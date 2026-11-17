# ADR-0008: Venue creation limit

- Status: Proposed
- Date: 2026-11-16
- Deciders: David Cabeza

## Context

[ADR-0005](0005-signup-control.md) controls who gets an account. [ADR-0006](0006-staff-invitations.md) lets a venue admin invite staff. Neither limits `POST /v1/venues`, which accepts any signed-in account and makes it admin of the new venue. ADR-0005 listed this as out of scope, and ADR-0006 accepted it as a known gap.

The gap defeats the point of a private instance. Under `SIGNUP=first-user` or `closed`, an operator invites a waiter as `read`. The waiter signs in, calls `POST /v1/venues`, and owns a venue on an instance the operator meant to keep for one restaurant. Venue data stays isolated, but the instance serves a tenant the operator never agreed to host. The hardening guide lists it as a limit of known gap 1.

The goal is that on a non-open instance an invited account can never create a venue, and the first owner can still create the first one.

What exists today:

- **Route.** `POST /v1/venues` in `apps/api/src/app.ts` needs a staff session and nothing else. It calls `createVenue`, which inserts the venue and an `admin` membership for the creator.
- **Keys.** The route reads the session only. An API key in the `apikey` header is ignored there, so a request with only a key fails with `unauthorized`. A key can never create a venue today, and a key sent next to a session adds nothing.
- **The owner mark.** `user.first_signup` is true for exactly one account, the one admitted by `SIGNUP=first-user` on an instance that had no account. A partial unique index allows one such row. The mark has no effect on access today. Invited accounts are never marked, by ADR-0006. Accounts created under `open` are never marked.
- **Mode.** `signupMode()` reads `SIGNUP` on each call, so the API validates it at startup and every request sees the current value.
- **Reads.** `GET /v1/venues` lists the venues the session holds a membership in. It reveals nothing about other venues.

Three properties bind the design. The rule must live in the API, because the staff app is one client. It must need no migration, since the mark already exists. And it must not strand an instance that exists today.

## Decision drivers

- **An invited account never creates a venue** on a non-open instance, whatever its role, `admin` included.
- **The first owner is never locked out.** The account that claims a fresh `first-user` instance can create its first venue and later ones.
- **Open stays open.** `open` is the development default and must not change, so every existing test and `pnpm dev` keep working.
- **No migration and no new bootstrap channel.** The mark and the mode are enough.
- **Honest operator stories.** Each mode says how the first venue comes to exist.
- **Existing instances keep working.** No account or venue loses access it uses today.

## Decision

The rule depends on the `SIGNUP` mode and on the account's `first_signup` mark. The mode is read on every request.

| Mode | Who may call `POST /v1/venues` |
| --- | --- |
| `open` | Any signed-in account. Unchanged. |
| `first-user` | Only the account with `first_signup = true`, the owner. |
| `closed` | Only the account with `first_signup = true`, if one exists. |

1. **Owner, not role.** The test is the mark, not a venue role. An invited account can hold `admin`, so a role test would leave the hole open. The mark cannot be set by a client, an invitation or a redemption. Only the sign-up hook sets it, under `first-user`.
2. **The owner can create more venues.** The marked account is the operator by construction, because it claimed the instance. A restaurant group with several venues is a normal case. Limiting the owner to one venue would add a count rule and a way to lock them out, for no gain.
3. **Refusal.** A refused call returns `403` with the code `venue_creation_closed` and the message equal to the code, like every other error. It is checked after the session and before the body, so a refused account learns nothing from validation errors. The code is new in `docs/contract/errors.md`. It is distinct from `forbidden`, which means a missing role in an existing venue, so a client can tell "ask your admin" from "this instance does not take new venues".
4. **Keys.** No change in code. A key cannot create a venue, with or without a session, and a test pins it so a future refactor of the route cannot add key access by accident.
5. **Reads.** Listing and reading venues is unchanged in every mode. An invited account still sees the venue it was invited to, and a venue admin still administers it.
6. **Existing venue admins.** An account that administers a venue keeps full control of that venue under every mode. It cannot create another venue unless it is the owner. This is the point of the change.

### How the first venue comes to exist

