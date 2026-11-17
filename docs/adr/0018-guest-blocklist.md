# ADR-0018: Guest blocklist on keyed hashes of the contact

- Status: Accepted
- Date: 2026-11-17
- Deciders: David Cabeza

## Context

A venue wants to refuse bookings from a guest who repeatedly does not show up or who abused staff. The engine keeps the minimum of guest data (REQ-G1), so a list of names, emails or phones in clear would break the rule that the list exists to serve. GitHub issue #66 asks for a per-venue blocklist matched on a hash of the normalized email or phone, with no clear value stored, and asks for this ADR before any code. ADR-0013 left the blocklist out of the booking policy and named it as the tool for a determined repeat guest.

Facts this design rests on, read in the code on `main` at `13e7f49`:

- **Normalization.** `normalizeContact` in `apps/api/src/lib/contact.ts` turns a raw contact into `{ kind: "email" | "phone", value }` or null. A contact with `@` is an email, trimmed, NFC-normalized and lowercased, with dots and `+` tags kept. Anything else is parsed to E.164 with the venue's default country from `venueCountry`. A contact that does not parse returns null. ADR-0003 and REQ-G2 define this rule.
- **Guest records hold contacts in clear.** `guests` has `email` and `phone` columns, unique per venue, and `reservations.guest_contact` keeps the contact as typed. Any `read` key or session can list and read guests with their email and phone (`GET /guests`, REQ-G4).
- **The create path.** `createReservation` in `apps/api/src/lib/reservations.ts` runs `timeReasons` and the service reasons before the transaction. Inside the transaction it checks the idempotent replay first, then takes the per-guest advisory lock when the cap is set, links the guest with `linkGuest`, counts toward `guest_booking_limit`, searches for tables or overbooking room, and inserts the reservation, its allocations, the idempotency key and the `created` event. A thrown `ReservationError` rolls back all of it, including a guest row that `linkGuest` inserted and its `guest_audit` row.
- **Callers of create.** `POST /reservations` calls `createReservation`. `POST /reservations/walk-in` and `POST /waitlist/{id}/seat` call `walkIn`, which calls `createReservation` with `initialStatus: "seated"`, so `walkIn` is true. I found no CSV import or other write path.
- **Modify cannot change the contact.** It changes party size, tables, consent, rating, note and reconfirmation (ADR-0013).
- **Availability and the explanation are anonymous.** `explainSlot` takes date, time, party size and zone, and no contact. ADR-0013 rejected adding a contact to availability because it would let a caller probe whether a contact has bookings.
- **Errors.** `apps/api/src/lib/errors.ts` is a typed registry. Every code has a status and `retryable`. `forbidden` (403) means the caller lacks the role. `approval_required` exists and no route emits it.
- **Erasure.** `erase` in `apps/api/src/lib/venue.ts` deletes the guest rows it targets, with their merged family, blanks their reservations with tombstones, deletes matching waitlist rows, and returns counts. It is admin only ([ADR-0017, erasure](0017-erasure-admin-only.md)).
- **Retention.** `runRetention` in `apps/api/src/lib/retention.ts` uses `venues.retention_days` (default 400) to clear guests, unlinked reservations, waitlist rows, events and `membership_audit` rows. I found no route that sets `retention_days`.
- **Audit.** `membership_audit` (ADR-0010) holds ids, a role and an action from a check-constrained set, and `GET /audit` reads it behind `adminOnly`.
- **Secrets.** `BETTER_AUTH_SECRET` falls back to a public development value, and `compose.prod.yaml` refuses to start without it. `docs/hardening.md` says dumps hold guest data.
- **Agents.** ADR-0014 gives remote MCP tokens at most `write`, an allowlist of 16 operations, and a `staffSessionOnly` guard that refuses the OAuth identity.

## Decision drivers

- **No clear value, and no cheap way back to one.** A database leak must not turn into a list of the venue's refused guests.
- **The refusal says no more than it must.** A refused caller learns that this booking is declined. It learns nothing about other entries, the reason, the date or who added it.
- **Reuse what exists.** The same normalization, the same check point and error vocabulary as ADR-0013, the same audit log as ADR-0010, and the same admin boundary as ADR-0009 and the erasure ADR-0017.
- **A person decides.** Adding someone to the list is a judgment about a human, made by a named staff member, and it can be undone.
- **Fail visible.** A wrong lockout, a lost key or an erasure that keeps an entry must show up where an admin looks.

