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

A modify that changes a field produces a version one greater than before. A no-op modify produces no new version. The confirmation is sent once for the new version when the modify carries `partySize` or `tables`. A modify with only consent or rating sends no email.

A modify that changes only consent or rating is allowed on `booked`, `seated` and `attended`. A change to party size or tables is allowed only on `booked` and `seated`, and fails with `invalid_transition` otherwise. `cancelled` and `no_show` reject every modify.

## C5. Erasure

Erasure by guest id returns the counts of erased reservations, guests, and waitlist entries, and no personal value remains for that guest. It deletes the venue's waitlist entries with that contact and leaves other venues and other guests untouched. Each tombstone it emits carries a hash of the reservation id, visible in the event feed.

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

## C14. Consent

A reservation carries `guest.consent`, one of `unknown`, `granted`, or `denied`. A create or walk-in without it returns `unknown` and no `consentRecordedAt`. A value outside the three fails with `invalid_request`. A modify that changes consent bumps the version by one and emits one `modified` event. A modify that sets the same value changes nothing. Consent changing to `granted` or `denied` sets `consentRecordedAt`. Reads through get, list, search, and agenda return the stored value. Erasure resets consent to `unknown` and clears `consentRecordedAt`, and its counts still report reservations and guests erased.

## C15. Webhooks

Registering an https endpoint returns `201` with its id and a secret, and the secret never appears in a listing. A new endpoint receives only events written after registration. Each event arrives as a POST whose `OpenCovers-Signature` verifies with HMAC-SHA256 of `<t>.<raw body>` under the secret and fails under any other key. Events reach an endpoint in id order. A failed delivery stops that endpoint, retries the same event after `min(30s × 2^(failures − 1), 1h)`, and on success resumes without skipping or repeating acknowledged events. A failing or slow endpoint does not delay another. Two workers running at once deliver each event to an endpoint exactly once. A cursor behind the retention watermark jumps to it and records the drop in `lastError`. A URL that is not https, carries credentials, or resolves to a loopback, private, link-local, CGNAT, unspecified, or multicast address, in IPv4, IPv6, or IPv4-mapped form, fails with `webhook_url_rejected`. A host that resolves to such an address at delivery time is not contacted. A venue holds at most 5 endpoints, and a webhook id from another venue returns `webhook_not_found`.

## C16. Rating

A reservation carries `rating`, an integer from 1 to 5 or null, and `ratingRecordedAt`, a timestamp or null. A create or walk-in without it returns both as null. A value outside 1 to 5, a non-integer, or a string fails with `invalid_request`. A modify that changes the rating bumps the version by one and emits one `modified` event. A modify that sets the same value changes nothing. Setting null clears the rating and `ratingRecordedAt`. A key without `write` cannot set it. Reads through get, list, search, and agenda return the stored value. Erasure resets both to null.
