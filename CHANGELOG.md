# Changelog

All notable changes to OpenCovers are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

Feature PRs append their entries here. The release PR moves them under a version heading.

### Changed

- `POST`, `PATCH` and `DELETE /v1/venues/{venueId}/floor-items` check their input (C80). A bad body, a fractional or out-of-range number and a field not listed fail with `400 invalid_request` instead of a `500` or a silent success. An unknown venue fails with `404 venue_not_found`, and a `PATCH` of an unknown item or another venue's item with `404 floor_item_not_found` (a new code). `POST` takes an optional `Idempotency-Key`. `POST /v1/venues/{venueId}/services` refuses a name over 200 characters.
- A table may seat up to 200 guests (it was 100), on `POST /v1/venues/{venueId}/tables`.
- `DELETE /v1/venues/{venueId}/services/{name}` with a name over 200 characters that the venue does not store now fails with `400 invalid_request` instead of answering `200`.

### Security

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
