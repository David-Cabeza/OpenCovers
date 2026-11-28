# Changelog

All notable changes to OpenCovers are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

Feature PRs append their entries here. The release PR moves them under a version heading.

### Added

- A staff modify (`POST /v1/venues/{venueId}/reservations/{id}/modify`) takes an optional `version`. If the booking is no longer at that version it answers `409 reservation_changed` and writes nothing, so a client that sends it cannot overwrite a change it has not read. A modify without `version` behaves as before. The staff app and the MCP tools do not send it yet (C87, partly built).

### Fixed

- On a phone, a message at the bottom of the screen covered **Cancel** in the walk-in, new reservation and other dialogs of the staff app. While a message shows, the dialog now ends above it. This also applies to screens up to 500 px tall, such as a phone held sideways. Closing a message while a dialog is open now closes only the message: before, it closed the dialog on a desktop and did nothing on a phone.
- On a tablet held in landscape, the demo bar and its tour took 45% of a 1024x768 screen, and 58% of a 1024x600 one. They now show as on a tablet held upright, with smaller text and only the next step of the tour, so they take 19% and 24%. This applies to touch screens in landscape up to 1280 px wide. Desktop and phone layouts are unchanged.
- The waitlist of the staff app offered **Seat** on entries dated another day, which the API always refuses, and answered with a message about reservation statuses. **Seat** is now unavailable on them, and the row says that only today's waitlist can be seated and which day the entry is for. Today is the venue's date, also on a screen left open past midnight.
- On a tablet or desktop, a waitlist entry with a date pushed **Seat** and **Remove** onto a second line, where **Seat** could be cut off and out of reach. The date, the online label and the zone now share one column.
- A staff modify that changes only the tables no longer emails the guest. Resending the party size or the tables a booking already had used to email them that the booking had changed, and no longer does. The email goes out when the party size changes. Repeating a request with the same `Idempotency-Key` sends none, so it no longer retries an email that failed.
- Saving the tables dialog in the staff app with the same tables it opened with now closes it without a write. It used to send them again, which undid a move another person had made while the dialog was open and could email the guest about a change. A changed selection still replaces whatever is stored then.
- Saving **Edit details** in the staff app sends only the fields that changed since the dialog opened. It used to send contact permission, rating and note every time, so a second person's save undid the first one's. Saving with nothing changed now closes the dialog without a write. Two people who change the same field still overwrite each other, and the later save wins.
- The floor plan (`GET /v1/venues/{venueId}/floor`) shows a table as occupied from the exact minute its booking starts. It used to show it as free during that minute, so a booking at 21:00, or a walk-in just seated, read as a free table. The end stays excluded.
- A guest who raised the party size from the self-service link had the seats of same-numbered tables of other venues counted as their own, so a party could be accepted on a table too small for it. Only this venue's tables count now.
- A guest whose booking, change or cancellation fails with `venue_busy` now reads that it was not saved and that trying again should work, in the widget's seven languages. It used to read as an unexpected failure that sent them to the venue.
- A booking without a table could commit above an `overbookingCeiling` that an admin had just lowered. The ceiling in force when the write commits now binds it. A config save that changes the ceiling waits for the bookings that already counted, and after 5 s answers `503 venue_busy` (retryable) and saves nothing ([issue 446](https://github.com/David-Cabeza/OpenCovers/issues/446)).
- The demo tour's cancel step told visitors to look at the floor plan 15 minutes after the booking time. It now says to look at the booking time itself.
- Closing the allergy dialog with Escape or **Cancel**, opened from the "You seated" notice of the waitlist or from a floor plan table card, now returns the keyboard focus to what opened it. Under the development server (`pnpm dev`, React StrictMode) it was lost; a production build already returned it. If another seat has replaced the notice meanwhile, the focus goes to **Add**.

### Breaking

- The staff reservation and waitlist writes refuse what they do not fully understand ([ADR-0029](docs/adr/0029-contract-rules-for-writes.md), C94): create, walk-in, modify, status and cancel of a reservation, and add, seat and cancel of a waitlist entry. They answer `400 invalid_request`, write nothing and store no idempotency key. For named fields the answer adds `details.fields`. There is no warning window. Requests that used to answer success and now fail:
  - A field the write does not take, at the top level or inside `guest`. Such as `source`, `service`, `status`, `bookedVia`, `basis`, `ownerPrincipal`, `guest.guestId`, `date` on a waitlist add, `reconfirmation` on a walk-in (already refused), `guest.name` or `guest.contact` on a modify, and any field on a cancel, seat or waitlist cancel.
  - A wrong type, `null` included, where the field takes none: `zone: null`, `guest: null`, `guest.contact: null`, a number as a name or a zone, a walk-in `date` or `time` that is not a string, and `tables` that is not a list of strings.
  - `partySize` that is zero, negative or over 10000. A create, walk-in, modify and waitlist add used to take zero or a negative number, a modify also a string, and a modify and waitlist add a party over 10000. A create or walk-in over 10000 now answers `invalid_request` instead of `party_size_too_large`.
  - `guest.contact` over 254 characters.
  - A modify whose `date`, `time` or `zone` differs from the booking. It used to answer `200` and ignore them.
  - A modify body that is a JSON array, and a cancel, seat or waitlist cancel body other than empty or `{}`.
  - A phone sent as a JSON number in `guest.contact`, which used to be read as text.
  - A retry, with a key already used, whose body is one of the above: it answers `400` instead of the first result.

  Migration: send only the fields in the request schema of `openapi.yaml`, leave a field out instead of sending `null` (`rating: null` and `dietary: null` keep their meaning), and do not rely on a modify to move a booking. A modify may still repeat the current `date`, `time` and `zone`. A malformed or missing body, a fractional `partySize` and other input that answered a plain-text `500` now answer `400`.

### Added

- The agenda, the pre-shift view and the floor plan of the staff app refresh themselves: every 30 seconds while the tab is visible, and when the tab or the network comes back. A refresh that fails keeps the data on screen and says that it could not be updated and since when the data is, on screen and on a printed pre-shift. A read with no answer now fails after 15 seconds. Until a time is picked, today's floor plan follows the clock.
- The waitlist of the staff app refreshes itself in the same way. Seating or removing an entry that was already seated or removed now says so and takes it off the list. When the row with the keyboard focus leaves the list, the focus moves to the row that took its place, or to **Add** when none is left. It used to be lost, also after removing an entry by hand. When a refresh moves a row, its **Seat** and **Remove** are dimmed and ignore presses for a second, so a press does not land on another party.
- Allergies and diets on a reservation, `dietary` (C82, [ADR-0027](docs/adr/0027-allergies-and-dietary-needs.md)), behind the instance switch `DIETARY=on|off`, off by default. It is health data, and the legal review still gates use with real guests. Create, walk-in and modify take it, and get, the agenda and the answers of reservation writes return it. List, search, events, webhooks, emails, logs and the public channel never carry it. Erasure and retention clear it. `GET /v1/venues/{venueId}/config` reads `dietaryEnabled`. The MCP tools do not take the field yet. Run the database migration (0050).
- With `DIETARY` off, a create, walk-in or modify whose body holds a `dietary` other than `null` fails with `400 invalid_request` and writes nothing. Before this change the field was ignored. A client reads `dietaryEnabled` before it sends the field.
- The public create and the self-service modify refuse a body that names `dietary`.
- `GET /v1/venues/{venueId}/config` and the answer of its `PUT` read `dietaryValuesHidden`, a boolean: `DIETARY` is off and a `booked` or `seated` reservation of the venue, dated yesterday or later, holds a stored value that no answer returns. It carries no value, count or reservation id, and a `PUT` ignores it. No request changes behaviour.
- While `dietaryValuesHidden` is `true`, the staff app shows a warning that cannot be dismissed on the agenda, the pre-shift view and its printout, the floor plan and the waitlist, to every role. An open screen asks for the config every minute and when its tab comes back.
- The staff app shows allergies and diets in the agenda, the pre-shift view, the floor plan, the table card and the table assignment dialog, and takes them on create, walk-in and edit with an unticked consent box. It can delete them on any reservation. Nothing appears unless the instance has `DIETARY=on`, and a reservation with nothing recorded shows nothing.
- With the same switch, staff who can write get a shortcut to a booking's allergies and diets after seating a guest from the waitlist and on the occupied table card of the floor plan.

### Changed

- Writes that claim tables now take turns per venue ([ADR-0030](docs/adr/0030-table-claims-take-turns.md), C1). Two writes that claim one table at the same instant, or each other's tables, answer a normal refusal such as `slot_taken` instead of a plain-text `500`.
- A reservation write that waits more than 5 s for another write of the venue now fails with `503 venue_busy` (a new code, retryable) instead of waiting without limit. Nothing is written, so send it again with the same `Idempotency-Key`.
- `POST /v1/venues/{venueId}/tables` applies the `id` rule to new tables only. A table the venue stored before the rule, with a space, `:` or more than 64 characters in its id, can be edited again.
- `POST`, `PATCH` and `DELETE /v1/venues/{venueId}/floor-items` check their input (C80). A bad body, a fractional or out-of-range number and a field not listed fail with `400 invalid_request` instead of a `500` or a silent success. An unknown venue fails with `404 venue_not_found`, and a `PATCH` of an unknown item or another venue's item with `404 floor_item_not_found` (a new code). `POST` takes an optional `Idempotency-Key`. `POST /v1/venues/{venueId}/services` refuses a name over 200 characters.
- `POST` and `DELETE /v1/venues/{venueId}/keys` and `/v1/auth/keys` check their input (C81). A bad or missing body and any query parameter (a key or hash in the URL) fail with `400 invalid_request` instead of a `500`. A new key must be 32 to 256 visible ASCII characters and a `principal` must not be empty; keys registered before keep working. An unknown venue fails with `404 venue_not_found` instead of a `201`. Registering a key again with the same `principal` and `role` answers as before; with another one it fails with `409 key_conflict` (a new code) instead of answering success and keeping the old role.
- A table may seat up to 200 guests (it was 100), on `POST /v1/venues/{venueId}/tables`.
- `DELETE /v1/venues/{venueId}/services/{name}` with a name over 200 characters that the venue does not store now fails with `400 invalid_request` instead of answering `200`.

### Security

- The API's error log no longer holds the bound parameters of a failed database query, the database's row detail, or the text of a request body that is not valid JSON. All three could hold guest data.
- `GET`, `POST` and `DELETE /v1/auth/keys` now require an `admin` API key that holds the all-venues grant (`*`). An `admin` key granted only named venues gets `403 forbidden` there, so it can no longer act on keys outside its venues. It still manages its own venues' keys through `/v1/venues/{venueId}/keys`.

## MCP 0.3.0 - package `@opencovers/mcp`

### Added

- `waitlist.list` takes an optional `date` (`YYYY-MM-DD`). Without it, the tool returns today's queue as before. With it, the tool returns the waiting entries guests made through the public waitlist for that date, plus today's queue when the date is today.
- Every waitlist entry carries `date`, `windowStart`, `windowEnd` and `source` (`staff` or `widget`).
- Every request sends the `X-OpenCovers-Channel: mcp` header, so the event trace labels bookings made through the package as `mcp`, not `api`.

### Changed

- `waitlist.seat` says that only an entry dated today or with no date can be seated. Another date fails with `invalid_transition`. For a future date, book with `reservation.create` and then remove the entry with `waitlist.cancel`.
- The README lists the 18 tools by group.

## Earlier

MCP 0.1.0 and 0.2.0 were published before this changelog existed. Their notes are not reconstructed here.
