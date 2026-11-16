# ADR-0006: Staff invitations

- Status: Proposed
- Date: 2026-11-15
- Deciders: David Cabeza

## Context

[ADR-0005](0005-signup-control.md) closed sign-up. `SIGNUP=first-user` or `closed` means nobody else can create an account, and `addMembership` in `apps/api/src/lib/memberships.ts` has no caller outside tests. A restaurant with several employees has no way to add them without editing SQL, and the SQL path needs the operator to reopen sign-up for a while. ADR-0005 named an invitation flow as the follow-up and said it would need an explicit allowance in the sign-up rule.

What exists today:

- **Accounts.** Better Auth owns `user`, `session`, `account` and `verification`. The `databaseHooks.user.create.before` hook in `apps/api/src/lib/auth.ts` applies `SIGNUP` to every way an account is created.
- **Memberships.** `venue_memberships` links a user to a venue with a role of `read`, `write` or `admin`. Only `createVenue` inserts one for a normal request.
- **Roles.** `admin` is the top role. There is no owner role. The first account on a `first-user` instance is marked by `user.first_signup`, and that mark has no effect on access.
- **Keys.** An API key can hold the `admin` role for a venue. A key belongs to an integration, not to a person.
- **Rate limiting.** OpenCovers has none for `/v1/*` except the credential paths in [ADR-0007](0007-rate-limiting.md). See the hardening guide, known gap 2.

Two properties bind the design. An invitation must not open a way to create accounts that `SIGNUP` forbids, beyond the one account per invitation. And it must not create a venue or a new owner.

## Decision drivers

- **Smallest model that works.** One table, no email sending, no new roles.
- **No back door.** One invitation yields at most one account or one membership, and the database enforces it.
- **All sign-up modes.** An invited sign-up works under `open`, `first-user` and `closed`.
- **Secret handling.** The token is a credential. It must not be stored, logged or readable after creation.
- **Venue isolation.** An invitation for venue A reveals nothing about venue B.
- **Minimum personal data.** An invitation may hold an email address. It must not live forever.

## Decision

A venue `admin` creates an invitation. The invitee redeems it, and redemption grants one membership. Nothing else about the invitee changes.

### What an invitation carries

| Field | Meaning |
| --- | --- |
| `id` | A random UUID, safe to show and use in URLs. |
| `venueId` | The one venue it grants access to. |
| `role` | `read`, `write` or `admin`. |
| `email` | Optional. When set, only an account with that email (compared case-insensitively) can redeem it. When null it is an open link, and anyone holding the token can redeem it once. |
| `expiresAt` | `expiresInHours` from creation. Default 72, allowed 1 to 336. |
| `invitedBy` | The user who created it. Set to null if that account is deleted. |
| `redeemedAt`, `redeemedBy` | Set once, on redemption. |
| `revokedAt` | Set once, on revocation. |

An invitation is pending, redeemed, revoked or expired. The status is computed, not stored. A database check refuses a row that is both redeemed and revoked.

### Who can invite

Only a staff session whose membership in the venue has the role `admin`. The venue middleware already resolves the role, and the invitation routes sit behind `adminOnly`. They also refuse any request that carries an `apikey` header, with `forbidden`, even an `admin` key. An invitation creates access for a person, and a key is an integration. A person with `admin` can do everything an agent key can, so nothing is lost.

`admin` is the top role, so no inviter can grant more than they hold. A role outside `read`, `write`, `admin` fails with `invalid_request`. An invited `admin` can invite others in that venue only. They gain nothing in any other venue and cannot create an owner, because there is no owner role.

### Token handling

1. **Format.** The token is `<id>.<secret>`. The secret is 32 random bytes in base64url from `node:crypto`.
2. **Storage.** The database stores only the SHA-256 hash of the secret, as hex. The token is returned once, in the response that creates the invitation. No later call returns it, including the list. If it is lost, the admin revokes the invitation and creates a new one.
3. **Compare.** Redemption looks the row up by `id`, hashes the presented secret, and compares the two hashes with `timingSafeEqual`. An unknown `id` runs the same compare against a dummy hash. A 256-bit secret cannot be guessed, so this is defense in depth.
4. **Never logged.** The API does not log request bodies or headers, and the code must not start. The token is a body field on redemption and a header on sign-up, both outside the URL, so a proxy access log does not capture it. Operators should not enable body or header logging at the proxy.
5. **Single use.** Redemption is one conditional `UPDATE` that sets `redeemed_at` where the row is not redeemed, not revoked and not expired, and where the email matches when one is set. The database serializes concurrent updates on the row, so exactly one wins. This replaces any read followed by a write. Expiry uses the database clock.
6. **One answer for every failure.** An unknown id, a wrong secret, an expired, used or revoked invitation, an email that does not match, and an invitation for any venue return the same `invalid_invitation` response. A caller cannot tell which, and cannot learn that a venue exists.

### Redemption

Two paths, one rule: the invitation is claimed atomically, then the membership follows.

**An existing account.** The user signs in and calls `POST /v1/invitations/redeem` with the `token`. In one transaction the invitation is claimed and the membership is written. If the user is already a member, the role becomes the higher of the two. Redeeming never lowers a role. The response is the venue id and the role.

