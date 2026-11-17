# ADR-0007: Rate limiting

- Status: Accepted
- Date: 2026-11-16
- Deciders: David Cabeza

## Context

Sign-in, sign-up and invitation redemption can be hit as fast as the machine allows, or so the hardening guide says. The same guide admits that it never tested what Better Auth does by default. [ADR-0005](0005-signup-control.md) left sign-up unthrottled on purpose. [ADR-0006](0006-staff-invitations.md) added `POST /v1/invitations/redeem` and the `X-Invitation-Token` sign-up header, and leaves redemption without a limit.

The goal is a rate limit on the credential and invitation paths of a single self-hosted instance, with honest limits stated. The API does not read `X-Forwarded-For` today, so it has no way to tell clients apart behind Caddy.

### What Better Auth does by default

Measured on Better Auth 1.7.18 (the version in `apps/api`), by reading its source in `node_modules` and by running the API against a scratch database and firing requests at it. The API ran under `tsx` with `NODE_ENV=production` set by hand, not from the built image. For the proxy runs the real `caddy:2-alpine` (v2.11.9) with `apps/web/Caddyfile` sat in front.

| Question | Answer | Evidence |
| --- | --- | --- |
| Is it on? | Only when `NODE_ENV` is `production`. | `create-context.mjs` sets `enabled: options.rateLimit?.enabled ?? isProduction`. `apps/api/Dockerfile` sets `NODE_ENV=production`, so the compose stack has it. `pnpm dev`, `pnpm start` outside Docker and the tests do not. Measured: with `NODE_ENV` unset, 8 sign-ins and 105 session reads all passed. |
| Where is the state? | A `Map` in the process, capped at 100,000 entries. No database table, no secondary storage here. | `api/rate-limiter/index.mjs`. It is lost on restart. |
| Which paths? | Everything under `/api/auth`. Nothing else. | Measured: `POST /v1/invitations/redeem` and `/v1/*` were never limited. |
| Which limits? | 3 requests per 10 seconds for paths that start with `/sign-in`, `/sign-up`, `/change-password` or `/change-email`. 3 per 60 seconds for password reset and verification mail paths, which this app does not enable. 100 per 10 seconds for every other `/api/auth` path. | Source. Measured: sign-in and sign-up allowed 3 and refused the 4th. A session read allowed 100 and refused 5 of 105. `/health` was never limited. |
| What is the key? | The client address plus the path, so sign-in and sign-up have separate budgets. | Source. |
| Where does the address come from? | `X-Forwarded-For` only, and only when it holds exactly one value. | `ip.mjs`. With no usable address, Better Auth logs one warning and puts every such client in one shared bucket per path. Measured with the API reached directly: 8 sign-ins with no header allowed 3. Sending a different single-value header on each request was never limited (6 of 6 allowed). A two-value header shared the bucket. |
| Is the address safe behind Caddy? | Yes, with this Caddyfile. | Measured with an echo server behind Caddy: a client header `X-Forwarded-For: 6.6.6.6, 7.7.7.7` reached the upstream as `127.0.0.1`, the one peer address. Caddy replaces the header, so a client cannot choose its key. |
| What does a refusal look like? | `429` with `{"message":"Too many requests. Please try again later."}` and an `X-Retry-After` header. | Measured. There is no `code` and no `Retry-After`, so it does not follow [errors.md](../contract/errors.md). |
| Can it be configured from the environment? | No. | The code passes no options to `rateLimit`. |

What follows from that:

- The compose stack already has a tight limit on sign-in and sign-up by accident of `NODE_ENV`. Sign-in and sign-up outside Docker have none.
- 3 per 10 seconds also refuses an honest user who mistypes a password 4 times quickly, and still allows about 26,000 guesses a day per address (3 per 10 seconds, computed, not measured over a day).
- Invitation redemption has no limit anywhere, and the error shape is the wrong one.

## Decision drivers

- **Smallest design that works.** One module in the API, no migration, no new dependency.
- **One limiter.** One response shape and one set of settings, not two limiters stacked.
- **Safe default, quiet development.** A fork that changes nothing is limited. `pnpm test` stays fast and stable.
- **An honest key.** A client must not be able to pick its own key in the shipped stack.
- **No oracle.** The answer must not change with whether an account or a token exists.
- **Cover redemption.** The limits must match the ADR-0006 paths exactly.

## Decision

