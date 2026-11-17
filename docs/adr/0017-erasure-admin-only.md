# ADR-0017: Guest erasure needs the admin role

- Status: Accepted
- Date: 2026-11-17
- Deciders: David Cabeza

## Context

`POST /v1/venues/{venueId}/erasure` had no role guard beyond the venue middleware, so any `write` key or staff session could erase guest data. Erasure is irreversible: it blanks reservations, deletes guest records, clears the merge audit, and deletes waitlist entries. A leaked `write` key, or an agent holding one, could destroy a venue's guest records. The issue is #86. The route was found unguarded while writing ADR-0014, which keeps erasure stdio-only on the MCP server.

## Decision

Erasure is admin only. The route uses `adminOnly`, a `read` or `write` key or session fails with `forbidden`, and nothing is erased. The contract (C22 and `docs/contract/mcp.md`), the OpenAPI description and the tests say the same. The hourly retention job does not go through this route and is not affected.

## Consequences

- A leaked `write` key can no longer destroy guest data.
- A floor manager with only `write` who receives a guest's erasure request must ask an admin.
- The stdio MCP server needs an admin key to call `reservation.erasure`. Platforms and agents that hold a `write` key for bookings lose erasure.
- Integrations that erased with a `write` key now get `forbidden` and must switch keys. The engine is pre-alpha, so no compatibility period is kept.
- The staff app has no erasure screen today, so no UI changes.

## Alternatives considered

- Keep `write`. Rejected: it leaves the blast radius of a leaked booking key at irreversible data loss.
- Keep `write` and require a second confirmation, such as a second factor or a confirm token. Rejected for now: it adds a flow the engine does not have, and it still lets a leaked `write` key reach the destructive path. It can be added on top of the admin role later.
