# Reverse engineering of reservation projects, checked against OpenCovers

Date: 2026-11-16. Status: research note, not a decision. Decisions that change architecture, contract or security still need an ADR.

## Method

Seven repositories and three web sources were read without running their code. Each was read by a separate read-only pass, then the findings were checked against this repository (schema, migrations, contract, conformance status, MCP server, site).

Limits:

- `harismuneer/Restaurant-Management-System`: only three files were read.
- `OpenReservation`: the WeChat client and the Razor views were not read.
- `TastyIgniter`: the repo is an empty Laravel skeleton, so `tastyigniter/core` and `ti-ext-reservation` were read instead. `ti-ext-local` and `ti-ext-api` were not read.
- `seatswiper-mcp` has only a README and a LICENSE. Nothing about its tools could be verified.
- `opencals.com` and `appsgit.com` were read through page fetches only.
- Claims marked "inference" were not run.

## Sources

| Source | What it is | Reservations core |
| --- | --- | --- |
| TastyIgniter (+ core, ti-ext-reservation) | PHP/Laravel ordering platform, reservations as an extension | Check in PHP, then `save()`. No transaction, lock, or constraint. |
| openresto | ASP.NET + SQLite, polished guest UX | SELECT overlap, then insert. Holds in an in-memory dictionary, single instance. |
| kitchenasty | Express + Prisma ordering clone | Insert with no availability check. Booking settings in the UI that no code reads. |
| OpenReservation | C# room booking for a school | Check-then-insert under a Redis or in-process lock. No database guarantee. |
| slavyanHristov/restaurant-table-reservation-system | Express + Sequelize demo | No availability logic. Manual `isOccupied` flag. |
| harismuneer/Restaurant-Management-System | Android + Firebase operations app | No reservations model. Table status set by hand. |
| respa (City of Helsinki, from the topic page) | Django resource booking, deprecated | `select_for_update()` plus an overlap check in the application. |
| seatswiper-mcp | Closed hosted MCP connector that watches Resy, SevenRooms and OpenTable | Not a reservations engine. |
| opencals.com | Closed SaaS for service bookings | Not for restaurants. |
| appsgit.com | Directory of self-hostable open source apps | A distribution channel. |

## Main finding

None of the reservation engines read enforces no-double-booking in the database. All of them check first and write after, protected at most by an application lock (Redis, in-memory, `select_for_update`). None has idempotency keys, monotonic versions or a signed event feed. OpenCovers has all of these (conformance C1, C2, C4, C11, C15, all PASS). This is the differentiator, and the message "the only open source engine where the database guarantees no double booking, with MCP built in" holds up against this sample. The sample is small, so claim it as "among the projects we reviewed", not universally.

## Recurring anti-patterns

- Occupancy as a mutable flag instead of derived from intervals.
- Date and time in separate columns, or a bitmask of slots.
- A fixed time zone, or hours hardcoded in code.
- Settings visible in the UI that no code applies.
- Tests on InMemory databases or mocks, which cannot exercise constraints or concurrency.
- Storing IP, user agent or phone with no need.
- Venue isolation as an application filter.

OpenCovers avoids each of these: `tstzrange` with a GiST exclusion on `table_allocations` (migration 0016), the contract and conformance first, tests against real Postgres, and isolation per venue (C10).

## Cross-check: what the sources have that OpenCovers lacks

Checked by reading `apps/api/src/db/schema.ts`, `docs/contract/*`, `docs/requirements.md`, `apps/api/src/lib/*` and `apps/mcp/src/index.ts`.

