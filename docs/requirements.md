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

## Booking

### REQ-B1 One transaction

Availability and booking are decided in one transaction.

Acceptance: there is no window between checking and writing where another writer can slip in. Conformance case C1 proves it.

### REQ-B2 Exclusion in the database

The rule that no two reservations can occupy one table with overlapping time is enforced by a database constraint, not only by application code.

Acceptance: a caller that deletes or bypasses the application check still cannot double-book a table. The mutant sweep of the overlap predicate is a storage test, run apart from the API conformance cases.

### REQ-B3 Server-assigned table and zone

The engine assigns the table and zone for a booking. A caller may request a specific table or zone when the venue allows it.

Acceptance: a booking that does not name a table still gets exactly one table assigned, and the response returns it.

### REQ-B4 Idempotent writes

Every write carries an idempotency key. Repeating the same key returns the original result, never a second booking.

Acceptance: conformance case C2 proves the replay behavior.

### REQ-B5 Monotonic versions

Every modification to a reservation produces a new, higher version. Versions are monotonic per reservation.

Acceptance: no two writes can produce the same version, and versions never go backward.

### REQ-B6 Status

A reservation's status is a closed vocabulary: booked, seated, attended, no_show, cancelled. Transitions are explicit and limited.

Acceptance: the engine refuses a status it does not define, and a transition that is not allowed fails.

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

## Erasure

### REQ-E1 Erasure by id or principal

Erasure runs by guest id or by principal, per venue. It deletes or nulls the personal fields and returns counts.

Acceptance: erasure returns the counts and the hashes the tombstones need, and no personal value remains for that guest.

### REQ-E2 Tombstones before deletion

The engine emits a tombstone for each erased reservation before deleting it.

Acceptance: a downstream consumer that missed the erasure can still learn, from the tombstone, that the reservation was erased.

### REQ-E3 Guest retention

A guest record lasts the venue's retention period, `retention_days`, counted from its latest visit. The default is 400 days, a starting value until the legal review. After that the engine clears the guest's email, phone, and name, and erases each reservation linked to it with the same tombstone and `erased` event as REQ-E1. Each visit keeps its date, party size, and status. A guest with a visit inside the period, or a future booking, stays. Waitlist entries older than the period are deleted. The same setting bounds the event feed.

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

## Conformance cases

The conformance cases are the acceptance tests for the contract. The first set:

- C1: two concurrent creates for the same table and time produce one booking and one conflict.
- C2: replaying a create with the same idempotency key returns the original id, not a second booking.
- C3: availability shows a free slot, then a create for that slot either fails with a defined conflict or assigns a different eligible table, and never double-books. A snapshot is not a hold.
- C4: a modify bumps the version, and the confirmation is sent once for the new version when it carries party size or tables. A consent or rating only modify sends no email and is allowed on attended reservations.
- C5: erasure returns counts and leaves no personal value.
- C6: turning the engine on without a notice address fails, and clearing the address while on fails.
