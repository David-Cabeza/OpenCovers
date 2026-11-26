# Changelog

All notable changes to OpenCovers are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

Feature PRs append their entries here. The release PR moves them under a version heading.

### Added

- Allergies and diets on a reservation, `dietary` (C82, [ADR-0027](docs/adr/0027-allergies-and-dietary-needs.md)), behind the instance switch `DIETARY=on|off`, off by default. It is health data, and the legal review still gates use with real guests. Create, walk-in and modify take it, and get, the agenda and the answers of reservation writes return it. List, search, events, webhooks, emails, logs and the public channel never carry it. Erasure and retention clear it. `GET /v1/venues/{venueId}/config` reads `dietaryEnabled`. The MCP tools do not take the field yet. Run the database migration (0050).
- With `DIETARY` off, a create, walk-in or modify whose body holds a `dietary` other than `null` fails with `400 invalid_request` and writes nothing. Before this change the field was ignored. A client reads `dietaryEnabled` before it sends the field.
- The public create and the self-service modify refuse a body that names `dietary`.
- The staff app shows allergies and diets in the agenda, the pre-shift view, the floor plan, the table card and the table assignment dialog, and takes them on create, walk-in and edit with an unticked consent box. It can delete them on any reservation. Nothing appears unless the instance has `DIETARY=on`, and a reservation with nothing recorded shows nothing.

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