## Decision

### What is hashed

The engine hashes the normalized contact that `normalizeContact` returns, using the venue's `venueCountry`. It never adds a second normalization. Email and phone are separate entries. A guest with both gets two entries.

The hash is an HMAC-SHA-256 under a per-venue key derived from one instance secret:

```
venueKey = HMAC-SHA-256(BLOCKLIST_KEY, "opencovers-blocklist-v1:" + venueId)
hash     = hex(HMAC-SHA-256(venueKey, kind + ":" + value))
keyId    = hex(HMAC-SHA-256(BLOCKLIST_KEY, "opencovers-blocklist-key-id"))[0..16]
```

`BLOCKLIST_KEY` is a new environment variable, 32 random bytes in base64 (`openssl rand -base64 32`). It follows the pattern of `BETTER_AUTH_SECRET`. Local development falls back to a fixed public value. `compose.prod.yaml` refuses to start without it. `docs/hardening.md` adds it to the secrets table, says it must never be stored with a database dump, and says that a dump restored under another key leaves the list inactive.

It is a separate secret from `BETTER_AUTH_SECRET`, so rotating the session secret after a session leak does not empty every venue's list.

The per-venue derivation means one contact blocked at two venues has two unrelated hashes. A dump does not show that the same person is refused in two places. The venue id is in the derivation and not in a stored salt, so nothing per venue is stored and nothing needs rotating per venue.

The hashing is a pure function next to `normalizeContact`. The key is read and checked once at startup. A value that is not base64 of at least 32 bytes stops the API, as an unknown `SIGNUP` value does.

### What an attacker with a database dump learns

With the dump and without `BLOCKLIST_KEY`, an attacker learns:

- how many entries each venue has, of which kind, with what reason code, when each was added, and the account id that added it, which the `user` table in the same dump turns into a staff email;
- the `guest_blocked` and `guest_unblocked` audit rows.

The attacker cannot test whether a contact is on the list, cannot link an entry to a guest record in the same dump, and cannot tell whether two venues refuse the same person. Brute force needs the key.

With the dump and the key, which means the server itself is compromised, the protection is gone. A plain hash of a phone number falls to brute force in seconds. Spanish mobile numbers, for example, are about 2 x 10^8 values, and one GPU computes SHA-256 at billions per second. That is an estimate, not a measurement. The attacker can also hash every contact in `guests`, which holds them in clear, and join. The HMAC protects against a database-only leak: a stolen backup, a read through SQL injection, a replica or a support dump. It does not protect against someone who holds the server's environment.

### Rotation

Each entry stores the `keyId` of the key that made it. An optional `BLOCKLIST_KEY_PREVIOUS` holds the old key during a rotation. The create check computes the hash under each configured key and matches on `(venue_id, key_id, hash)`. New entries use the current key. Old entries cannot be re-keyed, because the engine has no clear value, so they stay under the previous key until an admin removes them or retention deletes them. When no entry under the previous `keyId` remains, the operator removes `BLOCKLIST_KEY_PREVIOUS`.

An entry whose `keyId` matches no configured key never matches a booking. The list returns it with `active: false`, so a lost or wrong key shows up in the admin's list and does not silently empty it.

### Table

`guest_blocklist`:

| Column | Type | Rule |
| --- | --- | --- |
| `id` | text | A random UUID. The handle for removal and the audit row. |
| `venue_id` | text | Not null, references `venues`, cascades on delete. |
| `kind` | text | `email` or `phone`, check constraint. |
| `key_id` | text | 16 hex characters. |
| `hash` | text | 64 hex characters, as `tombstones.hash` is stored. |
| `reason` | text | Null or one of `no_show`, `late_cancellation`, `conduct`, `other`, check constraint. |
| `created_by` | text | The account id of the admin. No foreign key, as in `membership_audit`, so deleting the account does not cascade. |
| `created_at` | timestamptz | Not null, default now. |

A unique index on `(venue_id, key_id, hash)` makes an add idempotent and serves the create lookup. An index on `(venue_id, created_at)` serves the list and retention.

