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

1. **One sandbox venue per visitor.** On the first verified sign-in under `DEMO_MODE=1`, the API creates a venue for that account from a template and makes the visitor its `admin`. Every feature works, because the visitor is a real admin of a real venue. Isolation is the existing per-venue isolation. A visitor has at most one sandbox.
2. **Two profiles in one sandbox.** The template also turns on online booking for the sandbox venue and creates its booking key, so the guest widget at `/w/{bookingKey}` works from the first minute. A fixed bar in the demo shows a switch, "Restaurant" and "Diner". Restaurant opens the staff app. Diner opens the widget for that venue, in a new tab so both stay open. No second account is needed, because the widget is public by design. The widget's allowed origin list for a sandbox is the demo host only.
3. **See how a booking was made.** The reservation detail in the staff app shows its trace: where it came from (`widget`, `staff`, `api`, `mcp`), who or what acted, the idempotency key, and each event with its version and time, read from the same event feed the API exposes (`reservation.events`). A booking the visitor makes as diner appears in the agenda and its trace with source `widget`. If the staff app lacks this panel today, it is built as part of this work, because it is a product feature and not demo-only. A short guided checklist in the demo ("1. Book as a diner. 2. Find it in the agenda. 3. Open its trace. 4. Cancel it and watch the table free up") makes the loop explicit.
4. **Template is code, not data.** `provisionSandbox(userId)` is an in-process function that builds the venue through the same domain functions the routes call (`createVenue`, config, tables, services, reservations, waitlist, guests). It replaces the HTTP-only seed script, which becomes a thin caller of the same template so there is one definition. Dates are relative to the day of provisioning. Every guest is invented and uses an `example.com` address.
4. **Stays current by construction.** The template runs on every sign-in, against whatever code is deployed. A CI test provisions a sandbox and asserts the screens' data exist, so a change that breaks the template fails the pull request. `CLAUDE.md` gets one rule: a feature that adds a screen or setting also adds it to the template. The demo host redeploys on every push to `main`.
5. **Sign-in methods.** Under `DEMO_MODE=1` password sign-up is off. Visitors use a magic link or Google. The magic link is sent to the address typed, so the account exists only for someone who read that inbox. A Google account must report a verified email. This is the "access sent to your email" the visitor sees, and it is the spam control.
6. **Leads.** A table `demo_lead` holds `email`, `name` (optional), `source` (`magic-link` or `google`), `locale`, `created_at`, `last_seen_at`, `contact_consent` (boolean), `consent_text_version`. The sign-in form has an unchecked checkbox "I agree to receive news about OpenCovers" and a link to the privacy notice. The account and sandbox are created whether or not it is ticked, because the demo's operation does not depend on it. Only leads with `contact_consent = true` are exported for outreach. Export is a script, `pnpm demo:leads`, that prints CSV. No lead data is returned by any HTTP route.
7. **Abuse limits.** Existing rate limits cover `/api/auth`. Additional: one sandbox per account, at most 1 magic link per address per minute, disposable email domains refused through a small deny list in the repository, webhooks from sandboxes disabled and email sent only to the visitor's own verified address, so a diner booking in the demo can show a real confirmation email without the sandbox mailing third parties, and a lower cap on reservations and guests per sandbox.
8. **Lifecycle.** A sandbox expires 14 days after the last sign-in. A daily job deletes expired sandboxes and their accounts, and keeps the `demo_lead` row. The staff app shows a banner in a demo venue with the expiry date and a link to deploy it yourself. Signing in again after deletion creates a fresh sandbox.
9. **Separate deployment.** The demo runs as its own stack (`compose.demo.yaml`: its own database, API, Caddy) on its own host such as `demo.opencovers.dev`, never on the same database as a real instance. The site's "Try the demo" button links to it.
10. **Contract.** Demo auth lives under `/api/auth` and a small `/api/demo` namespace, outside `docs/contract/`. The engine contract is unchanged.

## Consequences

**Easier.** A visitor reaches a working restaurant in one email click. The team gets consented leads. Demo data cannot drift, because the engine builds it.

**Harder.** Provisioning runs real domain code on sign-in, so it must stay fast and idempotent. A new feature must be reflected in the template. The demo needs its own host, a verified Resend sender and a Google OAuth client.

**Accepted.** The demo stores visitor email addresses. The privacy notice must say so, for how long, and for what. Wording and legal basis need review before launch, as the project's other email templates do. A visitor who loses the magic link requests another. Some real users use disposable addresses and will be refused.

## Alternatives considered

- **One shared demo venue.** Cheapest, but visitors overwrite each other's data and the venue looks broken after the first hour. A nightly reset would still break live sessions. Rejected.
- **Read-only shared venue.** Safe, but it cannot show bookings, cancellations or setup, which is the product. Rejected.
- **Video or recorded tour only.** Already on the site. It does not let anyone test, and it creates no leads.
- **Password sign-up with email verification.** Works, but a password adds friction and no more safety than a magic link. Kept off in demo mode.
- **A separate seed copy for the demo.** It drifts from the engine within a release. Rejected for decision 2.
