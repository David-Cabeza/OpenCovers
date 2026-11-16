# ADR-0011: Member removal revokes what the person left behind

- Status: Accepted
- Date: 2026-11-16
- Deciders: David Cabeza

## Context

[ADR-0009](0009-venue-members.md) lets an admin remove a member. It stated three limits on purpose: removal does not revoke sessions, does not touch API keys or webhook endpoints the person made, and (until [ADR-0010](0010-membership-audit.md)) left no record. ADR-0010 added the append-only `membership_audit` log, including `member_removed`. This ADR does not redefine that log. It closes the other limits.

Those limits fail silent. A person who leaves keeps a working API key and a webhook that still receives guest events. A restaurant has staff turnover, so this is the normal case.

What the code shows:

- **Sessions.** Better Auth owns the `session` table. A row has a `user_id` and nothing about a venue. A session is global to the account, so revoking only one venue's sessions is impossible.
- **Keys.** `api_keys` has no link to a user. Venue key revocation deletes the grant for that venue, and deletes the key row when no grant remains.
- **Webhooks.** `webhook_endpoints` has no creator column.
- **Audit.** ADR-0010 records `member_removed` with ids and a role, and has no read route.

## Decision drivers

- **Fail visible and recoverable, not silent.** A removal must not leave working credentials behind unnoticed, and must not destroy what an admin cannot get back.
- **No lock-out of other venues.** One account may serve several venues.
- **One transaction.** A half-done removal is worse than none.
- **Honest scope.** State what stays unknown for rows that predate the change.

## Decision

### Removal does three more things in the same transaction

`removeMember` keeps the last-admin lock from ADR-0009 and the `member_removed` audit row from ADR-0010 unchanged. After it deletes the membership, in the same transaction, it also:

1. **Revokes the API keys the person made in this venue.** It removes this venue's grant from each key whose `created_by` is the person, and deletes the key row when no grant remains. This is what an admin revoking the key does. A key that also holds another venue keeps the other grant.
2. **Revokes the person's sessions, only when the removal was their last membership.** See below.
3. **Flags the webhook endpoints the person made in this venue** by setting `creator_departed_at`. It does not delete, disable or pause them.

If any step fails, the whole removal rolls back: the membership stays, nothing is revoked, and no audit row exists. The `last_admin` and `member_not_found` refusals return before any of it runs, so nothing is revoked then either.

The response of `DELETE /v1/venues/{venueId}/members/{userId}` gains `revoked` with the counts `keys`, `sessions` and `webhooksFlagged`. The counts are not stored in `membership_audit`, whose rows hold ids and a role only (ADR-0010). The row says who removed whom, and the response says what was revoked.

### Sessions

The per-request membership check already ends the person's access to this venue on their next request, so a session grants nothing in a venue they left. Revoking it matters when the session would otherwise serve no venue, or could be used for something that needs no membership, such as creating a venue under `SIGNUP=open`.

- **No membership left.** Delete every session row of the account. The person is signed out everywhere. The account stays and can sign in again and be invited again.
- **Another membership remains.** Keep the sessions and report `0`. Revoking would sign the person out of venues where they are still staff.

Consequence for ADR-0009: after a removal that was the last membership, the person's next request fails with `unauthorized` (401), not `venue_not_found`, and they sign in again before redeeming a new invitation. When they keep another venue it is still `venue_not_found`.

### Keys

`api_keys` gains a nullable `created_by` (a user id, `on delete set null`), set going forward when a staff session mints a venue key. Existing rows, keys made with an `admin` key, and keys from `POST /v1/auth/keys` stay null. Their creator is unknown and removal does not touch them. After a leaver who handled such keys, an admin should still review `GET /v1/venues/{venueId}/keys`. Revoked keys are deleted, as key revocation already does.

### Webhooks

`webhook_endpoints` gains a nullable `created_by` (same rules) and a nullable `creator_departed_at`. A webhook made by a staff session records its creator. One made with a key, and every existing row, has none. On removal the person's endpoints in this venue get `creator_departed_at` and keep delivering. `GET /v1/venues/{venueId}/webhooks` returns `creatorDepartedAt` so an admin can review and delete what they do not trust. The creator's id is not exposed. The flag is not cleared if the person is invited again.

Deleting would silently break an integration whose secret cannot be restored. Disabling would do the same without a record. A flag fails visible: delivery continues, and a person can see it and decide.

### Reading the audit log

ADR-0010 left the log without a read route. `GET /v1/venues/{venueId}/audit` reads `membership_audit`, behind `adminOnly`. A `read` or `write` session or key fails with `forbidden`. An `admin` key may read it. This differs from members and invitations, which refuse every key, because those show names and emails. The log shows opaque ids and a role only. A caller outside the venue gets `venue_not_found`.

It returns `{ entries, nextCursor }`, newest first, each entry with `id`, `action`, `actorUserId`, `targetUserId`, `invitationId`, `role` and `occurredAt`. `limit` is 1 to 200, default 50. `cursor` is the previous `nextCursor` and is bound to the venue. A cursor from another venue, a malformed one, and a bad limit fail with `invalid_request`. It is not exposed through MCP. Retention (ADR-0010) still prunes old rows.

### Errors

No new error code.

## Consequences

**Easier.** Removing a leaver ends their keys and, with no other venue, their sessions, in one step with no SQL. Webhooks they made stay running and are marked for review. An admin reads who invited, joined and removed whom.

**Harder.** Removal writes more rows inside the ADR-0009 lock, so concurrent removals in one venue stay serialized. Removing someone whose key an integration depends on breaks it at once, and the admin mints a new key.

**Accepted.**

- Keys and webhooks made before this change, and any made with a key, have no known creator. Removal does not reach them.
- Sessions are kept when the person has another venue. Their account stays usable there.
- The audit counts of what was revoked are in the response only, not stored.
- A person removed under `SIGNUP=open` can still sign in again and create a venue of their own. Removal ends access, not the account.

## Alternatives considered

- **Revoke sessions on every removal.** Rejected. Sessions are global, so it signs the person out of other venues where they are still staff.
- **Never revoke sessions.** Rejected. A person with no venue left keeps a live login.
- **Revoke only this venue's sessions.** Not possible. `session` has no venue.
- **Delete or disable the removed person's webhooks.** Rejected. Silent breakage of an integration, with no way to restore the secret.
- **Leave keys and webhooks to manual review.** Rejected. That is the silent failure this ADR ends.
- **Revoke every key in the venue.** Rejected. Without a creator link it would revoke other people's keys.
- **Backfill `created_by` on old rows.** Rejected. The creator is unknown, and a guess would revoke the wrong key.
- **Add a details column to `membership_audit` for the counts.** Rejected for now. ADR-0010 chose id-only rows, and the response already carries the counts.
- **A second audit table.** Rejected. It would duplicate ADR-0010.
- **Restrict the audit read to sessions.** Rejected. It holds no emails or names, and `adminOnly` is the convention.
