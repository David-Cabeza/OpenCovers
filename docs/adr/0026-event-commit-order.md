# ADR-0026: A venue's events commit in id order

This record was numbered 0024 until it was renumbered to 0026, because [ADR-0024](0024-guest-email-language.md) is the guest's email language. Pull requests and commits that call the event order ADR-0024 mean this record.

- Status: Accepted
- Date: 2026-11-20
- Deciders: David Cabeza

## Context

C11 promises a cursor reader of the event feed no gap, and webhooks are a cursor over that feed. `events.id` is a global bigserial assigned at insert, a row becomes visible only at commit, and every transaction runs at READ COMMITTED. So a higher id can commit while a lower one is still pending. The pull feed pages by `id > cursor` and the webhook worker records the last id it delivered, so both moved past the lower id for good. The 2 s settle window in the webhook worker did not cover it: it compares `occurred_at`, which is the writer's transaction start, so a long writer's events look settled as soon as they commit.

The engine concurrency review measured it on main. A cursor reader missed 4 of 960 events under 8 concurrent writers. During an erasure by principal of 30,000 reservations (about 60 s in one transaction) with normal bookings in between, a webhook endpoint's cursor passed 27,640 `erased` events that were never delivered.

## Decision

Within one venue, commit order equals id order. Every event goes through `appendEvents` (`apps/api/src/lib/events.ts`), which takes `pg_advisory_xact_lock(hashtextextended('events:<venueId>', 0))` and then inserts all of the write's events in one statement. The lock is held to commit, and Postgres releases it only after the commit is visible, so the next writer of the venue takes its ids after the previous one committed. A reader whose snapshot shows an event of a venue therefore also shows every lower id of that venue. A test asserts that no other file in `lib/` inserts into `events`.

Lock order. The events lock is the last lock of every write: after the idempotency key, guest-day, online-open, the planner, the reservation, link, waitlist and guest rows, and overbooking. Nothing after it waits on a lock. A guest cancel now revokes its link before the event, and a waitlist seat updates after its walk-in's event only the entry row it locked first. A holder of the events lock waits on nothing, so it cannot be part of a deadlock cycle.

Erasure. `eraseReservations` blanks the rows and writes the tombstones, and returns its `erased` events instead of writing them. `erase` and the retention batches append them as their last statement, so a long erasure holds the lock only for that one insert and its commit. Counts, tombstone hashes and blanked values are unchanged.

The webhook settle window is no longer needed for correctness. It stays in this change and can be removed later, with the sentence in `docs/contract/webhooks.md` that explains it.

## Consequences

- The observable contract does not change. C11 already promised no gap, and the engine now keeps it.
- Writes of one venue serialize on their last insert and commit. The commit's WAL flush is the limit, because writers of a venue can no longer share one flush. Measured on a dev machine (Postgres 16 in Docker on WSL2, fdatasync about 2.5 ms, 5 runs each): 8 concurrent writers of one venue went from about 400 to about 265 creates per second, and 16 writers stayed at about 245, the ceiling of one insert and commit (3.9 ms measured alone). Writers spread over 8 or 16 venues ran at about 470 per second after (350 to 370 before, a noisy run), and a single writer's create took 8 to 11 ms before and after. A disk with a faster flush raises the ceiling.
- An erasure of 3,000 reservations held the lock for 25 to 78 ms (median 34) of its 3.3 to 5.1 s. A writer queued on the lock holds a pool connection, so a burst of one venue can delay others only for that long. With 12 writers of one venue and an erasure of 1,000, another venue's create stayed under 200 ms (median about 25 ms), so no lock timeout was added.
- A new event writer must call `appendEvents` last.

## Alternatives considered

- A transaction id column with a reader horizon: store `pg_current_xact_id()` on each event and serve only ids below the oldest running transaction (`pg_snapshot_xmin`). It keeps writers parallel, but it needs a migration, changes the cursor's meaning, and makes the horizon database-wide, so one long transaction of any venue holds back every venue's feed. Rejected for now. It is the option if the per-venue ceiling becomes the limit.
- Keeping the settle window and lengthening it. No fixed window covers a transaction of unbounded length.
