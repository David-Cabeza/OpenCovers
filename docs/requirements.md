# Requirements

OpenCovers is an independent reservations engine for restaurants. These requirements describe what the engine must do. They are OpenCovers' own requirements, derived from the design rules recorded at the project's start.

Each requirement has an id and an acceptance criterion. The ids are stable and are referenced by the conformance cases and the contract.

How slots are generated from services and hours, reservation duration, table combinations, and the exact status transition map are venue configuration. They are specified in the contract, not here.

## Domain

### REQ-D1 Venue is the unit of tenancy

Every reservation belongs to one venue. A venue has hours, exceptions, tables, table combinations, services, slots, and zones.

Acceptance: a request scoped to one venue can never read or write another venue's data. A request for a venue that does not exist, or that the caller cannot see, is indistinguishable from not found.

### REQ-D2 Services

A venue's opening is split into named services, for example lunch and dinner. Each service has its own table and seat counts.

Acceptance: availability and agenda are grouped by service, and a booking always lands in exactly one service.

## Availability

### REQ-A1 Availability query

A caller can query availability for a venue, a date, and a party size. The engine returns the bookable time slots.

Acceptance: the response names, for each slot, whether it is free and what reservation type it requires.

### REQ-A2 Reservation types

A slot carries the reservation type it accepts, for example free or prepaid. The type comes from the venue's configuration.

Acceptance: a prepaid slot cannot be booked as a free reservation, and the response states the requirement.

### REQ-A3 A read is not a hold

An availability read is a snapshot. It reserves nothing.

Acceptance: two clients can both see a slot free and race to book it. The write transaction resolves the race. Conformance case C3 proves this.

### REQ-A4 Availability explanation

A caller that can read a venue can ask why a time is or is not bookable for a party size, optionally in one zone. The answer comes from the same rules that decide availability and booking, so it cannot disagree with them.

Acceptance: the answer lists every reason that blocks the time, in a fixed order, each with a code from the error vocabulary and the facts that decided it. A blocked time also returns up to 3 nearest available times that day. The answer holds no personal data. Conformance case C20.

### REQ-A5 Turn time and party limits

How long a booking holds its tables depends on its party size, from a table of turn times the venue sets. A service can take only parties between a minimum and a maximum size. Availability, booking, and the explanation apply both rules the same way.

Acceptance: a larger party holds its tables longer and a smaller one frees them sooner, a venue without turn times keeps one fixed duration, and a party outside the limits of a service cannot book it and sees its times as unavailable. A walk-in is not held to the limits. Conformance case C21.

## Booking

### REQ-B1 One transaction

Availability and booking are decided in one transaction.

Acceptance: there is no window between checking and writing where another writer can slip in. Conformance case C1 proves it.

### REQ-B2 Exclusion in the database

The rule that no two reservations can occupy one table with overlapping time is enforced by a database constraint, not only by application code.

Acceptance: a caller that deletes or bypasses the application check still cannot double-book a table. The mutant sweep of the overlap predicate is a storage test, run apart from the API conformance cases.

### REQ-B3 Server-assigned table and zone

The engine assigns the table and zone for a booking. A caller may request a specific table or zone when the venue allows it.

Acceptance: a booking that does not name a table still gets exactly one table assigned, and the response returns it. The one exception is a venue that sets an overbooking ceiling above 0, see REQ-B7.

### REQ-B4 Idempotent writes

Every write carries an idempotency key. Repeating the same key returns the original result, never a second booking.

Acceptance: conformance case C2 proves the replay behavior.

### REQ-B5 Monotonic versions

Every modification to a reservation produces a new, higher version. Versions are monotonic per reservation.

Acceptance: no two writes can produce the same version, and versions never go backward.

### REQ-B6 Status

A reservation's status is a closed vocabulary: booked, seated, attended, no_show, cancelled. Transitions are explicit and limited.

A reservation cannot be seated without a table. A move to `seated` needs at least one active table allocation and otherwise fails with `table_required`. A booking accepted under the overbooking ceiling (REQ-B7) holds no table, so staff assign one with a modify before it can be seated. A walk-in is seated with its tables at creation and is not affected.

Acceptance: the engine refuses a status it does not define, and a transition that is not allowed fails. Conformance case C26. A booking without tables cannot be seated, and a table that another booking holds is refused when staff assign it.

### REQ-B7 Explicit overbooking ceiling

