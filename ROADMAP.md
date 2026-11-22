# Roadmap

OpenCovers is pre-alpha. The engine, the staff app, and the MCP server run locally and pass their tests. The public site is deployed, and a hosted demo is open to the public at demo.opencovers.dev. The demo redeploys on pushes to `main`. This roadmap has two jobs. It records where the project stands, and it lays out the road to the product depth that mature restaurant reservation platforms offer, so contributors can choose a place to work.

Phases are a sequence, not a promise of dates. There is no Phase 1 or Phase 9. Numbering started at the contract in Phase 2, and the first-venue phase was dropped, so its route is a decision below. Phase 0 is a track that runs alongside the others, listed last under Now. It covers the publication of the repository, which is now public. Each phase has an exit criterion. Flags are the unit of work. Read [CONTRIBUTING.md](CONTRIBUTING.md) to claim one. Sizes (S, M, L) on the items below are first estimates. A maintainer refines them when the flag is opened, and splits any L.

How we built this map. We studied what mature platforms publish about their products and wrote our own plan in our own words. The "Not planned" section says what we leave out and why.

## Where we are

| Area | Today | Mature target | Phase |
| --- | --- | --- | --- |
| Booking and availability | Create, modify, cancel, seat. A database rule blocks double booking. Services, hours, pacing. Turn time by party size, party limits per service, an overbooking ceiling per venue, and an endpoint that explains why a slot is closed. | Layered availability rules, per-channel inventory, a slot grid with per-day overrides. | 10 |
| Tables and floor | Zones, combinations, automatic assignment, a visual floor editor. | Saved layouts per service, live table status, sections. | 10 |
| Guests | A guest record per venue, matched by normalized email or phone, with list, read, and admin merge and unmerge through the API. An admin blocklist on hashed contacts refuses new bookings (ADR-0018). A contact consent, a rating, and a booking note per reservation. No guest screen in the staff app yet. | Notes, allergies, tags, and segments on the profile, and a staff app view. | 10 |
| Waitlist and walk-ins | Both exist in the staff app. The public API to join, read, and leave the waitlist is built (ADR-0021 stage 11), and so are the widget join and the `/r/waitlist` page (stage 12). Both are off by default, with provisional wording pending legal review. | A QR join page, a notice when the table is ready. | 11 |
| Guest-facing surfaces | A booking widget framed on the venue's site, public booking routes, and a self-service link to view, change, or cancel a booking, in progress (ADR-0017 stages 2 to 7, 9, 10, 12 and 15). The widget has a day strip, a zone choice, and a summary step (ADR-0021 stages 3, 6 and 9), in seven languages. The API side of ADR-0021 is built through stage 11. The venue's theme shows in the widget, and an optional `embed.js` sizes the iframe and passes the host page's language. A guest who lost the link can ask for a new one by email when the venue has email on. No confirmation email carries the link yet. | An embeddable booking widget, a self-service change link, themes. | 11 |
| No-shows and payments | Status transitions and a reconfirmation status on each reservation. | Deposits, card guarantees, no-show fees, refund windows, automatic reconfirmation messages. | 12 |
| Messaging | Branded confirmation, change, cancellation, and lost-link emails through Resend, off by default. The first three carry a calendar file. The text follows the guest's booking language, then the venue's, and only the `es` catalog ships (ADR-0024). See the [guest email lifecycle](#guest-email-lifecycle). | Pluggable email, SMS, and WhatsApp, automations on the event feed, STOP handling. | 13 |
| Reviews | None. | A post-visit survey gated by consent, routing to a review link. | 13 |
| Integrations | An API, signed webhooks, an event feed, an MCP server over stdio. An OAuth 2.1 authorization server for remote MCP sits behind `MCP_REMOTE`, off by default (ADR-0014, part 1 of issue #67). There is no `/mcp` endpoint yet. Roles `read`, `write`, and `admin` apply to keys and to staff sessions. | A documented POS contract with adapters, importers, calendar feeds, a conformance kit. | 14 |
| Reporting | A pacing view. | Covers, no-show rate, source mix, lead time, exports. | 15 |
| Multiple venues | Venues are isolated. Venue configuration and structure need an admin key. | Groups, shared guests by opt-in, group roles and dashboards. | 15 |
| Events and ecosystem | None. | Inquiries, prepaid menus, ticketing, a plugin and theme registry. | 16 |
| Privacy | Erasure by an admin with counts and tombstones, retention for guest records and reservations, per-reservation consent, and a hardening guide for self-hosters. | Data export and retention settings. | 7, 10, 13 |

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
- Contact consent per reservation (`unknown`, `granted`, `denied`), and a rating per reservation from 1 to 5.
- Guest records per venue, matched by normalized email or phone, with an hourly retention job, list and read endpoints, and admin merge and unmerge with an audit trail ([ADR-0003](docs/adr/0003-guest-identity.md), conformance C17 to C19).
- An endpoint that explains why a slot is unavailable, from the same rules that decide booking (C20).
- Turn time by party size, and a minimum and maximum party size per service (C21).
- Role boundaries. A `read` key cannot write, and configuration, services, tables, floor items, keys, guest merge, and erasure need `admin` (C22, ADR-0019).
- A booking note, `commentary`, on create, walk-in, and modify, up to 500 characters (C23).
- An explicit overbooking ceiling per venue, default 0, enforced under a per-venue lock (C24).
- A reconfirmation status on a reservation (C25).
- Optional booking policy per venue: how far ahead a booking may name, a cap on one guest's active bookings per day, and blocked dates (C35, [ADR-0013](docs/adr/0013-booking-policy.md)).
- A pre-shift view in the staff app for a service and date.
- Services that run on chosen weekdays (C36).
- Staff invitations, member removal that revokes the member's keys for the venue, role changes, a venue creator transfer, and a membership audit log on the Team screen (C27, C30 to C32, C37, C38).
- Rate limits on sign-in, sign-up, invitation redemption, and venue creation (C28). On first-user and closed instances, only the owner creates venues (C29).
- A guest blocklist on keyed hashes of contacts, managed by an admin through the API. A blocked contact cannot book (C56, C57, ADR-0018).
- An idempotency key on every reservation and waitlist write, and a waitlist entry that is seated once under concurrent requests (C58, C59).
- An error retry hint for agents (C34), and the MCP server published on npm as `@opencovers/mcp`.
- Vitest and Testing Library in the staff app and the public site.
- Signed webhooks over the event feed, with ordered, at-least-once delivery and protection against server-side request forgery. See [docs/contract/webhooks.md](docs/contract/webhooks.md).
- A one-command deployment with Docker Compose and no hosting vendor. See [docs/deploy.md](docs/deploy.md).
- The public site at [opencovers.dev](https://opencovers.dev).

## Now

### Phase 7: Notices, consent, and erasure

Status: partly built, blocked on legal review.

- Done: restaurant notice address, erasure with counts and hashes, tombstones, an hourly retention job, email confirmations, and contact consent per reservation.
- Pending: legal review of the email text, the consent basis, and retention periods.
- Pending: guest reminders and STOP handling, planned in Phase 13.

Exit criterion: the legal review is complete and the conformance cases still pass.

### Phase 8: Deployment

Status: every item below is done.

- Done: `compose.prod.yaml` brings up PostgreSQL, the API, and the staff app behind Caddy with one command. It was checked end to end over HTTP, including a booking and a rejected overlap.
- Done: automatic HTTPS on a real domain. Caddy gets a certificate when `SITE_ADDRESS` and `WIDGET_ADDRESS` name a domain, as [docs/deploy.md](docs/deploy.md) describes.
- Done: a click-through of the staff screens in a browser. All six screens load, and a walk-in seats a guest against the migrated database.
- Done: consent at walk-in and an edit dialog for consent and rating in the staff app. Rating and consent can be set on an attended visit.
- Done: the React warning about an inline script, fixed by dropping the theme library.
- Done: a hardening guide for self-hosters, in [docs/hardening.md](docs/hardening.md).
- Done: automated tests for the staff app and the public site, run with Vitest.
- Done: a hosted demo with one sandbox per visitor ([ADR-0022](docs/adr/0022-hosted-demo-sandbox.md)). `compose.demo.yaml` runs the same Docker images and Caddyfile at demo.opencovers.dev, with HTTPS from Caddy, and `.github/workflows/deploy-demo.yml` redeploys it on pushes to `main`. It is open to the public, with terms of use and a privacy notice written without a lawyer's review.

Exit criterion: the staff app signs in and books a table against an API running from the Docker image.

### Phase 0: Publication readiness

Status: the repository is public. Two checks remain.

- Done: Apache-2.0 license, README, contribution guide, code of conduct, security policy, governance, and the flag and pull request templates.
- Done: private vulnerability reporting through GitHub, as [SECURITY.md](SECURITY.md) describes.
- Pending: confirm the repository history holds no private reference material. `scripts/check-publication.sh` checks the files in the working tree, not the history.
- Pending: a monitored private contact for the code of conduct.

Exit criterion: the public repository holds no confidential or proprietary material, and every reporting channel is live.

## The road to maturity

The phases below follow dependencies. Phase 10 comes first because later phases need a guest entity and an availability model that do not exist yet.

### Phase 10: Guests and availability

The guest becomes a first-class record, and availability becomes a set of rules that can explain themselves.

Design settled and the core is built. [ADR-0003](docs/adr/0003-guest-identity.md) is accepted, and the guest record, matching, retention, list, read, and merge are merged and covered by C17 to C19. A guest belongs to one venue, is matched by normalized email or phone, and merges are manual with an audit trail. A group can share guests by opt-in in Phase 15. Allergies as a structured field wait for the legal review. The booking note is merged (C23), and it is free text, not an allergy field.

Guests
- Done: a guest entity separate from the reservation, with matching, retention, list, read, and merge.
- Done: a booking note, `commentary`, on the reservation (C23, issue #16 part 1).
- Pending: allergies and diet, blocked on legal review. [M]
- Pending: occasions, and a staff app view of the guest and visit history. [L, split it]
- Tags, manual and rule-based, with a staff alert on the booking. [M]
- Guest import from CSV and importers for common export formats. [M]
- Segment queries and CSV export. [M]

Availability
- Done: turn time by party size instead of one fixed duration (C21).
- Shifts and pacing layered with access rules that can only restrict. [L, split it]
- Done: party size minimum and maximum per service (C21).
- Done: an explicit overbooking ceiling, default 0 (C24, migration 0023).
- Per-channel allocation, so a platform sees its own share of the slots. [M]
- A slot grid with per-day overrides. [M]
- Done: an endpoint that explains why a slot is unavailable (C20), and a popover on the Availability screen that shows the reasons and the nearest free times. [S]
- Done: reconfirmation status on a reservation (C25, migration 0024).
- Done: a reservation cannot be seated without a table (C26, no migration).

Staff and floor
- Done: a pre-shift view in the staff app for a service and date. It shows the booking note and the reconfirmation status. Allergies wait for the legal review. [S]
- Saved floor layouts per service and live table status timers. [M]
- Done: role boundaries for `read`, `write`, and `admin` (C22).
- Pending: granular permissions beyond the three roles. [M]

Exit criterion: a host sees who is coming and what they need, and a platform can ask why a slot is closed and get an answer. The second half is met through the API. The first half is partly met. The pre-shift view shows the booking note, and it waits on the guest profile.

### Phase 11: Guest-facing surfaces

This phase gives venues their own door, so a guest can book without a platform or an agent. The widget and the self-service link are partly built and tested locally (ADR-0017 stages 2 to 7, 9, 10, 12 and 15).

- An embeddable booking widget with no OpenCovers branding. Design accepted in [ADR-0017](docs/adr/0017-booking-widget-and-self-service-link.md): an iframe from a separate widget origin (required in production), public routes under `/v1/public/`, and a staged plan. The contract is written (stage 1: `openapi.yaml`, the five new error codes, cases C39 to C55, REQ-P1 to REQ-P8). Built: the admin settings and the booking key with its rotation (stage 2), the public config, availability and create (stage 3), the widget app and its framed page at `/w/{bookingKey}` (stage 5), the Online booking card in Setup (stage 7), the theme tokens in the widget and in Setup (stage 9), the optional `embed.js` that sizes the iframe to the widget (stage 10) and passes the host page's language, and the widget locales beyond `es` and `en`, which wait for native review (stage 15). From [ADR-0021](docs/adr/0021-widget-day-status-zones-waitlist.md): the day strip (stage 3), the zone choice and its Setup field (stage 6), and the summary step with the privacy notice link (stage 9). Pending: the email stage, the consent question, and the optional CAPTCHA (stages 8, 11 and 13). See [conformance status](docs/contract/conformance-status.md) for C39 to C55. [L, split it]
- A self-service link to view, change, or cancel a booking. Design accepted in ADR-0017, and its contract is written in the same cases. Built: the link and its routes (stage 4), the page at `/r` (stage 6), and the lost-link resend with placeholder email text (stage 12). The link is stored as a hash and ends when the guest cancels. Pending: the link in the confirmation email, which waits for the legal review (stage 8). [M]
- A public QR page to join the waitlist, and a notice when the table is ready. Partly done: the public join, read, and leave routes and the join email (ADR-0021 stage 11, placeholder text). Also built: the widget join and the `/r/waitlist` page (stage 12), off by default, with provisional wording pending legal review, tested with fakes and jsdom and not end to end in a browser. Pending: the QR and the table-ready notice. [M]
- Theme tokens for the widget and the staff app: colors, radius, type, logo. The staff app already uses CSS variables. Built for the widget and its Setup form (ADR-0017 stage 9). Not built for the staff app. [M]
- Themes as declarative packages, data only with no executable code, so a theme cannot touch guest data. [M]
- A curated theme registry in the repository, reviewed through pull requests. [M]
- Localization of the staff app and the widget. Partly done: the staff app in Spanish and English, and the widget in seven languages, five of them waiting for native review (ADR-0017 stage 15). Pending: native review of `ca`, `fr`, `de`, `it` and `pt`, then re-enable them in the hosted demo, which offers only `es` and `en` until then (ADR-0022). [L, split it]
- A PWA mode for a tablet at the host stand. [M]
- A Wallet pass for a booking (Apple Wallet and Google Wallet), saved from the self-service page and updated when the booking changes or is cancelled. Proposed in [ADR-0025](docs/adr/0025-wallet-passes.md), merged as a proposal and not accepted. It is a convenience for the guest, not a messaging channel: Apple only shows an alert when a pass field changes, and Google caps its messages. It needs an Apple Developer account, so it waits for demand. It leaves out a loyalty card with points, which would need a guest identity across bookings and marketing consent. [L, split it]
- An add-to-Wallet link in the confirmation email, as mature platforms offer. ADR-0025 puts the button on the self-service page only, so the link in the email needs an amendment to it. Like the pass, it is a convenience, not a messaging channel. [S]
- Local search visibility for venue pages. Partly done (ADR-0012, C33): a separate opt-in public profile and a public `GET /v1/venues/{venueId}/public.jsonld` that returns schema.org Restaurant JSON-LD with address, phone, cuisine, hours from the configured services and a ReserveAction when a booking URL is set. The venue puts it in the HTML of its own page with a small server-side snippet. Done: the staff form (Setup, Public profile card). Still pending: per-weekday hours, and rendering it in the page that hosts the widget or in a hosted page, because content inside an iframe is not read as the venue's page. Booking completes without leaving the venue's site in the framed widget. [M]
- A guide to putting the booking link on a Google Business Profile, written after trying it on a real profile. Nothing in the repository covers it today. The booking page is `noindex` on purpose, so search visibility comes from the venue's own page and the public profile above, not from the widget. [S]
- Measured page speed of the booking page, saved in `docs/`. A local Lighthouse run of the built widget (Lighthouse 12.8.2, one run, simulated throttling, no Caddy in front, 2026-11-18) scored 93 on mobile and 100 on desktop for performance, 100 for accessibility and best practices on both, and 50 for SEO because of `noindex` and no meta description. Repeat it with PageSpeed Insights once the widget runs on a public domain. The mobile Largest Contentful Paint (2.7 s) comes from one 290 KB script (89 KB gzip), so splitting it is the one performance lever, and only worth it if a real measurement asks for it. [S]

Exit criterion: a venue puts a branded booking page on its own site without writing code.

### Phase 12: No-shows and payments

Each venue connects its own payment account. OpenCovers does not take a fee and does not hold card data.

- A payment provider interface, with Stripe first and a Redsys adapter for Spain. [L, split it]
- Deposits per service or party size. [M]
- Card guarantee through a saved payment method, and a no-show charge. [M]
- Refund windows per service. [S]
- Automatic reconfirmation messages and release of unconfirmed tables. The messages are the reconfirmation request and the second confirmation in the [guest email lifecycle](#guest-email-lifecycle). The status they set already exists (C25). [M]
- Waitlist back-fill when a booking is cancelled or marked no-show. [M]
- A documented boundary of PCI scope, with hosted fields only. [S]

Exit criterion: a venue takes a deposit or a card guarantee, charges a no-show, and never sees a card number.

### Phase 13: Messaging, surveys, and automation

Messages run as consumers of the event feed and respect consent.

- A messaging provider interface with email, SMS, and WhatsApp adapters. Providers need paid accounts, so each is optional. [L, split it]
- A rating per reservation: `rating`, an integer from 1 to 5 that is absent when not given, and `ratingRecordedAt`. Done for staff and platforms with a write key (C16). Not built: the guest setting it through the self-service link. It is returned on reads and on the `modified` event, and it follows the shape of per-reservation consent. [S]
- Optional rating dimensions (food, service, ambience) and a free-text comment, if venues ask for them. [M]
- Enforcement of contact consent before any proactive message, and STOP handling. [M]
- A booking reminder by email before the visit, the first automation to build. It reuses the branded email layout, and it needs the per-language catalogs of [ADR-0024](docs/adr/0024-guest-email-language.md) (Q7), the consent enforcement above, and the legal review of its text. [M]
- An optional WhatsApp link in the reminder when the venue has a public phone. The link opens a chat with the venue and a prefilled message with the date, time, and party size, never text a guest typed. A venue setting turns it on, because the public phone may not take WhatsApp. The link needs no provider account. A message the venue sends over WhatsApp needs the provider interface above and the guest's consent. [S]
- Automations after the reminder: a thank-you, and win-back after 30, 60, and 90 days. [M]
- A post-visit survey, sent only to guests with granted consent. [M]
- Score-based routing to a review link, and a private feedback inbox. [M]
- Template editing per venue, with variables and a preview. [M]
- A per-venue tone for guest emails, formal (`usted`) or informal (`tú`), as a follow-up to ADR-0024. The `es` catalog uses `tú` today. Each tone is a separate catalog, and each needs the native review that ADR-0024 requires. [M]
- More of the venue theme in emails: page and card background, text and divider colors, and type. Today an email takes the theme's logo and its `primary` and `onPrimary` pair, and uses the brand pair when the venue's pair is below 4.5:1. The other theme keys (`background`, `surface`, `text`, `muted`, `border`, and `font`) must pass the same contrast check, with the brand palette as the fallback. [M]

Exit criterion: a guest who consented gets a reminder and a survey, and one who did not gets neither.

#### Guest email lifecycle

A reservation product sends a guest a set of emails over the life of a booking. The table lists each one, what sends it, and where OpenCovers stands. A row that is not built is open work. Every built email is off until the venue turns email on.

| Email | Sent when | Status | Depends on |
| --- | --- | --- | --- |
| Confirmation | A booking is made, on any channel. | Built. Placeholder text pending legal review. | REQ-N2. The self-service link in it is blocked on legal (ADR-0017 stage 8). |
| Modification | The date, time, or party size changes. | Built. Placeholder text pending legal review. A guest's own changes send at most 3, 15 minutes apart. | REQ-N2. |
| Cancellation by the guest | The guest cancels with the self-service link. | Built. Placeholder text pending legal review. | REQ-N2. The venue's notice of a guest cancel waits for ADR-0017 stage 8. |
| Cancellation by the venue | Staff or a platform cancels. | Built, with the same text as a guest cancel. Placeholder text pending legal review. | REQ-N2. |
| Reminder | A set time before the visit. | Planned in Phase 13. The calendar file in the confirmation already sets an alarm 2 hours before. | ADR-0024 catalogs, consent enforcement, REQ-N2. |
| Reconfirmation request | A set time before the visit, to ask the guest to confirm. | Planned in Phase 12. The status exists, and staff or a platform set it by hand (C25). | A way for the guest to answer. REQ-N2. |
| Second confirmation | The guest confirms the booking again. | Planned in Phase 12, with the reconfirmation messages. | The reconfirmation request. |
| No-show notice | Staff mark the booking `no_show`. | Not planned on its own. The Phase 12 no-show charge needs it. | Phase 12 payments. REQ-N2. |
| Waitlist table ready | A table frees up for a waiting party. | Planned in Phase 11. | The widget join page and `/r/waitlist` (ADR-0021 stage 12) are built, off by default. SMS needs the Phase 13 provider interface. |
| Request received | A booking waits for staff approval. | Blocked on a decision. ADR-0017 stage 14 is deferred, and `confirmationMode: approval` is reserved. | A `pending` status, which changes REQ-B6. |
| Post-visit survey and review request | The visit is over. | Planned in Phase 13. | Granted consent. REQ-N2. |
| Waitlist join | A guest joins the public waitlist. | Built (ADR-0021 stage 11), and the widget join that triggers it (stage 12), off by default. Placeholder text pending legal review. | C70. |
| Self-service link | The guest asks for a new link. | Built (ADR-0017 stage 12). Placeholder text pending legal review. | REQ-N2. |
| Birthday | The guest's birthday comes near. | Blocked. | Data the product does not store (a date of birth, a guest identity across bookings) and marketing consent. See the [guest-data design rule](README.md#design-rules). |
| Welcome | A guest signs up to hear from the venue. | Blocked. | Data the product does not store (a guest identity across bookings) and marketing consent. See the [guest-data design rule](README.md#design-rules). |

Two more emails are built and go to people other than the guest: the venue's notice of a new booking, and the sign-in link of the hosted demo.

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
- Cross-venue alternatives when a venue is full. [M] First step: the owner links sibling venues and the widget offers their public availability on a full day, so venue isolation stays intact. Distance ordering needs venue coordinates and comes later. Needs an ADR first (guest data shared with the other venue changes the consent text).

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
- The data controller of a shared guest book in a group, decided in Phase 15.
