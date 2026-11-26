# Changelog

All notable changes to OpenCovers are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

Feature PRs append their entries here. The release PR moves them under a version heading.

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

- Allergies and diets on a reservation, `dietary` (C82, [ADR-0027](docs/adr/0027-allergies-and-dietary-needs.md)), behind the instance switch `DIETARY=on|off`, off by default. It is health data, and the legal review still gates use with real guests. Create, walk-in and modify take it, and get, the agenda and the answers of reservation writes return it. List, search, events, webhooks, emails, logs and the public channel never carry it. Erasure and retention clear it. `GET /v1/venues/{venueId}/config` reads `dietaryEnabled`. The MCP tools do not take the field yet. Run the database migration (0050).
- With `DIETARY` off, a create, walk-in or modify whose body holds a `dietary` other than `null` fails with `400 invalid_request` and writes nothing. Before this change the field was ignored. A client reads `dietaryEnabled` before it sends the field.
- The public create and the self-service modify refuse a body that names `dietary`.
- `GET /v1/venues/{venueId}/config` and the answer of its `PUT` read `dietaryValuesHidden`, a boolean: `DIETARY` is off and a `booked` or `seated` reservation of the venue, dated yesterday or later, holds a stored value that no answer returns. It carries no value, count or reservation id, and a `PUT` ignores it. No request changes behaviour.
- While `dietaryValuesHidden` is `true`, the staff app shows a warning that cannot be dismissed on the agenda, the pre-shift view and its printout, the floor plan and the waitlist, to every role. An open screen asks for the config every minute and when its tab comes back.
- The staff app shows allergies and diets in the agenda, the pre-shift view, the floor plan, the table card and the table assignment dialog, and takes them on create, walk-in and edit with an unticked consent box. It can delete them on any reservation. Nothing appears unless the instance has `DIETARY=on`, and a reservation with nothing recorded shows nothing.
- With the same switch, staff who can write get a shortcut to a booking's allergies and diets after seating a guest from the waitlist and on the occupied table card of the floor plan.

### Changed

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
