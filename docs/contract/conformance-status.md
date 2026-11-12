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
| C4 Modify bumps the version | **PASS** | Version +1 on a change, no-op without a bump. A confirmation is sent once per (reservation, version) via Resend, idempotent by a unique constraint. |
| C5 Erasure | **PASS** | Returns counts, nulls personal fields, emits tombstones with a hash in the event feed. Test: erasure is idempotent. |
| C6 Notice address | **PASS** | `notice_address_required` on enable-without-address and clear-while-enabled. Test covers both. |
| C7 Party size | **PASS** | `party_size_too_large` (explicit and auto-assign) and `no_suitable_table`. Tests cover both. |
| C8 Hours | **PASS** | `outside_hours` (hours, slot grid, last seating) and `lead_time_violation` are enforced and tested. Walk-ins bypass the slot grid and lead time. |
| C9 Status transitions | **PASS** | `seated`/`attended`/`no_show` with events; `invalid_transition`; `already_cancelled`. Tests cover. |
| C10 Venue isolation | **PASS** | Requests are scoped per venue; an ungranted venue returns `venue_not_found`. Covered by the key-grant tests. |
| C11 Event feed | **PASS** | Bigserial ids and a cursor over the feed; replay re-emits the same ids. |
| C12 Attribution | **PASS** | `basis`, `owner_principal`, `booked_via` are set from the authenticated channel; the request body cannot override them. |
| C13 Cursor expiry | **PASS** | `pruneEvents` advances a per-venue watermark; a cursor below it is rejected with `expired_cursor`. A scheduled job runs retention hourly. Tested. |
| C14 Consent | **PASS** | `guest.consent` tri-state with `consentRecordedAt`. Tests in `apps/api/test/consent.test.ts` cover default, grant, invalid value, modify bump and event, same-value no-op, reads, walk-in, and erasure reset. |
| C15 Webhooks | **PASS** | `webhook_endpoints` holds one cursor per endpoint over the event feed. A single-statement `FOR UPDATE SKIP LOCKED` claim leases an endpoint to one worker. Tests in `apps/api/test/webhooks.test.ts` cover signature, order, backoff, resume, independence, settle window, new-endpoint start, watermark jump, concurrent workers, SSRF ranges, DNS rebinding, cap, isolation, and secret exposure. `apps/api/test/webhooks-e2e.test.ts` delivers to a real local receiver and verifies with the snippet in `webhooks.md`. |

## Open gaps

None. All 15 conformance cases pass.

## Notes

- Email delivery is Resend. The templates in `apps/api/src/lib/mailer.ts` are placeholders pending legal review of the text and basis; sends are gated by `notificationsEnabled` (default off).
