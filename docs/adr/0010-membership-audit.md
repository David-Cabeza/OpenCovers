# ADR-0010: Membership audit

- Status: Accepted (owner, 2026-11-23). Built: C31 and `membership-audit.test.ts`.
- Date: 2026-11-16
- Deciders: David Cabeza

## Context

[ADR-0006](0006-staff-invitations.md) and [ADR-0009](0009-venue-members.md) let an admin invite, revoke and remove, and ADR-0009 records none of it. Nobody can tell afterwards who invited, who joined or who was removed. Only guest changes write an audit row (`guest_audit`).

## Decision

A `membership_audit` table is append-only and scoped to a venue. One row is written for each change of access, in the same transaction as the change:

| `action` | Written by | `actor_user_id` | `target_user_id` |
| --- | --- | --- | --- |
| `invited` | create invitation | the admin | none |
| `invite_revoked` | revoke, only when it revokes | the admin | none |
| `redeemed` | redemption, where the membership is granted | none | the redeemer |
| `member_removed` | remove, only when it removes | the admin | the removed account |

Each row also carries `invitation_id` and `role` where they apply, and `occurred_at`. A repeated revoke, a refused removal and a refused redemption write nothing.

**Ids only.** Rows hold account and invitation ids and a role. They never hold an email, a name or a token, so the log adds no personal data. The ids have no foreign key to `user`, so deleting an account does not erase or cascade into the log. `venue_id` cascades with the venue.

**Atomicity.** Create, revoke, remove and redemption by a signed-in account write the row in the same transaction as the change. Redemption by sign-up is two steps by design (ADR-0006): the claim runs before the account exists, the grant after. The `redeemed` row is written in the grant transaction, so it exists exactly when the membership does, and a claimed invitation whose account is never created has no row and no membership. The grant is guarded by `redeemed_by IS NULL`, so concurrent redemptions write one row.

**Retention.** `runRetention` deletes a venue's rows older than its `retentionDays`, in bounded batches like the other steps.

**Scope.** No read route yet, so the contract's `openapi.yaml` does not change. Role changes do not exist and so are not logged.

## Consequences

An admin's questions are answerable from the table. The log needs a route and a staff screen to be reachable without SQL. A person with direct database access can still change memberships without a row, as ADR-0009 accepts for the last-admin rule.

## Alternatives considered

- **Store the email.** Rejected. The account id answers who, and a log of addresses outlives the account.
- **A foreign key to `user`.** Rejected. Deleting an account would delete or null the trail.
- **Write `redeemed` in the claim.** Rejected. A claim can precede an account that is never created, which would log a join that did not happen.
- **A database trigger on `venue_memberships`.** Rejected for now. It also covers SQL, but it cannot know the actor or the invitation.
