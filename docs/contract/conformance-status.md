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
| C5 Erasure | **PASS** | Returns counts, nulls personal fields, emits tombstones with a hash in the event feed. By guest record id it deletes the guest and those merged into it and unlinks the anonymous visits. Erasure by principal also deletes the guest records left with no other visit. The contact fallback is deprecated. Tests in `apps/api/test/guests.test.ts` and `apps/api/test/erasure-waitlist.test.ts` cover record id, contact fallback, other venues, merged guests, waitlist, and idempotency. |
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
| C16 Rating | **PASS** | `rating` 1 to 5 or null with `ratingRecordedAt`. Tests in `apps/api/test/rating.test.ts` cover create, walk-in, modify bump and event, same-value no-op, clear with null, invalid values, read-only key, reads, and erasure reset. |
| C17 Guest identity | **PASS** | `guests` holds one record per venue and normalized key, with a per-venue unique index on email and on phone. The booking transaction links with insert-on-conflict. Tests in `apps/api/test/contact.test.ts` cover the normalization table. `apps/api/test/guests.test.ts` covers same contact, case and whitespace, dots and tags, local and international phone, configured country, venue isolation, no contact, unparseable contact, walk-in and waitlist seating, concurrent creates, and the idempotent backfill. |
| C18 Guest retention | **PASS** | The hourly `runRetention` job in `apps/api/src/lib/retention.ts` claims eligible guests, then unlinked reservations, per venue in bounded batches with `FOR UPDATE SKIP LOCKED` and blanks their visits through `eraseReservations`, the same path erasure uses. Tests in `apps/api/test/guest-retention.test.ts` and `apps/api/test/reservation-retention.test.ts` cover expiry, future and seated visits, a stale last-visit time, the horizon, per-venue periods, a second run, batch bounds, overlapping runs, merged guests, tombstones and events, unlinked reservations with a name only, a contact only, and an unnormalizable contact, future and seated reservations, and scans for personal values. |
| C19 Guest merge | **PASS** | `GET /guests` pages by `(last_visit_at desc, id)` with a venue-scoped cursor. Merge and unmerge lock the guest rows `FOR UPDATE`, merge in id order, and write a `guest_audit` entry with `prior_state` and the moved reservation ids. `forgetMergeState` in `apps/api/src/lib/guests.ts` clears `prior_state` on erasure and on guest expiry. Tests in `apps/api/test/guest-read.test.ts` cover order, filters, pagination with ties, bad cursors, isolation, and hidden guests. `apps/api/test/guest-merge.test.ts` covers roles, moved visits, idempotency, invalid and cyclic merges, opposite merges at once, exact unmerge, later bookings, rejected unmerges, and audit scans after erasure by guest id, by principal, and retention. |

## Open gaps

None. All 19 conformance cases pass.

## Notes

- Email delivery is Resend. The templates in `apps/api/src/lib/mailer.ts` are placeholders pending legal review of the text and basis; sends are gated by `notificationsEnabled` (default off).