A venue can set `overbookingCeiling`, the most covers it accepts without tables at any one time. The default is 0, and then every booking holds tables as REQ-B3 says. Above 0, a booking that fits the venue but finds no free table combination is accepted with no tables while the covers of the overlapping active bookings without tables stay within the ceiling. The ceiling never relaxes REQ-B2. A booking without tables holds no allocation, and tables are assigned later through a modify that the exclusion constraint checks, and the booking cannot be seated before then (REQ-B6). It does not apply to walk-ins, to named tables, or to a party larger than the venue.

Acceptance: conformance case C24. At 0 every booking holds tables, and a modify cannot release them all. Concurrent creates never take more than the ceiling. A table assigned to a booking over the ceiling is refused when another booking holds it.

## Guest and client

### REQ-G1 Minimum data

The engine stores only the guest data a booking needs: name, a contact, party size, notes, and a principal reference. Beyond the booking it keeps one guest record per person per venue, as decided in [ADR-0003](adr/0003-guest-identity.md). Today that record holds the normalized email or phone, a display name, and the time of the latest visit. It holds nothing a booking does not already carry. A booking never depends on it.

Acceptance: a booking can be made and honoured without a guest record. A booking with no contact, or with a contact that does not normalize, creates none. Erasure removes the guest record with the reservations linked to it.

### REQ-G2 Reuse by rule

The engine decides when a booking reuses an existing guest record and when it creates one, by an explicit matching rule on its own fields, such as the contact. Identity across channels belongs to the memory platform, not to the engine.

The rule is an exact match on the normalized contact within one venue. An email is trimmed, Unicode-normalized to NFC, and lowercased, keeping dots and `+` tags. Anything else is a phone, parsed to E.164 with the venue's default country when it has no country code. The name never takes part.

Acceptance: the matching rule is documented and tested, and a booking that matches an existing record updates that record rather than duplicating it. Conformance case C17.

### REQ-G3 The engine sets the basis

`basis`, `owner_principal`, and `booked_via` are set by the engine from the authenticated channel at booking time. A caller or a model never types them.

Acceptance: a write that tries to set these fields is rejected or ignored, and the stored value comes only from the channel.

### REQ-G4 Guest list and merge

Staff and platforms with read access list and read the venue's guests. Only an admin merges two guests and undoes a merge. A merge moves the absorbed guest's reservations to the target and keeps the absorbed guest, so an unmerge restores it with exactly the reservations moved. The audit entry of a merge holds the absorbed guest's prior state, which is personal data, so erasure and retention clear it.

Acceptance: conformance case C19.

## Notices and consent

### REQ-N1 Notice address

The venue's notice address is required to turn the engine on and cannot be cleared while the engine is on.

Acceptance: turning on without an address fails, clearing the address while on fails, and a venue already on without one stays on.

### REQ-N2 Confirmation and reminder

A confirmation and a reminder are sent one time per reservation id and version. They are off per venue until the text and the basis pass legal review.

Acceptance: a retry never sends a second message for the same id and version, and a modification sends one new confirmation.

### REQ-N3 STOP

A STOP from the guest closes proactive messages for that contact across the engine.

Acceptance: after a STOP, the engine sends no proactive message to that contact, and the booking itself still works.

### REQ-N4 Per-reservation contact consent

Each reservation records whether the guest allows being contacted after the visit. The value is `unknown` (never asked, the default), `granted`, or `denied`, with the time it was recorded. It can be set on create and walk-in and changed on modify. Erasure resets it to `unknown`. The engine does not gate its own emails on it. Integrations read it.

Acceptance: a reservation created without consent reads back `unknown`. A create with `granted` reads back `granted` with a recorded time. A modify that changes consent bumps the version once and emits one `modified` event, and the same value changes nothing. Erasure leaves `unknown` and no recorded time.

The legal basis and the consent text shown to guests are pending review. This requirement defines the stored signal only.

### REQ-N5 Per-reservation guest rating

Each reservation can record the guest's rating of the visit, an integer from 1 to 5, with the time it was recorded. Absent means not given. Staff or a key with `write` can set it on create and walk-in and change or clear it on modify. Erasure resets it. Integrations read it, for example to triage a visit after the fact.

Acceptance: a reservation created without a rating reads back null. A create with `5` reads back `5` with a recorded time. A modify that changes the rating bumps the version once and emits one `modified` event, and the same value changes nothing. Null clears the rating and its time. A value outside 1 to 5 fails with `invalid_request`. Erasure leaves null and no recorded time.

### REQ-N6 Per-reservation booking note