| Idea | Seen in | OpenCovers today | Verdict |
| --- | --- | --- | --- |
| Table combinations and auto-assign (best fit) | openresto, TastyIgniter | `pickCombination` in `apps/api/src/lib/reservations.ts` picks the fewest tables, then the fewest seats. `no_suitable_table` exists. | Covered. Not covered: round-robin by section and a max-oversize setting. |
| Turn time by party size, party limits per service | openresto | C21, `turn_times`, `min_party_size`, `max_party_size`. | Covered. |
| Walk-ins, waitlist | openresto, TastyIgniter | `waitlist` table, walk-in endpoint, C8, C26. | Covered. Wait estimate and a "table ready" notice are not present. |
| Booking status, no-show | openresto, TastyIgniter | C9 `seated`, `attended`, `no_show`, `invalid_transition`. | Covered. A short undo window is not present. |
| Overbooking | none directly | C24 | Ahead of the sources. |
| Reconfirmation, consent, rating, booking note | none | C14, C16, C23, C25 | Ahead of the sources. |
| Explain why a time is unavailable | none | C20 | Ahead of the sources. |
| Webhook delivery with retry and signature | KitchenAsty (unsigned, in memory) | C15: HMAC, ordering, backoff, SSRF guards. | Ahead. |
| MCP tool hints | SeatSwiper README | `readOnlyHint` is set on read tools in `apps/mcp/src/index.ts`. | Partly covered. Check that write tools carry `destructiveHint` and `idempotentHint` where true. Not verified. |
| Temporary holds while the guest fills in the form | openresto (in memory) | None. C3 states that availability is advisory and not a hold. | Gap. |
| Approval flow (pending, approved, rejected) | OpenReservation | None. A booking is accepted or refused at create. | Gap, optional. |
| Per-venue booking policy: maximum days ahead, maximum active bookings per guest per day, blocked dates, blocklist | OpenReservation, KitchenAsty (unused) | `lead_time_violation` covers a minimum lead time only. No horizon, per-guest cap, blocked dates or blocklist were found. | Gap. |
| API keys with per-resource scopes, plus a test that every route declares a scope | openresto | Keys carry one role (`read`, `write`, `admin`). C22 tests each admin route. | Partly covered. No per-resource scopes. |
| Audit of admin mutations with retention | openresto, KitchenAsty | `guest_audit` covers guest merges only. Invitations and member removal write no audit rows. | Gap. Already planned as sprint 3 item 1. |
| Remote MCP (Streamable HTTP, OAuth 2.1 with PKCE) | SeatSwiper | stdio only. | Gap. |
| Structured MCP and API errors with a retry hint | none directly | Errors are `{code, message}`. There is no `retryable` field. | Gap, small. |
| Official MCP registry listing, appsgit listing | SeatSwiper, appsgit | Not found in the repo. | Gap, distribution. |
| `llms.txt`, an English page | ai-visibility result for this project | `apps/site/public` has no `llms.txt`. The site is in Spanish by rule. | Gap, distribution. |
| Reservation analytics | KitchenAsty | None found. | Gap, low priority. |
| Automation rules on events | KitchenAsty, TastyIgniter | The signed feed and webhooks exist. No rule layer. | Optional, low priority. |

## Recommended backlog, in order

1. Audit log for invitations, joins and member removals. Already planned. It also feeds the member-removal policy being decided.
2. Per-venue booking policy: maximum horizon, maximum active bookings per guest per day, blocked dates. This needs a contract change (`openapi.yaml`, `conformance.md`, `conformance-status.md` together) and likely an ADR. A blocklist must store hashes, not phone numbers or emails.
3. Persistent holds. A table with `expires_at` that takes part in the same exclusion constraint. This changes C3 and needs an ADR, because it changes the rule that a read is not a hold. Decide first whether any client needs it. The staff app does not today.
4. MCP: audit hints on write tools, add a `retryable` flag to errors, then evaluate Streamable HTTP with OAuth 2.1 (needs a security ADR).
5. Distribution: `llms.txt`, an English landing page, GitHub topics and description, listing in the MCP registry and appsgit. These are not code in the engine and do not touch the contract.
6. Later, only if requested: waitlist wait estimate, approval flow, per-resource key scopes, analytics, automation rules.

## Not recommended

- Holds kept in memory, SQLite, or check-then-insert protected only by a lock.
- A bitmask of slots, or a fixed time zone.
- Guest credentials for third-party platforms, which is the SeatSwiper model. If agent booking is wanted, the venue-side API we already have is the safer route.
- Settings that are exposed before they are enforced. Each new setting should have a conformance case that proves it takes effect.

## Open questions

- Does any planned client need holds, or is the advisory read enough? (Decides item 3.)
- Should a booking ever be pending? (Decides the approval flow.)
- Is a hosted offer planned? opencals charges per booking and its one-line message is a reference point, but this is a product decision.
