# ADR-0004: Overbooking ceiling enforced in application code

- Status: Accepted
- Date: 2026-11-15
- Deciders: David Cabeza
- Accepted: 2026-11-15

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
- Serialization. With `lock: true` (since the amendment below, `claimOverbookRoom`) it first runs `pg_advisory_xact_lock(hashtextextended('overbooking:<venueId>', 0))`. The lock is per venue, held to the end of the transaction, and taken only on the overbooking path. Ordinary bookings do not take it.
- The same check on three paths. `createReservation` (with the lock), `modifyReservation` (with the lock, when the party of a booking without tables grows or its tables change and it would hold none), and `evaluateSlot`, which backs availability and `GET /availability/explain` (without the lock, read only).

Why a database constraint does not fit the sum. The exclusion constraint compares pairs of rows on one key. The ceiling is a sum over every row whose window overlaps another window, and the rows hold no key. One booking window can overlap several others that do not overlap each other. PostgreSQL has no declarative constraint for "the sum over overlapping ranges stays under N".

Facts checked on `origin/feat/overbooking-ceiling` (8c7b681). Read in the code, and `pnpm --filter @opencovers/api test` on an empty database passes: 28 files, 346 tests, including `apps/api/test/overbooking.test.ts`.

## Decision

Enforce the cover ceiling in application code, inside the booking transaction, under a per-venue advisory lock. Keep no-overlap in the database, and make an overbooked booking hold no allocation so the two rules never touch.

The justification, in order:

- REQ-B2 and the design rule are about no table double-held. That stays in the database. Nothing in PR #26 relaxes or bypasses the exclusion constraint.
- The new limit is a different rule, a capacity cap, and no declarative constraint expresses it.
- The decision and the insert share one transaction, so "One transaction decides availability and booking" holds. The advisory lock closes the window between the sum and the insert that the default isolation level leaves open.
- Eight concurrent creates against a ceiling of 4 take exactly 4 covers. This is not evidence for the lock: the planner lock also serializes auto-assigned creates, so that test passes without the overbooking lock (corrected, see the amendment below). The races that need it are in `apps/api/test/overbooking-races.test.ts`.

This is a judgment about how to read the design rule. If the rule is read as "application code never enforces any cap", the ceiling breaks it, and the alternatives below apply.

Decision note, 2026-11-15. The maintainer accepted this record in the 2026-11-15 session, on one condition. Only the venue's responsible person, the `admin` role, can configure the ceiling. This is already enforced. `PUT /venues/{venueId}/config` is guarded by `adminOnly` in `apps/api/src/app.ts`, so a `read` or `write` key or session fails with `forbidden` and the ceiling does not change. `apps/api/test/overbooking.test.ts` ("needs an admin key") shows a `write` key getting `403` and the stored ceiling staying at 0. The `PUT /config` case in `apps/api/test/authorization.test.ts` sends `overbookingCeiling` with a `write` key and a `read` key, checks the venue state is unchanged, and then shows the `admin` key changing it.

The maintainer also decided that a reservation cannot be seated without a table, so an overbooked booking has to get a real table before it is seated. Conformance case C26 and the error `table_required` carry that rule.

## Amendment, 2026-11-27: the ceiling in force at commit

This record first said that removing the overbooking lock makes the 8 concurrent creates test fail. It does not. With the lock removed that test passes, and the races of creates against modifies that give up their tables, of concurrent party increases and of creates counting after a cancel fail.

It also left open which ceiling binds a write while an admin changes it, and a write could commit above a value lowered before it ([issue 446](https://github.com/David-Cabeza/OpenCovers/issues/446)). The owner decided: the ceiling in force when the write commits.

- A write takes the overbooking lock, then reads the ceiling from the database, then counts. It never uses the venue row it read earlier. The lock is held to commit.
- `setConfig` takes the same lock when it changes `overbookingCeiling`, after its `FOR NO KEY UPDATE` on the venue row. So no change commits between a write's read and its commit.
- The change waits at most 5 seconds and then answers `venue_busy`, saving nothing, like a reservation write (ADR-0030). A save that keeps the value does not take the lock.
- A staff create or modify with no free table now takes the lock even when the ceiling is 0, because a value read before the lock could be out of date.
- Lock order: no writer that holds the overbooking lock waits for anything the config write holds. The config write holds the venue row `for no key update`, which lets the writer's foreign key checks through, and waits for nothing after the overbooking lock.

A `FOR SHARE` on the venue row in the booking was rejected: every booking would wait behind a config save.

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
- An overbooked booking cannot be seated until it holds a table. A move to `seated` with no active table allocation fails with `table_required` (HTTP 409, conformance case C26), and so does a modify that would leave a `seated` booking without tables. The system always knows which real table a seated party occupies. A booking without tables keeps counting against the ceiling until staff assign a table and seat it, or it is a no-show or cancelled. A walk-in is unaffected, because it is seated at creation with its tables.
- Nothing assigns tables to an overbooked booking when a table frees up. Staff do it with a modify, which the exclusion constraint checks, and then seat it. The staff app needs a way to assign a table before this is usable from the screen.
- The staff app (`apps/web`) is untouched. It shows an overbooked booking without a table, and a display for it is a follow-up.
- One behavior change at the default. A modify that sends `tables: []` used to release every table and now fails with `no_suitable_table` at ceiling 0, because it would leave a booking without tables. Nothing in the API tests, the MCP tool (`min(1)`) or the staff app sends it.
- The ceiling is venue-wide, not per service or zone. It never applies to a walk-in, to a create that names its tables, or to a party larger than the venue.
- `docs/contract/openapi.yaml`, `conformance.md` (C24), `conformance-status.md`, `errors.md`, `mcp.md` and REQ-B7 carry the rule, and C26 and REQ-B6 carry the seating rule, as the conventions require.

## Alternatives considered

- **A database-level mechanism, a counter row or a trigger.** A per-venue counter row updated in the booking transaction would serialize writers through a row lock and could carry a check. It cannot track time windows, so it caps total covers in the venue, not covers at any one time, unless it keeps one row per slot. A trigger on `reservations` could compute the sum and raise. It would also have to take a lock to be safe, so it moves the same logic into SQL and hides it from the code and tests. Both are heavier than the advisory lock and only one of them (the trigger) enforces the cap against direct writes. Rejected for now. This is the option to take if the maintainer reads the design rule as covering any cap.
- **No overbooking at all.** The simplest option, and it keeps the design rule literal. It leaves a venue unable to take a known number of extra covers, and the venue would have to work around the engine. Rejected because the roadmap asks for the control. Default 0 already gives this behavior to every venue that does not opt in.
- **A pseudo-table.** Add a virtual table with seats equal to the ceiling and let the exclusion constraint guard it. The constraint rejects overlapping holds of one table, so the pseudo-table fits only one booking per window, not a sum of covers. Giving it many seat slots is the counter row again. It also puts a fake row in `tables`, the floor plan, and every availability list. Rejected.
