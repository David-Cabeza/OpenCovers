# ADR-0001: OpenCovers is an independent reservations engine

- Status: Proposed
- Date: 2026-11-08
- Deciders: David Cabeza

## Context

OpenCovers is an open-source reservations engine for restaurants. It must be independent of any CRM, point-of-sale system, or messaging provider, so a venue can change those systems without losing its reservation book.

The engine decides availability and booking. A memory platform holds guest identity and consent, but the engine must take a booking and honour a STOP even when that platform is down.

## Decision

We build the engine on these decisions.

1. Store: one SQLite Durable Object per venue in the eu jurisdiction, with a single writer per venue. The base region is settled; the restore-log jurisdiction is not.
2. Booking: one transaction decides availability and booking. The database enforces the no-overlap rule with a constraint, never only in application code.
3. Contract first: we write the API and MCP contract and the conformance cases before any engine code.
4. Writes: every write carries an idempotency key and produces a monotonic version.
5. Status: a closed vocabulary (booked, seated, attended, no_show, cancelled) with explicit transitions.
6. Attribution: the engine sets basis, owner_principal, and booked_via from the authenticated channel at booking time.
7. Guest data: the engine stores only the minimum a booking needs, and erasure returns counts and hashes with tombstones before deletion.
8. Events: a cursor event feed emits every write, including staff-typed bookings, from one write path.
9. Project: open source under Apache-2.0, built by the community through claimable flags.

## Consequences

What becomes easier: venue isolation and independence from a CRM.

What remains conditional: clean erasure depends on the restore-log answer, and a sellable engine depends on the standalone-product decision.

What becomes harder: the Durable Object schema-migration mechanism and scaling a single writer per venue.

## Alternatives considered

- Reservations as memory-platform interactions and facts. Rejected because it loses transactions, availability queries, and constraints, and retracted facts keep values.
- Postgres via Hyperdrive or PlanetScale as the primary store. Rejected because it adds a second residency question and an extra hop in the booking transaction. Kept as an option for cross-venue projections.
- The D1 storage class. Rejected until its jurisdiction is verified.

## Open decisions

These block parts of the plan and need David or a lawyer.

- The project name and trademark clearance.
- Whether the product is offered standalone or only internally.
- The first-venue route.
- Legal review of guest data, retention, and the confirmation and reminder text.
- Written answers from Cloudflare on Durable Object SQLite restore, the restore-log jurisdiction, pricing, and the migration mechanism.
