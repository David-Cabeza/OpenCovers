# Roadmap

OpenCovers is pre-alpha. The engine, the staff app, and the MCP server run locally and pass their tests. Nothing is deployed except the public site. The roadmap is a sequence of phases, not a promise of dates. Each phase has an exit criterion. Flags are the unit of work. See [CONTRIBUTING.md](CONTRIBUTING.md).

The storage decision changed from Cloudflare Durable Objects to PostgreSQL. See [ADR-0002](docs/adr/0002-port-to-postgresql.md).

## Done

### Phase 2: Contract and conformance

The OpenAPI contract, the MCP tool catalog, the error vocabulary, and 13 conformance cases are merged under [docs/contract](docs/contract).

### Phase 3: Runnable skeleton

Node.js, Hono, and PostgreSQL run locally with `pnpm dev`. CI runs typecheck and tests against PostgreSQL 16.

### Phase 4: Schema and exclusion

Venues, hours, tables, services, reservations, and versions are in the schema with 13 migrations. A GiST exclusion constraint rejects overlapping table allocations. A concurrency test shows two parallel creates yield one booking and one `slot_taken`.

### Phase 5: Write routes

Create, modify, cancel, seat, attend, and no-show. Idempotency keys and monotonic versions apply to every write. The engine sets `basis`, `owner_principal`, and `booked_via` from the authenticated channel.

### Phase 6: Read side and event feed

Availability, agenda, list, pacing, and an event feed with a cursor and a retention watermark. See [conformance status](docs/contract/conformance-status.md): all 13 cases pass.

### Beyond the original plan

- Walk-ins, a waitlist, zones, and automatic table assignment.
- Staff sign-in with Better Auth and per-venue roles. Scoped API keys for platforms and agents.
- An MCP server with 18 tools over stdio.
- A staff app with an agenda, availability, a visual floor plan and editor, a waitlist, and setup screens.
- The public site at [opencovers.dev](https://opencovers.dev).

## Now

### Phase 7: Notices, consent, and erasure

Status: partly built, blocked on legal review.

- Done: restaurant notice address, erasure with counts and hashes, tombstones, and an hourly retention job.
- Done: email confirmations and cancellations through Resend, one per reservation version, off by default.
- Pending: legal review of the email text, the consent basis, and retention periods.
- Pending: guest reminders and STOP handling.

Exit criterion: the legal review is complete and the conformance cases still pass.

### Phase 8: Deployment

Status: next.

- Keep the engine host-agnostic: PostgreSQL and a Node.js process, with no vendor-specific code. Each fork chooses where its database lives.
- Done: `compose.prod.yaml` brings up PostgreSQL, the API, and the staff app behind Caddy with one command, documented in [docs/deploy.md](docs/deploy.md). Checked on 2026-11-11 with Docker Compose: `config`, `up --build`, migrations on boot, sign-up and sign-in through the single origin, a table booking, a rejected overlapping booking (`slot_taken`), an idempotent replay, and data surviving a restart.
- Pending: automatic HTTPS on a real domain, and a click-through of the staff screens in a browser. The checks above used HTTP calls to the same origin.

Exit criterion: the staff app signs in and books a table against an API running from the Docker image.

### Phase 0: Publication readiness

Status: in progress.

- Done: Apache-2.0 license, README, contribution guide, code of conduct, security policy, governance, and the flag and pull request templates.
- Pending: confirm the repository history holds no private reference material. Run `scripts/check-publication.sh`.
- Pending: private vulnerability reporting enabled and a monitored private contact for the code of conduct.

Exit criterion: the repository can be made public without confidential or proprietary material, and every reporting channel is live.

## Next

### Phase 9: First venue

- Staff screens hardened with role checks and accessibility review.
- Migration from the launch venue's current system.
- Test coverage for the staff app and the public site, which have none today.

Exit criterion: the launch venue runs on OpenCovers.

## Decisions that block the roadmap

- The project name and trademark clearance.
- Standalone or internal-only product.
- The first-venue route.
- Legal review of guest data, retention, confirmation text, and reminder text.
