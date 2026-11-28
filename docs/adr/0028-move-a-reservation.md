# ADR-0028: Move a reservation to another date or time

- Status: Accepted (phase 1 built for C83 to C90, apart from the match with the explanation in C84; C91 and C92 not built)
- Date: 2026-11-27
- Deciders: David Cabeza (owner)

The owner approved its decisions on 2026-11-26. This record covers phase 1: staff and integrators move a booking through the API. The contract (`docs/contract`) and the conformance cases C83 to C92 were written first, as GAP.

Sections 2 to 8 are built, with section 1 for create and modify. Not built: `changed` and the placement history of section 9, and `reservationId` on the availability reads of section 10. A client must not rely on those until `conformance-status.md` marks C91 and C92 as passing.

Two points the code settles. The overbooking ceiling of section 4 takes only a party within the zone's or the venue's capacity, as for a create (C24), also when the body says `tables: []`. The new expiry of section 7 applies to the link that is not revoked.

## Context

An integrator sent a new time to `modify`, got `200`, and believed the booking had moved. ADR-0029 closed the false answer: a different `date`, `time` or `zone` is now refused by name. Staff and integrators still cannot move a booking. They cancel it and book again, which loses the reservation id, the self-service link and the history, and shows every event consumer a cancellation.

What the code does at `38573e4`:

- `createReservation` in `apps/api/src/lib/reservations.ts` applies every rule of a slot: `timeReasons` (hours, weekday, slot grid, last seating, lead time, horizon, blocked date), `serviceReasons` (service party limits), the per-guest daily cap, `tableReasons` (capacity and a free combination), the overbooking ceiling through `claimOverbookRoom`, and the guest blocklist.
- `modifyReservation` applies none of the time rules. A staff party change runs no seat check and keeps the booking's window. A guest party change (`guestTables`) searches tables at the same window.
- `tableReasons` and `hasOverbookRoom` already take a reservation id to leave out. Only the guest party change passes one.
- Every write that claims a table takes the venue's planner lock ([ADR-0030](0030-table-claims-take-turns.md)), every reservation write waits at most 5 seconds for a lock and then answers `venue_busy` (C1), and the ceiling that binds a write is the one in force at commit (C24). The deadlock and ceiling issues the design depended on (#451, #452, #446) are closed.
- The guest view computes `linkExpiresAt` from the booking's end (`lib/public-booking.ts`), while `mintLink` stores the link's expiry once. A change of the end that left the stored expiry alone would show one expiry and enforce another.
- The email after a modify is the `confirmation` kind. From version 2 it reads as a change, and its calendar attachment keeps one UID per reservation with `SEQUENCE` equal to the version (`lib/ics.ts`), so the guest's calendar entry updates in place. The staff modify route sends it whenever the body carries `partySize` or `tables`, also when only a table changed.

[ADR-0013](0013-booking-policy.md) required that "a future change that lets a booking move must call the same reason functions, and the cap check, for the new date". ADR-0029 left the seat check of a staff party change to this record.

## Decision

| # | Question | Decision |
| --- | --- | --- |
| 1 | API shape | Extend `modify`. `date`, `time` and `zone` become changes. No `move` route. |
| 2 | Who moves | Phase 1: a staff session or a key with `write` or `admin`, over HTTP and later MCP. The guest moves through the link in a later phase, behind a per-venue setting that is off by default, after a legal review. This answers ADR-0017 Q5. |
| 3 | What moves | Only a `booked` reservation changes date, time or zone. `seated` keeps its party and table changes. |
| 4 | Concurrency | `version` is required when `date` or `time` changes. It is optional otherwise, and checked whenever it is sent. |
| 5 | Email | One change email when date, time or party size really change. `notifyGuest: false` turns it off for that request. A table or zone change alone sends none. |
| 6 | Duration | A change of date, time or party size on a `booked` reservation recomputes the end from the venue's turn times for the resulting party. |
| 7 | Reconfirmation | A change of date or time resets it to `none`, unless the same body sets it. |
| 8 | History | The trace keeps the placement before and after each change. |
| 9 | Events | One `modified` event with a new field `changed` that names placement fields, never values. No new event type. |
| 10 | Guest blocklist | Not applied to a move. ADR-0018 limits it to a create. |
| 11 | Staff exceptions | None in phase 1. Staff move under the rules a staff create follows. |

