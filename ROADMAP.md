# Roadmap

OpenCovers is in the design phase. The roadmap is a sequence of phases, not a promise of dates. Each phase has an exit criterion. Flags are the unit of work. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Now

### Phase 0: Publication readiness

Status: in progress.

- Apache-2.0 license.
- Public README, contribution guide, code of conduct, security policy, and governance.
- Flag and pull request templates.
- Clean public history without private reference material.
- Private vulnerability reporting enabled.
- A monitored private contact for the code of conduct.

Exit criterion: the repository can be made public without confidential or proprietary material, and every reporting channel is live.

### Phase R: Reference research

Status: next. Private.

- Study authorized reference products with synthetic data.
- Record the domain model, API surface, states, flows, and edge cases in private notes.
- Derive OpenCovers requirements and conformance cases. Do not copy third-party material.

Exit criterion: the requirements are written from findings, with no copied documentation or code.

### Phase 1: Decisions and ADR

Status: blocked on the product decisions.

- Confirm the name and the trademark check.
- Decide whether the engine is standalone or internal.
- Choose the first-venue route.
- Write and accept the architecture decision record.

Exit criterion: the ADR is merged with the open decisions recorded.

### Phase 2: Contract and conformance

Status: next.

- Write the OpenAPI contract for availability, list, create, modify, cancel, and the event feed.
- Write the MCP tool catalog over the same operations.
- Define the error vocabulary.
- Write the conformance cases for the booking boundary.
- Define the erasure call and the event cursor.

Exit criterion: the contract and the conformance cases are merged. No engine code is required.

## Next

### Phase 3: Runnable skeleton

- TypeScript, Cloudflare Workers, Durable Objects, and one SQLite database per venue.
- A health endpoint and a test that runs in CI.
- A local development command.

Exit criterion: CI is green on the skeleton.

### Phase 4: Schema and exclusion

- Venue, hours, tables, combinations, services, reservations, and versions.
- The database exclusion rule for overlapping table allocations.
- Tests for overlap, concurrent writes, version monotonicity, and tombstones.

Exit criterion: concurrent writes cannot double-book a table.

### Phase 5: Write routes

- Create, modify, and cancel.
- Idempotency keys and monotonic versions.
- `basis`, `owner_principal`, and `booked_via` set by the engine.
- The staff write path uses the same operations.

Exit criterion: the write conformance cases pass.

### Phase 6: Read side and event feed

- Availability, agenda, list, and search across days.
- Event feed with a cursor, including staff-typed bookings.

Exit criterion: the read and feed conformance cases pass.

## Later

### Phase 7: Notices, consent, and erasure

- Restaurant notice address.
- Guest confirmation and reminder, off by default until legal review.
- STOP handling.
- Erasure with counts and hashes.
- Retention job.

Exit criterion: the legal review is complete and the conformance cases pass.

### Phase 8: Staff screens and migration

- Staff screens with role checks.
- Migration from the launch venue's current system.

Exit criterion: the launch venue runs on OpenCovers.

## Decisions that block the roadmap

- The project name and trademark clearance.
- Standalone or internal-only product.
- The first-venue route.
- Legal review of guest data, retention, confirmation text, and reminder text.
- Cloudflare's written answers on Durable Object SQLite restore and jurisdiction.
