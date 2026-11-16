# MCP tool catalog

The MCP server implements this catalog. It wraps the HTTP API and is scoped per agent key.

| Tool id | HTTP operation | Kind | Idempotency |
| --- | --- | --- | --- |
| `reservation.availability` | GET /venues/{venueId}/availability | read | none |
| `reservation.agenda` | GET /venues/{venueId}/agenda | read | none |
| `reservation.list` | GET /venues/{venueId}/reservations | read | none |
| `reservation.search` | GET /venues/{venueId}/reservations/search | read | none |
| `reservation.get` | GET /venues/{venueId}/reservations/{id} | read | none |
| `reservation.create` | POST /venues/{venueId}/reservations | write | required |
| `reservation.walk_in` | POST /venues/{venueId}/reservations/walk-in | write | required |
| `reservation.modify` | POST /venues/{venueId}/reservations/{id}/modify | write | required |
| `reservation.cancel` | POST /venues/{venueId}/reservations/{id}/cancel | write | required |
| `reservation.status` | POST /venues/{venueId}/reservations/{id}/status | write | required |
| `reservation.events` | GET /venues/{venueId}/events | read | none |
| `reservation.erasure` | POST /venues/{venueId}/erasure | write | required |
| `waitlist.list` | GET /venues/{venueId}/waitlist | read | none |
| `waitlist.add` | POST /venues/{venueId}/waitlist | write | none |
| `waitlist.seat` | POST /venues/{venueId}/waitlist/{id}/seat | write | required |
| `waitlist.cancel` | POST /venues/{venueId}/waitlist/{id}/cancel | write | none |
| `venue.getConfig` | GET /venues/{venueId}/config | read | none |
| `venue.setConfig` | PUT /venues/{venueId}/config | write | required |

## Tool hints

Every tool sets `readOnlyHint`, `destructiveHint` and `idempotentHint` explicitly. A client that sees a write tool without `destructiveHint: false` must treat it as destructive, so none is left to the default. `idempotentHint` is true when the same call, key included, has no further effect. A write tool generates a fresh key when the caller omits it, so a retry is only idempotent when the caller passes the key back.

| Tool id | readOnly | destructive | idempotent | Reason |
| --- | --- | --- | --- | --- |
| `reservation.availability`, `reservation.agenda`, `reservation.list`, `reservation.search`, `reservation.get`, `reservation.events`, `waitlist.list`, `venue.getConfig` | true | false | true | Reads. |
| `reservation.create`, `reservation.walk_in` | false | false | true | Adds a booking and removes nothing. A repeat with the same key returns the same booking. |
| `reservation.modify` | false | true | true | Overwrites fields and may release tables. |
| `reservation.cancel` | false | true | true | Ends the booking and frees its tables. |
| `reservation.status` | false | false | true | Moves the status forward, and the feed keeps the history. |
| `reservation.erasure` | false | true | true | Removes personal data for good. |
| `waitlist.add` | false | false | false | Adds an entry and takes no key, so a repeat adds another. |
| `waitlist.seat` | false | false | true | Turns an entry into a booking. A repeat with the same key returns the same booking. |
| `waitlist.cancel` | false | true | true | Removes an entry. A repeat changes nothing more. |
| `venue.setConfig` | false | true | true | Overwrites the venue configuration. |

A tool error reads `API error <status>: <code>` followed by ` (retryable)` or ` (not retryable)`, taken from the `retryable` field of the HTTP error. See [errors.md](errors.md).

Reservation writes carry an idempotency key and return the reservation. Erasure returns the counts of erased reservations, guest records, and waitlist entries. Reads never mutate.

Reads return `guest.guestId` when the reservation is linked to a guest record of the venue. `reservation.erasure` takes that id as `guestId`. A `guestId` that is not a guest record is read as a contact. That fallback is deprecated and kept for one version. `erasedGuests` counts guest records deleted, so a contact that matches no record reports 0. Erasure by `principal` also deletes the guest records whose every visit that principal owned, and keeps a guest who still has a visit owned by another principal.

`venue.setConfig` needs an `admin` key. A `read` or `write` key fails with `forbidden`. `venue.setConfig` accepts `phoneCountry`, an ISO 3166 alpha-2 code or null. It is the country used to read a guest phone without a country code. Null means the country of the venue's time zone. It also accepts `overbookingCeiling`, an integer from 0 to 1000 with a default of 0, the most covers the venue accepts without tables at one time. A booking accepted under it reads back with `tables: []` until staff assign tables with `reservation.modify`.

`venue.setConfig` also accepts the booking policy, all off by default. `maxAdvanceDays` is an integer from 0 to 1000 or null, the furthest date ahead that a booking may name. `maxActivePerGuestPerDay` is an integer from 1 to 100 or null, the most active bookings one guest, found by contact, may hold on a date. `blockedDates` is a list of at most 366 dates (`YYYY-MM-DD`) or `{ from, to }` ranges, in the venue time zone, that replaces the stored list, and an empty list clears it. A create that breaks one fails with `beyond_booking_horizon`, `date_blocked` or `guest_booking_limit`, and `reservation.availability` shows those dates as unavailable. A change never alters a booking that already exists.

`reservation.status` with `seated` needs the reservation to hold at least one table. A booking without tables fails with `table_required`, and the tool returns `API error 409: table_required`. Assign a table with `reservation.modify` first. A table that another booking holds fails with `slot_taken`.

`reservation.create`, `reservation.walk_in`, and `reservation.modify` accept an optional `consent` of `unknown`, `granted`, or `denied`. Reads return it as `guest.consent`, with `guest.consentRecordedAt` once a guest has answered.

The same three tools accept an optional `rating`, an integer from 1 to 5, or null on modify to clear it. Reads return it as `rating` and `ratingRecordedAt`.

The same three tools accept an optional `commentary`, a short note for staff of up to 500 characters. An empty string on modify clears it. Reads return it as `commentary`. It is not for health data, so do not put allergies, medical conditions, or diet needs in it.

`reservation.create` and `reservation.modify` accept an optional `reconfirmation` of `none`, `requested`, `confirmed`, `declined`, or `no_answer`. `reservation.walk_in` does not. Reads return it as `reconfirmation` and `reconfirmationRecordedAt`. It only stores the guest's answer. It sends nothing and never cancels the booking.

The MCP server is scoped per agent key. A key sees only the venues it is granted, and the grant limits which tool ids it may call.