Each reservation can carry a short free-text note for staff, up to 500 characters, such as an occasion. Absent means an empty string. Staff or a key with `write` can set it on create and walk-in and change or clear it on modify. Erasure and retention clear it. The note is not for health data. The engine cannot tell whether a note holds any, so the contract states the rule and the engine adds no allergy or diet field until a legal review of health data is done. The note stays on the reservation and is never copied to a guest record, an email, or a webhook payload.

Acceptance: a reservation created without a note reads back an empty string. A create with a note reads it back, trimmed. A modify that changes the note bumps the version once and emits one `modified` event, and the same value changes nothing. An empty string clears it. A value that is not a string or is longer than 500 characters fails with `invalid_request`. Erasure leaves an empty string.

### REQ-N7 Per-reservation reconfirmation

Each reservation records where the guest stands on reconfirming it: `none` (not asked, the default), `requested`, `confirmed`, `declined`, or `no_answer`, with the time it was recorded. Staff or a key with `write` can set it on create and change it on modify while the reservation is `booked`. The engine only stores the signal. It sends no reconfirmation request, and `declined` neither cancels the reservation nor frees its tables. Erasure and retention reset it to `none`. A host reads it to see who has confirmed.

Acceptance: conformance case C25. A reservation created without it reads back `none` and no recorded time. A modify that changes it bumps the version once and emits one `modified` event, and the same value changes nothing. A value outside the set, and a walk-in that carries it, fail with `invalid_request`. A change on a reservation that is not `booked` fails with `invalid_transition`. Erasure leaves `none` and no recorded time.

The text of any reconfirmation message and the legal basis for sending it are pending review. This requirement defines the stored signal only.

## Erasure

### REQ-E1 Erasure by id or principal

Erasure runs by guest id or by principal, per venue. It deletes or nulls the personal fields and returns counts.

Acceptance: erasure returns the counts and the hashes the tombstones need, and no personal value remains for that guest.

### REQ-E2 Tombstones before deletion

The engine emits a tombstone for each erased reservation before deleting it.

Acceptance: a downstream consumer that missed the erasure can still learn, from the tombstone, that the reservation was erased.

### REQ-E3 Guest retention

A guest record lasts the venue's retention period, `retention_days`, counted from its latest visit. The default is 400 days, a starting value until the legal review. After that the engine clears the guest's email, phone, and name, and erases each reservation linked to it with the same tombstone and `erased` event as REQ-E1. Each visit keeps its date, party size, and status. A guest with a visit inside the period, or a future booking, stays. A reservation with no guest record, because its contact did not normalize or it had a name and no contact, expires by the same period, counted from its end time, and is erased the same way. One that is booked or seated and not yet over stays. Waitlist entries older than the period are deleted. The same setting bounds the event feed.

Acceptance: conformance case C18. After expiry no personal value of that guest remains in the venue. A second run changes nothing, and other venues are untouched.

## Event feed

### REQ-F1 Cursor feed

The engine exposes a cursor event feed for every write, including staff-typed bookings.

Acceptance: the feed emits events with stable, monotonic ids in cursor order. A consumer that resumes from a cursor sees no gap. Duplicates are possible and are deduplicated by event id. Retention and replay bounds are defined in the contract.

### REQ-F2 One write path

Staff and employee writes use the same operations and emit the same events.

Acceptance: a staff-typed booking and an employee booking produce the same event shape.

### REQ-F3 Signed webhooks

A venue can register up to 5 HTTPS endpoints that receive its feed events as signed POSTs, so a platform learns about a reservation change without polling. The feed stays the source of truth. Each endpoint is a cursor over it. The payload carries ids only, and the receiver reads the reservation, including its consent, with a normal GET. Webhook management is HTTP only and is not part of MCP parity. The full rules are in [webhooks.md](contract/webhooks.md).

Acceptance: conformance case C15. Events arrive in id order, at least once, signed with HMAC-SHA256 under a secret shown only at registration. A failure stops the endpoint and retries with capped exponential backoff. A URL that reaches a loopback, private, link-local, or metadata address is refused at registration and at delivery.

## API and MCP

### REQ-C1 Public contract

The public contract exposes availability, agenda, list, search, create, modify, and cancel, plus the event feed and the erasure call.

Acceptance: these operations are defined in the OpenAPI contract with an error vocabulary, before the engine code.

### REQ-C2 MCP parity

An MCP server exposes the same operations with the same tool ids as the HTTP contract.

Acceptance: a call through MCP and a call through HTTP produce the same result for the same operation.

### REQ-C3 Role boundaries

Keys and staff sessions carry a per-venue role, `read`, `write`, or `admin`. A `write` role works the reservations: create, walk-in, modify, cancel, status, the waitlist, webhooks, and erasure. Only an `admin` changes how the venue is set up: its configuration, services, tables, floor items, API keys, and guest merges. A platform or agent that may book cannot redirect the venue's emails or reshape its floor.

