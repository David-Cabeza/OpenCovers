# MCP tool catalog

The MCP server implements this catalog. It wraps the HTTP API and is scoped per agent key.

| Tool id | HTTP operation | Kind | Idempotency key |
| --- | --- | --- | --- |
| `reservation.availability` | GET /venues/{venueId}/availability | read | none |
| `reservation.agenda` | GET /venues/{venueId}/agenda | read | none |
| `reservation.list` | GET /venues/{venueId}/reservations | read | none |
| `reservation.search` | GET /venues/{venueId}/reservations/search | read | none |
| `reservation.get` | GET /venues/{venueId}/reservations/{id} | read | none |
| `reservation.create` | POST /venues/{venueId}/reservations | write | optional |
| `reservation.walk_in` | POST /venues/{venueId}/reservations/walk-in | write | optional |
| `reservation.modify` | POST /venues/{venueId}/reservations/{id}/modify | write | optional |
| `reservation.cancel` | POST /venues/{venueId}/reservations/{id}/cancel | write | optional |
| `reservation.status` | POST /venues/{venueId}/reservations/{id}/status | write | optional |
| `reservation.events` | GET /venues/{venueId}/events | read | none |
| `reservation.erasure` | POST /venues/{venueId}/erasure | admin | none |
| `waitlist.list` | GET /venues/{venueId}/waitlist | read | none |
| `waitlist.add` | POST /venues/{venueId}/waitlist | write | optional |
| `waitlist.seat` | POST /venues/{venueId}/waitlist/{id}/seat | write | optional |
| `waitlist.cancel` | POST /venues/{venueId}/waitlist/{id}/cancel | write | optional |
| `venue.getConfig` | GET /venues/{venueId}/config | read | none |
| `venue.setConfig` | PUT /venues/{venueId}/config | write | none |

## Tool hints

Every tool sets `readOnlyHint`, `destructiveHint` and `idempotentHint` explicitly. A client that sees a write tool without `destructiveHint: false` must treat it as destructive, so none is left to the default. `idempotentHint` is true when the same call, key included, has no further effect. A write tool generates a fresh key when the caller omits it, so a retry is only idempotent when the caller passes the key back.

| Tool id | readOnly | destructive | idempotent | Reason |
| --- | --- | --- | --- | --- |
| `reservation.availability`, `reservation.agenda`, `reservation.list`, `reservation.search`, `reservation.get`, `reservation.events`, `waitlist.list`, `venue.getConfig` | true | false | true | Reads. |
| `reservation.create`, `reservation.walk_in` | false | false | true | Adds a booking and removes nothing. A repeat with the same key returns the same booking. |
| `reservation.modify` | false | true | true | Overwrites fields and may release tables. A repeat with the same key changes nothing more. |
| `reservation.cancel` | false | true | true | Ends the booking and frees its tables. A repeat with the same key returns the cancelled booking. |
| `reservation.status` | false | false | true | Moves the status forward, and the feed keeps the history. |
| `reservation.erasure` | false | true | true | Removes personal data for good. Takes no key, and a repeat erases nothing more. |
| `waitlist.add` | false | false | true | Adds an entry. A repeat with the same key adds nothing and returns the list. |
| `waitlist.seat` | false | false | true | Turns an entry into a booking. A repeat with the same key returns the same booking. |
| `waitlist.cancel` | false | true | true | Removes an entry. A repeat with the same key changes nothing more. |
| `venue.setConfig` | false | true | true | Overwrites the venue configuration. Takes no key, and a repeat with the same values sets the same configuration. |

## Retries

Every tool marked `optional` above takes an optional `idempotencyKey` and sends it as the `Idempotency-Key` header. When the caller omits it, the server generates a new key for that call. To retry a write after a timeout or an error, send the same `idempotencyKey` as the first call. The engine then returns the first call's result and writes nothing more, even when the first call is still running, because a duplicate waits for it. A retry with a new key, or with no key, is a new write and may create a second booking or waitlist entry.

Keys are scoped to the venue. A key used before for another kind of write, or for another reservation or waitlist entry, fails with `invalid_request`. A repeat of a create, walk-in, or `waitlist.add` key returns the first result even when the other arguments differ. A call that fails stores no key, so the same key can be sent again once the cause is fixed. Over HTTP the reservation routes and the waitlist seat require the header, and the waitlist add and cancel accept it, because callers that predate it send none. `reservation.erasure` and `venue.setConfig` take no key. A repeat of either changes nothing more.

