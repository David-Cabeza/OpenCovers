# Conformance cases

These are the acceptance tests for the contract. Each case states the observable behavior. They assert behavior, not storage internals. The storage-level mutant sweep of the overlap predicate is a separate test, not listed here.

A case is satisfied when a conforming engine produces the stated result. The ids are stable and referenced by the requirements.

## C1. One transaction

Two concurrent creates for the same venue, date, time, and table produce exactly one booking and one `slot_taken`. The loser never double-books the table.

## C2. Idempotent create

Replaying a create with the same idempotency key returns the original reservation id and version. No second reservation exists.

## C3. Snapshot is not a hold

Availability returns a free slot. A create for that slot then either fails with `slot_taken` or assigns a different eligible table. It never double-books, and a failed create writes nothing. A create with explicit tables that are no longer free fails with `slot_taken`.

## C4. Modify bumps the version

A modify that changes a field produces a version one greater than before. A no-op modify produces no new version. The confirmation is sent once for the new version.

## C5. Erasure

Erasure by guest id returns the counts of erased reservations and guests, and no personal value remains for that guest. Each tombstone it emits carries a hash of the reservation id, visible in the event feed.

## C6. Notice address

Enabling a venue without a notice address via `venue.setConfig` fails with `notice_address_required`. Clearing the address while the venue is enabled fails. A venue already enabled without one stays enabled.

## C7. Party size

A party above the venue maximum fails with `party_size_too_large`. A party that fits no table combination fails with `no_suitable_table`.

## C8. Hours

A time outside the hours, off the slot grid, or after the last seating fails with `outside_hours`. A time within the lead time fails with `lead_time_violation`.

## C9. Status transitions

`reservation.status` moves a reservation to seated, attended, or no_show and emits an event. A transition that is not allowed fails with `invalid_transition`. Cancelling twice returns `already_cancelled` on the second call.

## C10. Venue isolation

A request scoped to one venue never returns data from another venue. A request for a venue the caller cannot see returns `venue_not_found`, the same as an unknown venue.

## C11. Event feed

A consumer that polls the feed from a cursor sees events with stable, monotonic ids and no gap. Replaying from an earlier cursor re-emits the same ids, which the consumer deduplicates.

## C12. Attribution

The engine sets `basis`, `owner_principal`, and `booked_via` from the authenticated channel. A write that tries to set them is ignored, and the stored value comes only from the channel.

## C13. Cursor expiry

Polling the event feed with a cursor older than the venue's retention period fails with `expired_cursor`. A cursor within the retention period returns no gap in the event ids.