The table has no clear value, no free text and no `guest_id`. A link to the guest would let anyone with the dump read who is blocked without the key, and it would have to be cut on erasure, which would detach the entry from its only purpose. The reason is a code because free text about a person invites accusations, names and health details, and a code is enough for an admin to recall why.

### Routes

Four routes under `/v1/venues/{venueId}/blocklist`, all behind `adminOnly` and `staffSessionOnly`:

- `POST /blocklist` with `{ guestId }` or `{ contact }`, and an optional `reason`. It adds one entry per normalized key and returns `{ entries }`, each with `id`, `kind`, `reason`, `createdAt`, `createdBy`, `expiresAt`, `active`, and `created` (false when the entry already existed).
- `GET /blocklist` returns `{ entries, nextCursor }`, newest first, `limit` 1 to 200, default 50, with a cursor bound to the venue as in `GET /audit`.
- `POST /blocklist/lookup` with `{ guestId }` or `{ contact }` returns the matching `{ entries }`, possibly empty.
- `DELETE /blocklist/{entryId}` removes one entry and returns it.

A contact travels only in a request body, never in a URL, so it stays out of the access logs of proxies. The response never echoes a contact or a hash.

**Add by guest id.** Staff never type the value again. The route reads the guest's email and phone, and those of every guest merged into it, and adds an entry for each. The guest record already holds normalized keys, so nothing is normalized again. A guest of another venue, a merged-away guest or a guest cleared by retention fails with `guest_not_found`.

**Add by contact.** The contact is normalized with the venue's default country and hashed on receipt, and the clear value is dropped. A contact that does not normalize fails with `invalid_request`, because an entry that no booking could match would only mislead.

**Idempotency.** An add of an entry that already exists changes nothing, writes no audit row, and returns it with `created: false`. A second delete of the same id fails with `blocklist_entry_not_found`. Both converge to the same end state, so neither route needs an `Idempotency-Key`, as the table, service and config routes need none. To renew an entry, an admin removes it and adds it again.

**Limit.** A venue holds at most 10,000 entries. An add that would exceed it fails with `blocklist_limit_reached` (409) and adds nothing. A restaurant's real list is tens of entries. The cap bounds a runaway script or a hijacked admin session. The create lookup is one index probe whatever the size.

### Who may read and edit

Only an `admin` with a staff session. A `read` or `write` session fails with `forbidden`. An API key of any role, an `admin` key included, fails with `forbidden`. ADR-0006 and ADR-0009 give the reason. A key is an integration, not a person, and refusing a person is a person's act. `created_by` needs an account id, and a key has none.

The guest routes stay unchanged. `GET /guests/{guestId}` does not show whether a guest is blocked, because `read` keys can call it and would learn list membership for every guest they can list.

### Audit

Two new actions in `membership_audit`, `guest_blocked` and `guest_unblocked`, with a new nullable column `blocklist_entry_id`. Each add that creates an entry and each delete writes one row in the same transaction, with `actor_user_id` and the entry id, and no hash, contact or reason. An add by guest id that creates two entries writes two rows. `GET /audit` returns them with the other actions. The log is the venue's record of access and admin decisions, and ADR-0014 already decides to extend it to agent grants, so a second audit table would duplicate it, as ADR-0011 argued.

A removed entry's audit rows stay, and they hold only a random id, so they link to no person once the entry is gone.

### Where the check runs

The check runs in `createReservation`, inside the transaction, after the table search finds tables or overbooking room and before the reservation insert. The order is: idempotent replay, cap lock, `linkGuest`, cap count, table search, blocklist, insert.

- **Replay first.** A replay of a create that succeeded before the entry was added returns the original booking, as ADR-0013 does for the cap. A declined create rolls back and stores no idempotency key, so the same key succeeds after an admin removes the entry.
- **Last before the insert.** A blocked guest gets `booking_declined` only when the booking would otherwise have been made. When the time is closed, the date blocked, the guest at the cap or no table free, the blocked guest gets the same code as anyone. This is the opposite of the cap's placement, on purpose. A probe at a closed or full time learns nothing, and each probe of a contact that is not blocked creates a real booking. See Threats.
- **Always run.** The lookup runs on every create with a contact that normalizes, whether or not the venue has entries. It costs one index probe.
- **Nothing left behind.** A declined create leaves no reservation, no guest row, no guest audit row, no idempotency key, no event and no email, because the transaction rolls back and `notifyReservation` runs only on success.

