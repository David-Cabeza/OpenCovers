# Error vocabulary

Every error response is `{"code": "...", "message": "...", "retryable": true|false}`. The `code` is one of the values below and is the stable contract. The `message` is human-readable and may change.

`retryable` is `true` when repeating the same request, unchanged, may succeed later: after the `Retry-After` of a `429`, or with the same idempotency key for a write. It is `false` when the caller must change something first, such as the input, the credentials, or its view of the venue (a `slot_taken` means query availability again, not retry). Each code below says which it is.

## Request errors

- `invalid_request`: the request is malformed or fails validation. A body over 16 KB under `/v1/public/` or over 256 KB elsewhere gets it, and so does a staff write made with a session cookie whose body is not `application/json`. Not retryable.
- `venue_not_found`: the venue does not exist, or the caller cannot see it. Indistinguishable from not found. Not retryable.
- `reservation_not_found`: the reservation does not exist, or the caller cannot see it. Not retryable.
- `waitlist_entry_not_found`: the waitlist entry does not exist, or the caller cannot see it. Not retryable.
- `guest_not_found`: the guest does not exist, belongs to another venue, was merged into another guest, or was cleared by retention. Indistinguishable from not found. Not retryable.

## Public profile

- `public_profile_incomplete`: the public profile cannot be turned on without a venue name, `street`, `locality` and `country`, or a `latitude` was given without a `longitude` (or the reverse). `409`. Nothing changed. Not retryable.

## Online booking and the self-service link

The guest-facing routes under `/v1/public/` and the `online-booking` settings. See [ADR-0017](../adr/0017-booking-widget-and-self-service-link.md). An unknown, rotated or disabled booking key answers `venue_not_found`, as an unknown venue does.

- `online_booking_incomplete`: online booking cannot be turned on without a venue name and at least one service bookable online, meaning a service named in `services` (any service when it is null) that opens on at least one of the online `weekdays`. `409`. Nothing changed. Not retryable.
- `online_booking_limit`: the contact already holds the venue's `maxOpenBookingsPerContact` future `booked` bookings made online. Public create only. `409`. Nothing is booked. Not retryable.
- `self_service_link_invalid`: the self-service token does not work. It is missing or malformed, its id is unknown, its secret is wrong, or the link expired, was revoked, or belongs to an erased booking. One answer for every cause, which names no venue and no booking. `404`. Not retryable.
- `self_service_closed`: the booking can no longer be changed or cancelled through the link, because it is not `booked` or it starts within the venue's `selfServiceCutoffMinutes`. Reading through the link still works. `409`. Not retryable.
- `reservation_changed`: the `version` sent with a self-service modify is not the stored version, because the booking changed after the guest read it. Read it again, then send the change with the new version. `409`. Nothing changed. Not retryable.

## Auth

- `unauthorized`: the caller is not authenticated. Not retryable.
- `forbidden`: the caller is authenticated but lacks the role for the operation, or made a write with a session cookie from an `Origin` the instance does not trust (`BETTER_AUTH_URL`, `TRUSTED_ORIGINS`). Not retryable.
- `venue_creation_closed`: the instance does not let this account create a venue. Under `SIGNUP=first-user` and `SIGNUP=closed` only the owner may, so any other account, an invited one included, gets it with `403`. It is not `forbidden`, which is about a role in an existing venue. Nothing is created. Not retryable.

## Rate limiting

- `rate_limited`: the caller sent too many requests of a limited kind. The response is `429` with a `Retry-After` header in whole seconds, the wait before retrying. The body is the same whatever the request named. The limited calls are sign-in and other writes under `/api/auth`, sign-up, invitation redemption, venue creation, and every request under `/v1/public/` (rules `public_read`, `public_booking`, `public_venue` and `self_service`). See [ADR-0007](../adr/0007-rate-limiting.md) and [ADR-0017](../adr/0017-booking-widget-and-self-service-link.md). Retryable.

## Availability and allocation

