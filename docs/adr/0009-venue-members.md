# ADR-0009: Venue members

- Status: Proposed. The limits on sessions, keys and webhooks are replaced by [ADR-0011](0011-member-removal-revocation.md), and the missing audit by [ADR-0010](0010-membership-audit.md).
- Date: 2026-11-16
- Deciders: David Cabeza

## Context

[ADR-0006](0006-staff-invitations.md) lets a venue admin add staff. It left two things out. An admin cannot see who holds access to the venue, and cannot take that access away. Revoking an invitation does nothing for a person who already redeemed it. The only fix today is to delete a `venue_memberships` row in SQL.

A restaurant has staff turnover. Someone leaves, and their account must stop working in that venue the same day.

What exists today:

- **Memberships.** `venue_memberships` has `user_id`, `venue_id` and `role`, with a primary key on the pair. It has no created-at column. Both foreign keys cascade on delete.
- **Access check.** The venue middleware in `apps/api/src/app.ts` reads the membership on every staff request. A session holds no venue access of its own. Deleting the row ends access on the next request.
- **Keys.** An API key is a row in `api_keys` with a `principal` string and rows in `grants` that name venues. Nothing links a key to a user.
- **Roles.** `admin` is the top role. There is no owner role and no way to change a role. Redeeming an invitation only raises a role.
- **Account.** Better Auth owns `user` and `session`. A user may hold memberships in several venues.

Two properties bind the design. A venue must never be left with no admin, because then nobody can invite, set up or remove anyone, and only SQL can recover it. And two admins acting at the same moment must not be able to defeat that rule.

## Decision drivers

- **Smallest model that works.** Two routes, no new table, no migration.
- **No lock-out.** A venue always keeps at least one admin, even under concurrent requests.
- **Venue isolation.** A member of another venue is invisible. The answer is not found.
- **Minimum personal data.** Show an admin what they need to tell people apart, and nothing more.
- **Honest scope.** State what removal does not reach.

## Decision

A venue `admin` with a staff session can list the venue's members and remove one. Nothing else about members changes.

### Routes

- `GET /v1/venues/{venueId}/members` returns `{ "members": [...] }`.
- `DELETE /v1/venues/{venueId}/members/{userId}` removes one membership and returns `{ "member": { "userId", "role" } }`, the membership that was removed.

Both sit behind `adminOnly` and `staffSessionOnly`, as the invitation routes do. A `read` or `write` session fails with `forbidden`. An API key of any role, an `admin` key included, fails with `forbidden`. Neither route is exposed through MCP.

Keys are refused for the same reason as in ADR-0006. The list shows the name and email address of other people, and a key is an integration, not a person. A leaked or over-trusted `admin` key must not be able to harvest staff addresses or lock staff out. A person with `admin` can do everything an agent key can, so nothing is lost.

### What the list shows

| Field | Meaning |
| --- | --- |
| `userId` | The opaque account id. It is the handle for removal. |
| `name` | The name the person gave at sign-up. |
| `email` | The account email. |
| `role` | `read`, `write` or `admin`. |

This is the least that lets an admin tell two people apart and pick the right one. The list holds no password data, no session data and no sign-in history. It shows only this venue's members, ordered by email.

It has no "since when" field. `venue_memberships` has no created-at column, and a migration would back-fill every existing row with the migration date, which is false. The account's own creation date answers a different question. A member's start date is not worth a schema change here. If it is wanted later, add the column then, and show it as unknown for old rows.

### Removal

- **Venue isolation.** The route resolves the target only inside the path's venue. A user id that is unknown, belongs to no membership here, or is a member of another venue only, fails with `member_not_found` (404). Those cases are indistinguishable.
- **Self-removal.** An admin may remove themselves, which is how an admin leaves, unless they are the last admin.
- **Role change is out of scope here.** [ADR-0016](0016-member-roles-and-creator-transfer.md) adds it. This ADR had no demotion route. Remove, then invite again at the lower role. Redeeming an invitation never lowers a role, so a person who stays a member cannot be demoted by inviting them. This is the smallest model. If a role change is added later, it must take the same lock as removal and refuse to demote the last admin.

### The last admin

A venue always keeps at least one `admin`. A removal that would leave none fails with `last_admin` (409) and changes nothing. This includes an admin removing themselves.

The rule is enforced by a row lock, not by check-then-delete. The removal runs in one transaction:

1. Lock the venue's admin membership rows with `SELECT ... FOR UPDATE`, ordered by `user_id`.
2. Fail with `venue_not_found` if the caller is no longer among them. This stops an admin who was removed a moment ago from finishing a removal of their own.
3. Find the target. Fail with `member_not_found` if it is not a member.
4. Fail with `last_admin` if the target is an admin and the locked set has one row.
5. Delete the target row and commit.

