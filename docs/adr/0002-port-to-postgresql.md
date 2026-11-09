# ADR-0002: Port the engine from Cloudflare Durable Objects to PostgreSQL

- Status: Accepted
- Date: 2026-11-09
- Deciders: David Cabeza

## Context

The engine was first built on Cloudflare Workers and Durable Objects, with one SQLite Durable Object per venue. That gave a single writer per venue and strong transactional storage, but it tied the engine to one vendor. To keep the project portable and avoid lock-in, the engine moves to PostgreSQL.

## Decision

We build the engine on PostgreSQL with Node.js, Hono, and Drizzle.

- Storage: one PostgreSQL database. Every row carries a `venue_id`, and the no-overlap rule is a GiST exclusion constraint on `table_allocations`, which holds for any number of concurrent writers.
- API: Node.js with Hono.
- Data access: Drizzle with generated SQL migrations.
- Authentication: Better Auth for staff login (email and password, sessions) and API keys with roles and per-venue grants for platform and agent access.
- Frontend: React for the staff screens.

This supersedes the storage decision in ADR-0001. The other decisions there, the contract first, one transaction deciding availability and booking, idempotent and versioned writes, and the erasure model, still hold.

## Consequences

What becomes easier: the engine runs on any PostgreSQL host, the exclusion rule is stronger than the previous SQLite triggers, and there is no single-writer bottleneck per venue.

What becomes harder: the deployment now needs a PostgreSQL instance and a Node.js server, and the Durable Object single-writer model had to be re-expressed as database constraints and transactions.

## Alternatives considered

- Keep Cloudflare Durable Objects. Rejected for vendor lock-in.
- Use a separate PostgreSQL schema per venue. Rejected as heavier to migrate and operate than a shared database with a `venue_id` column.
- Use an ORM other than Drizzle. Rejected because Drizzle stays close to SQL, which fits the existing schema and the exclusion constraint.
