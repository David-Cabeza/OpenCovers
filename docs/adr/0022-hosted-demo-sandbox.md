# ADR-0022: Hosted demo with one sandbox per visitor

- Status: Proposed
- Date: 2026-11-19
- Deciders: David Cabeza

## Context

A person who reads opencovers.dev cannot try the product without deploying it. The goal is a hosted demo restaurant where a visitor tries every feature (agenda, availability, floor plan, waitlist, online booking widget, team, API keys, MCP) with no setup. The demo must follow development, so a feature merged to `main` shows up in it without manual work. Access must require a verified email address or a Google account, so the demo does not fill with spam accounts and the project gets a list of contacts it can follow up.

What exists today:

- **Sign-up control.** [ADR-0005](0005-signup-control.md) gates account creation with `SIGNUP`. [ADR-0008](0008-venue-creation-limit.md) limits `POST /v1/venues` to the owner on non-open instances.
- **Seed.** `apps/api/src/demo/seed-demo-venue.ts` builds a full venue ("La Taberna del Faro") through the public HTTP API, local only.
- **Mail.** `apps/api/src/lib/mailer.ts` sends through Resend when `RESEND_API_KEY` is set.
- **Better Auth** is the account system. Its `magic-link` plugin and Google social provider ship in the version we use.

The design rules still hold: venue data is isolated, the database enforces no-overlap, and we store the minimum personal data.

A visitor plays two roles in the same demo, and the demo must connect them:

- **The restaurant.** They look inside OpenCovers as staff: agenda, availability, floor plan, setup, team, API keys, and how each booking came to exist.
- **The diner.** They book a table as a guest through the public widget, and then see that booking appear on the restaurant side.

## Decision drivers

- **Two profiles, one story.** A booking made as the diner must be visible, with its origin, on the restaurant side within the same session.
- **Every feature, no collisions.** One visitor's cancellations or deleted tables must not change another visitor's demo.
- **Follows development.** No second copy of the sample data that can drift from the engine.
- **No spam.** An account exists only for an inbox or a Google identity the visitor controls.
- **Leads with consent.** We keep a contact only when the visitor agreed to be contacted.
- **Bounded cost.** Abandoned sandboxes are removed.
- **Self-hosters unaffected.** Demo behavior is off unless `DEMO_MODE=1`.

## Decision

