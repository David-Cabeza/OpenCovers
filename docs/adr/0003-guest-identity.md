# ADR-0003: A guest belongs to one venue

- Status: Accepted
- Date: 2026-11-12
- Deciders: David Cabeza

## Context

Phase 10 makes the guest a record of its own, with notes, allergies and diet, occasions, tags, and visit history. Today no guest record exists. The engine must decide what a guest is before any guest data accumulates.

A guest today is a few columns on one reservation. The `reservations` table in `apps/api/src/db/schema.ts` holds `guest_name`, `guest_contact`, `consent`, `consent_recorded_at`, `rating`, `rating_recorded_at`, and `erased`. The `waitlist` table holds its own `guest_name` and `guest_contact`. No `guests` table exists, and no column links two reservations by the same person.

The contact is stored exactly as the caller sent it. Nothing trims, lowercases, or parses it. The contract describes it as "an email or a phone with its country code", but the API does not check that. A modify cannot change the name or the contact. `ModifyReservationInput` carries only `partySize`, `tableIds`, `consent`, and `rating`.

Consent and rating live on the reservation. `consentColumns` in `apps/api/src/lib/consent.ts` records `unknown`, `granted`, or `denied` with a time. `ratingColumns` in `apps/api/src/lib/rating.ts` records an integer from 1 to 5 with a time. REQ-N4 and REQ-N5 define both per reservation.

Erasure already works, and Phase 10 must not break it. `erase` in `apps/api/src/lib/venue.ts` takes a venue and either a `guestId` or a `principal`. It reads `guestId` as a contact and compares it to `guest_contact` with exact string equality, so `Eva@example.com` and `eva@example.com` are two people to it. For each match it blanks the name and the contact, resets consent to `unknown` and rating to null, sets `erased`, writes a tombstone, and emits an `erased` event. The tombstone hash is the SHA-256 of the reservation id, not of any personal value. It returns `erasedReservations` and `erasedGuests`, and `erasedGuests` is always 1 when anything matched. Erasure does not touch `waitlist` rows.

The contract already expects a guest record. The `Guest` schema in `docs/contract/openapi.yaml` describes `guestId` as "the engine's own guest record id, when one exists. Used for erasure." The implementation has no such id and uses the contact in its place.

The requirements pull two ways. REQ-G1 says the engine "stores no guest profile beyond" name, contact, party size, notes, and a principal reference. REQ-G2 says a booking that matches an existing guest record updates it rather than duplicating it, by an explicit matching rule. Phase 10 needs REQ-G1 amended. REQ-G2 then describes the rule this ADR proposes.

Three rules from the README bind the design:

- A venue's data is isolated. A request for another venue returns not found.
- The engine stores the minimum guest data a booking needs.
- Erasure returns counts and keeps hashes, not personal values.

Phase 15 adds a group entity above venues and "shared guests across a group by opt-in, built on the Phase 10 decision." No group entity exists today. Every venue-scoped table carries a `venue_id`.

The project is pre-alpha and nothing is deployed, so the reservation data a migration must carry today is test data.

## Decision drivers

- **Minimum data.** Notes and tags are new personal data. Allergies and diet can reveal health information, which carries stricter legal rules than a name or a phone number.
- **Erasure.** One request must remove a person from every place the engine holds them, including the new guest record, its history, and any audit entry about it.
- **Venue isolation.** A venue must never read another venue's guest, even inside a future group, unless someone opted in.
- **Group venues in Phase 15.** The Phase 10 choice must not force a rewrite when groups arrive.
- **Matching quality.** Two bookings by the same person should land on one guest. Two people should never land on one guest by accident.
- **Reversible merges.** Staff will merge the wrong two guests. Undoing a merge must restore both guests and their visits.
- **Consent and rating already live on the reservation.** Moving them would change shipped behavior, the contract, and two requirements.

## Decision

The maintainer accepted this decision on 2026-11-12. The answers to the open questions are recorded at the end.

We choose option C. A guest belongs to exactly one venue now, and the shape leaves room for a group to share guests by opt-in later.

