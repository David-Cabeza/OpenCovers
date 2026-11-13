# Error vocabulary

Every error response is `{"code": "...", "message": "..."}`. The `code` is one of the values below and is the stable contract. The `message` is human-readable and may change.

## Request errors

- `invalid_request`: the request is malformed or fails validation.
- `venue_not_found`: the venue does not exist, or the caller cannot see it. Indistinguishable from not found.
- `reservation_not_found`: the reservation does not exist, or the caller cannot see it.
- `waitlist_entry_not_found`: the waitlist entry does not exist, or the caller cannot see it.
- `guest_not_found`: the guest does not exist, belongs to another venue, was merged into another guest, or was cleared by retention. Indistinguishable from not found.

## Auth

- `unauthorized`: the caller is not authenticated.
- `forbidden`: the caller is authenticated but lacks the role for the operation.

## Availability and allocation

- `slot_taken`: the requested time is no longer available and no other eligible table remains.
- `party_size_too_large`: the party exceeds the venue's capacity, or the maximum of the service that covers the time.
- `party_size_too_small`: the party is below the minimum of the service that covers the time.
- `no_suitable_table`: no table combination fits the party.
- `outside_hours`: the time is outside the venue's hours, off the slot grid, or after the last seating.
- `lead_time_violation`: the booking is too close to the requested time.

`GET /availability/explain` returns `outside_hours`, `lead_time_violation`, `party_size_too_small`, `party_size_too_large`, and `no_suitable_table` as reason codes in a `200` answer, with the same meaning.

## Guest

- `email_required`: the operation needs a guest contact and none was given.
- `confirmation_required`: the guest must confirm before the write is applied.
- `approval_required`: a human must approve before the write is applied.

## State

- `already_cancelled`: the reservation is already cancelled.
- `invalid_transition`: the requested status change is not allowed from the current status.
- `guest_merged`: a guest in a merge or unmerge is already merged into another guest.
- `guest_not_merged`: the guest to unmerge is not merged.
- `unmerge_unavailable`: the merge cannot be undone because its audit entry is missing or was cleared by erasure or retention.

## Idempotency and outcome

- `idempotency_in_flight`: a write with this key is already running.
- `unknown_outcome`: the engine cannot tell whether the write landed. The client must retry with the same key or read back.
- `transient`: a downstream dependency failed temporarily. Retry.

## Notices and erasure

- `notice_address_required`: the venue has no notice address, so the engine cannot be turned on or the address cannot be cleared while on.
- `stale_second_factor`: the second factor used for erasure is no longer valid.

## Feed

- `expired_cursor`: the event cursor is older than the venue's retention period.

## Webhooks

- `webhook_not_found`: the webhook does not exist, or belongs to another venue. Indistinguishable from not found.
- `webhook_url_rejected`: the URL is not https, carries credentials, cannot be resolved, or resolves to a blocked address. The message does not say which.
- `webhook_limit_reached`: the venue already has the maximum of 5 webhook endpoints.