1. **One sandbox venue per visitor.** On the first verified sign-in under `DEMO_MODE=1`, the API creates a venue for that account from a template and makes the visitor its `admin`. Every feature works, because the visitor is a real admin of a real venue. Isolation is the existing per-venue isolation. A visitor has at most one sandbox. A sandbox account cannot create another venue: on a demo instance `POST /v1/venues` refuses every account (ADR-0008 leaves it open on `open` instances, so the demo must close it), and only `provisionSandbox` creates a venue.
2. **Two profiles in one sandbox.** The template also turns on online booking for the sandbox venue and creates its booking key, so the guest widget at `/w/{bookingKey}` works from the first minute. A fixed bar in the demo shows a switch, "Restaurant" and "Diner". Restaurant opens the staff app. Diner opens the widget for that venue, in a new tab so both stay open. No second account is needed, because the widget is public by design. The widget's allowed origin list for a sandbox is the demo host only.
3. **See how a booking was made.** The reservation detail in the staff app shows its trace: where it came from (`widget`, `staff`, `api`, `mcp`), who or what acted, the idempotency key, and each event with its version and time, read from the same event feed the API exposes (`reservation.events`). A booking the visitor makes as diner appears in the agenda and its trace with source `widget`. If the staff app lacks this panel today, it is built as its own flag and pull request, because it is a product feature and not demo-only. The demo then depends on it and does not carry it. A short guided checklist in the demo ("1. Book as a diner. 2. Find it in the agenda. 3. Open its trace. 4. Cancel it and watch the table free up") makes the loop explicit.
4. **Template is code, not data.** `provisionSandbox(userId)` is an in-process function that builds the venue through the same domain functions the routes call (`createVenue`, config, tables, services, reservations, waitlist, guests). It replaces the HTTP-only seed script, which becomes a thin caller of the same template so there is one definition. Dates are relative to the day of provisioning. Every guest is invented and uses an `example.com` address.
5. **Stays current by construction.** The template runs once per visitor, at their first verified sign-in, against whatever code is deployed. Later sign-ins do not re-run it and do not move the dates, so a sandbox of day 10 shows its day-1 calendar. A visitor can press "Reset my demo", which deletes the sandbox venue and builds a fresh one with dates relative to that day. A CI test provisions a sandbox and asserts the screens' data exist, so a change that breaks the template fails the pull request. A rule for `CLAUDE.md` (a feature that adds a screen or setting also adds it to the template) is proposed in its own pull request, because it changes the project's instructions. The demo host redeploys on every push to `main`.
6. **Sign-in methods.** Under `DEMO_MODE=1` password sign-up is off. Visitors use a magic link or Google. The magic link is sent to the address typed, so the account exists only for someone who read that inbox. A Google account must report a verified email. This is the "access sent to your email" the visitor sees, and it is the spam control. Requesting a magic link is public and sends email to whatever address is typed, so it is limited before it sends (decision 8) and carries the same proof-of-work challenge as the public booking form. Session cookies are host-only: Better Auth sets no `Domain` attribute, so the demo host shares no cookie with `opencovers.dev` or any other subdomain.
7. **Leads.** A row in `demo_lead` exists only for a visitor who ticked the consent box, and nobody else is stored there. It holds `email`, `name` (optional), `source` (`magic-link` or `google`), `locale`, `created_at`, `last_seen_at`, `consent_text_version` and `withdrawn_at`. The sign-in form has an unchecked checkbox "I agree to receive news about OpenCovers" and a link to the privacy notice. The account and sandbox are created whether or not it is ticked, because the demo's operation does not depend on it. A visitor who did not tick it leaves nothing behind: when the sandbox expires the account, with its email, is deleted (decision 9). A consented row is deleted 12 months after `last_seen_at` (a proposed value, see Open for the owner). Withdrawal: every message sent from the list carries a link to a signed route `GET /api/demo/unsubscribe?token=`, which sets `withdrawn_at`, changes nothing else and returns no lead data, and an erasure request for an address is served by `pnpm demo:leads --erase <email>`. A withdrawn row is excluded from export. Export is a script, `pnpm demo:leads`, that prints CSV of rows with no `withdrawn_at`. No HTTP route returns lead data. OpenCovers sends no marketing email itself: outreach happens outside it, and the operator is responsible for honouring `withdrawn_at` there.
8. **Abuse limits.** Existing rate limits cover `/api/auth`. Additional, with proposed values the owner confirms: (a) a magic link needs the proof-of-work challenge and is limited to 1 per address per minute, 5 per address per day and 10 per IP per hour, so the endpoint cannot be used to mail a third party or to damage the sender's reputation; (b) one sandbox per normalized address: lower case, and for Gmail and Googlemail the dots and the `+tag` removed before counting, plus a small deny list of disposable domains in the repository; (c) a global cap of live sandboxes and a daily cap of new ones, and when either is reached the sign-in page says the demo is full for now and links to the self-hosting guide, with no sandbox created; (d) email goes only to the visitor's own verified address, for every kind the sandbox can send (booking confirmation, self-service link and resend, waitlist, team invitation). If the diner types another address, nothing is sent to it. A team invitation in a sandbox is created but not mailed, and the invitation link is shown to the visitor in the staff app; (e) webhook delivery from sandboxes is disabled. The signed event feed is shown by the reservation trace (decision 3), which reads `reservation.events`, so the demo does not claim to test webhook delivery; (f) a lower cap on reservations and guests per sandbox, and API keys created in a sandbox keep the sandbox venue's scope and its rate limits.
9. **Lifecycle.** A sandbox expires 14 days after the last sign-in. A daily job deletes expired sandboxes and their accounts, the visitor's email included. Only a `demo_lead` row with consent survives it, under decision 7's retention. The staff app shows a banner in a demo venue with the expiry date and a link to deploy it yourself. Signing in again after deletion creates a fresh sandbox, and a repeated sign-up from the same normalized address is counted against decision 8.
10. **Separate deployment.** The demo runs as its own stack (`compose.demo.yaml`: its own database, API, Caddy) on its own host such as `demo.opencovers.dev`, never on the same database as a real instance. The site's "Try the demo" button links to it. `DEMO_MODE=1` has a guard at startup: the API refuses to start in demo mode when the database holds a venue that `provisionSandbox` did not create, so the mode cannot be turned on over a real instance. How a sandbox venue is marked (a column or a side table) is decided when it is built.
11. **Contract.** Demo auth lives under `/api/auth` and a small `/api/demo` namespace, outside `docs/contract/`. The engine contract is unchanged.

