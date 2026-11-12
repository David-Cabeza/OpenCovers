# Roadmap

OpenCovers is pre-alpha. The engine, the staff app, and the MCP server run locally and pass their tests. Nothing is deployed except the public site. This roadmap has two jobs. It records where the project stands, and it lays out the road to the product depth that mature restaurant reservation platforms offer, so contributors can choose a place to work.

Phases are a sequence, not a promise of dates. Each phase has an exit criterion. Flags are the unit of work. Read [CONTRIBUTING.md](CONTRIBUTING.md) to claim one. Sizes (S, M, L) on the items below are first estimates. A maintainer refines them when the flag is opened, and splits any L.

How we built this map. We studied what mature platforms publish about their products and wrote our own plan in our own words. The "Not planned" section says what we leave out and why.

## Where we are

| Area | Today | Mature target | Phase |
| --- | --- | --- | --- |
| Booking and availability | Create, modify, cancel, seat. A database rule blocks double booking. Services, hours, pacing. | Layered availability rules, per-channel inventory, turn time by party size, an explanation for every closed slot. | 10 |
| Tables and floor | Zones, combinations, automatic assignment, a visual floor editor. | Saved layouts per service, live table status, sections. | 10 |
| Guests | A name and a contact on the reservation, plus a contact consent per reservation. | A guest profile with history, notes, allergies, tags, and segments. | 10 |
| Waitlist and walk-ins | Both exist in the staff app. | A QR join page, a notice when the table is ready. | 11 |
| Guest-facing surfaces | None. The API and the MCP server are the only entry points. | An embeddable booking widget, a self-service change link, themes. | 11 |
| No-shows and payments | Status transitions only. | Deposits, card guarantees, no-show fees, refund windows, reconfirmation. | 12 |
| Messaging | Email confirmations through Resend, off by default. | Pluggable email, SMS, and WhatsApp, automations on the event feed, STOP handling. | 13 |
| Reviews | None. | A post-visit survey gated by consent, routing to a review link. | 13 |
| Integrations | An API, signed webhooks, an event feed, an MCP server. | A documented POS contract with adapters, importers, calendar feeds, a conformance kit. | 14 |
| Reporting | A pacing view. | Covers, no-show rate, source mix, lead time, exports. | 15 |
| Multiple venues | Venues are isolated. | Groups, shared guests by opt-in, group roles and dashboards. | 15 |
| Events and ecosystem | None. | Inquiries, prepaid menus, ticketing, a plugin and theme registry. | 16 |
| Privacy | Erasure with counts and tombstones, retention, per-reservation consent. | Data export, retention settings, a hardening guide. | 7, 10, 13 |

## Done

### Phase 2: Contract and conformance

The OpenAPI contract, the MCP tool catalog, the error vocabulary, and the conformance cases are merged under [docs/contract](docs/contract).

### Phase 3: Runnable skeleton

Node.js, Hono, and PostgreSQL run locally with `pnpm dev`. CI runs typecheck and tests against PostgreSQL 16.

### Phase 4: Schema and exclusion

Venues, hours, tables, services, reservations, and versions live in the schema. A GiST exclusion constraint rejects overlapping table allocations. A concurrency test shows two parallel creates yield one booking and one `slot_taken`.

### Phase 5: Write routes

Create, modify, cancel, seat, attend, and no-show. Idempotency keys and monotonic versions apply to every write. The engine sets `basis`, `owner_principal`, and `booked_via` from the authenticated channel.

### Phase 6: Read side and event feed

Availability, agenda, list, pacing, and an event feed with a cursor and a retention watermark. See [conformance status](docs/contract/conformance-status.md).

### Beyond the original plan

