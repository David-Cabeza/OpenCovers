# ADR-0014: Remote MCP transport with OAuth 2.1

- Status: Proposed
- Date: 2026-11-16
- Deciders: David Cabeza

## Context

The MCP server runs over stdio only. A hosted agent cannot start a local process, so it cannot reach OpenCovers (GitHub issue #59). A remote transport is a security decision, so this ADR settles it before issue #67 builds it. It decides how a Streamable HTTP endpoint authenticates callers with OAuth 2.1 and PKCE, what those callers may do, and how their access ends.

What the code shows today:

- **The MCP server.** `apps/mcp/src/index.ts` registers 18 tools and connects them to a `StdioServerTransport`. Each tool calls one `/v1` route through `request()` in `apps/mcp/src/client.ts`, which sends `OPENCOVERS_API_KEY` in the `apikey` header to `OPENCOVERS_BASE_URL`. The server holds one key for its whole life.
- **Keys and grants.** `api_keys` stores the SHA-256 hash of a key, a `principal` string and a `role`. `grants` holds `(key_hash, venue_id)` rows. `authenticate` in `apps/api/src/lib/api-keys.ts` accepts a grant for the venue or the wildcard `*`. `POST /v1/auth/keys` defaults `venues` to `["*"]`. `POST /v1/venues/{venueId}/keys` accepts only `read` and `write`. A key has no expiry.
- **The venue check.** The middleware on `/v1/venues/:venueId/*` in `apps/api/src/app.ts` accepts a key or a Better Auth session. A key with no grant for the venue gets `venue_not_found`, and a session with no membership gets the same. A `read` role fails every `POST`, `PUT`, `PATCH` and `DELETE` with `forbidden`. The membership is read on every request, so removing it ends access on the next one (ADR-0009).
- **Route guards.** `adminOnly` requires the `admin` role. `staffSessionOnly` refuses any request that carries an `apikey` header. Invitations and members sit behind both. Keys, tables, services, the floor plan, guest merges, the public profile and `PUT /config` sit behind `adminOnly`. `POST /v1/venues/{venueId}/erasure` has neither guard, so a `write` key or session can erase guest data.
- **Admin tools in the catalog.** `venue.setConfig` calls `PUT /config`, which needs `admin`. It accepts `resendApiKey`, a secret. `reservation.erasure` deletes personal data for good (`destructiveHint: true` in `docs/contract/mcp.md`).
- **Principals.** A key acts as its `principal`, and a session acts as the user's email. Creates store it in `bookedVia` and `ownerPrincipal`. `GET /reservations` lists by principal.
- **Better Auth.** `apps/api/src/lib/auth.ts` enables email and password sign-in and no plugin. Its own rate limiter is off. The installed version is 1.7.18, and its package exports no OAuth provider and no MCP plugin. The `bearer` plugin, which would let a session token act as a bearer token, is not enabled.
- **Rate limits.** `apps/api/src/lib/rate-limit.ts` counts per client address, in memory, and only on writes under `/api/auth`, sign-up and invitation redemption (ADR-0007). Every other write under `/api/auth` falls into the `auth` budget of 30 per 15 minutes. `/v1` routes have no limit (hardening known gap 2).
- **The proxy.** `apps/web/Caddyfile` forwards `/health`, `/api/*` and `/v1/*` to the API and serves the staff app for every other path. Its CSP includes `form-action 'self'`.
- **Audit.** `membership_audit` (ADR-0010) holds ids and a role for `invited`, `invite_revoked`, `redeemed` and `member_removed`, with a check constraint on the action. Key creation and revocation are not audited (hardening known gap 5).
- **The MCP SDK.** `@modelcontextprotocol/sdk` 1.32.2 ships `WebStandardStreamableHTTPServerTransport`, which has a stateless mode, and its newest protocol version is `2025-11-25`. Its DNS rebinding options (`allowedHosts`, `allowedOrigins`) are marked deprecated in favor of external middleware and are off by default. Its OAuth router and bearer middleware are written for Express, and the API uses Hono.

What the MCP specification asks. The current revision is 2026-07-28 ([authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), [security considerations](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations), [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)). The points this ADR relies on:

- Authorization is optional. A stdio server should take credentials from the environment, as ours does.
- The MCP server is an OAuth 2.1 resource server (draft-ietf-oauth-v2-1-13). It must publish Protected Resource Metadata (RFC 9728) and must accept only tokens issued for itself (RFC 8707 audience). It must not pass a received token through to another API.
- Clients must use PKCE with `S256`, and must refuse an authorization server whose metadata lacks `code_challenge_methods_supported`.
- Client ID Metadata Documents are a SHOULD. Dynamic Client Registration (RFC 7591) is a MAY and is deprecated in 2026-07-28. Pre-registration is allowed.
- The authorization server should issue short-lived access tokens and must rotate refresh tokens for public clients. It must match redirect URIs exactly, must show the redirect URI hostname during authorization, and should warn about `localhost`-only redirect URIs.
- A token with too little scope gets `403` with `WWW-Authenticate: Bearer error="insufficient_scope"`. An invalid or expired token gets `401`.
- The server must validate `Origin` on every request and answer `403` when it is present and invalid. Revision 2026-07-28 removed protocol sessions and the `GET` stream from Streamable HTTP.

## Decision drivers

- **No new trust model.** A remote caller acts for a staff member, inside that person's venue memberships, through the same `/v1` routes and guards as everyone else.
- **Revocation is immediate.** A revoked grant, a removed member or a deleted account fails on the next call, as ADR-0009 and ADR-0011 require.
- **Least privilege by construction.** A remote token can never reach admin, membership, key, webhook or erasure routes, whatever bug sits above it.
- **Write less security code.** Reuse the authentication library the API already runs instead of writing an authorization server.
- **Stdio unchanged.** Self-hosters who run the stdio server with a key see no difference.

## Decision

### Shape

The API process serves one MCP endpoint, `POST /mcp`, with the MCP SDK's web-standard Streamable HTTP transport in stateless mode. It answers `GET` and `DELETE` on `/mcp` with `405`. It issues no `MCP-Session-Id` and ignores one if sent, so a session id is never part of authentication. The canonical resource URI is the API's public base URL, `BETTER_AUTH_URL`, plus `/mcp`, for example `https://book.example.com/mcp`. The compose stack sets `BETTER_AUTH_URL` from `PUBLIC_URL`.

The remote endpoint is off by default. An operator turns it on with `MCP_REMOTE=on`. With it off, `/mcp` and the OAuth metadata return `404`.

The tool definitions stay in `apps/mcp`, defined once. `createServer` takes the request function and the list of tools to register. Stdio passes the HTTP client and every tool. The API passes an in-process dispatcher and the remote tool list below.

The dispatcher calls the same Hono app in process (`app.request`) and never makes a network call. It does not forward the access token. It hands the venue middleware a resolved identity, `{ userId, clientId, grantId, scope }`, through a value that only the in-process call can set. A header cannot carry it, so an HTTP caller cannot forge it. The `/v1` routes keep accepting only `apikey` and a staff session, and never an OAuth access token.

`apps/web/Caddyfile` gains `handle` blocks for `/mcp` and the `/.well-known/oauth-*` paths, all forwarded to the API. Everything else stays as it is.

### Authorization server

Better Auth is the authorization server, through its OAuth provider plugin (`@better-auth/oauth-provider`) and its Client ID Metadata Document plugin (`@better-auth/cimd`). Both are published at 1.7.25 and require `better-auth` 1.7.25 or later, so issue #67 upgrades `better-auth` from 1.7.18. The plugins need new tables, added to `apps/api/src/db/schema.ts` and migrated with `pnpm db:generate`.

A person authenticates with the staff sign-in that exists today, email and password through Better Auth. No second login system exists. The authorization server metadata advertises `code_challenge_methods_supported: ["S256"]`, `client_id_metadata_document_supported: true` and no `registration_endpoint`.

### Client registration

- **Client ID Metadata Documents: yes.** A client identifies itself with an HTTPS URL that serves its metadata. The server fetches it under the same address rules as webhook targets in `apps/api/src/lib/webhook-target.ts`. It requires HTTPS, refuses private, loopback, link-local and multicast addresses, and applies a short timeout and a size cap. The fetched `client_id` must equal the URL, and the redirect URI in the request must match one in the document exactly.
- **Pre-registered clients: yes.** An instance operator can register a client by hand for an agent that has no metadata document. The command or route for that is issue #67's to design, limited to the instance owner.
- **Dynamic Client Registration: no.** Open registration lets anyone write rows to the client table with no account. The spec deprecates it, and the two options above cover current clients. See the open questions.

### PKCE and the authorization code

PKCE is required for every client, with `S256` only. A request with no `code_challenge` or with `plain` fails. The authorization code is single use, bound to the client, the redirect URI and the `resource`, and expires after 10 minutes, the plugin default. The `resource` parameter must equal the canonical resource URI. The authorization response carries `iss` (RFC 9207), which 2026-07-28 recommends.

### Tokens

| Token | Form | Lifetime | Storage |
| --- | --- | --- | --- |
| Authorization code | opaque | 10 minutes, one use | plugin table |
| Access token | opaque, never a JWT | 15 minutes | SHA-256 hash only |
| Refresh token | opaque, rotated on every use | 30 days from its issue | hash only |
| Grant (the consent) | database row | 90 days from consent, then consent again | row |

Access tokens are opaque so that each call looks the token up in the database. That lookup is what makes revocation take effect on the next call. A JWT would stay valid until it expired.

Every refresh issues a new refresh token and invalidates the old one. A rotated refresh token presented again is treated as theft. The whole grant is revoked, every token of it stops working, and an `agent_revoked` audit row is written. The reuse interval is 0. Refresh never extends the grant beyond 90 days from consent.

The access token audience is the canonical resource URI. `/mcp` refuses a token whose audience differs, one that has expired, and one whose grant no longer exists, all with `401` and a `WWW-Authenticate` header that names the Protected Resource Metadata URL. Tokens are accepted only in the `Authorization: Bearer` header. A token in the query string is refused, and a Better Auth session cookie on `/mcp` grants nothing.

### Scopes

Two scopes, and nothing else.

| Scope | Maps to role | Allows |
| --- | --- | --- |
| `opencovers:read` | `read` | The read tools below. |
| `opencovers:write` | `write` | The read tools and the write tools below. It includes `opencovers:read`. |

No scope maps to `admin`. An authorization request for any other scope, `opencovers:admin` included, fails with `invalid_scope`. The Protected Resource Metadata lists both scopes in `scopes_supported`.

The role a call runs with is the lower of the scope's role and the person's current membership role in that venue, read on every call. A `read` member who grants `opencovers:write` still gets `read`. An `admin` member who grants `opencovers:write` gets `write`. A write tool called with an `opencovers:read` token fails with HTTP `403` and `error="insufficient_scope", scope="opencovers:write"`, so the client can ask for more. A write tool called by a `read` member with a write token fails as a tool error, `API error 403: forbidden`, because more scope would not help.

### Venues

A grant names a set of venues, chosen on the consent screen. It is stored as rows of `(grant_id, venue_id)`, the same shape as `grants` for keys. It never holds `*`. The consent screen offers only the venues where the person is a member, and none is ticked unless the person has exactly one.

A call is allowed only when all of these hold, checked on every call:

1. The access token is valid, unexpired and issued for this resource.
2. The grant exists and holds the venue named in the tool arguments.
3. The person is still a member of that venue.
4. The effective role allows the operation.

Rules 2 and 3 fail with `venue_not_found`, the same answer as for a key or a session outside the venue. A caller cannot tell an unknown venue from one it may not use.

### What a remote caller can do and can never do

The remote endpoint registers 16 of the 18 tools.

| Kind | Tools |
| --- | --- |
| Read, with either scope | `reservation.availability`, `reservation.agenda`, `reservation.list`, `reservation.search`, `reservation.get`, `reservation.events`, `waitlist.list`, `venue.getConfig` |
| Write, with `opencovers:write` | `reservation.create`, `reservation.walk_in`, `reservation.modify`, `reservation.cancel`, `reservation.status`, `waitlist.add`, `waitlist.seat`, `waitlist.cancel` |
| Stdio only | `reservation.erasure`, `venue.setConfig` |

`reservation.erasure` is stdio only because it removes guest data for good, and a token held by a hosted service is a weaker credential than a key on the operator's own machine. `venue.setConfig` is stdio only because it needs `admin`, which no remote token has, and because it carries `resendApiKey`. Both tools stay in the catalog in `docs/contract/mcp.md`, which gains a column that says which tools the remote endpoint serves.

The dispatcher also holds an allowlist of the 16 HTTP operations those tools call, by method and path pattern, and refuses anything else with `forbidden` before it reaches a route. A remote caller can therefore never reach, even through a bug in tool code:

- members, invitations and the membership audit log;
- keys, at the venue routes or at `/v1/auth/keys`;
- webhooks;
- guest erasure, guest merge and unmerge;
- tables, services, the floor plan, the public profile and the config write;
- venue creation, `GET /v1/venues`, and anything under `/api/auth`.

`staffSessionOnly` is changed to refuse the OAuth identity as well as an `apikey` header, so it means what its name says. `adminOnly` already refuses it, because the effective role is never `admin`.

### Principal

A remote call acts as the principal `mcp:<clientId>:<userId>`. It goes into `bookedVia` and `ownerPrincipal` like any other principal. It names the agent and the person, holds no email, and keeps one agent's reservations apart from another's in `reservation.list`. See the open questions.

### Consent screen

The staff app serves the consent screen. The person signs in there if they have no session. The screen shows:

- the client name from its metadata, marked as given by the client, and the client id URL;
- the redirect URI hostname, and a warning when every redirect URI is `localhost`;
- each scope in plain words: "See bookings, the waitlist and guest names and contacts" and "Create, change, cancel and seat bookings, and manage the waitlist";
- the venue choices, and that access ends after 90 days or when revoked;
- what the agent can never do: manage staff, keys or webhooks, change settings, or erase guest data.

The person can lower `opencovers:write` to `opencovers:read` before approving. Every authorization request shows the screen. Consent is never skipped because an earlier one exists. A refresh needs no screen.

### Revocation

Every path ends access on the next call, because every call reads the token, the grant and the membership from the database.

- **The person.** The staff app lists the person's own grants per venue: client, scope, created, last used and expiry. Revoking removes that venue from the grant, and the grant is deleted when no venue remains.
- **A venue admin.** A venue `admin` with a staff session lists and revokes every grant on the venue, as for keys. The route sits behind `adminOnly` and `staffSessionOnly`.
- **The client.** The token revocation endpoint (RFC 7009) revokes a refresh token and its grant.
- **Member removal.** ADR-0011's removal transaction also deletes the person's grants for that venue, and the response's `revoked` gains a count `agentGrants`. When it was the person's last membership, all their grants go with their sessions.
- **Account deletion.** Grants cascade with the account.
- **Refresh token reuse.** Revokes the whole grant, see Tokens.

Last used is updated at most once a minute per grant, so reads do not become writes on every call.

### Rate limits

Two rules are added to `apps/api/src/lib/rate-limit.ts`, with the same `429`, `rate_limited` and `Retry-After` answer and the same `RATE_LIMIT` switch.

| Rule | Matches | Key | Default |
| --- | --- | --- | --- |
| `oauth_token` | `POST` to the token endpoint | client address | 60 per 15 minutes |
| `mcp_call` | `POST /mcp` with a valid token | grant id | 300 per 5 minutes |

The token endpoint gets its own budget so that agents refreshing every 15 minutes do not spend the `auth` budget that guards password guessing. The authorization and consent `POST`s stay in `auth`, because a person makes them. A `POST /mcp` that fails authentication counts on the `auth` budget for its address, so guessing tokens meets the same limit as guessing passwords. `mcp_call` is keyed by grant and not by address, because many agents share the egress addresses of one hosting service. The limits keep the caveats of ADR-0007: in memory, one process, cleared on restart.

### Origin and host checks

A middleware in front of `/mcp` refuses with `403`:

- a request whose `Origin` header is present and is not in `MCP_ALLOWED_ORIGINS`, which is empty by default;
- a request whose `Host` is not the host of `BETTER_AUTH_URL`.

A request without `Origin` passes to the token check. Server-to-server agents send no `Origin`. `/mcp` sends no CORS headers, so a browser page on another origin cannot read its answers. The SDK's own DNS rebinding options are not used, because they are deprecated and off by default.

### Audit

`membership_audit` gains two actions, through a migration that widens its check constraint, and a nullable `client_id` column.

| `action` | Written by | `actor_user_id` | `target_user_id` | `role` | `client_id` |
| --- | --- | --- | --- | --- | --- |
| `agent_authorized` | consent approved | the person | the person | the effective scope as `read` or `write` | the client |
| `agent_revoked` | any revocation path above | the person or admin who revoked, none when refresh reuse or removal revoked it | the grant's owner | the scope | the client |

A grant that spans several venues writes one row per venue. Rows hold ids, a role and the client id URL, and never a token, an email or a name, as ADR-0010 requires. Writes made through the agent already appear in the event feed with the principal above. Reads leave no record, as reads by a key leave none today.

### Threats and mitigations

| Threat | Mitigation |
| --- | --- |
| Stolen access token | Valid at most 15 minutes. Audience-bound to `/mcp`, so it works nowhere else. Revocable at once. Never `admin`, never erasure. Stored only as a hash, so a database leak exposes no usable token. |
| Stolen refresh token | Rotated on every use. When both the thief and the real client refresh, the second use of a rotated token revokes the grant for both, and the audit log records it. The grant ends after 90 days in any case. |
| Stolen authorization code | PKCE `S256` binds it to the client that asked. Single use, 10 minutes, exact redirect URI match. |
| Cross-venue access | The grant names venues explicitly and never `*`. Each call checks the venue in the grant and the person's membership, then the venue middleware runs as for any caller. Every failure is `venue_not_found`. Issue #67 tests isolation on the remote path. |
| Replay | TLS stops replay on the wire. A replayed authorization code fails. A replayed rotated refresh token fails and revokes the grant. A token holder who repeats a write gets what stdio gives. A write that carries the same idempotency key returns the same result, and a call without a key is not deduplicated. `waitlist.add` takes no key. |
| Abuse | No anonymous client registration. A grant needs a staff account and a membership. The token endpoint, failed `/mcp` authentication and calls per grant are rate limited. Metadata document fetches follow the webhook address rules, so they cannot reach internal addresses. |
| Privilege escalation | No admin scope. The effective role is the lower of scope and membership, read per call. The dispatcher allowlist blocks routes outside the 16 tools. `staffSessionOnly` refuses the OAuth identity. |
| Confused deputy | OpenCovers is both the authorization server and the resource server, and calls no third-party API with a user's token. The server holds no master credential to act with. A call runs with the grant's identity and never with more. Every authorization shows the consent screen. |
| Client impersonation | A client that claims another client's metadata URL must also redirect to one of that document's URIs. The screen shows the redirect hostname and warns on `localhost`-only clients. |
| Token passthrough | `/mcp` validates the token and never forwards it. The dispatcher passes a resolved identity in process. `/v1` does not accept OAuth access tokens. A token for another audience is refused. |
| DNS rebinding and cross-site requests | `Origin` and `Host` checks with `403`. No CORS headers. Session cookies grant nothing on `/mcp`, so a page in the person's browser cannot ride their staff session. |
| A leaver keeps an agent | The membership check on every call ends access at once. Removal also deletes their grants (ADR-0011). |
| Token leak through logs | Tokens travel only in the `Authorization` header, never in a URL. The API logs no request headers, and issue #67 adds no logging of them. |

### What issue #67 must verify

These are properties of libraries this ADR has not run. Issue #67 tests each one, and if one fails, it implements the behavior or comes back to this ADR.

- The OAuth provider plugin issues opaque access tokens with the JWT plugin off, and stores tokens hashed.
- A rotated refresh token reused with interval 0 revokes the whole grant, not only the reused token.
- An OAuth access token is never accepted by `auth.api.getSession`.
- The authorization response carries `iss`, and the metadata sets `authorization_response_iss_parameter_supported`.
- The CSP `form-action 'self'` in the Caddyfile does not block the redirect to the client after the consent form posts. Some browsers apply `form-action` to redirects.
- The SDK's web-standard transport, built for protocol `2025-11-25`, answers clients that speak 2026-07-28. If not, the endpoint supports `2025-11-25` until the SDK catches up.

## Consequences

**Easier.** A hosted agent connects with a URL and a sign-in, with no key to paste. A person grants it one or several venues, read or write, and sees and revokes it in the staff app. Revocation, member removal and account deletion stop it on the next call. OpenCovers writes no OAuth protocol code. The OAuth provider plugin implements the protocol, and OpenCovers adds the venue and scope rules on top.

**Harder.** Every remote call costs a token lookup, a grant lookup and a membership lookup. Better Auth moves to 1.7.25, with new tables and a migration. The Caddyfile, the staff app (consent, grant list), `rate-limit.ts`, `membership_audit` and `createServer` all change. A self-hoster who turns the endpoint on must serve it over HTTPS at its public URL. The contract gains the remote column in `docs/contract/mcp.md`, the `agentGrants` count, the grant routes and new conformance cases.

**Accepted.**

- Sign-in has no second factor (hardening known gap 2), so a phished staff password can authorize an agent. The consent screen and the audit row make it visible, not impossible.
- A token holder can act until the token expires or is revoked. Bearer tokens are not bound to the client's key. DPoP is left out because the MCP specification does not require it.
- Reads through an agent leave no audit trail.
- A client that supports only Dynamic Client Registration cannot connect until it is pre-registered.
- Rate limits stay per process and in memory.
- Erasure and config changes need the stdio server or the staff app. A hosted agent cannot do them.

## Alternatives considered

- **API keys as bearer tokens on the remote endpoint.** The smallest change is to accept `Authorization: Bearer <key>` on `/mcp`. Rejected. A key never expires and can hold `*`. It belongs to no person, so member removal reaches it only through `created_by` (ADR-0011). It must be pasted into a hosted service. MCP clients discover OAuth and do not know how to ask for a key.
- **Write a minimal authorization server.** Full control and no upgrade. Rejected. Codes, PKCE, rotation, reuse detection, metadata and client documents are security code that the library already ships and maintains.
- **A separate authorization server.** Rejected. A second service to run and a second account store for a project whose deployment is one API process.
- **Run the remote server as a separate `apps/mcp` HTTP process.** Keeps the API untouched. Rejected. The process would call `/v1` with either the user's token, which is token passthrough, or a key of its own that can act for every venue, which is a confused deputy waiting to happen.
- **Accept OAuth access tokens on `/v1` too.** Rejected. It widens every route to a new credential type, and the audience of the token is the MCP endpoint, not the API.
- **JWT access tokens.** No database read per call. Rejected. A revoked grant would keep working until the token expired, which breaks the revocation driver.
- **Dynamic Client Registration, open.** Most clients support it today. Rejected for now. Anyone could write client rows, and the spec deprecates it. Kept as an open question.
- **One venue per grant, or one endpoint per venue (`/mcp/v/{venueId}`).** Makes the audience the venue boundary. Rejected. A person with several venues would add one connection per venue, and the per-call grant and membership check already isolate venues.
- **An `opencovers:admin` scope.** Would let an agent change settings and tables. Rejected. Admin actions change what guests can book and hold secrets. They stay with a person in the staff app or the stdio server.
- **Allow erasure remotely with the write scope, as the HTTP route allows a write key.** Rejected. Erasure is irreversible, and a hosted agent's token is the weakest credential in the system.
- **Hide tools from `tools/list` by scope.** Rejected. The client would not learn that more scope exists. Listing all 16 and answering `insufficient_scope` lets it ask for more.
- **Use the email as the principal, as a session does.** Keeps records readable. Rejected for now. It puts staff emails into more rows and hides which agent acted. Kept as an open question.

## Open questions for the owner

1. **Principal format.** `mcp:<clientId>:<userId>` keeps emails out and names the agent, but staff see an opaque string in the agenda and feed. The alternative is the person's email with a client suffix.
2. **Dynamic Client Registration.** Off. If an agent the project needs supports nothing else, decide whether to allow it behind `MCP_DYNAMIC_REGISTRATION=on` with a registration rate limit.
3. **Lifetimes and limits.** 15 minutes, 30 days, 90 days, 60 token calls per 15 minutes and 300 calls per 5 minutes are proposals, not measurements.
4. **Venue sets.** A grant may name several venues. One venue per grant is simpler to reason about and costs multi-venue owners more connections.
5. **Off by default.** `MCP_REMOTE=on` is required. The alternative is on whenever the public URL is HTTPS.
6. **Idempotency on remote writes.** The write tools generate a key when the caller omits one, so a repeated call is not deduplicated. Requiring the key on the remote endpoint would change tool behavior, which issue #67 excludes.
