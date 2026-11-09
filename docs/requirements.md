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

The engine stores only the guest data a booking needs: name, a contact, party size, notes, and a principal reference. It stores no guest profile beyond that.

Acceptance: a booking can be made and honoured without a persistent guest profile.

### REQ-G2 Reuse by rule

The engine decides when a booking reuses an existing guest record and when it creates one, by an explicit matching rule on its own fields, such as the contact. Identity across channels belongs to the memory platform, not to the engine.

Acceptance: the matching rule is documented and tested, and a booking that matches an existing record updates that record rather than duplicating it.

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

## Erasure

### REQ-E1 Erasure by id or principal

Erasure runs by guest id or by principal, per venue. It deletes or nulls the personal fields and returns counts.

Acceptance: erasure returns the counts and the hashes the tombstones need, and no personal value remains for that guest.

### REQ-E2 Tombstones before deletion

The engine emits a tombstone for each erased reservation before deleting it.

Acceptance: a downstream consumer that missed the erasure can still learn, from the tombstone, that the reservation was erased.

## Event feed

### REQ-F1 Cursor feed

The engine exposes a cursor event feed for every write, including staff-typed bookings.

Acceptance: the feed emits events with stable, monotonic ids in cursor order. A consumer that resumes from a cursor sees no gap. Duplicates are possible and are deduplicated by event id. Retention and replay bounds are defined in the contract.

### REQ-F2 One write path

Staff and employee writes use the same operations and emit the same events.

Acceptance: a staff-typed booking and an employee booking produce the same event shape.

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
- C4: a modify bumps the version, and the confirmation is sent once for the new version.
- C5: erasure returns counts and leaves no personal value.
- C6: turning the engine on without a notice address fails, and clearing the address while on fails.