1. **Scope.** A `guests` row carries a `venue_id` and is readable only through that venue, like every other row. Its id is a random UUID, never derived from the contact. No query joins guests across venues.
2. **Matching.** A booking links to a guest by an exact match on a normalized email or a normalized phone, within the venue. The name never takes part in matching. A booking whose contact does not normalize creates no guest and still succeeds.
3. **Normalization.** An email is trimmed, Unicode-normalized to NFC, and lowercased. Dots and `+` tags stay, because their meaning differs between mail providers and removing them can join two people. A phone is parsed to E.164. A number without a country code uses a per-venue default country. A contact with `@` is treated as an email. Anything else is treated as a phone.
4. **Booking path.** The booking transaction normalizes the contact and links `reservations.guest_id` to the matching guest. If none matches, it inserts one. A per-venue unique index on each normalized key, with insert-on-conflict, keeps two concurrent bookings from creating two guests. A matching failure never fails the booking.
5. **Merge.** Staff merge guest B into guest A. A takes B's keys, notes, and tags. B's reservations move to A. B is kept with `merged_into` set to A, so nothing is lost. Merge never runs automatically.
6. **Audit trail.** Every create, edit, merge, unmerge, and erasure on a guest writes a `guest_audit` row with the venue, the guest, the action, the acting principal, and the time. A merge entry also stores B's prior state and the ids of the reservations it moved.
7. **Unmerge.** Unmerge reads the merge entry, restores B, and moves the listed reservations back. A reservation booked after the merge stays with A, and staff can move it by hand.
8. **Erasure.** Erasing a guest blanks every linked reservation as `erase` does today, with the same tombstones and events. It then deletes the guest row, every guest it absorbed by merge, and the personal fields of every audit entry about them. It also blanks `waitlist` rows with the same normalized key. Each erased reservation keeps its date, party size, and status, with `guest_id` set to null, so cover counts survive and the visit history does not. `erasedGuests` reports the real number of guest rows removed.
9. **Erasure input.** `guestId` takes its contract meaning, the guest record id. A guest id that does not exist falls back to today's behavior, read as a contact and normalized first. Erasure by `principal` is unchanged.
10. **Consent and rating stay on the reservation.** Each is a statement about one visit, recorded at one time, and REQ-N4 and REQ-N5 define them that way. The guest view shows the latest consent and the rating history, derived from reservations and never stored on the guest.
11. **The reservation keeps its own name and contact.** A guest can book under another name, and a booking must work with no guest record. Erasure already clears both columns.

## Consequences

**Easier.** Phase 10 builds notes, tags, allergies, and history on one record per person per venue. Erasure gets a real guest id and stops depending on an exact string. Isolation needs no new rule, because a guest is one more row with a `venue_id`.

**Harder.** Every write path that takes a contact now normalizes it, including create, walk-in, the waitlist, and the CSV import. Phone parsing needs a library and a per-venue default country. Erasure today writes to `reservations`, `tombstones`, and `events`. It now also writes to `guests`, `guest_audit`, and `waitlist`. The audit trail is a second copy of personal data, and erasure must clear it.

**Accepted.** A guest who visits two venues of the same group exists twice until Phase 15 links the two records. Two people who share one email or phone become one guest, and staff split them with unmerge. A wrong contact typed on a booking links that booking to the wrong guest until staff move it.

## Migration

The engine stores no contact hash today, so a backfill cannot work from hashes. The tombstone hash is a hash of the reservation id. The backfill reads `guest_contact` directly.

1. Add `guests`, `guest_audit`, `reservations.guest_id` (nullable), and the per-venue unique indexes on the normalized keys.
2. Run a backfill script per venue. For each reservation with `erased` false and a non-empty `guest_contact`, normalize the contact. Group by venue and key. Create one guest per group, named after its most recent reservation. Link each reservation. Write one `created` audit entry per guest with the backfill as the actor.
3. Leave reservations with an empty or unparsable contact unlinked. Leave erased reservations alone.
4. Skip waitlist rows. A seated waitlist entry already points at a reservation through `waitlist.reservation_id`.
5. Switch the booking path to link on write, then change `erase` to the new rules in the same release.