Acceptance: conformance case C22. A `read` or `write` key or session that tries an admin operation fails with `forbidden` and changes nothing.

### REQ-C4 Staff invitations

A venue `admin` can add staff without touching the database. An invitation grants one membership, `read`, `write`, or `admin`, in one venue, to whoever redeems its token once before it expires. It may be bound to an email address. An invited sign-up works under every `SIGNUP` mode, creates no venue, and never makes the account the first user. The token is shown once and only a hash is stored. Only a staff session with the `admin` role creates, lists, or revokes invitations. A key does not, whatever its role. See ADR-0006.

Acceptance: conformance case C27. Concurrent redemptions of one token produce one membership and at most one account. Every failed redemption gets the same answer and names no venue. Under `SIGNUP=closed` a sign-up without a valid invitation still fails with `SIGNUP_CLOSED`.

### REQ-C5 Rate limits on credential paths

Sign-in and every other write under `/api/auth`, sign-up, and invitation redemption are limited per client address, with a separate budget for each. A refused call returns `429`, the code `rate_limited` and a `Retry-After` header, the same whatever the request names. Reads and `/health` are not limited. The limits and the trusted proxy are settings, and a fork that changes nothing is limited. The limits are per process and per address. They do not stop an attacker who holds many addresses, and they do not cover other `/v1` routes. See [ADR-0007](adr/0007-rate-limiting.md).

Acceptance: conformance case C28.

### REQ-C6 Venue creation limit

On an instance that is not `SIGNUP=open`, an invited account never creates a venue, whatever its role. Under `first-user` and `closed` only the owner, the account that claimed the instance, creates venues, and may create several. Any other account fails with `venue_creation_closed` and nothing is written. A key never creates a venue. Listing and reading venues does not change. See ADR-0008.

Acceptance: conformance case C29. Under `first-user` and `closed`, an account invited as `read`, `write`, or `admin` cannot create a venue, and the first owner can. Under `open` nothing changes.

### REQ-C7 Venue members

A venue `admin` can see who has access to the venue and remove someone, with no SQL. The list shows each member's name, email and role, and only for that venue. A removed person loses access to that venue on their next request and keeps their account. A venue always keeps at least one `admin`, even when two admins remove each other at the same moment. Only a staff session with the `admin` role lists or removes members. A key does not, whatever its role. Removal does not revoke API keys, which belong to integrations, and is not recorded in the event feed. There is no role change. See ADR-0009.

Acceptance: conformance case C30. Concurrent removals leave at least one admin. A member of another venue is not found. A removed person's next request fails with `venue_not_found`, and they can be invited again.

### REQ-C8 Membership audit

An admin can tell who invited, who joined and who was removed, because every change of access leaves one row in an append-only log scoped to the venue: an invitation created, an invitation revoked, an invitation redeemed, and a member removed. The row names the acting and the target account by id, the invitation, the role, and the time, and never holds an email, a name or a token. It is written in the same transaction as the change, so a change that fails or does nothing writes no row. Retention deletes a venue's rows after its `retentionDays`. There is no read route yet. See ADR-0010.

Acceptance: conformance case C31. Each event writes one row with the right action, actor, target, invitation and role. A repeated revoke, a refused removal and a refused redemption write none. A venue sees only its own rows. Concurrent redemptions write one `redeemed` row.

### REQ-C9 Member removal revokes what the person left behind

Removing a member also ends what they left behind, in the same transaction, so a leaver cannot keep working credentials unnoticed. It revokes the API keys the person made in that venue. It revokes all their sessions when the removal was their last membership, and keeps them when the person still belongs to another venue. It marks the webhook endpoints the person made as created by a departed member, without deleting or disabling them, and the webhook list shows it. A failure anywhere rolls the whole removal back, and a refused removal revokes nothing. A venue `admin` reads the membership audit log of REQ-C8, newest first, with cursor pagination, and another venue's log is not found. See ADR-0011.

Acceptance: conformance case C32. Keys, endpoints and logins created before the change have no known creator and are not reached.

### REQ-C10 Public venue profile and JSON-LD