A Hono middleware in `apps/api/src/lib/rate-limit.ts` runs before every route. It counts requests per client in memory and answers `429` when a budget is spent.

### What is limited

| Rule | Matches | Default |
| --- | --- | --- |
| `auth` | Any request that is not `GET`, `HEAD` or `OPTIONS` under `/api/auth`, except sign-up. Sign-in, sign-out, change password, and anything Better Auth adds later. | 30 per 15 minutes |
| `signup` | Any such request under `/api/auth/sign-up`. | 5 per hour |
| `invitation` | `POST /v1/invitations/redeem`, and any sign-up that carries a non-empty `X-Invitation-Token` header. | 10 per 15 minutes |

- A sign-up with the invitation header counts on `signup` and on `invitation`. If either is spent, the request is refused and neither is charged, so a refusal never burns the other budget.
- `GET`, `HEAD` and `OPTIONS` are never limited. That covers `/health`, session reads, availability, the event feed and CORS preflights.
- Repeated slashes and a trailing slash are removed before matching, and the path is the one Hono routes on. The default for any unmatched write under `/api/auth` is the `auth` budget, so a path spelling that dodges the sign-up match falls into a limit, not into none.
- The redeem path is matched by name, and a test runs it against the real route.
- Every other `/v1` route is not limited. See What is not covered.

### How it counts

A fixed window per rule and client. The window opens at the first request and the count resets when it ends. Every request counts, whatever its outcome, because the limiter runs before the handler and never reads the body. A refused request does not count and does not extend the window. `Retry-After` is the seconds left in the longest spent window, rounded up, never below 1. A client that straddles a window boundary can send up to twice the maximum in a short time. That is accepted.

### The client address

`TRUST_PROXY` decides where the address comes from.

| Value | Address used |
| --- | --- |
| `false` (default) | The socket address Node sees. `X-Forwarded-For` is ignored. |
| `true` | The last entry of `X-Forwarded-For`, which is the address the one trusted proxy saw. Earlier entries are client-controlled and ignored. If the entry is missing or not an IP, the socket address is used. |

An IPv6 client is keyed by its first 48 bits (its first 64 bits until the amendment of 2026-11-17 below). An IPv4-mapped address is read as IPv4. The API logs one warning when a forwarded header arrives and `TRUST_PROXY` is off, and one when it is on and the header is unusable.

`compose.prod.yaml` sets `TRUST_PROXY: ${TRUST_PROXY:-true}`. Caddy is the only door to the API, the `api` service publishes no port, and Caddy replaces the header with the peer address (measured above). Outside compose the default is `false`, because a client that reaches the API directly writes that header itself.

What happens when it is wrong:

- **Off behind a proxy.** Every client has the proxy's address, so everyone shares one budget. One abuser, or a busy shift change, refuses all staff sign-ins until the window ends. The warning above names the fix.
- **On with the API reachable directly.** A client picks its own key. It can dodge its limit by rotating the header, and it can spend a victim's budget by sending the victim's address. Never publish the `api` port.
- **A CDN or second proxy in front of Caddy.** Caddy then sees the CDN's address and the API keys on it, so every client behind one CDN edge shares a budget. One trusted hop is all this supports. Limit at the CDN instead, or accept the shared budget.

### Storage

One in-process `Map` per rule, keyed by client, at most 10,000 clients each. Expired counters go first, and a full table refuses new clients (the amendment of 2026-11-17 below; it used to drop the oldest key). There is no timer.

- A restart clears every counter. Someone who can restart the API gets a fresh budget.
- Two API instances count separately, so the real limit is the number of instances times the setting. Compose runs one.
- Someone with more than 10,000 distinct addresses can fill a rule's table, and new clients of that rule are then refused until a window ends. At that scale per-address limits do not help anyway.

The database was considered and rejected. It would need a table and a write on every auth call, and it only helps a multi-instance setup that this repository does not run. No migration is needed.

### The response