### 1. One placement for create, modify and the reads

Placing a reservation means choosing its service, its window and its tables. The engine gets one function for it. It takes the channel, the date, time, party size and zone, the tables if the caller named them, and the reservation to leave out. It returns the placement or the first reason that refuses it. It reads and does not write.

- A create places and inserts.
- A modify of a `booked` reservation places, leaving the reservation out, and updates.
- `availability` and `availability/explain` place without writing. With `reservationId` they leave that reservation out.

The time rules run only when the date or the time changes. A change of party size, tables or zone alone keeps the slot, so a booking made before a change of hours or policy can still change its party.

### 2. The modify request

`POST /v1/venues/{venueId}/reservations/{reservationId}/modify` gains two fields, and three fields change meaning.

| Field | Type | Rule |
| --- | --- | --- |
| `date` | `YYYY-MM-DD` | The new local date. A value equal to the booking's is not a change. |
| `time` | `HH:MM`, 24-hour | The new local start. A value equal to the booking's is not a change. |
| `zone` | string | The zone to place the booking in. `""` removes the zone. Equal is not a change. |
| `version` | integer, at least 1 | Required when `date` or `time` changes. When sent, it must equal the stored version. |
| `notifyGuest` | boolean | Default `true`. `false` sends no email for this modify. |

- A field left out keeps its value. `date` alone keeps the time, and `time` alone keeps the date.
- `date` and `time` follow the create's format. Another spelling, such as `21:00:00`, fails with `invalid_request` and the problem `invalid`.
- `version` and `notifyGuest` are not changes. A body whose only fields are those two fails with `invalid_request`.
- The other fields keep their meaning. Everything in one body is applied in one transaction, with one new version and one event, or nothing is applied.
- A value is always absolute, so a repeat leads to the same state.

Compatibility: an integrator that sends `date`, `time` and `partySize` with every modify keeps working. Equal values change nothing and need no `version`, as C94 says.

### 3. Rules for the new slot

When the date or the time changes, the move runs the checks of a staff create for the new slot, whatever channel made the booking, in this order, and fails with the first:

1. `outside_hours`: no service covers the time on that weekday, the time is off the slot grid, or it is after the last seating.
2. `lead_time_violation`: the start is within the venue's lead time. With a lead time of 0 a start in the past is accepted, as on a staff create.
3. `beyond_booking_horizon`, then `date_blocked`.
4. `party_size_too_small` or `party_size_too_large`: the limits of the service that covers the new time.
5. `guest_booking_limit`: only when the date changes, the booking has a guest record and the venue sets `maxActivePerGuestPerDay`. It counts the guest's `booked` and `seated` bookings on the new date, without this one.
6. The table rules of section 4.

Not checked: the guest blocklist, `maxOpenBookingsPerContact` (public create only) and the hosted demo's sandbox caps. The booking already exists, and a move adds none.

### 4. Tables

On a `booked` reservation, a change of date, time, party size or zone places its tables. The zone binds them as the amendment below says:

- With `tables`, it holds exactly those, checked in the create's order. An unknown or repeated id fails with `invalid_request`. Tables whose seats add up to less than the party fail with `party_size_too_large`. A table outside the zone, when the booking has one, fails with `invalid_request`. A table another booking holds in the new window fails with `slot_taken`. `tables: []` holds none and passes the ceiling check. The ceiling does not lift the capacity limit: a party larger than the zone's or the venue's capacity, a zone with no table included, fails with `party_size_too_large`.
- Without `tables`, it keeps the tables it holds when they lie in the zone (any table, when the booking has no zone), seat the party and are free for the new window apart from itself. A regular keeps the table.
- Otherwise it takes the free combination a create would assign in the zone.
- Otherwise, when the venue's `overbookingCeiling` has room for the party in the new window, it holds no tables (C24).
- Otherwise it fails with `party_size_too_large` when the party exceeds the zone's or the venue's capacity, and with `no_suitable_table` when it does not.

A change of `tables` alone on a `booked` reservation is held to the same rule for the seats of named tables. A `seated` reservation keeps today's rules (C4, C26).

Amendment of 2026-11-28, which replaces what the list above says about the zone:

