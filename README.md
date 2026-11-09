# OpenCovers

OpenCovers is an open-source reservations engine for restaurants. It covers availability, bookings, table allocation, guest confirmations, and the reservation event feed. Platforms and AI agents use it through an HTTP API and an MCP server.

OpenCovers is the working name. Trademark clearance is pending.

**Status.** Pre-alpha. The engine runs locally with tests, but nothing is deployed. The contract, the write and read routes, the exclusion rule, availability, erasure, authentication, the staff screens, and the MCP server are implemented. The email confirmations and a deployment are not. See [ROADMAP.md](ROADMAP.md).

## Why

Most booking systems are tied to a CRM, a point-of-sale system, or a single vendor. A venue that changes its front end or its messaging provider risks losing its reservation book. OpenCovers keeps the book independent. Any platform or AI agent can read availability, create a booking, modify it, or cancel it through the same contract.

## Stack

- Node.js and Hono for the HTTP API.
- PostgreSQL with Drizzle. The no-double-booking rule is a GiST exclusion constraint.
- Better Auth for staff login.
- React for the staff screens.

## Design rules

- One transaction decides availability and booking.
- The database enforces the no-overlap rule. Application code does not.
- Every write carries an idempotency key and produces a monotonic version.
- A venue's data is isolated. A request for another venue returns not found.
- The engine takes a booking and honors a STOP without a memory platform.
- The engine stores the minimum guest data a booking needs.
- Erasure returns counts and keeps hashes, not personal values.
- The contract and the conformance cases come before the implementation.

## Development

You need Node.js 22 or newer, pnpm, and Docker.

```
docker compose up -d
pnpm install
pnpm db:migrate
pnpm test
pnpm dev
```

`docker compose up -d` starts a local PostgreSQL. `pnpm dev` starts both the API on port 3000 and the staff app on port 5173. Open <http://localhost:5173> and sign up. The full guide is in [CONTRIBUTING.md](CONTRIBUTING.md).

## Contributing

OpenCovers uses flags. A flag is a scoped task with acceptance criteria, dependencies, and a size. Anyone can propose or claim one. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [flag issue form](.github/ISSUE_TEMPLATE/flag.yml).

The project is pre-alpha. Help with the remaining roadmap phases, the documentation, and the flags is welcome.

## Governance and security

- [GOVERNANCE.md](GOVERNANCE.md) explains how decisions are made.
- [SECURITY.md](SECURITY.md) explains how to report a vulnerability.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) applies to every project space.

## License

Apache-2.0. See [LICENSE](LICENSE).