## Consequences

**Easier.** A visitor reaches a working restaurant in one email click. The team gets consented leads. Demo data cannot drift, because the engine builds it.

**Harder.** Provisioning runs real domain code on sign-in, so it must stay fast and idempotent. A new feature must be reflected in the template. The demo needs its own host, a verified Resend sender and a Google OAuth client.

**Accepted.** The demo stores visitor email addresses. The privacy notice must say so, for how long, and for what. Wording and legal basis need review before launch, as the project's other email templates do. A visitor who loses the magic link requests another. Some real users use disposable addresses and will be refused. Webhook delivery cannot be tried in the demo. The demo has real caps, so on a busy day a visitor can meet a "demo is full" page.

## Open for the owner

- **Hosting and domain** for the demo stack, and the Resend sender domain for magic links.
- **Google OAuth client** and its consent screen.
- **Privacy notice and legal basis** for storing consented leads and for sending news. Wording and basis need legal review before launch.
- **Numbers** proposed in decisions 7 and 8: lead retention (12 months), magic-link limits, the global and daily sandbox caps, the per-sandbox reservation and guest caps.
- **Whether the unsubscribe route belongs in the engine** or in a small separate service next to it.

## Amendment, 2026-11-20: consent is recorded by the signed-in account

Decision 7 said a lead exists only for a visitor who ticked the consent box, and the first implementation took the tick from headers on the magic link request (and from a cookie across the Google redirect). The security audit of the implementation (finding F8) showed that this lets anyone request a link for another person's address with the tick set and a name of their choosing: the inbox owner only opens a mail that never mentions consent, and a lead is recorded for them. Consent is therefore recorded by the signed-in account, not by whoever requested the link.

After sign-in the form calls `POST /api/demo/consent` with the session cookie and `{ version, locale, name? }`. The server writes the `demo_lead` row for the verified address of that session, never for an address named in the request, and accepts only the current consent text version and a supported locale. The `X-Demo-Consent` and `X-Demo-Locale` headers and the claim cookie no longer exist. A sign-in alone creates no `demo_lead` row. The unsubscribe route of decision 7 is not part of this amendment.

## Amendment, 2026-11-20: how the abuse limits of decision 8 are applied

Decision 8(b) to (f) was implemented as written, with these clarifications and no change of intent.

- **One normalized address, one place.** `normalizeEmail` (`apps/api/src/demo/normalize.ts`) is used by the sandbox rule, the lead table and the link limits. It is NFKC, lower case, the domain in ASCII (punycode) without a trailing dot, and for Gmail and Googlemail the dots and the `+tag` removed. A `+tag` on other domains is kept, because providers differ and stripping it could merge two people.
- **Leads.** `demo_lead` has a unique `normalized_email`, so a person has one lead under any spelling, and erasure finds it under any spelling. `email` keeps the verified address the visitor last signed in with, which is where outreach goes.
- **Disposable list.** The deny list is the CC0 list `disposable-email-domains`, vendored with its commit and date, plus a few local additions. Matching is by suffix.
- **Mail (d).** "The visitor's own verified address" means the account that owns the sandbox. Another admin who joined through an invitation is not reachable.
- **Webhooks (e).** Creation is refused, and a delivery to a sandbox's endpoint is skipped and switches the endpoint off.
- **Values for the owner to confirm (c, f).** 500 live sandboxes, 100 new per 24 hours, 150 reservations and 100 guests per sandbox, and the other per-sandbox caps listed in the deployment guide. Each is an environment variable with a default.