- `slot_taken`: the requested time is no longer available and no other eligible table remains. A public create gets it whenever no free table combination fits the party at that time, because the public channel never uses the overbooking ceiling. Not retryable.
- `party_size_too_large`: the party exceeds the venue's capacity, or the maximum of the service that covers the time. Not retryable.
- `party_size_too_small`: the party is below the minimum of the service that covers the time. Not retryable.
- `no_suitable_table`: no table combination fits the party, and the venue's overbooking ceiling leaves no room for it. A modify that would leave a booking without tables beyond that ceiling fails with it too. Not retryable.
- `table_required`: the reservation holds no table, so it cannot be seated. Staff assign a table with a modify first. A modify that would leave a seated reservation without tables fails with it too. Not retryable.
- `outside_hours`: the time is outside the venue's hours or on a weekday the service does not open, off the slot grid, or after the last seating. Not retryable.
- `lead_time_violation`: the booking is too close to the requested time. Not retryable.
- `beyond_booking_horizon`: the date is further ahead than the venue's `maxAdvanceDays`. Not retryable.
- `date_blocked`: the venue takes no bookings on that date. Not retryable.
- `guest_booking_limit`: the guest already holds the venue's `maxActivePerGuestPerDay` active bookings on that date. Create only, because availability does not know the guest. Not retryable.
- `booking_declined`: the venue does not accept bookings for this contact. Show the guest a neutral message and send them to the venue directly. `409`. The body has no details: no reason, no date, no actor, and nothing about other entries. Create only, because availability does not know the guest. A walk-in and a seat from the waitlist are never declined. Not retryable.

`GET /availability/explain` returns `outside_hours`, `lead_time_violation`, `beyond_booking_horizon`, `date_blocked`, `party_size_too_small`, `party_size_too_large`, and `no_suitable_table` as reason codes in a `200` answer, with the same meaning.

## Guest

- `email_required`: the operation needs a guest contact and none was given. Not retryable.
- `confirmation_required`: the guest must confirm before the write is applied. Not retryable.
- `approval_required`: a human must approve before the write is applied. Not retryable.

## State

- `already_cancelled`: the reservation is already cancelled. Not retryable.
- `invalid_transition`: the requested status change is not allowed from the current status. Not retryable.
- `guest_merged`: a guest in a merge or unmerge is already merged into another guest. Not retryable.
- `guest_not_merged`: the guest to unmerge is not merged. Not retryable.
- `unmerge_unavailable`: the merge cannot be undone because its audit entry is missing or was cleared by erasure or retention. Not retryable.

## Invitations

- `invalid_invitation`: the token does not redeem. The id is unknown, the secret is wrong, or the invitation is expired, used, revoked, or bound to another email. One answer for every cause. Not retryable.
- `invitation_not_found`: the invitation does not exist, or belongs to another venue. Indistinguishable from not found. Not retryable.
- `invitation_redeemed`: the invitation is already redeemed, so it cannot be revoked. Not retryable.

A sign-up with a bad `X-Invitation-Token` fails on the auth route with `403` and the code `INVALID_INVITATION`. Auth routes are outside this contract.

## Members

- `member_not_found`: the user is not a member of this venue. An unknown id and a member of another venue only give the same answer. On `POST /v1/account/transfer-creator` it means the target is not a member of any venue the caller administers. Not retryable.
- `last_admin`: the removal or role change would leave the venue with no `admin`, so nothing changed. An admin removing themselves is the same case when no other admin remains. Not retryable.

## Idempotency and outcome

- `idempotency_in_flight`: a write with this key is already running. Retryable.
- `unknown_outcome`: the engine cannot tell whether the write landed. The client must retry with the same key or read back. Retryable.
- `transient`: a downstream dependency failed temporarily. Retryable.

## Notices and erasure

- `notice_address_required`: the venue has no notice address, so the engine cannot be turned on or the address cannot be cleared while on. Not retryable.
- `stale_second_factor`: the second factor used for erasure is no longer valid. Not retryable.

## Feed

- `expired_cursor`: the event cursor is older than the venue's retention period. Not retryable.

## Webhooks

- `webhook_not_found`: the webhook does not exist, or belongs to another venue. Indistinguishable from not found. Not retryable.
- `webhook_url_rejected`: the URL is not https, carries credentials, cannot be resolved, or resolves to a blocked address. The message does not say which. Not retryable.
- `webhook_limit_reached`: the venue already has the maximum of 5 webhook endpoints. Not retryable.

## Guest blocklist

- `blocklist_entry_not_found`: the blocklist entry does not exist, or belongs to another venue. Indistinguishable from not found. `404`. Not retryable.
- `blocklist_limit_reached`: the add would take the venue past 10,000 blocklist entries, so nothing was added. `409`. Not retryable.