The script is idempotent. A second run finds every key already present and creates nothing. Because nothing is deployed, the first real backfill runs on test data. Each fork that deploys before Phase 10 ships runs the same script.

## Deferred

- Sharing guests across a group. Phase 15 adds a link from a group to per-venue guest records, created by opt-in. It never moves or copies a record across venues.
- Suggesting duplicates by name or by fuzzy match. Phase 10 matches exact keys only.
- Identity across channels. REQ-G2 assigns it to the memory platform, not the engine.
- Guest events in the event feed and in webhooks.
- STOP per contact under REQ-N3. The engine has no STOP handling today. It belongs to the normalized contact key, not to the guest record, because it must work for a booking with no guest.
- Rule-based tags and segment queries. Both read the guest record this ADR defines and need no further identity decision.

## Options considered

### A. A guest per venue

Each venue has its own guests, and nothing more is planned. This is the smallest change and fits isolation as it stands. Phase 15 would then need to decide how two venues' records of one person relate, with no design to build on. Option C is option A plus three rules that keep Phase 15 additive. Ids are random. Normalized keys are stored. No guest field has a meaning that depends on the venue.

### B. A guest per group from day one

One guest record serves every venue in a group. Staff at one venue see notes typed at another, which is the point of a group and also a break in "a venue's data is isolated". No group entity exists yet, so every venue would start as a group of one, and Phase 10 would design the group early. Erasure becomes ambiguous. A guest who asks one venue to forget them may still expect another venue in the group to remember a booking. Whether one venue may see another's guests depends on who the legal controller is, and nobody has answered that. Going from B back to per-venue later means splitting records. Going from C to shared later means adding a link. We reject B for now.

### C. A guest per venue, shareable by opt-in later

This is the decision above.

### Matching alternatives

- Match on name and contact together. Rejected because one person types their name several ways, and the contact alone is the stronger signal.
- Strip dots and `+` tags from email. Rejected because the rule holds for some mail providers and not others, and a wrong join is harder to fix than a missed one.
- Store only a hash of the normalized key. Rejected for Phase 10 because the reservation already stores the contact in clear and staff read it. A hash would protect nothing. A shared group index in Phase 15 may need one.

### Merge alternatives

- Merge by deleting B. Rejected because unmerge would have nothing to restore.
- Keep reservations on B and resolve `merged_into` on every read. Rejected because every guest query would follow a chain. Moving reservations and recording the move in the audit entry costs one write at merge time.

### Consent and rating alternatives

- Move consent to the guest. Rejected because consent is recorded per visit with a time, and REQ-N4 and the contract define it there. A guest-level "latest consent" is a read over reservations.
- Move rating to the guest. Rejected because a rating is about one visit.

## Resolved questions

The maintainer settled these on 2026-11-12.

- Allergies and diet. Phase 10 does not store them as a structured field on the guest record. A guest has a free-text note, with an on-screen warning not to record health details. Allergies stay as a note on each reservation. A structured field waits for the legal review of Phase 7, because allergies can reveal health information. That reading is general knowledge and a lawyer must confirm it.
- Guest record lifetime. A guest record reuses `venues.retention_days` (default 400). That many days after the last visit, the guest's personal fields are cleared and the visits stay as anonymous rows. The default is a starting value, and the legal review may change it.
- `guestId` in erasure. It becomes the guest record id, which is what the contract already says. The contact match stays as a fallback for one version and is documented as deprecated. No contract version bump, because the project is pre-alpha with no stable version. Known consumers are told when the change ships.
- A walk-in with no contact does not create a guest.
- Only an admin can merge and unmerge. Opening it to `write` keys can come later.
- Guest changes stay out of the event feed until a consumer needs them.
- The default country for phone numbers is a venue setting. The time zone only supplies its initial value.

## Still open

- Who is the data controller in a group, each venue or the group. This is decided in Phase 15, before any sharing.
- The legal review of retention periods and of health-related notes.
