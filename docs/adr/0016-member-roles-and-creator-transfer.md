# ADR-0016: Member role change and venue creator transfer

- Status: Accepted
- Date: 2026-11-17
- Deciders: David Cabeza

## Context

Two things still need SQL.

[ADR-0009](0009-venue-members.md) left out role change. To promote or demote a person, an admin removes them and invites them again, and the invitee must redeem a new token. [ADR-0008](0008-venue-creation-limit.md) left out a way to hand over the owner mark: the `user.first_signup` flag, held by at most one account (a partial unique index), which alone may create venues under `SIGNUP=first-user` and `closed`. It says "a transfer flow is a separate decision".

Two meanings of "owner" exist today, and this ADR keeps them apart.

- **Venue role.** `admin`, `write` or `read` in `venue_memberships`, per venue. An admin runs a venue: invitations, members, keys, setup.
- **Venue creator.** The `first_signup` mark, per instance. It decides one thing, who may call `POST /v1/venues` on a non-open instance. It gives no access to any venue.

Role change touches the first. Creator transfer touches the second. Neither may weaken the last-admin rule of ADR-0009 or the single-mark rule of ADR-0008.

## Decision

### Role change

`PATCH /v1/venues/{venueId}/members/{userId}` with `{ "role": "admin" | "write" | "read" }` returns `{ "member": { "userId", "role" } }`.

- It sits behind `adminOnly` and `staffSessionOnly`, as the other member routes do. A key of any role fails with `forbidden`, for the reason in ADR-0009: a key is an integration, and a leaked `admin` key must not be able to promote itself a human or lock staff out. Not exposed through MCP.
- The target is resolved only inside the path's venue. Unknown, or a member of another venue only, is `member_not_found`. A caller outside the venue is `venue_not_found`.
- It runs in the same transaction shape as removal: lock the venue's admin rows `FOR UPDATE` in `user_id` order, refuse a caller who is no longer admin, find the target, refuse a demotion of the last admin with `last_admin` (409), then update. The two operations take the same lock, so a role change and a removal, or two role changes, queue and cannot jointly leave no admin.
- Setting the role the member already holds returns 200 and writes nothing. A retry is safe.
- An admin may change their own role when another admin remains.
- A change writes one `role_changed` row to `membership_audit` with the admin as actor, the member as target and the new role. The old role is not stored. It is the previous `role_changed` row, or the invitation's role.
- Effect is immediate. The venue middleware reads the membership on every request, so the next request uses the new role.
- Not reached: API keys the member made keep their own role, and sessions are untouched. A demoted admin's earlier `admin` keys keep working until revoked. This is the same limit ADR-0011 accepts for keys and is stated in the deploy guide.

This needs a migration, because the `action` column has a CHECK constraint. Migration `0032` adds both new actions below.

### Creator transfer

`GET /v1/account` returns `{ "account": { "userId", "isCreator" } }` so the staff app can show the action only to the creator. `POST /v1/account/transfer-creator` with `{ "userId" }` returns `{ "creator": { "userId" } }`. Both need a staff session and refuse a key with `forbidden`. Neither sits under a venue path, because the mark belongs to the instance.

Rules for the transfer.

1. **Only the current creator.** Any other account, a venue admin included, fails with `forbidden`. The check reads the mark inside the transaction, after locking the caller's `user` row.
2. **An eligible target.** The target must be a member, of any role, of at least one venue the caller administers. Anything else, an unknown id included, fails with `member_not_found`. The reason is to stop the creator from handing the right to an arbitrary account and to make probing for account ids useless. The target is not required to be an admin: the creator already decides who is invited, and venue creation does not grant access to existing venues.
3. **Atomic swap.** One transaction clears the caller's mark, then sets the target's. The order matters, because the partial unique index is checked per row, not at the end of the statement, so setting first would fail. The row lock on the caller serializes two concurrent transfers by the same creator. The second sees the cleared mark and fails with `forbidden`. At no committed moment are there zero or two creators.
4. **The old creator keeps everything else.** All their memberships and their venues stay. They lose only the right to create venues, and only the new creator can hand it back.
5. **Self transfer** is a 200 no-op.
6. **Audit.** The membership log is per venue and the mark is per instance, so there is no exact home. A `creator_transferred` row, with the old creator as actor, the new one as target and no role, is written to each venue where the caller is admin and the target is a member. Those are the venues where the people who can see the audit log can also see the change. If the audit write fails the whole transfer rolls back.
7. **Mode independence.** The route works under any `SIGNUP` mode, including `open`, where the mark has no effect until the mode changes.

### Not changed

- **No creator.** An instance whose accounts were made under `open` has no marked account, so nobody can call the transfer. The one-time SQL step in the deploy guide stays for that single bootstrap. Allowing "any admin" to claim an unmarked instance would hand venue creation to whoever asks first, which is the hole ADR-0008 closed.
- **The creator is not a venue role.** There is no new role and no change to `adminOnly`.
- **A deleted creator.** Nothing in the product deletes accounts. If one is deleted in SQL, the instance has no creator, as above.

### Errors

No new codes. `forbidden`, `unauthorized`, `invalid_request`, `member_not_found`, `venue_not_found` and `last_admin` cover every case. `member_not_found` and `last_admin` gain a line each in `errors.md`.

## Consequences

**Easier.** An admin promotes or demotes in one call, and the staff app Team screen has a role selector. The creator can hand the instance to a successor without SQL, for example when the person who set it up leaves. Role changes and creator changes appear in the audit log.

**Harder.** The venue lock now serves two writers. An admin who changes roles and an admin who removes someone run one after the other in that venue. The audit action vocabulary grows by two values, so any reader that switches on `action` must handle them.

**Accepted.**

- A transfer is not undoable by the old creator. It needs the new one, or SQL.
- The creator can hand the right to a person who holds only `read`. That person can then create venues but sees nothing new in existing ones.
- Demoting an admin does not revoke the `admin` keys they made. Review the keys after a demotion, as after a removal.
- Admins of venues the two accounts do not share cannot see a transfer in their log.
- The old role is not recorded in `role_changed`.

## Alternatives considered

- **Role change by remove plus invite.** Status quo. Rejected: two steps, a token to pass on, and a window where the person has no access.
- **Let an `admin` key change roles.** Rejected, as in ADR-0009 and ADR-0006.
- **A deferred trigger for the last-admin rule.** Rejected again, for the reason in ADR-0009. The shared lock is enough for every API caller.
- **Treat any venue admin as able to transfer the creator mark.** Rejected. The mark gates venue creation on a private instance, and ADR-0008 ties it to the account that claimed the instance. Any invited admin could then take it.
- **Let the creator name any account.** Rejected. It lets the right go to a stranger, and the answer would reveal which ids exist.
- **Require the target to be an admin of a shared venue.** Rejected. It adds a rule that does not protect anything, since the creator can already make the person an admin first.
- **A deferred unique constraint to swap in one `UPDATE`.** Rejected. It needs a hand-written migration that `pnpm db:generate` does not produce. Two ordered updates inside one transaction are enough.
- **No audit for the transfer.** Considered, since the log is per venue. Rejected because a change of who controls the instance should leave a trace, and the shared venues are the natural home.
- **A new `owner` venue role.** Rejected. The mark is about the instance, and a role would change `adminOnly`, invitations and the last-admin rule.