A create whose contact does not normalize, or that has no contact, is not checked, as it is not counted for the cap.

### Walk-ins, the waitlist and staff bookings

A walk-in bypasses the list, as it bypasses the booking policy in ADR-0013. The guest is at the door and staff decide face to face. Seating from the waitlist goes through `walkIn`, so it bypasses too. Adding to the waitlist does not check the list, because the waitlist is the walk-in queue.

Every other create is checked, whoever calls it. A staff session booking a blocked guest by phone gets `booking_declined`, which tells the staff member what they need to know. An admin who wants to take the booking removes the entry first.

Adding an entry never cancels or changes an existing booking. A booking cannot change its contact, so it continues. Staff cancel it by hand if they want to.

### What a refused guest sees

A new code, `booking_declined`, status 409, `retryable: false`. The body is the usual `{ code, message, retryable }` with no details. `docs/contract/errors.md` describes it as "the venue does not accept bookings for this contact. Show the guest a neutral message and send them to the venue directly." The code tells the caller one fact, that this contact cannot book here. Any refusal tells the caller that much, so no code can hide it. The response holds no reason, no date, no actor, and nothing about other entries.

409 matches `guest_booking_limit`, a refusal caused by the venue's state about this guest. 403 would be wrong. `forbidden` means the caller's role is too low, and ADR-0014 uses 403 on the remote endpoint to ask for more scope, so a client could re-authenticate or ask for scope in a loop. `retryable` is false because repeating the request cannot succeed until an admin removes the entry.

The engine says what the code means in the public contract. Disguising it as another code would mislead honest integrators and stop no attacker, who can tell the cases apart by trying a second contact on the same slot.

### Availability and the explanation

Availability and `GET /availability/explain` do not take a contact and do not consult the list. They stay anonymous, as ADR-0013 keeps them for the cap.

This changes one acceptance criterion of issue #66, "shown as unavailable in the explanation". An explanation that takes a contact and answers differently for a blocked one is a free membership test for every `read` key. One request with the contact and one without, on a free time, give the answer, with no booking made and nothing for staff to see. Equal messages do not help, because the difference between the two answers is the leak. Equal timing does not help either, for the same reason. The only explanation that leaks nothing is one that ignores the list, which is what this ADR decides. The conformance text that says availability and the explanation never apply the cap gains the blocklist beside it. Those are the two reasons a create can fail on a time the explanation shows as available.

### Erasure and retention

**An entry survives erasure.** Erasing a guest deletes the guest record and blanks the reservations, and leaves any matching blocklist entry in place. The erasure response gains `blocklistEntriesKept`, the number of entries that match the keys of the guests it removed and the contact it was given. The admin handling the request sees that the refusal stays and can tell the person. Erasure never removes an entry silently, and never keeps one silently.

**Entries expire.** `runRetention` deletes an entry `retention_days` after its `created_at`, in bounded batches like its other steps, and writes no audit row, because the expiry follows from a rule the list response shows as `expiresAt`. An admin who still wants the refusal after that adds the entry again.

**Rationale.** This is a design position, not legal advice. A lawyer must confirm it, as ADR-0003 already requires for retention periods.

- A keyed hash of a contact is pseudonymous data. The venue holds the key and can test any contact it knows, so the entry is still personal data under the GDPR (Recital 26). Minimization and retention apply to it.
- The basis is the venue's legitimate interest in refusing service to people who repeatedly do not show up or who abuse staff (Art. 6(1)(f)). The entry is the least that serves it: a hash, a kind, a code, a time and an account id.
- A guest who asks for erasure is in effect asking to be unblocked. The right to erasure gives way where overriding legitimate grounds exist (Art. 17(1)(c) with Art. 21(1)). Removing the entry on request would defeat its only purpose. The guest can still object, and an admin decides by removing the entry or not.
- The expiry keeps the entry from outliving the reason. A recycled phone number or a changed person is bounded by `retention_days`.
- A guest who asks what the venue holds about them is answered by an admin through `POST /blocklist/lookup` with their contact.
- The venue's privacy notice should say that it may keep such a list. That text is the venue's, not the engine's.

### Agents and MCP