Two concurrent removals of the same venue's admins queue on the lock. The second one re-reads the admin rows after the first commits, sees the shrunken set, and either fails with `last_admin` or with `venue_not_found`. Of two admins removing each other at once, exactly one succeeds. The fixed lock order makes a deadlock between two removals impossible.

This lock is the guarantee, and it holds for every caller of this code. It does not stop a person who edits `venue_memberships` in SQL, or deletes the venue, which is allowed. A database trigger would stop SQL too, and needs a migration. That is rejected for now, see Alternatives.

### What removal does and does not reach

- **Sessions.** Removed. Access is checked against the membership on every request, so the person's next request to this venue fails with `venue_not_found`. Their session is not revoked, because it also serves their other venues.
- **The account.** Kept. Better Auth owns it, and the person may belong to other venues. With no membership left, the account signs in and `GET /v1/venues` returns an empty list. Under `SIGNUP=open` it can still call `POST /v1/venues` and create a venue of its own. Under `first-user` and `closed` it cannot, see [ADR-0008](0008-venue-creation-limit.md).
- **API keys.** Not affected. A key belongs to an integration, not to a user, and no column links a key to the person who created it. A key the removed person made keeps working until an admin revokes it. The admin should review `GET /v1/venues/{venueId}/keys` after removing someone who handled keys. The same holds for webhook endpoints.
- **Past records.** Not rewritten. Events and reservations keep the `principal` text, which is the email of whoever acted. Removal does not edit history.
- **Invitations.** A removed person's earlier invitation stays redeemed. It cannot be used again. To bring the person back, an admin creates a new one, and redeeming it grants a fresh membership.

### Guest erasure

Guest erasure concerns guest data and does not touch memberships. Removing a member does not erase the staff email in past events, because those events are the venue's record. Deleting a staff account is a separate matter, and it already cascades to its memberships.

### Audit

Not recorded. Removal writes no event and no log line. The event feed is guest-facing and signed, and a new event type would change the webhook contract. A membership removal is therefore not visible after the fact, as a key change is not. Hardening known gap 5 states this. An audit trail for staff and access changes is a separate decision.

### Errors

Two new codes. `member_not_found` (404) and `last_admin` (409). The other failures reuse `forbidden`, `venue_not_found` and `unauthorized`.

### Scope

No migration, no staff app screen, no role change, no MCP tool, no audit entry. The staff app screen is a later change. The contract gains the two routes and the two codes.

## Consequences

**Easier.** A venue admin sees who has access and removes someone, with no SQL. A leaver loses venue access on their next request. A venue cannot be locked out of its own admin role through the API, even under concurrent requests.

**Harder.** Removal takes a lock on the venue's admin rows, so concurrent removals in one venue run one after another. Admin removals are rare, so this costs nothing in practice. Role change still needs remove plus invite.

**Accepted.** Removing a person does not revoke API keys or webhooks they created, and nothing records who removed whom. A person with direct database access can still empty the admin set. Their session on other venues stays valid.

## Alternatives considered

- **A deferred constraint trigger that rejects a commit leaving no admin.** Rejected for now. It also covers SQL, but it needs a migration and a hand-written trigger, which `pnpm db:generate` does not produce. The API is the only supported write path. Revisit if another writer appears.
- **Count the admins, then delete, in one transaction without a lock.** Rejected. Two transactions both count two admins and both delete, leaving none. This is the race the lock prevents.
- **Lock the `venues` row.** Rejected. A `FOR UPDATE` on `venues` conflicts with the key-share locks that every booking insert takes on that row, so removals would stall bookings.
- **A serializable transaction with a retry.** Rejected. It also works, but it needs retry code and reasons about conflicts less plainly than a lock on the rows that matter.
- **Allow `admin` keys to list and remove.** Rejected, for the reason in ADR-0006. A key is not a person.
- **A role-change route.** Rejected for now. Remove plus invite covers it, and a role change adds a second way to break the last-admin rule.
- **Add a created-at column to show "since when".** Rejected. A migration to show a date that is false for every existing row.
- **Revoke the removed person's sessions.** Rejected. The membership check already ends access to this venue, and a session belongs to the account, which may serve other venues.
- **Delete the account when its last membership goes.** Rejected. Better Auth owns the account, and an account with no venue is harmless. It would also turn a venue admin's action into an account deletion.
- **Record a removal event in the feed.** Rejected. The feed is a guest-facing contract. See Audit.