A tool error reads `API error <status>: <code>` followed by ` (retryable)` or ` (not retryable)`, taken from the `retryable` field of the HTTP error. See [errors.md](errors.md).

Reservation writes and `waitlist.seat` return the reservation. `waitlist.add` and `waitlist.cancel` return the waiting entries. Erasure needs an `admin` key, and a key without it gets `forbidden`. It returns the counts of erased reservations, guest records, and waitlist entries, and `blocklistEntriesKept`, the guest blocklist entries that match the erased guests and stay in place. Reads never mutate.

`reservation.create` fails with `booking_declined` (409, not retryable) when the guest's contact is on the venue's guest blocklist (ADR-0018). Tell the guest the venue cannot take the booking and to contact the venue directly. Do not retry with the same contact. `reservation.walk_in` and `waitlist.seat` are never declined.

Reads return `guest.guestId` when the reservation is linked to a guest record of the venue. `reservation.erasure` takes that id as `guestId`. A `guestId` that is not a guest record is read as a contact. That fallback is deprecated and kept for one version. `erasedGuests` counts guest records deleted, so a contact that matches no record reports 0. Erasure by `principal` also deletes the guest records whose every visit that principal owned, and keeps a guest who still has a visit owned by another principal.

`venue.setConfig` needs an `admin` key. A `read` or `write` key fails with `forbidden`. `venue.setConfig` accepts `phoneCountry`, an ISO 3166 alpha-2 code or null. It is the country used to read a guest phone without a country code. Null means the country of the venue's time zone. It also accepts `overbookingCeiling`, an integer from 0 to 1000 with a default of 0, the most covers the venue accepts without tables at one time. A booking accepted under it reads back with `tables: []` until staff assign tables with `reservation.modify`.

`venue.setConfig` also accepts the booking policy, all off by default. `maxAdvanceDays` is an integer from 0 to 1000 or null, the furthest date ahead that a booking may name. `maxActivePerGuestPerDay` is an integer from 1 to 100 or null, the most active bookings one guest, found by contact, may hold on a date. `blockedDates` is a list of at most 366 dates (`YYYY-MM-DD`) or `{ from, to }` ranges, in the venue time zone, that replaces the stored list, and an empty list clears it. A create that breaks one fails with `beyond_booking_horizon`, `date_blocked` or `guest_booking_limit`, and `reservation.availability` shows those dates as unavailable. A change never alters a booking that already exists.

`reservation.status` with `seated` needs the reservation to hold at least one table. A booking without tables fails with `table_required`, and the tool returns `API error 409: table_required`. Assign a table with `reservation.modify` first. A table that another booking holds fails with `slot_taken`.

`reservation.create`, `reservation.walk_in`, and `reservation.modify` accept an optional `consent` of `unknown`, `granted`, or `denied`. Reads return it as `guest.consent`, with `guest.consentRecordedAt` once a guest has answered.

The same three tools accept an optional `rating`, an integer from 1 to 5, or null on modify to clear it. Reads return it as `rating` and `ratingRecordedAt`.

The same three tools accept an optional `commentary`, a short note for staff of up to 500 characters. An empty string on modify clears it. Reads return it as `commentary`. It is not for health data, so do not put allergies, medical conditions, or diet needs in it.

`reservation.create` and `reservation.modify` accept an optional `reconfirmation` of `none`, `requested`, `confirmed`, `declined`, or `no_answer`. `reservation.walk_in` does not. Reads return it as `reconfirmation` and `reconfirmationRecordedAt`. It only stores the guest's answer. It sends nothing and never cancels the booking.

The MCP server is scoped per agent key. A key sees only the venues it is granted, and the grant limits which tool ids it may call.

`reservation.create`, `reservation.walk_in` and `waitlist.add` take the guest as flat `guestName` and `guestContact`, as released in 0.1.0, or as a `guest` object with `name` and `contact`, the shape of the HTTP API. `reservation.create`, `reservation.walk_in` and `reservation.modify` also take `consent` flat or as `guest.consent`. Both forms send the same guest. A field given in both forms with different values fails the call with `guest.<field> and <flat name> disagree` and writes nothing. These four tools reject any argument they do not list, including an unknown key inside `guest`, so a misspelled or mis-shaped guest field fails the call, naming the key, instead of booking with no guest.
