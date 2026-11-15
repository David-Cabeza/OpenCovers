# ADR-0005: Sign-up control

- Status: Proposed
- Date: 2026-11-15
- Deciders: David Cabeza

## Context

Email and password sign-up is always on. `apps/api/src/lib/auth.ts` sets `emailAndPassword: { enabled: true }` and nothing else, so `POST /api/auth/sign-up/email` accepts any visitor. `POST /v1/venues` accepts any signed-in user and makes them admin of the new venue. Anyone who reaches the staff app can therefore create an account and a venue on someone else's instance. Venue data stays isolated, but the instance is not private. The hardening guide lists this as known gap 1 and tells operators to restrict access at the network layer.

The goal is that nobody who reaches the staff app can create an account and a venue on a self-hosted instance, while `pnpm dev` keeps working with no environment.

What exists today:

- **Staff accounts.** The Better Auth `user`, `session`, `account` and `verification` tables. Sign-up is the only way an account is created.
- **Memberships.** The `venue_memberships` table links a user to a venue with the role `read`, `write` or `admin`. The only code path that inserts a membership for a normal request is `createVenue` in `apps/api/src/lib/venue.ts`, which makes the creator admin. `addMembership` in `apps/api/src/lib/memberships.ts` can add any user to any venue, but only tests call it. No HTTP route and no screen invites or adds staff.
- **Agents.** API keys are separate from accounts and are created by a venue admin. Sign-up control does not affect them.
- **Deployments.** `compose.prod.yaml` runs the API behind Caddy on one origin. Nothing is deployed from this repository, but forks will deploy it.

Two properties bind the design. The API must enforce the rule, because the staff app is only one client of `/api/auth/*`. And "the first account can sign up, then it closes" must hold when two first sign-ups arrive at the same moment.

## Decision drivers

- **Safe production default.** A fork that copies `.env.prod.example` and changes nothing else must not end up open.
- **Frictionless local development.** `pnpm dev` and `pnpm test` need no environment.
- **Race safety.** Two simultaneous first sign-ups yield one account. The guarantee comes from the database, not from a read followed by a write in application code.
- **Existing instances.** An upgrade must not open an instance that is closed in practice, and must not lock out people who already have accounts.
- **Smallest set of modes.** Each mode needs a distinct operator story.
- **Honesty about staff.** There is no way to add staff today. The decision must say so and not pretend `closed` has a companion.

## Decision

A variable `SIGNUP` controls account creation. It has three values.

| Value | Meaning |
| --- | --- |
| `open` | Anyone can sign up. This is today's behavior. |
| `first-user` | Sign-up works only while the instance has no account. The first account is created, and every later attempt is refused. |
| `closed` | No sign-up through the API. |

1. **Default.** An unset or empty `SIGNUP` means `open`, so local development needs no environment. `compose.prod.yaml` passes `SIGNUP: ${SIGNUP:-first-user}`, and `.env.prod.example` lists `SIGNUP=first-user`. A fork that does nothing gets a private instance whose first visitor becomes the owner.
2. **Unknown values fail.** Any other value, including a typo such as `first_user`, stops the API at startup with a message that names the allowed values. An unrecognized value never falls back to `open`.
3. **Enforcement.** A Better Auth `databaseHooks.user.create.before` hook decides. It runs for every way an account can be created, not only email sign-up, so a provider added later is covered. A refused attempt returns `403` with the code `SIGNUP_CLOSED` and the message "Sign-up is closed on this instance." The staff app already shows `error.message`, so the sign-up form shows it with no change.
4. **First-user race safety.** The `user` table gets a column `first_signup boolean not null default false` and a partial unique index on `first_signup` where it is true. In `first-user` mode the hook refuses when any account exists. Otherwise it marks the new row `first_signup = true`. Two concurrent first sign-ups both pass the check, both try to insert a marked row, and PostgreSQL lets one commit. The other fails on the unique index and no account is created. The mark is written in the same statement as the account, so a failed insert leaves nothing behind and the instance stays claimable. The client cannot set the column. It is not an input field and is not returned.
5. **Upgrade.** Existing rows get `first_signup = false`. An existing instance with accounts is therefore already closed under `first-user`, with no data step. The default for `compose.prod.yaml` changes from open to `first-user`, so an existing production stack closes to new sign-ups on its next `up`. Operators who relied on open sign-up set `SIGNUP=open` in `.env.prod`. The release notes and `docs/deploy.md` say so. An existing instance with no accounts yet stays claimable by its first visitor.
6. **Deleting accounts.** `first-user` tests whether any account exists now. If the only account is removed, the instance is empty again and the next visitor can claim it. No code path deletes accounts today, so this only matters for operators who edit the database.
7. **Staff.** There is no way to add staff through the product today. In `first-user` mode the instance has one account, the owner, who owns every venue they create. To add a second person, an operator sets `SIGNUP=open`, restarts the API, lets the person sign up, sets the value back, and then inserts a `venue_memberships` row for that user in SQL. That is a poor path and this ADR does not claim otherwise. A staff invitation flow is the follow-up, and it needs its own ADR. It would create accounts through the same hook, so it will need an explicit allowance in the rule, such as an invitation token checked by the hook.
8. **Scope.** This ADR controls who gets an account. It does not rate limit sign-up, add email verification, or restrict `POST /v1/venues` for existing accounts. Known gap 2 in the hardening guide still stands. The web app's sign-up tab stays visible and shows the server's refusal. Hiding it needs a public status endpoint and is deferred.

The contract is unchanged. Auth lives under `/api/auth`, outside `docs/contract/`.

## Consequences

**Easier.** A default production stack is private without a proxy rule. The rule is one variable and three words to learn. The hardening guide can drop known gap 1 and its checklist item, which a follow-up edit to `docs/hardening.md` must do after this lands.

**Harder.** The default for the production stack changes, so a deployment that expected open sign-up must opt back in. A `first-user` instance holds one account until a staff flow exists, so a second person needs the SQL step above. The `user` table carries a column that exists only for the race guarantee, and a migration adds it.

**Accepted.** In `first-user` mode the first visitor to a new instance becomes the owner. An operator who exposes a fresh instance to the internet before signing up themselves can lose it to a stranger. The deploy guide tells them to create the account before they publish the address. The staff app shows a sign-up tab that always fails on a closed instance. The race loser in `first-user` mode gets a generic failure from the database error, not the `SIGNUP_CLOSED` message.

## Alternatives considered

- **A boolean `SIGNUP_ENABLED`.** Rejected. It cannot express "the first account can sign up", and a closed production stack could not be claimed at all, with no staff flow to add the owner.
- **Only `open` and `closed`, with the owner created by a command.** Rejected for now. It is safer than `first-user`, but it adds a CLI and a documented bootstrap step to a stack that today starts with one command.
- **A fourth value for invite-only.** Rejected. There is no invite flow to point it at. Adding it now would be a value that behaves like `closed`.
- **Check-then-insert in the hook.** Rejected. Two requests can both see no account and both insert, which breaks the race requirement.
- **A transaction with an advisory lock around the check.** Rejected. The hook runs before the insert and cannot hold a lock through the commit, so it would need to wrap Better Auth's own transaction.
- **A separate claim table.** Rejected. A claim row written before the account can outlive a failed account insert and leave an empty instance closed for good. A column on the account row commits or fails with the account.
- **A static unique index on `user`.** Rejected. It would cap every instance at one account, including `open` ones.
- **Network-layer restriction only.** This is the status quo in the hardening guide. It stays valid as defense in depth, but it asks every operator to write proxy rules and does not protect a stack run as documented.
