# ADR-0012: Public venue profile and schema.org JSON-LD

- Status: Accepted
- Date: 2026-11-16
- Deciders: David Cabeza

## Context

A venue wants Google to read structured local data (name, address, hours, phone, cuisine, a way to book) from the venue's own pages. The standard way is schema.org `Restaurant` markup as JSON-LD. Phase 11 of the roadmap lists it, and a person asked for it directly.

Everything the API stores about a venue is private by default. The only address is `noticeAddress`, the address that receives guest notices. It may be a personal mailbox, so it must not be published. Venue hours live in `services` (`openStart`, `openEnd`). They had no weekday when this ADR was written, so every service applied every day. [ADR-0015](0015-service-weekdays.md) adds `days`.

Google reads JSON-LD from the HTML of the page it crawls. Markup inside an iframe belongs to the framed page, not to the venue's page. The booking widget does not exist yet, so the data has to be served as a document that the venue's own site embeds in its HTML.

## Decision drivers

- Public data must be a separate, opt-in set of fields, never derived from private ones.
- Store the minimum. No guest data, no staff data, no keys.
- The contract comes first, then the implementation.
- Smallest design: one table (`venues`), one read route, one admin route, no new dependency.

## Decision

### A separate public profile

Nullable columns on `venues`, all prefixed `public_`, plus an opt-in flag:

| Field | Rule |
| --- | --- |
| `publicProfileEnabled` | boolean, default `false` |
| `street`, `locality`, `postalCode`, `region` | trimmed text, up to 200, 100, 20, 100 characters. An empty string clears. |
| `country` | ISO 3166-1 alpha-2, upper case, from the same supported list as `phoneCountry` |
| `phone` | digits, spaces and `+ ( ) . / -`, 5 to 30 characters |
| `websiteUrl`, `bookingUrl` | `https` only, no embedded credentials, up to 2048 characters |
| `cuisine` | text, up to 100 characters (one `servesCuisine` string) |
| `priceRange` | `$`, `$$`, `$$$` or `$$$$` |
| `latitude`, `longitude` | optional, both or neither, within -90..90 and -180..180 |

`noticeAddress` is not reused and is never read by the public route. The venue `name` is public once the profile is on, and so are the opening hours. Enabling needs a non-empty venue name, `street`, `locality` and `country`, otherwise `409 public_profile_incomplete`, so the endpoint never emits an invalid `Restaurant`. Latitude without longitude, or the reverse, fails with the same code.

`GET` and `PUT /v1/venues/{venueId}/public-profile` read and write these fields with the usual venue auth. `PUT` is admin only and partial: absent fields stay, `null` clears. `GET` is open to any role of the venue. A field-level audit is not added. The fields are public by intent and hold no personal data.

### The public document

`GET /v1/venues/{venueId}/public.jsonld` needs no credentials and returns `application/ld+json`:

- `@context` `https://schema.org`, `@type` `Restaurant`, `name`, `address` (`PostalAddress`), and when set: `url`, `telephone`, `servesCuisine`, `priceRange`, `geo` (`GeoCoordinates`).
- `openingHoursSpecification`: one entry per service, with `dayOfWeek` listing all seven days (since ADR-0015, the days of that service), `opens` = `openStart`, `closes` = `openEnd`. Omitted when the venue has no services. An overnight service (`closes` before `opens`) is passed through as stored.
- `potentialAction`: a `ReserveAction` whose target is `bookingUrl`, only when `bookingUrl` is set.

It returns `404 venue_not_found` with the same body and headers when the venue is unknown and when the profile is off. Nothing else about the venue is reachable without credentials.

Only `.jsonld` is offered. A second `.json` form would carry the same bytes under another media type, and the staff `GET /public-profile` already returns the plain fields.

### Caching, CORS and rate limiting

- `Cache-Control: public, max-age=300` and a strong `ETag` (a hash of the body). `If-None-Match` gets `304`. The `404` is cacheable for 60 seconds.
- `Access-Control-Allow-Origin: *` on `GET` and the `OPTIONS` preflight. The data is public and carries no credentials.
- Rate limiting: [ADR-0007](0007-rate-limiting.md) never limits `GET`, `HEAD` or `OPTIONS`, and this route is a `GET`, so it is not limited. It costs two indexed queries and is meant to be cached by a CDN or by the venue's server. The cache headers are the control. An operator who wants a hard cap sets it at the proxy or CDN.

### How a venue uses it

The venue's own web server fetches the document and prints it inside the page HTML:

```html
<script type="application/ld+json">{ ...the document... }</script>
```

A server-side include or a few lines in the venue's site code is enough, with a cache of a few minutes. A browser-side fetch is not reliable for Google, and the document must not live in the iframe widget, which does not exist yet. Google's Rich Results Test and the Schema Markup Validator check the result.

### Not in scope

- The staff form for these fields. The API ships first.
- An MCP tool. MCP wraps authenticated operations for agents. The public document is for web crawlers, so the tool surface is unchanged.
- Opening hours per weekday (done in ADR-0015), holidays, and `sameAs` social links. Services have no weekday today.
- Reviews and ratings markup. Ratings are per reservation and private, so none are published.

## Consequences

**Easier.** A venue gets Google-readable data from its own site with no widget. The public surface is one route and one flag, easy to audit.

**Harder.** The route sits above the venue auth middleware, so a later reorder could break it or, worse, widen the exposure. A test pins it. The venue name and hours become public when the flag is on.

**Accepted.** Hours were the same every day (changed by ADR-0015). Any caller can read the document, and one with a CDN in front is expected. A `ReserveAction` is valid schema.org, but Google's reservation features need a separate partner program, so the markup alone does not guarantee a Reserve button.

## Alternatives considered

- **Reuse `noticeAddress`.** Rejected. It is private, and may be a personal mailbox.
- **A `publicProfile` jsonb column.** Rejected. Columns give the database the geo check and keep validation visible. The cost is thirteen columns.
- **Fields on `PUT /config`.** Rejected. Config mixes secrets (`resendApiKey`) with settings. A separate resource states which fields are public.
- **Rate limit the route.** Rejected for now, see above.
- **Default on.** Rejected. Publishing is opt-in.
- **Render an HTML page hosted by OpenCovers.** Deferred. It needs a theme and a domain story that Phase 11 has not settled.