- Walk-ins, a waitlist, zones, and automatic table assignment.
- Staff sign-in with Better Auth and per-venue roles. Scoped API keys for platforms and agents.
- An MCP server with 18 tools over stdio.
- A staff app with an agenda, availability, a visual floor plan and editor, a waitlist, and setup screens.
- Contact consent per reservation (`unknown`, `granted`, `denied`).
- Signed webhooks over the event feed, with ordered, at-least-once delivery and protection against server-side request forgery. See [docs/contract/webhooks.md](docs/contract/webhooks.md).
- A one-command deployment with Docker Compose and no hosting vendor. See [docs/deploy.md](docs/deploy.md).
- The public site at [opencovers.dev](https://opencovers.dev).

## Now

### Phase 7: Notices, consent, and erasure

Status: partly built, blocked on legal review.

- Done: restaurant notice address, erasure with counts and hashes, tombstones, an hourly retention job, email confirmations, and contact consent per reservation.
- Pending: legal review of the email text, the consent basis, and retention periods.
- Pending: guest reminders and STOP handling.

Exit criterion: the legal review is complete and the conformance cases still pass.

### Phase 8: Deployment

Status: next.

- Done: `compose.prod.yaml` brings up PostgreSQL, the API, and the staff app behind Caddy with one command. It was checked end to end over HTTP, including a booking and a rejected overlap.
- Pending: automatic HTTPS on a real domain. [S]
- Done: a click-through of the staff screens in a browser. All six screens load, and a walk-in seats a guest against the migrated database.
- Pending: consent and rating fields in the staff app. Today they are set only through the API and the MCP server. [S]
- Pending: the React warning about an inline script, probably from the theme library. [S]
- Pending: a hardening guide for self-hosters. [M]
- Pending: automated tests for the staff app and the public site, which have none today. [M]

Exit criterion: the staff app signs in and books a table against an API running from the Docker image.

### Phase 0: Publication readiness

Status: in progress.

- Done: Apache-2.0 license, README, contribution guide, code of conduct, security policy, governance, and the flag and pull request templates.
- Pending: confirm the repository history holds no private reference material with `scripts/check-publication.sh`.
- Pending: private vulnerability reporting enabled and a monitored private contact for the code of conduct.

Exit criterion: the repository can be made public without confidential or proprietary material, and every reporting channel is live.

## The road to maturity

The phases below follow dependencies. Phase 10 comes first because later phases need a guest entity and an availability model that do not exist yet.

### Phase 10: Guests and availability

The guest becomes a first-class record, and availability becomes a set of rules that can explain themselves.

Design first. Write an ADR on guest identity before any guest data accumulates. The open question is the scope of a guest, per venue or per group. A starting point is a guest matched by normalized email or phone, with a merge tool and an audit trail. [M]

Guests
- A guest entity separate from the reservation, with notes, allergies and diet, occasions, and visit history. [L, split it]
- Tags, manual and rule-based, with a staff alert on the booking. [M]
- Guest import from CSV and importers for common export formats. [M]
- Segment queries and CSV export. [M]

Availability
- Turn time by party size instead of one fixed duration. [M]
- Shifts and pacing layered with access rules that can only restrict. [L, split it]
- Party size minimum and maximum per service. [S]
- An explicit overbooking ceiling, default 0. [S]
- Per-channel allocation, so a platform sees its own share of the slots. [M]
- A slot grid with per-day overrides. [M]
- An endpoint that explains why a slot is unavailable. [M]
- Reconfirmation status on a reservation. [S]

Staff and floor
- A pre-shift view with VIPs, large parties, notes, and allergies. [M]
- Saved floor layouts per service and live table status timers. [M]
- Granular permissions beyond the three roles. [M]

Exit criterion: a host sees who is coming and what they need, and a platform can ask why a slot is closed and get an answer.

### Phase 11: Guest-facing surfaces

Today a guest can only book through a platform or an agent. This phase gives venues their own door.

- An embeddable booking widget with no OpenCovers branding. [L, split it]
- A self-service link to view, change, or cancel a booking. [M]
- A public QR page to join the waitlist, and a notice when the table is ready. [M]
- Theme tokens for the widget and the staff app: colors, radius, type, logo. The staff app already uses CSS variables. [M]
- Themes as declarative packages, data only with no executable code, so a theme cannot touch guest data. [M]
- A curated theme registry in the repository, reviewed through pull requests. [M]
- Localization of the staff app and the widget. [L, split it]
- A PWA mode for a tablet at the host stand. [M]

Exit criterion: a venue puts a branded booking page on its own site without writing code.

### Phase 12: No-shows and payments

Each venue connects its own payment account. OpenCovers does not take a fee and does not hold card data.

- A payment provider interface, with Stripe first and a Redsys adapter for Spain. [L, split it]
- Deposits per service or party size. [M]
- Card guarantee through a saved payment method, and a no-show charge. [M]
- Refund windows per service. [S]
- Automatic reconfirmation messages and release of unconfirmed tables. [M]
- Waitlist back-fill when a booking is cancelled or marked no-show. [M]
- A documented boundary of PCI scope, with hosted fields only. [S]

Exit criterion: a venue takes a deposit or a card guarantee, charges a no-show, and never sees a card number.

### Phase 13: Messaging, surveys, and automation

Messages run as consumers of the event feed and respect consent.

- A messaging provider interface with email, SMS, and WhatsApp adapters. Providers need paid accounts, so each is optional. [L, split it]
- A rating per reservation: `rating`, an integer from 1 to 5 that is absent when not given, and `ratingRecordedAt`. Staff and platforms with a write key set it first. The guest sets it through a link once Phase 11 ships the self-service link. It is returned on reads and on the `modified` event, and it follows the shape of per-reservation consent. [S]
- Optional rating dimensions (food, service, ambience) and a free-text comment, if venues ask for them. [M]
- Enforcement of contact consent before any proactive message, and STOP handling. [M]
- Automations: reminder, thank-you, win-back after 30, 60, and 90 days. [M]
- A post-visit survey, sent only to guests with granted consent. [M]
- Score-based routing to a review link, and a private feedback inbox. [M]
- Template editing per venue, with variables and a preview. [M]

Exit criterion: a guest who consented gets a reminder and a survey, and one who did not gets neither.

### Phase 14: Integrations

The aim is a small, documented contract and a community of adapters, not a long list built by one team.

- A POS contract: read a reservation by table, post a check total, free a table. [M]
- A first POS adapter, then adapters for common regional systems. [L each]
- Importers for exports from other reservation systems. [M each]
- A calendar and availability feed. [M]
- A reference voice-agent integration over the existing MCP server, with the venue's own keys. [M]
- A typed client library generated from the OpenAPI contract. [M]
- A conformance kit so an adapter author can prove an adapter works. [L, split it]

Exit criterion: a third party writes an adapter against the contract and passes the kit without help from the maintainers.

### Phase 15: Insight and groups

- Reports: covers, no-show and cancellation rate, source mix, hourly density, lead time, period comparison. [L, split it]
- CSV export and a scheduled report by email. [M]
- A group entity above venues, with group roles and a group dashboard. [L, split it]
- Shared guests across a group by opt-in, built on the Phase 10 decision. [M]
- Cross-venue alternatives when a venue is full. [M]

Exit criterion: a group of venues sees one dashboard and shares a guest book by choice.

### Phase 16: Events and ecosystem

- Private dining and group inquiries with a pipeline, quotes, deposits, and a minimum spend. [L, split it]
- Prepaid menus and ticketed experiences. [L, split it]
- Guest lists and QR check-in. [M]
- A plugin interface with isolation, for code that goes beyond declarative themes. [L, split it]
- A marketplace for themes and adapters, only if the registry shows real demand. [L]

Exit criterion: a venue sells a ticketed event and handles a private dining inquiry end to end.

## Not planned

Some capabilities of large platforms depend on things an open-source engine cannot or should not own. We list them so no one spends effort on a dead end.

- A consumer marketplace or demand network. It needs a large audience and commercial deals.
- Enrichment of guest profiles from third-party consumer data.
- Pulling bookings out of other booking platforms with a venue's login. It breaks their terms of service.
- Hardware cashless systems and hosted telephony. They need devices, payment licenses, and per-minute costs.
- Security certifications. They belong to an organization that runs the service, not to the code. We document how to self-host safely.
- Managed onboarding. We offer importers, seed data, and documentation instead.

## Decisions that block the roadmap

- Standalone or internal-only product.
- The first-venue route.
- Legal review of guest data, retention, confirmation text, and reminder text.
- The guest identity scope, per venue or per group, recorded in an ADR at the start of Phase 10.