**A new account.** The invitee calls Better Auth sign-up with the header `X-Invitation-Token`. The `user.create.before` hook sees the header and claims the invitation, with the sign-up email, before it considers `SIGNUP`. If the claim fails the hook refuses with `403` and the code `INVALID_INVITATION`. If it succeeds the account is created, and the `user.create.after` hook grants the membership in one transaction that also records `redeemed_by`. The staff app then has a session and no further call.

How this interacts with `SIGNUP`:

- **A valid invitation** lets the sign-up through in every mode. It does so for exactly one account, because the claim is single use.
- **No header** leaves ADR-0005 unchanged. `closed` still returns `SIGNUP_CLOSED`, and `first-user` still admits only the first account.
- **An invalid token** is refused with `INVALID_INVITATION` in every mode, including `open`. It never falls back to the plain rule, so a staff app flow fails the same way everywhere.
- **No new owner.** An invited account is never marked `first_signup`. It gets one membership, in the invited venue, with the invited role. Redemption creates no venue.

The claim happens before the account is written, so a sign-up that fails after the claim, for example a crash, leaves a used invitation and no membership. The failure is closed. The admin creates a new invitation. If the account exists, it redeems the new one as an existing user.

### Revocation and listing

- `DELETE /v1/venues/{venueId}/invitations/{invitationId}` sets `revoked_at` on a pending invitation. Revoking a revoked or expired invitation returns it unchanged. Revoking a redeemed invitation fails with `invitation_redeemed`, because the membership is separate and this ADR adds no way to remove it. An id from another venue is `invitation_not_found`.
- `GET /v1/venues/{venueId}/invitations` lists the venue's invitations with status, newest first. It never returns the token or its hash.
- Creating returns `201` with the invitation and the one-time `token`.

### Rate limiting

This decision adds none. [ADR-0007](0007-rate-limiting.md) later limits `POST /v1/invitations/redeem` and a sign-up with `X-Invitation-Token` per client address. The size of the secret is still the main protection. An `admin` can create many invitations, and invitation creation is not limited.

### Retention and erasure

An invitation holds an email address only when the admin typed one. The hourly retention job deletes every invitation whose `expires_at` is more than 30 days past, in any state. A used invitation therefore keeps its email for at most its lifetime plus 30 days. A deleted venue deletes its invitations. A deleted account is set to null on `invited_by` and `redeemed_by`. Guest erasure does not touch invitations, because they hold staff data, not guest data. The membership a redemption created outlives the invitation.

### Schema

A table `invitations` with the columns above, a foreign key to `venues` with delete cascade, foreign keys to `user` with delete set null, a check on `role`, and a check that `redeemed_at` and `revoked_at` are not both set. The migration comes from `pnpm db:generate`.

### Scope

No email sending, no staff screen in `apps/web`, no way to list or remove members (see [ADR-0009](0009-venue-members.md)), and no change to `POST /v1/venues`. Those are separate changes. The contract gains the invitation routes. Better Auth routes stay outside `docs/contract/`, and the sign-up header is documented in `docs/deploy.md`.

## Consequences

**Easier.** A venue admin adds staff with no SQL and no change to `SIGNUP`. A production instance stays closed while it grows. The rule that a stranger cannot sign up is the same rule, with one documented exception that spends a single-use secret.

**Harder.** The sign-up hook now has two branches and reads a request header. A failed sign-up after the claim burns the invitation. The admin shares the token by hand, because the API sends no email. An open link works for whoever holds it first, so it must be sent over a private channel.

**Accepted.** An invited account can still call `POST /v1/venues` and create a venue of its own on a closed instance. That is hardening known gap 2, unchanged by this decision, and it is the next thing to restrict. The invitation grants no more than any open sign-up did before ADR-0005. Email-bound invitations check the address the invitee typed and do not verify it, because email verification is off. The token is the secret. Redemption attempts are limited per client address by ADR-0007, and the secret's size is the main protection. An admin session that is stolen can mint invitations until it is revoked. Staff cannot yet see who holds a membership, so they cannot yet remove one.

## Alternatives considered

- **An admin creates the account with a temporary password.** Rejected. It puts a password in an admin's hands and bypasses the sign-up hook as a second account path.
- **A fourth `SIGNUP` value for invite-only.** Rejected. `closed` plus an invitation already means it, and ADR-0005 rejected a value with nothing to point at.
- **Reopen sign-up for invited emails by email match alone.** Rejected. An email is not a secret, so anyone could sign up with an address they know was invited.
- **Check the invitation in `before`, consume it in `after`.** Rejected. Two sign-ups can both pass the check and create two accounts from one token. The claim has to happen first.
- **Create the account and the membership in one transaction ourselves.** Rejected. Better Auth owns account creation and its own connection. Bypassing it would fork the auth code to save one rare retry.
- **A stored token or a reversible token.** Rejected. A database leak would hand out live access. A hash costs nothing.
- **A bare random token with no id.** Rejected. A lookup by hash cannot compare in constant time and cannot be listed or revoked by a handle.
- **Let `admin` keys invite.** Rejected for now. A key is not a person, and an agent that holds `admin` can already do what the invited person could. It can be allowed later without a schema change.
- **Cap pending invitations per venue.** Rejected. The cap bounds nothing, because redeemed invitations stop counting, and rate limiting is the real control.
- **Delete the email at redemption.** Rejected. Admins want to see who joined, and the retention sweep bounds the life of the address.