`429` with the standard body and a header:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 840
{"code":"rate_limited","message":"Too many requests. Try again later."}
```

The body and the headers are the same for every rule. The limiter does not read the request body or the cookies, so it cannot answer differently for an account or a token that exists. A refused request does no work, because the limiter runs first. The API does not log each refusal. A log line per refusal would let an attacker fill the log.

### Better Auth's limiter is off

`auth.ts` sets `rateLimit: { enabled: false }`. Otherwise the compose stack would have two limiters. Better Auth's 3 per 10 seconds would answer first, in its own shape, with a setting nobody can change. Everything it limited that matters here is a write under `/api/auth`, and the `auth` and `signup` rules cover those. What is lost is its 100 per 10 seconds on reads such as the session, which this ADR does not limit.

### Settings

| Variable | Values | Default |
| --- | --- | --- |
| `RATE_LIMIT` | `on` or `off` | `on` when `NODE_ENV=production`, otherwise `off` |
| `TRUST_PROXY` | `true` or `false` | `false` (`true` in `compose.prod.yaml`) |
| `RATE_LIMIT_AUTH` | `max/window`, such as `30/15m`, with `s`, `m` or `h` | `30/15m` |
| `RATE_LIMIT_SIGNUP` | same | `5/1h` |
| `RATE_LIMIT_INVITATION` | same | `10/15m` |

An empty value counts as unset. Any other value, including `OFF` or `0/1m`, stops the API at startup and names the variable, as `SIGNUP` does. The API logs one startup line that says whether the limiter is on or off and why: the default for `NODE_ENV`, or an explicit `RATE_LIMIT`. `vitest.config.ts` sets `RATE_LIMIT=off`, so the existing suite is unaffected, and the tests for this feature switch it on themselves.

Why these numbers. Staff in one venue share one public address, so `auth` must allow a shift change, with sign-outs, and 30 per 15 minutes does. It still caps a sustained guess at about 2,900 a day per address, roughly a ninth of what Better Auth's 3 per 10 seconds allows. Sign-up is rare, so 5 per hour. Redemption is rare, and the 256-bit token cannot be guessed, so 10 per 15 minutes only bounds probing and database load.

The default follows `NODE_ENV` because in `pnpm dev` every request arrives through the Vite proxy from one address. An on default would lock a developer out after 5 sign-ups in an hour, and local development must need no setting. `RATE_LIMIT=on` or `off` always wins.

Consequence. The API image sets `NODE_ENV=production`, and `compose.prod.yaml` also sets `RATE_LIMIT=on`, so the shipped stack is limited. A deployment outside Docker must set `NODE_ENV=production` or `RATE_LIMIT=on`. Otherwise it runs with no limits, and the startup line says so.

### What is not covered

- **A distributed attacker.** The key is the address. Many addresses mean many budgets. There is no per-account lockout, because it would let an attacker lock a staff member out. There is no CAPTCHA and no second factor.
- **Every other `/v1` route.** Reservation writes, key creation and webhooks are not limited. `POST /v1/venues` is limited since the 2026-11-17 amendment below. Agents with a valid key are expected to be busy.
- **Reads.** Session reads, availability and the event feed are not limited.
- **Request size.** The hardening guide still lists body limits.
- **A shared address.** One abusive person on a venue's network spends the budget of everyone behind that address.
- **Several instances and restarts.** See Storage.
- **Visibility.** There is no metric and no log of refusals.

An edge limit, such as a CDN or a Caddy build with a rate-limit module, stays a good second layer.

## Consequences

**Easier.** Sign-in, sign-up and invitation redemption are limited with one setting, in every environment, with one error shape. The hardening guide can say exactly what is covered. A conformance case (C28) pins the behavior.

**Harder.** `TRUST_PROXY` is a new setting that has to be right. Compose sets it. Anyone who fronts the API by hand must set it. The `auth` rule is broad by design, so a new write route under `/api/auth` is limited without anyone deciding to.

**Accepted.** The limits are per address and per process. A determined attacker with many addresses is not stopped. ADR-0006 points here for its redemption limit.

## Alternatives considered

- **Configure Better Auth's limiter instead.** It supports `customRules`, `ipAddressHeaders` and `trustedProxies`. Rejected. It covers only `/api/auth`, so redemption would need a second limiter anyway, and it would still answer in its own shape.
- **Store counters in PostgreSQL.** Rejected for now. It adds a migration and a write per request and only matters with several instances. It is the upgrade path if the project ever runs more than one API process.
- **A rate-limit package for Hono.** Rejected. It adds a dependency for about 150 lines, and the hard part, the client address, is still ours to decide.
- **A Caddy rate-limit module.** Not in the stock image. It needs a custom build, and it protects nothing when the API runs without that proxy. Kept as an optional second layer.
- **Count only failed attempts.** Rejected. It needs the outcome, so a response hook, and a flood of valid sign-ins still costs a password hash each.
- **Take the leftmost `X-Forwarded-For` entry.** Rejected. The client writes it.
- **Lock the account after repeated failures.** Rejected. It hands an attacker a way to lock out any staff member.
- **A sliding window or token bucket.** Rejected. More state for a smoother edge that does not change the decision.
- **Default off, opt in.** Rejected. A fork that changes nothing would stay unprotected, which is the problem this ADR exists to fix.

## Amendment 2026-11-17: venue creation

`POST /v1/venues` is now limited by a fourth rule, `venue_creation`, with the same limiter, response, client address and `TRUST_PROXY` handling. The default is 10 per hour per client address, set by `RATE_LIMIT_VENUE_CREATION` as `max/window`. It is rare for an owner to create more than a few venues in an hour, and a restaurant group seeding a dozen fits one window, while a script that creates thousands is stopped. ADR-0008 left this open ("the owner can create venues without a bound").

- It runs before the session and the body are read, so a call that fails with `unauthorized`, `403 venue_creation_closed` or `invalid_request` spends budget like one that creates a venue. This follows "every request counts, whatever its outcome" above, and it keeps the refusal independent of the account, as the No oracle driver requires. The cost is that a refused account behind a shared address spends the budget of that address.
- The route takes no `Idempotency-Key`, so there is no replay to exempt. A repeated call is a new call and counts.
- `GET /v1/venues` and every other `/v1/venues/{venueId}/...` route are unaffected. Only the exact path `POST /v1/venues`, after the slash normalization, matches.

## Amendment 2026-11-17: fail closed, /48, and the HTTP layer

A security review showed two ways to reset or spend a budget at no cost. One shared table of 10,000 keys dropped its oldest key when full, so 10,001 reads from new addresses erased a spent sign-in or `public_venue` budget. And a public create with a malformed body spent `public_venue` like a real booking.

- **One table per rule, and a full table refuses.** Each rule keeps at most 10,000 clients. A rule has one window, so a table is ordered by expiry, and expired counters leave from its front. A new client of a full rule gets `429 rate_limited` with a `Retry-After` until the oldest window ends, and the API logs one warning naming the rule. A live counter is never dropped, so a flood of public reads cannot touch sign-in or `public_venue` counters. The cost: an attacker who fills a rule's table refuses new clients of that rule for one window. Memory stays bounded at 8 tables of 10,000 counters.
- **IPv6 by `/48`.** One site commonly holds a `/48`, which is 65,536 `/64`s, enough to fill a table from one allocation. Keying by `/48` makes filling a table cost 10,000 allocations. Every rule uses it, sign-in included, because a fail-closed table is the target. The cost: clients that share a `/48`, such as some mobile carriers, share a budget. Raise the budget if that shows.
- **`public_venue` is charged only for a create that reaches the booking.** A create that answers `400` (a malformed body, a failed challenge, a body over the size limit) or `404` (an unknown key) gives its `public_venue` charge back. The per-address `public_booking` charge stays, so junk costs the sender's own budget first, and unknown keys leave no counter behind. A solved challenge with a valid body still spends `public_venue`: the lever section 3 of ADR-0017 accepts stays, at the cost of the proof of work.
- **Request bodies are capped.** The API reads at most 16 KB under `/v1/public/` and 256 KB elsewhere, and answers a larger body with `invalid_request`, before any route reads it. The widget's largest body is about 2 KB, and the staff app's is a config with 366 blocked date ranges, about 20 KB. The shipped Caddyfile caps bodies at 64 KiB on the widget site and 1 MiB on the staff site, above the API's limits, so a client normally sees the API's JSON error and Caddy answers `413` only beyond.
- **Cookie writes need the staff origin.** A `POST`, `PUT`, `PATCH` or `DELETE` under `/v1/` (not `/v1/public/`) that carries a cookie and no `apikey` fails with `403 forbidden` when its `Origin` is not one of `BETTER_AUTH_URL` and `TRUSTED_ORIGINS`, and with `invalid_request` when it has a body that is not `application/json`. A page on a sibling origin, such as the widget host, can send a form or a `text/plain` fetch with the staff cookie and no preflight; this closes that. A request with no `Origin` passes, because browsers send one on every cross-origin write. Keys, the public routes and `/api/auth`, which Better Auth checks itself, are unchanged.