- Decided by the owner: staff may keep moving a booking onto tables outside its zone. A staff modify that names tables and changes none of date, time, party size and zone does not require the zone of them. The seats are still checked and the stored zone stays.
- Following from it: while date, time and zone are unchanged, as on a later party change, the tables the booking holds are kept if they are free and seat the party, also outside the zone, so a party moved indoors is not silently sent back. A table named anew by a party change must lie in the zone. A booking whose zone no table has any more can therefore shrink its party on the tables it holds.
- A change of date, time or zone applies the zone to the tables it keeps, takes or names.
- `tables: []` is held to the zone's capacity, except on a change of `tables` alone, where the venue's capacity is the limit.

The reservation never counts against itself. Its own allocations do not block the search, its covers do not count twice under the ceiling, and the daily cap leaves it out. Moving 20:00 to 20:30 on the same table works.

### 5. Statuses

| Status | Date, time, zone | Party size, tables | Consent, rating, note, dietary |
| --- | --- | --- | --- |
| `booked` | Yes | Yes, placed by section 4 | Yes |
| `seated`, a walk-in included | `invalid_transition` | Yes, as today | Yes |
| `attended` | `invalid_transition` | `invalid_transition` | Yes |
| `no_show`, `cancelled` | `invalid_transition` | `invalid_transition` | Only `dietary: null` (C82) |

A staff member can move a `booked` reservation at any time, also after its start when the guest is late. A reservation whose guest data was erased still holds its tables and can be moved. It gets no email, because it has no contact.

### 6. Concurrency

- **Version.** The check runs under the reservation's row lock. Two staff who read version 3 and move the booking to different times: one gets version 4, the other gets `reservation_changed`, reads again and sends version 4.
- **Idempotency.** The key stays of the `modify` kind. A repeat returns the reservation as it reads now and applies nothing (C58). A refused move stores no key.
- **Order of checks.** The body (C94), the key, `reservation_not_found`, a missing `version`, `reservation_changed`, `invalid_transition`, then the rules of sections 3 and 4.
- **Lock order.** The idempotency key, the reservation row, the guest-day lock of the new date (only when the date changes and the cap is set), the planner lock (always, also when the body names tables), the overbooking lock (only when the booking ends up without tables), and the event lock last (ADR-0026). The planner lock is per venue, so one lock covers the old date and the new one. A move does not lock the guest row: a create locks the guest before the planner, so a move that locked it after the planner could close a cycle.
- **Limits.** Every lock wait is bounded at 5 seconds and answers `venue_busy` (C1). Two moves alone cannot swap two bookings on one table, because each still sees the other in place. Both are refused. An atomic swap would be a new operation, not proposed here.
- **Known limit.** The cap's lock is keyed by the contact stored on the reservation, as a create keys it by the contact it was sent. A guest with two merged contacts can pass the cap by one with a move and a create at the same instant. ADR-0013 already treats the cap as a guard against a mistake, not against abuse.

### 7. Effects in the same transaction

- The reservation row: `date`, `service`, the start, the end, `zone`, `partySize`, the version plus one.
- The allocations: the old ones are released and the new ones inserted with the new window.
- The self-service link: when the end changes, the stored expiry becomes the new end plus 48 hours. The token does not change and the link does not rotate. `changeableUntil` follows the new start, because it is computed on read.
- `reconfirmation`: `none` with no recorded time when the date or the time changed, unless the body sets it.
- The idempotency key.
- The event, last, with its `changed` list and the placement before and after.

### 8. Email

With email on and a contact, a staff modify sends one `confirmation` for the new version when it changes the date, the time or the party size, unless the body says `notifyGuest: false`. A change of tables or zone alone, of consent, rating, note, reconfirmation or `dietary`, a refusal and a repeat send none. This replaces the rule of C4, which sends one whenever the body carries `partySize` or `tables`. The calendar attachment keeps its UID and takes the new version as `SEQUENCE`, so the guest's entry moves. A staff confirmation counts toward the guest's limit of 3 (C49) and is never held back by it. The venue gets no notice for a staff move. The email is sent after commit and does not block the answer, as today.

### 9. Events, webhooks and the trace

