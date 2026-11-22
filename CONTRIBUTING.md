# Contributing to OpenCovers

Thanks for helping. This guide explains what to work on, how to claim a flag, and what a good pull request looks like.

## Before you start

Read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [GOVERNANCE.md](GOVERNANCE.md), and [ROADMAP.md](ROADMAP.md).

## Work through flags

A flag is a scoped task that one person can claim. Every flag has a what, a why, a scope, acceptance criteria, dependencies, and a size.

1. Find an open issue with the `good first issue` label for a first task, or the `flag` label for a scoped task.
2. Comment that you want to claim it.
3. Wait for a maintainer to assign it to you.
4. Open a draft pull request within seven days. If you need more time, say so in the issue.

If a flag is too large, ask a maintainer to split it. Do not expand a flag into a second feature.

## Sizes

| Size | Meaning |
| --- | --- |
| S | One session. A small document, test, or fix. |
| M | A few days. A contract section, a route, or a module. |
| L | A week or more. Split it before you start. |

## Current phase

The contract is defined in `docs/contract/`. The engine runs against PostgreSQL with CI. Code flags are opened as the work is scoped, so there may be none open when you look. If you want to help and see nothing to claim, open an issue to propose one.

## Development setup

You need Node.js 22.9 or newer, pnpm, and Docker.

```
docker compose up -d
pnpm install
pnpm db:migrate
pnpm test
pnpm dev
```

`docker compose up -d` starts a local PostgreSQL with two databases: `opencovers` (dev) and `opencovers_test` (tests). `pnpm db:migrate` applies the schema to the dev database. `pnpm test` runs the integration tests against `opencovers_test`, so it never wipes your dev data. `pnpm dev` starts the API on port 3000, the staff app on port 5173 and the site on port 5174. With `pnpm dev` running, `pnpm demo:seed` loads an invented demo venue with reservations, a waitlist, a second team member and keys (local only; details in the README).

The API lives in `apps/api`. The staff frontend lives in `apps/web`; run `pnpm --filter @opencovers/web dev` to start only the frontend.

## Other parts to know

- **Widget.** The guest booking widget lives in `apps/widget`. The API serves its build at `/w/{bookingKey}`, and in development the staff app's server proxies that path, so it opens at `http://localhost:5173/w/{bookingKey}`.
- **Staff app languages.** The staff app speaks Spanish and English. Its texts live in one catalog per area under `apps/web/src/i18n/`; see the [README there](apps/web/src/i18n/README.md) before you add a string.
- **Demo template.** A feature that adds a screen or a setting also adds it to the demo template, `apps/api/src/demo/template.ts`, so the hosted demo shows it ([ADR-0022](docs/adr/0022-hosted-demo-sandbox.md)).
- **Agent-authored pull requests.** If an AI agent wrote the pull request, tick the "Agent-authored" box in the pull request template. See [docs/collaboration-security.md](docs/collaboration-security.md).

## Pull requests

- One flag per pull request. Link the flag in the description.
- Keep the diff small. Move unrelated cleanups to their own flag.
- Add or update tests when behavior changes.
- Update the documentation when the contract, a command, or a workflow changes.
- Include evidence. A command, a test result, or a screenshot.
- Do not include confidential third-party documentation, API keys, guest data, or proprietary code.

Use Conventional Commits for commit messages: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.

## Architecture decisions

Record a decision that changes the architecture, the contract, or a security property in `docs/adr/`. Start from [docs/adr/TEMPLATE.md](docs/adr/TEMPLATE.md). Open an issue before you write a large ADR.

## Security

Do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md).

[docs/collaboration-security.md](docs/collaboration-security.md) sets the rules for contributions, dependencies and AI agents in this repository. It lists what gets closed on sight, what a new dependency must justify, and which paths need extra review. Read it before you add a dependency or touch `.github/`.

To report spam or a promotional issue, use "Report content" in the issue or comment menu, which sends it to GitHub, and do not reply to it. The maintainer closes spam without discussion.