- **`open`.** Anyone signs up and creates a venue. Nothing changes.
- **`first-user`.** The first visitor signs up, becomes the owner, and creates the first venue. This is the intended production path. Register before publishing the address, as ADR-0005 says.
- **`closed`.** Nobody signs up, so on an instance with no account nothing can start. This is honest and intended. `closed` is for an instance that already has its owner. The operator creates the owner by signing up once under `first-user` (or under `open`, then marking the account as below), creates the venue, and then sets `SIGNUP=closed` and restarts the API. The owner keeps the right to create venues after that. This adds no bootstrap channel, no CLI and no environment flag. ADR-0005 rejected a command for the same reason and this ADR keeps that choice.

### Existing instances on upgrade

No migration and no data step.

- An instance that ran under `first-user` has one marked account. That account keeps creating venues. Every other account keeps its venues and loses only the ability to create more.
- An instance that ran under `open` has no marked account. After the upgrade, if `SIGNUP` is `first-user` or `closed`, no account can create a venue, until the operator picks one of two steps. Set `SIGNUP=open` for as long as it takes, then set it back, with the cost that anyone can sign up meanwhile. Or mark the owner with SQL, which the unique index allows for one account only:

  ```sql
  UPDATE "user" SET first_signup = true WHERE email = 'owner@example.com';
  ```

  The deploy guide and the hardening guide say this. Existing venues, memberships, keys and invitations are untouched, so day to day staff work does not stop.
- `compose.prod.yaml` already defaults to `first-user`, so an upgraded production stack lands in the second case if it was ever open. This is the one place the change can surprise an operator. It surprises them only when they try to create a new venue, and the refusal names the cause.

### What this does not cover

- Venue creation had no rate limit when this ADR was written. [ADR-0007](0007-rate-limiting.md) now limits `POST /v1/venues` per client address (amendment of 2026-11-17), so the owner can no longer create venues without a bound from one address.
- Under `open` nothing is limited, as before.
- An owner who invites a person as `admin` still gives that person full control of the invited venue, including keys and further invitations. The limit is on creating venues, not on administering the one they hold.
- The mark is one row. There is no way to hand ownership to another account except SQL. A transfer flow is a separate decision, now [ADR-0016](0016-member-roles-and-creator-transfer.md).
- If the marked account is deleted, a `first-user` instance is empty again only when no other account exists. With other accounts present, nobody can create venues until the operator marks one. ADR-0005 notes that nothing in the product deletes accounts.
- The staff app shows the refusal as the code, as it does for any API error. A friendlier message is a separate change.

## Consequences

**Easier.** A closed or first-user instance stays for the venues its owner makes. Inviting staff no longer risks a stranger venue. The rule is one function and one route check.

**Harder.** The venue route now reads the mode and the account row. An instance that ran under `open` and moves to `first-user` or `closed` must mark its owner or reopen briefly to make a new venue. The sign-up mark carries one more meaning, so it must keep one definition: set only by the sign-up hook, only under `first-user`.

**Accepted.** The owner is a single account for the life of the instance. A `closed` instance cannot be started from nothing. The operator's SQL step for an upgraded open instance is a poor path, though it is one line and happens once.

## Alternatives considered

- **Allow any account that is already `admin` of a venue.** Rejected. An invitation can grant `admin`, so an invited admin would create venues and the hole stays.
- **Allow the owner one venue only.** Rejected. It needs a count, adds a lockout case, and a group of venues is a normal use.
- **Derive "invited" from the invitations table.** Rejected. Retention deletes invitations 30 days after they expire, so the evidence expires, and an account that redeems as an existing user was never new.
- **Mark the oldest account in a migration.** Rejected. It is a guess. The oldest account under `open` may be a stranger, and a wrong guess hands venue creation to the wrong person. The task needs no migration and the operator knows who the owner is.
- **Fall back to the oldest account when nobody is marked.** Rejected for the same reason, and because it makes the rule depend on a heuristic that changes when accounts are deleted.
- **A new setting such as `VENUE_CREATION=owner`.** Rejected. A fourth knob for what `SIGNUP` already states. An operator who closed sign-up wants this limit, and a single variable keeps the safe default.
- **Return `forbidden`.** Rejected. It is already the answer for a missing role, and a client cannot tell it from "ask your venue admin".
- **Return `venue_not_found` or hide the route.** Rejected. The route exists and the account is authenticated, so hiding it helps nobody and breaks the staff app's reading of errors.
- **Let a key with a special role create venues for the operator.** Rejected. It is a new bootstrap channel, and keys are tied to existing venues.
- **Block venue creation in the database.** Rejected. It cannot see the mode, and a trigger on `venues` would also block seeds and tests that create venues directly.