- A consumer sees one `modified` event with the new version, never a `cancelled` and a `created`.
- `changed` lists the placement fields whose read value the write changed, from `date`, `time`, `service`, `partySize`, `zone` and `tables`, in that order. It is empty when only other fields changed. It never names consent, rating, note, reconfirmation or `dietary`, so it cannot single out a change to health data (ADR-0027).
- A consumer that knows only today's fields ignores `changed` and reads the reservation, as it does now.
- The trace entry of a `modified` event that changed a placement field carries `placement`, `{ from, to }`, each with `date`, `time`, `service`, `partySize`, `zone` and `tables`. It holds no guest data. It is stored with the event in one statement (a nullable column on `events`, added by a generated Drizzle migration), and retention deletes it with its event. Erasure leaves it, because it holds no personal value. It is not in the feed or in a webhook.

### 10. Checking a move before sending it

`GET /availability` and `GET /availability/explain` take an optional `reservationId`. With it they leave that reservation out, use its zone unless explain names one, and apply the daily cap for a date other than the booking's. The explanation's `available` is true exactly when a move with the same date, time, party size and zone, without `tables`, would succeed. A reservation that is not `booked` answers `409 invalid_transition`, and an unknown id or one of another venue answers `reservation_not_found`. A read is a snapshot and not a hold (C3). `dryRun` on the write is rejected: a screen needs the list of times, and a write that does not write complicates idempotency.

### 11. Errors

No new code. A move answers the codes a create and a modify already have: `invalid_request`, `forbidden`, `reservation_not_found`, `reservation_changed`, `invalid_transition`, `outside_hours`, `lead_time_violation`, `beyond_booking_horizon`, `date_blocked`, `party_size_too_small`, `party_size_too_large`, `guest_booking_limit`, `slot_taken`, `no_suitable_table` and `venue_busy`. `reservation_changed` reaches a staff modify for the first time. Once a move is built, a modify no longer answers the problem `unchangeable`. The value stays in the vocabulary for other routes of ADR-0029.

### 12. Later phases, not in this contract

- **Staff app and MCP.** A "Move" dialog in the agenda, fed by `availability` with `reservationId`, and a step in the demo template. `reservation.modify` and `reservation.availability` take the new fields in a new MCP release, still 18 tools.
- **Guest move through the link.** A per-venue setting, off by default. The cutoff counts from the booking's current start with `selfServiceCutoffMinutes`. No limit on the number of moves at first. A notice to the venue. Texts in the seven widget languages and a legal review come first. Case C93 is kept for it.
- **Staff exceptions.** An explicit list of rules a staff member may skip, recorded in the trace. Optional.
- **Idempotency fingerprint.** Rule (b) of ADR-0029, with its own legal review.

## Consequences

Easier:

- An integrator moves a booking with one call and keeps its id, link, guest and history. A consumer of the feed sees one change.
- The create, the modify and the reads agree on a slot because they share one placement.
- A party that grows on a `booked` reservation is checked against its tables. A party of 12 can no longer stay on a table for 4.

Harder, and accepted:

- A `booked` party change that succeeds today can fail after this, with `no_suitable_table` or `party_size_too_large`, when its tables no longer seat it and no other combination is free. Its window also grows or shrinks with the turn times.
- A `booked` modify that names tables too small for the party fails with `party_size_too_large`. Today it is accepted. The staff app's table assignment must handle it.
- The guest's own party change (C49) keeps its window until the guest phase, so it differs from a staff party change for a while.
- A move inside the 5-second lock limit queues behind the venue's other table claims, as every claim does since ADR-0030.
- The change email goes out more often. Its text is still provisional pending the review of REQ-N2, and its basis as a service message is part of that review.
- The placement history outlives an erasure of the guest. It holds no personal value. The retention period applies to it as to its event, and the legal review should confirm that.

## Alternatives considered

- **A separate `move` route.** Easier to give its own permission later. It duplicates the party and table changes that already live in `modify`, and the contract already published `date`, `time` and `zone` on `modify`. A request resource can be added later without undoing this.
- **Cancel and create linked.** Loses the id, the link and the history, and tells consumers about a cancellation that did not happen.
- **`dryRun` on the modify.** Answers for one time only, and needs a rule for whether its key is stored.
- **A `moved` event type.** A consumer that knows only today's types would skip it and miss the change.
- **`changed` naming every field.** An empty list would then single out a change to `dietary`.
- **A separate table of placement history.** It repeats the event's columns and needs its own retention.
- **`version` required on every modify.** Breaks every integrator and staff screen that modifies today without it.