No MCP tool adds, lists, looks up or removes entries, on stdio or remote. Agents are only refused by the list. A remote token never reaches these routes, because ADR-0014's dispatcher allowlist does not contain them, and ADR-0014 changes `staffSessionOnly` to refuse the OAuth identity. A stdio server with an `admin` key is refused by `staffSessionOnly`. `reservation.create` in `docs/contract/mcp.md` gains `booking_declined` among its errors.

[ADR-0017, booking widget](0017-booking-widget-and-self-service-link.md), accepted, decides a public create route. If it is built, it must call `createReservation`, so the same check applies there with no extra code, and its per-address and per-venue limits bound probing.

### Venue isolation

Every entry carries `venue_id`, and every route runs behind the venue middleware. An entry id of another venue fails with `blocklist_entry_not_found`, indistinguishable from an unknown id. A guest id of another venue fails with `guest_not_found`. The per-venue key makes the hashes of two venues unrelated. An entry in one venue never affects a booking in another. Sharing a list across a group (Phase 15) is out of scope, and would need each venue to add its own entries, because hashes do not carry across venues.

### Errors

Three new codes in the registry, all `retryable: false`:

| Code | Status | When |
| --- | --- | --- |
| `booking_declined` | 409 | A create matches an entry. |
| `blocklist_entry_not_found` | 404 | A delete names an unknown entry, or one of another venue. |
| `blocklist_limit_reached` | 409 | An add would exceed 10,000 entries. |

Other failures reuse `invalid_request`, `guest_not_found`, `forbidden` and `venue_not_found`.

### Scope

This ADR changes no code and no contract. The implementation for #66 then changes, together, `docs/contract/openapi.yaml`, `docs/contract/conformance.md` with a new case, `conformance-status.md`, `docs/contract/errors.md`, `docs/contract/mcp.md`, the migration, the routes, the create check, erasure, retention and `docs/hardening.md`. The staff app screen is out of scope, as #66 says.

## Threats

**Enumerating the list through create.** A caller with a `write` key, or a future public widget, tries contacts against create. It needs a time that is bookable, because the check runs only where the booking would otherwise succeed. Each contact that is not blocked becomes a real booking on the agenda, with a `created` event, and a confirmation email to that contact when notifications are on. Probing is therefore noisy and visible to staff. It is not prevented. A `write` key can list every guest's contact in clear through `GET /guests` and test each, at the cost of one booking per guest that is not blocked. `/v1` writes have no rate limit (hardening known gap 2). The ordering keeps this from being free, and the limits of a future public route bound it.

**Enumerating through timing.** Availability and the explanation never touch the list, so they have no timing to measure. On create, a declined request returns sooner than a booking, but the response already says which happened, so timing adds nothing. The lookup runs on every create with a usable contact, so its cost does not reveal whether a venue has a list.

**Dictionary attack on a dump.** Without `BLOCKLIST_KEY`, the attacker cannot test a single contact. With it, phones and emails fall to brute force, and the attacker is already on the server. The key stays out of the database and out of dumps, and `docs/hardening.md` says so.

**A staff member abusing the list.** Only an admin with a staff session can add or remove. Every change writes an audit row with the admin's account id, the list shows `createdBy` on each entry, the reason is a code and not text, and entries expire. Another admin can see and remove any entry. Nothing stops a sole admin who acts in bad faith. The engine records who did it, which is the same limit ADR-0009 accepts for SQL access.

**A guest locked out wrongly.** A shared family phone, a recycled number, a typo when an admin typed a contact, an office email used by several people, or an add by guest id after a wrong merge, which blocks the other person's contact too. The guest sees `booking_declined` and the integrator sends them to the venue. An admin runs `POST /blocklist/lookup` with the guest's contact, deletes the entry, and the guest books again. The audit log records both the add and the removal. An unmerge does not remove entries added while the guests were merged. The admin looks up the restored guest and removes its entries by hand.

## Consequences

**Easier.**

- A venue refuses a repeat no-show or an abusive guest in one call, from the guest record, with no value typed again.
- A database leak does not expose who is refused, and does not link refusals across venues.
- The refusal reuses the create transaction and the error registry, so every create path, a future public one included, applies it with no new code.
- An admin can answer an access request and fix a wrong lockout without SQL.

**Harder.**

