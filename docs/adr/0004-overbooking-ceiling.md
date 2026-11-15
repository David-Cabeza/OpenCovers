# ADR-0004: Overbooking ceiling enforced in application code

- Status: Proposed
- Date: 2026-11-15
- Deciders: David Cabeza

## Context

A venue may want to take a few more covers than its tables seat, on purpose and with a hard limit. ROADMAP Phase 10 lists "an explicit overbooking ceiling, default 0". PR #26 implements it as `venues.overbooking_ceiling`, an integer from 0 to 1000 with a database check.

`CLAUDE.md` says the database enforces no-overlap and application code does not. The ceiling is a cap on covers, and PR #26 enforces it in application code. This record states why, so the maintainer can accept or reject the reasoning. It does not claim the design rule is untouched. It claims the ceiling is a different rule.

The meaning of the ceiling. It is the most covers (party sizes) a venue accepts without tables at any one time. A create that fits the venue but finds no free table combination (`no_suitable_table`) is accepted with `tables: []` when the party sizes of every `booked` or `seated` booking without tables that overlaps the new window, plus the new party, are at most the ceiling. At 0 nothing is accepted without tables.

What the database enforces, unchanged:

- No table is held twice at overlapping times. `table_allocations_no_overlap` is a GiST exclusion constraint on `(venue_id, table_id, tstzrange(starts_at, ends_at))` where `active` (migration `0016`).
- An overbooked booking holds no row in `table_allocations`. `createReservation` sets `tableIds = []` for it, so it takes no table and cannot overlap any. Staff assign tables later with a modify, and the constraint checks that assignment like any other. A taken table still returns `slot_taken`.
- The ceiling value itself is in range. `venues_overbooking_ceiling` is a check from 0 to 1000.

What application code enforces:

- The cover sum. `hasOverbookRoom` in `apps/api/src/lib/reservations.ts` selects the active bookings of the venue that overlap the window and have no allocation row, sums their party sizes, and tests `used + covers <= overbookingCeiling`.
- Serialization. With `lock: true` it first runs `pg_advisory_xact_lock(hashtextextended('overbooking:<venueId>', 0))`. The lock is per venue, held to the end of the transaction, and taken only on the overbooking path. Ordinary bookings do not take it.
- The same check on three paths. `createReservation` (with the lock), `modifyReservation` (with the lock, when the party of a booking without tables grows or its tables change and it would hold none), and `evaluateSlot`, which backs availability and `GET /availability/explain` (without the lock, read only).

Why a database constraint does not fit the sum. The exclusion constraint compares pairs of rows on one key. The ceiling is a sum over every row whose window overlaps another window, and the rows hold no key. A bookings window can overlap several others that do not overlap each other. PostgreSQL has no declarative constraint for "the sum over overlapping ranges stays under N".

Facts checked on `origin/feat/overbooking-ceiling` (8c7b681). Read in the code, and `pnpm --filter @opencovers/api test` on an empty database passes: 28 files, 346 tests, including `apps/api/test/overbooking.test.ts`.

## Decision

Enforce the cover ceiling in application code, inside the booking transaction, under a per-venue advisory lock. Keep no-overlap in the database, and make an overbooked booking hold no allocation so the two rules never touch.

The justification, in order:

- REQ-B2 and the design rule are about no table double-held. That stays in the database. Nothing in PR #26 relaxes or bypasses the exclusion constraint.
- The new limit is a different rule, a capacity cap, and no declarative constraint expresses it.
- The decision and the insert share one transaction, so "One transaction decides availability and booking" holds. The advisory lock closes the window between the sum and the insert that the default isolation level leaves open.
- Eight concurrent creates against a ceiling of 4 take exactly 4 covers. Removing the lock makes that test fail.

This is a judgment about how to read the design rule. If the rule is read as "application code never enforces any cap", the ceiling breaks it, and the alternatives below apply.

## Consequences

What becomes easier:

- A venue can accept a bounded number of covers beyond its tables. The default 0 keeps every behavior as it was.
- The ceiling needs no new table, trigger, or fake rows.

What becomes harder, and what we accept:

- The ceiling is weaker than no-overlap. A caller that bypasses the API and writes `reservations` rows directly can exceed it, because the database does not know the sum. A deleted check does not leave the cap standing the way a deleted check leaves REQ-B2 standing. Only the exclusion constraint is that strong.
- The lock is taken only on the overbooking path and only in code that knows to take it. A new write path that adds an unseated booking without `hasOverbookRoom` and the lock breaks the cap silently. Review must keep the three call sites together.
- The sum is conservative. It counts every overlapping booking without tables, not only those that coincide in time. It can refuse a booking that a time-sliced count would accept.
- Availability and explain read the sum without the lock. They show a time as bookable exactly when a create would succeed at that instant, so a concurrent create can still win the last cover and the loser gets `no_suitable_table`.
- Reads return `tables: []` for an overbooked booking. The array was already allowed to be empty, but code that assumes a booking holds at least one table must change.
- Seating an overbooked booking is allowed and needs no table. `ALLOWED_TRANSITIONS` checks only status, so a `seated` booking can have no table and still counts against the ceiling until it is attended, a no-show, or cancelled. Tables are not forced at seating.
- Nothing assigns tables to an overbooked booking when a table frees up. Staff do it with a modify.
- The staff app (`apps/web`) is untouched. It shows an overbooked booking without a table, and a display for it is a follow-up.
- One behavior change at the default. A modify that sends `tables: []` used to release every table and now fails with `no_suitable_table` at ceiling 0, because it would leave a booking without tables. Nothing in the API tests, the MCP tool (`min(1)`) or the staff app sends it.
- The ceiling is venue-wide, not per service or zone. It never applies to a walk-in, to a create that names its tables, or to a party larger than the venue.
- `docs/contract/openapi.yaml`, `conformance.md` (C24), `conformance-status.md`, `errors.md`, `mcp.md` and REQ-B7 carry the rule, as the conventions require.

## Alternatives considered

- **A database-level mechanism, a counter row or a trigger.** A per-venue counter row updated in the booking transaction would serialize writers through a row lock and could carry a check. It cannot track time windows, so it caps total covers in the venue, not covers at any one time, unless it keeps one row per slot. A trigger on `reservations` could compute the sum and raise. It would also have to take a lock to be safe, so it moves the same logic into SQL and hides it from the code and tests. Both are heavier than the advisory lock and only one of them (the trigger) enforces the cap against direct writes. Rejected for now. This is the option to take if the maintainer reads the design rule as covering any cap.
- **No overbooking at all.** The simplest option, and it keeps the design rule literal. It leaves a venue unable to take a known number of extra covers, and the venue would have to work around the engine. Rejected because the roadmap asks for the control. Default 0 already gives this behavior to every venue that does not opt in.
- **A pseudo-table.** Add a virtual table with seats equal to the ceiling and let the exclusion constraint guard it. The constraint rejects overlapping holds of one table, so the pseudo-table fits only one booking per window, not a sum of covers. Giving it many seat slots is the counter row again. It also puts a fake row in `tables`, the floor plan, and every availability list. Rejected.