A venue can publish structured local data that search engines read from its own pages, without exposing anything private. The venue holds a separate, opt-in public profile (address, phone, website, booking URL, cuisine, price range, optional coordinates) that is never derived from `noticeAddress`. An unauthenticated, cacheable `GET /v1/venues/{venueId}/public.jsonld` returns a schema.org `Restaurant` with the opening hours from the venue's services, and a `ReserveAction` only when a booking URL is set. It answers `venue_not_found` for an unknown venue and for a venue with the profile off, with no difference. URLs are `https` only, the country is ISO 3166-1 alpha-2, and strings are length bounded. Only an admin writes the profile. No guest data is stored or published. See ADR-0012.

Acceptance: conformance case C33. The venue embeds the document in the HTML of its own page, not in an iframe, and Google's Rich Results Test reads it.

### REQ-C11 Errors say whether to retry, and MCP tools declare what they do

An agent can tell from an error alone whether repeating the same call can succeed. Every error body carries `retryable`, true when the same request, unchanged, may succeed later and false when the caller must change something first. The MCP tool error text says which. Every MCP tool declares `readOnlyHint`, `destructiveHint` and `idempotentHint` explicitly, so a client does not have to guess from the MCP defaults.

Acceptance: conformance case C34. There is no version-conflict error, because writes carry no expected version.

### REQ-C12 Per-venue booking policy

A venue can set simple rules for the bookings it takes, so it can refuse bookings too far ahead, stop one guest from holding many bookings on the same day, and close specific dates. `maxAdvanceDays` caps how many days ahead a booking may name, `maxActivePerGuestPerDay` caps the active bookings one guest holds on a date, and `blockedDates` lists dates and ranges with no bookings. All three are optional and off by default, and only an admin sets them. The horizon and the blocked dates are enforced by the same check in create, availability and the explanation. The cap needs the guest's contact, so only create applies it, and a booking with no usable contact is not counted. A walk-in is held to none of them. A change of policy never cancels or alters a booking that already exists. No new personal data is stored. See ADR-0013.

Acceptance: conformance case C35. Each rule has its own error code, and concurrent creates by one guest never exceed the cap.

### REQ-C13 Services have weekdays

A venue that closes on some days, or runs a service only on some days, can say so. Each service has an optional set of ISO weekdays (`days`), all seven by default, so existing services and behavior do not change. Create, availability, the availability explanation and the public JSON-LD opening hours all read the same set, using the venue's time zone for the weekday of a date. An overnight service belongs to the day it opens. A walk-in is held to the weekday as it is to the hours. Only an admin sets it. See ADR-0014.

Acceptance: conformance case C36.

## Conformance cases

The conformance cases are the acceptance tests for the contract. The first set:

- C1: two concurrent creates for the same table and time produce one booking and one conflict.
- C2: replaying a create with the same idempotency key returns the original id, not a second booking.
- C3: availability shows a free slot, then a create for that slot either fails with a defined conflict or assigns a different eligible table, and never double-books. A snapshot is not a hold.
- C4: a modify bumps the version, and the confirmation is sent once for the new version when it carries party size or tables. A consent, rating, booking note, or reconfirmation only modify sends no email. The first three are allowed on attended reservations.
- C5: erasure returns counts and leaves no personal value.
- C6: turning the engine on without a notice address fails, and clearing the address while on fails.
- C26: a reservation without a table cannot be seated and fails with `table_required`. Staff assign a table with a modify first, and a taken table fails with `slot_taken`.
- C28: an address that spends its budget of sign-in, sign-up or invitation calls gets `429` with `rate_limited` and `Retry-After`, the same answer whatever the request names. Reads and `/health` pass. C27 is reserved for staff invitations.
- C30: a venue admin lists and removes members, a venue always keeps one admin even under concurrent removals, and a removed person gets `venue_not_found`.
- C31: each invitation created or revoked, each redemption and each member removal writes one id-only audit row in the same transaction, and a no-op writes none.
- C32: removing a member revokes the keys they made in that venue and their sessions when no membership is left, flags their webhooks without deleting them, all or nothing, and an admin reads the venue's membership audit log.
- C33: a venue with the public profile on serves a credential-free `public.jsonld` Restaurant with hours and no private field, an unknown venue or one with the profile off gives the same `venue_not_found`, and only an admin writes validated fields.
- C34: every error body carries `retryable`, the MCP tool error text says it, and every MCP tool declares its three hints.
- C35: a venue's optional horizon, per-guest daily cap and blocked dates refuse a create with `beyond_booking_horizon`, `guest_booking_limit` or `date_blocked`, availability and the explanation agree on the first and last, a walk-in is held to none, and the defaults change nothing.
- C36: a service's optional `days` (all seven by default) limit create, availability, the explanation and the public opening hours to those weekdays in the venue time zone, an overnight service follows the day it opens, a walk-in is held to them, and the three paths agree.