- The operator holds one more secret, keeps it out of backups, and loses the list if the key is lost. The list says so with `active: false`.
- An admin cannot read who is on the list. An entry shows its kind, reason, date and creator, and only a lookup by guest or contact says whom it refuses.
- Erasure computes the hashes of the guests it removes to count kept entries.
- The conformance cases gain a second guest-dependent exception to "the explanation agrees with create", beside the cap.

**Accepted.**

- A guest who books with another email or phone, a `+` tag, or a contact that does not parse is not refused. The list stops the same contact, not a determined person, as the cap does.
- A caller who holds a `write` key can learn whether a known contact is blocked, at the cost of a visible booking for each one that is not.
- A refusal outlives the guest's erasure, for up to `retention_days` from when it was added.
- A key leak together with a dump exposes the list to brute force.
- A staff booking for a blocked guest fails until an admin removes the entry.

## Alternatives considered

- **A plain SHA-256 of the contact.** Rejected. Phone numbers and emails are low-entropy, so the hash is reversible by brute force from a dump.
- **A random salt per entry, stored in the row.** Rejected. The salt is in the dump, so each entry is still brute-forced in seconds, and the create check would need one hash per entry instead of one lookup.
- **A per-venue salt stored in `venues`.** Rejected for the same reason. It only defeats precomputed tables, and the dump holds the salt.
- **A slow password hash, such as Argon2, with a per-venue salt.** Rejected as the main protection. It makes one guess costly but adds tens of milliseconds to every create, and a targeted test of one email is still one guess. It can be layered on later if the key alone proves weak.
- **One instance key without the venue in the derivation.** Rejected. One contact blocked at two venues would show the same hash in a dump.
- **A random key per venue, stored in the database.** Rejected. The key would be in the dump. Encrypting it under an instance secret makes the instance secret the real key again.
- **Reuse `BETTER_AUTH_SECRET`.** Rejected. Rotating it after a session leak would silently empty every list.
- **Link the entry to the guest record.** Rejected. The dump would show who is blocked without the key, and erasure would have to cut the link.
- **Free-text reason.** Rejected. It would hold names, accusations and health details, which the engine keeps out of every other field.
- **Remove the entry on erasure.** Rejected. A blocked guest could unblock themselves by asking to be forgotten.
- **Keep entries forever.** Rejected. Pseudonymous data needs a bound, and phone numbers are reassigned.
- **Reuse `forbidden`.** Rejected. It means the caller's role, and ADR-0014 uses 403 on the remote endpoint to ask for more scope.
- **Reuse `guest_booking_limit` or `approval_required`.** Rejected. Each already means something else, and a disguise stops no attacker, who can compare two contacts on one slot.
- **Check before the table search, as the cap does.** Rejected. A probe at a closed or full time would learn membership for free, with no booking made.
- **A contact parameter on availability or the explanation.** Rejected, as ADR-0013 rejected it for the cap. See Availability and the explanation.
- **Show `blocked` on the guest record.** Rejected. `read` keys read guests and would learn list membership.
- **Let `admin` keys and the stdio MCP manage the list.** Rejected for now. A key is not a person, and an agent should not decide whom a venue refuses. See the open questions.
- **Block automatically after N no-shows.** Rejected. A refusal of service to a person should be a person's decision, made one at a time and attributable.
- **A separate audit table.** Rejected. `membership_audit` already holds the venue's admin decisions with ids only.
- **Soft-delete entries to keep removal history.** Rejected. The hash would stay stored after its purpose ended. The audit row already records the removal.

## Decisions on the open questions

The owner accepted this ADR with the recommendations below.

1. **The explanation criterion in #66.** Amended to "refused in create, and the explanation stays anonymous".
2. **How long an entry lives.** `retention_days` from creation. No separate setting until a venue asks.
3. **Admin keys and bulk import.** No key access. If an import is needed, a staff-session route that hashes contacts on receipt.
4. **A staff override on create.** None. An admin removes the entry first.
5. **The reason codes.** `no_show`, `late_cancellation`, `conduct`, `other`, nullable. No code that alleges a crime.
6. **Report existing bookings on add.** Yes, as a count of `booked` bookings in the response, computed and not stored.
7. **The production fallback for `BLOCKLIST_KEY`.** Match `BETTER_AUTH_SECRET` for now. Both change together in a separate change.
8. **Legal review.** The design stands. The question joins the Phase 7 legal review that ADR-0003 depends on, before the first real venue.