## Amendment, 2026-11-21: leads and consent dropped

The demo no longer collects leads. This supersedes decision 7, the consent route of the 2026-11-20 amendment, the lead rules of decision 9 and the lead row of the abuse-limits amendment. The `demo_lead` table, `POST /api/demo/consent`, `pnpm demo:leads` and the 12-month lead retention are removed (migration 0049), and so are the checkbox and the privacy and legal-basis questions that came with it. The sign-in form shows one line under the buttons, "By continuing you accept the terms of use and the privacy policy", with links to `/condiciones.html` and `/privacidad.html` on opencovers.dev. No click beyond the sign-in buttons is needed. Why: a smaller privacy surface. The demo now stores only the account and sandbox of a visitor, and both are deleted when the sandbox expires (decision 9). The terms page is a draft without lawyer review.

## Amendment, 2026-11-21: only reviewed languages, and no phone in the sample restaurant

With `DEMO_MODE=1` the demo offers Spanish and English only. The widget's `ca`, `fr`, `de`, `it` and `pt` texts are machine-assisted and not yet reviewed by a native speaker (ADR-0017, stage 15 amendment), and the demo is about to open to the public. `enabledLocales()` (`apps/api/src/lib/online-booking.ts`) returns all seven codes normally and `es` and `en` in the demo. It decides the widget page `?lang=`, the `/r` and `/r/waitlist` `?lang=`, the venue's `locale`, a guest's `locale` on a public booking or waitlist entry, and the language of the sign-in email. A code outside the list behaves as an unknown code does today: the page falls back to the venue's language, and a write is refused with the usual validation error. The Setup card lists the languages the demo status allows. Self-hosted installs keep seven languages. The five come back in the demo once they are reviewed (ROADMAP, localization).

The sample restaurant also publishes no phone number. The number it had looked like a real Madrid landline. The widget already renders without a phone. Sandboxes created before this change keep the old number until they expire (14 days after the last sign-in, decision 9). No migration, because the demo is not public yet.

## Amendment, 2026-11-23: what is built

Facts only. The status stays Proposed until the owner accepts the record.

- **The "Reset my demo" button of decision 5 is not built.** A search of `apps/api/src` and `apps/web/src` finds no such route or control. A sandbox expires 14 days after its owner's last sign-in (`SANDBOX_TTL_DAYS`).
- **Sandbox caps as built** (`apps/api/src/demo/settings.ts`, each overridable by a `DEMO_MAX_*` variable): 150 reservations, 100 guests, 60 waitlist entries, 40 tables, 8 services, 40 floor items, 20 invitations, 10 API keys and 50 blocklist entries per sandbox. The demo hosts at most 500 live sandboxes and 100 new ones per 24 hours. At most 3 sandboxes build at once, with 50 sign-ins allowed to wait.
- **The demo opened to the public on 2026-11-21.** It collects no leads. The visitor accepts the terms by continuing, and the demo offers Spanish and English only.

## Alternatives considered

- **One shared demo venue.** Cheapest, but visitors overwrite each other's data and the venue looks broken after the first hour. A nightly reset would still break live sessions. Rejected.
- **Read-only shared venue.** Safe, but it cannot show bookings, cancellations or setup, which is the product. Rejected.
- **Video or recorded tour only.** Already on the site. It does not let anyone test, and it creates no leads.
- **Password sign-up with email verification.** Works, but a password adds friction and no more safety than a magic link. Kept off in demo mode.
- **A separate seed copy for the demo.** It drifts from the engine within a release. Rejected for decision 4.
