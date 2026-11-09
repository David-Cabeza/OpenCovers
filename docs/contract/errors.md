# Error vocabulary

Every error response is `{"code": "...", "message": "..."}`. The `code` is one of the values below and is the stable contract. The `message` is human-readable and may change.

## Request errors

- `invalid_request`: the request is malformed or fails validation.
- `venue_not_found`: the venue does not exist, or the caller cannot see it. Indistinguishable from not found.
- `reservation_not_found`: the reservation does not exist, or the caller cannot see it.

## Auth

- `unauthorized`: the caller is not authenticated.
- `forbidden`: the caller is authenticated but lacks the role for the operation.

## Availability and allocation

- `slot_taken`: the requested time is no longer available and no other eligible table remains.
- `party_size_too_large`: the party exceeds the venue's maximum.
- `no_suitable_table`: no table combination fits the party.
- `outside_hours`: the time is outside the venue's hours, off the slot grid, or after the last seating.
- `lead_time_violation`: the booking is too close to the requested time.

## Guest

- `email_required`: the operation needs a guest contact and none was given.
- `confirmation_required`: the guest must confirm before the write is applied.
- `approval_required`: a human must approve before the write is applied.

## State

- `already_cancelled`: the reservation is already cancelled.
- `invalid_transition`: the requested status change is not allowed from the current status.

## Idempotency and outcome

- `idempotency_in_flight`: a write with this key is already running.
- `unknown_outcome`: the engine cannot tell whether the write landed. The client must retry with the same key or read back.
- `transient`: a downstream dependency failed temporarily. Retry.

## Notices and erasure

- `notice_address_required`: the venue has no notice address, so the engine cannot be turned on or the address cannot be cleared while on.
- `stale_second_factor`: the second factor used for erasure is no longer valid.

## Feed

- `expired_cursor`: the event cursor is older than the venue's retention period.
