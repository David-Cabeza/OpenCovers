# Conformance status

Audit of the implementation against [conformance.md](conformance.md). Updated as cases are closed.

Status legend:

- **PASS** — the behavior is implemented and covered by a test.
- **PARTIAL** — some parts pass, others are missing or blocked.
- **GAP** — specified in the contract but not implemented.
- **BLOCKED** — depends on email or another external piece that is not yet decided.

| Case | Status | Evidence / note |
| --- | --- | --- |
| C1 One transaction | **PASS** | GiST exclusion constraint inside the create transaction. Tests: overlap rejected; a new concurrency test asserts two parallel creates yield one booking and one `slot_taken`. |
| C2 Idempotent create | **PASS** | `idempotency_keys` keyed on `(venue_id, key)`. Test: replay returns the same id and version. |
| C3 Snapshot is not a hold | **PASS** | Availability is advisory; create re-checks via the exclusion constraint and a failed create rolls back. |
| C4 Modify bumps the version | **PARTIAL** | Version +1 on a change: pass. No-op produces no new version: pass (fixed). "Confirmation sent once" is **BLOCKED** on email. |
| C5 Erasure | **PASS** | Returns counts, nulls personal fields, emits tombstones with a hash in the event feed. Test: erasure is idempotent. |
| C6 Notice address | **PASS** | `notice_address_required` on enable-without-address and clear-while-enabled. Test covers both. |
| C7 Party size | **PASS** | `party_size_too_large` (explicit and auto-assign) and `no_suitable_table`. Tests cover both. |
| C8 Hours | **PARTIAL** | `outside_hours` is enforced and tested. "Off the slot grid", "after the last seating", and `lead_time_violation` are **GAP** (no booking rules yet). |
| C9 Status transitions | **PASS** | `seated`/`attended`/`no_show` with events; `invalid_transition`; `already_cancelled`. Tests cover. |
| C10 Venue isolation | **PASS** | Requests are scoped per venue; an ungranted venue returns `venue_not_found`. Covered by the key-grant tests. |
| C11 Event feed | **PASS** | Bigserial ids and a cursor over the feed; replay re-emits the same ids. |
| C12 Attribution | **PASS** | `basis`, `owner_principal`, `booked_via` are set from the authenticated channel; the request body cannot override them. |
| C13 Cursor expiry | **GAP** | `expired_cursor` is in the vocabulary but no retention/pruning or expiry check exists yet. |

## Open gaps

1. **C4 — confirmation once.** Needs the email layer (blocked on legal text and a delivery provider).
2. **C8 — booking rules.** Lead time, maximum advance, slot grid, and last-seating offset are specified but not modelled. Requires adding these fields to the venue config and enforcing them in availability and create.
3. **C13 — cursor expiry.** Requires an event retention/pruning job plus a low-water mark so an old cursor can be rejected with `expired_cursor`.
