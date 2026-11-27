# ADR-0030: Table claims of a venue take turns

- Status: Proposed
- Date: 2026-11-26
- Deciders: David Cabeza

## Context

Two writes that claim tables at the same instant can deadlock. PostgreSQL inserts a row and then checks the exclusion constraint, so two inserts that overlap can each wait for the other ([#451](https://github.com/David-Cabeza/OpenCovers/issues/451)). Two writes that name each other's tables, or the same two tables in opposite orders, wait on each other the same way ([#452](https://github.com/David-Cabeza/OpenCovers/issues/452)). The database aborts one with SQLSTATE `40P01`, and the engine answered `500` in plain text. No table was double booked. Auto-assigned writes already took a per-venue advisory lock, the planner lock. Writes that named their tables did not.

Two fixes were measured as prototypes against the unchanged engine: retrying the whole transaction on `40P01` (three attempts), and taking the planner lock in every write that claims a table. The numbers are below.

Setup for every number: PostgreSQL 16.16 in Docker on WSL2, 16 CPUs shared with other work, default settings, the engine's pool of 10, engine functions called directly (no HTTP), medians of 5 runs with the sides in rotating order. "Reached the caller" counts `40P01` answers.

The two candidates. "Contended" is one venue with 6 tables and one time slot, where each worker keeps creating (a quarter of the creates on two tables), moving and cancelling its own bookings, 10 s per run, `deadlock_timeout` 1 s. The pair rows start two writes together, 200 rounds.

| | unchanged | retry | planner lock |
| --- | --- | --- | --- |
| contended, 8 workers: writes per second | 8 | 3 | 363 |
| p99 | 7.0 s | 20.0 s | 40 ms |
| reached the caller | 90 of 619 | 36 of 304 | 0 of 17,749 |
| contended, 16 workers: writes per second | 9 | 3 | 407 |
| p99 | 10.0 s | 30.0 s | 64 ms |
| reached the caller | 136 of 896 | 75 of 630 | 0 of 20,245 |
| two swaps: reached the caller | 182 of 400 | 0 | 0 |
| p99 | 1.01 s | 1.02 s | 18 ms |
| two creates, tables in opposite orders: reached the caller | 186 of 400 | 0 | 0 |
| p99 | 1.03 s | 1.03 s | 35 ms |

Retry was also tuned, with `deadlock_timeout` at 100 ms. Contended with 8 workers it reached 30 writes per second with a p99 of 2.4 s, and 211 of 1,582 writes still reached the caller. Ten attempts with a random pause did worse (9 per second, p99 7.8 s, 62 of 634). The shipped code did 370 per second with a p99 of 59 ms in the same runs.

The shipped code against the unchanged engine:

| | unchanged | shipped |
| --- | --- | --- |
| contended, 8 workers: writes per second, p99 | 8, 7.0 s | 398, 36 ms |
| no two writes want one table, 1 worker: creates per second, p50 | 105, 9.2 ms | 94, 9.7 ms |
| same, 8 workers of one venue | 262, 29 ms | 179, 43 ms |
| same, 16 workers of one venue | 254, 58 ms | 184, 83 ms |
| 8 workers, each in its own venue | 482, 15 ms | 483, 16 ms |

What limits each number. The unchanged and retry throughput under contention is bound by `deadlock_timeout`. On the unchanged engine 99% of sampled backend time was spent waiting on another transaction while Node used 3% of a core, and a shorter timeout raised the retry's rate. Writes behind a deadlocked pair wait on them too. Without contention the limit is the part of a venue's writes that runs one at a time, which now starts at the first claim and not at the event insert. Turning `synchronous_commit` off raised 8 workers from about 250 to 330 per second before and from about 165 to 270 after, so the commit flush is a large part of it. With one worker the shipped code costs two more round trips per write (the lock and the timeout). Under contention with the lock, Node used 74% to 88% of one core, so that figure is partly the client of the database and not the database.

## Decision

Every write that gives a reservation a table takes the planner lock first: create and walk-in (named or assigned tables, public channel and waitlist seat included), and a modify or self-service modify that changes its tables. A write that only frees tables (cancel, status change, a modify to no tables) does not take it, because freeing a table waits on no claim. The exclusion constraint is unchanged and is still what keeps a table from being held twice. The lock only orders the writers. One transaction still decides availability and booking.

A create that names its tables takes the lock just before its first table, not before its reservation row. Contended with 8 workers that measured 398 writes per second against 363 with the lock before the row.

Lock order. A write takes the planner lock after the rows it already needs: a modify after its reservation's row, a seat after its waitlist entry, a create after its guest. So a write stuck on one of those, such as during a large erasure, does not hold up the venue. This is safe because no holder of the planner lock waits for a row held by a write that is itself waiting for that lock. A claim can wait for a release to commit, and a release never waits for the planner lock. It comes before the overbooking lock, and the events lock is still last (ADR-0026). A modify takes it before it frees its own tables.

Bounded waits. A reservation write (create, walk-in, modify, cancel, status change, seat) sets `lock_timeout` to 5 s for its transaction. On `55P03`, or on a `40P01` from any cycle not foreseen here, it answers `venue_busy` (`503`, retryable). Nothing was written and the key is not stored.

The replan loop, which retried an auto-assignment up to three times on an exclusion violation, is removed. It covered a named-table write taking a planned table between plan and insert, which can no longer happen.

## Consequences

- Claims of one venue run one at a time, from the lock to the commit. That costs about 30% of one venue's peak rate for writes that would not have collided (262 to 179 creates per second above), as auto-assigned writes already paid. A venue's writes already took turns on their last insert and commit (ADR-0026). Venues do not wait for each other on this lock.
- A queued writer holds a pool connection, as it does on the events lock. A stuck holder can occupy the pool for up to 5 s.
- A write that used to wait without limit, for example a modify of a reservation inside a long erasure, now fails with `venue_busy` after 5 s.
- The limit is per lock wait, not per transaction. It does not end a stuck holder, bound a slow statement, or cover erasure, setup and other writes, except a config save that changes the overbooking ceiling (ADR-0004, amendment of 2026-11-27). Statement and idle-transaction timeouts, which the ROADMAP's Saturday Gate also asks for, are still open.
- A new writer that claims tables must take the planner lock. `apps/api/test/overlap-races.test.ts` checks each existing one.

## Alternatives considered

- Retry the transaction on `40P01`. It hides the error from most callers, but every cycle still costs the database's `deadlock_timeout` (1 s by default) before anything happens, a crowd can use up the attempts, and the engine does not control that setting on a self-hosted database.
- Both: the lock and a retry. With the lock no known cycle is left, so the retry would be code no test can reach. A deadlock that appears anyway answers `venue_busy`, and the client retries.
- Claim tables in a fixed order (sorted table ids). It removes the opposite-order case only, not two claims of one table or a swap.
- A lock per table instead of per venue. More concurrency, but auto-assignment does not know its tables until it has read the venue, so it would still need the venue lock.
