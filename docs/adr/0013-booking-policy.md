# ADR-0013: Booking policy: horizon, per-guest cap, blocked dates

- Status: Accepted (owner, 2026-11-23). Built: C35 and `booking-policy.test.ts`.
- Date: 2026-11-16
- Deciders: David Cabeza

## Context

A venue can set a minimum lead time and nothing else about when it takes bookings. It cannot refuse bookings too far ahead, stop one guest from holding many bookings on the same day, or close specific dates (GitHub issue #57). The blocklist is a separate flag (#66) and is out of scope.

Facts this design rests on, read in the code:

- `timeReasons` in `apps/api/src/lib/reservations.ts` holds the hours and lead-time rules. Create, availability and `GET /availability/explain` all call it, which is how conformance C20 and C21 keep the three in agreement.
- `modifyReservation` takes `partySize`, `tableIds`, consent, rating, commentary and reconfirmation. It cannot change the date or time, so a booking never moves.
- Availability and the explanation are anonymous. They have no guest.
- A guest record is keyed by the normalized contact (ADR-0003), and `createReservation` links it in the create transaction through `linkGuest`. A merged guest resolves to its root.
- ADR-0004 set the precedent for a venue setting that application code enforces under a per-venue advisory lock, because no declarative constraint expresses it.

## Decision

Three optional settings on the venue config, all off by default so existing behavior is unchanged.

- `maxAdvanceDays`, null or an integer from 0 to 1000. A booking whose local date is later than today plus N, in the venue time zone, fails with `beyond_booking_horizon` (400). A booking exactly N days ahead passes.
- `blockedDates`, a list of at most 366 entries, each a `YYYY-MM-DD` date or a `{ from, to }` range, both ends included. A booking on a blocked date fails with `date_blocked` (400). The write replaces the list and normalizes it, so overlapping, adjacent and duplicate entries merge into sorted `{ from, to }` ranges, and a read returns that form.
- `maxActivePerGuestPerDay`, null or an integer from 1 to 100. A create fails with `guest_booking_limit` (409) when the guest already holds that many `booked` or `seated` bookings on the same local date in the same venue.

Where each rule applies:

- Horizon and blocked dates are added to `timeReasons`, so create, availability and the explanation share one check and one order of reasons: hours, lead time, horizon, blocked date, service limit, tables. A create fails with the first reason, as before. Availability shows the times as unavailable. The explanation returns the reason with `maxAdvanceDays` and the last bookable date, or the blocked range.
- The cap applies to create only. Availability and the explanation have no guest, so they cannot know it, and the contract says so. It runs in the create transaction after the idempotent-replay check and before the table search, so a guest at the cap sees `guest_booking_limit` and not a table error.
- A walk-in bypasses all three, as it bypasses lead time.
- Modify does not run any of them, because it cannot change the date. A future change that lets a booking move must call the same reason functions, and the cap check, for the new date.

  Note 2026-11-27, planned and not built: [ADR-0028](0028-move-a-reservation.md) lets a modify move a `booked` reservation. A move runs the horizon and the blocked dates for the new date, and the cap only when the date changes, leaving the moved booking out of the count (C84). With `reservationId`, availability and the explanation apply the cap for that reservation's guest (C92). A change of party size, tables or zone alone still runs none of the three, so the last paragraph of this decision still holds for it.

The cap counts rows of `reservations` by `(venue_id, guest_id, date)` with status `booked` or `seated`, using `idx_reservations_venue_guest`. It uses the guest record, so no new personal data is stored. A booking with no usable contact has no guest record and is not counted. Cancelled, attended and no-show bookings do not count. A booking that was cancelled frees its place.

Serialization. When the cap is set and the booking has a contact, the create takes `pg_advisory_xact_lock(hashtextextended('guest-day:<venue>:<kind>:<contact>:<date>', 0))` before it links the guest and counts, and holds it to the end of the transaction. The lock is per venue, guest key and date, and taken only when the cap is set, as ADR-0004 does for the ceiling. `linkGuest` upserts the guest row, which also row-locks it, so concurrent creates by one guest would serialize even without the advisory lock, and a test with the lock removed still passes. The advisory lock stays so the guarantee does not depend on how `linkGuest` writes, and it costs one statement on a path that is already off by default.

Storage. `max_advance_days` and `max_active_per_guest_per_day` are nullable integer columns on `venues` with check constraints on their ranges, as `overbooking_ceiling` is. `blocked_dates` is a `jsonb` array of `{ from, to }`, default `[]`, validated and normalized in `apps/api/src/lib/booking-policy.ts`, as `turn_times` is. The list is read with the venue row on every create and availability call, is capped at 366 entries, and is never queried by date from SQL, so a table would add a join and a migration of meaning for no gain. The two integers are plain columns because a column carries a database check and `jsonb` does not.

Errors. Three new codes in the typed registry in `apps/api/src/lib/errors.ts`, all `retryable: false`, because the caller has to change the date or the guest first. `beyond_booking_horizon` and `date_blocked` are 400, like `outside_hours` and `lead_time_violation`. `guest_booking_limit` is 409, because it conflicts with the state of other bookings and not with the request itself.

Config API. `GET` and `PUT /venues/{venueId}/config` read and write the three settings. An absent field keeps its value, null clears the two integers, and an empty list clears the dates. Out-of-range values, a malformed or impossible date, `from` after `to`, an unknown key in an entry and more than 366 entries fail with `invalid_request` and change nothing. Only `admin` sets them, as for the rest of the config. `venue.setConfig` in the MCP accepts the same fields.

A booking that already exists is never cancelled or changed by a later change of policy. A venue that blocks a date, shortens the horizon or lowers the cap keeps the bookings it has, and staff resolve them by hand. The policy applies to creates after the change.

## Consequences

What becomes easier:

- A venue can close Christmas, stop bookings a year out, and stop a guest from reserving ten tables, with no code and no staff action per booking.
- Create, availability and the explanation agree on the horizon and the blocked dates by construction, and a test over a grid enforces it.
- The defaults change nothing. A venue that sets none of the three sees the same behavior and one more set of fields in its config.

What becomes harder, and what we accept:

- The cap is weaker than no-overlap, for the reason ADR-0004 gives. A caller that writes `reservations` rows directly can exceed it. A new write path that adds a booking without the check breaks it silently.
- The cap is keyed on the contact. A guest who gives a different email or phone, or none, is not counted. The cap stops a casual repeat, not a determined abuser. The blocklist and rate limits are the tools for that.
- Availability can show a time as free to a guest who is already at the cap, and the create then fails with `guest_booking_limit`. The explanation cannot say otherwise without knowing the guest.
- A policy change can leave bookings that now break the rule. Nothing flags them.
- The date is the booking's local calendar date as sent. A service that crosses midnight is judged by the date of the slot, so a 00:30 slot after a Friday dinner service counts as Saturday for the horizon, the blocked dates and the cap.
- `blocked_dates` is rewritten whole on each change, and old ranges stay until someone clears them. The cap of 366 entries bounds it.
- `GET /config` always returns the three fields, with `null` and `[]` when off. A client that compared the whole config object must allow them.
- The staff app has no screen for the policy in this change. An admin sets it through the API or the MCP.

## Alternatives considered

- **A table of blocked dates, one row per date.** Allows a SQL lookup per date and an index. The venue row is already read on every create and availability call, and a list of at most 366 ranges is cheaper to read with it than to join. A table also needs its own migration, retention and admin routes. Rejected.
- **One `jsonb` column for the whole policy.** One column instead of three. The two integers lose their database checks, and a partial update has to merge inside the object. Rejected.
- **Reject overlapping blocked entries instead of merging.** Keeps what the caller sent, and forces the caller to clean up. A merged, sorted list stores equal sets equally and reads back predictably. Rejected.
- **Enforce the cap in the database.** A trigger that counts rows per guest and date would also need a lock to be safe, and moves the rule out of the code and tests. The exclusion constraint cannot express a count. Rejected, for the reason ADR-0004 gives.
- **Apply the cap to availability by taking an optional guest contact.** The endpoint is anonymous and public-facing, and accepting a contact there turns it into a way to probe whether a contact has bookings. Rejected.
- **Count every non-cancelled status, including attended and no-show.** Keeps a guest who dined at lunch from booking dinner, which is not "holding many bookings". A no-show would also count against the guest all day. Rejected. Only `booked` and `seated` hold a place.
