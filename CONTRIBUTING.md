# Contributing to OpenCovers

Thanks for helping. This guide explains what to work on, how to claim a flag, and what a good pull request looks like.

## Before you start

Read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [GOVERNANCE.md](GOVERNANCE.md), and [ROADMAP.md](ROADMAP.md).

## Work through flags

A flag is a scoped task that one person can claim. Every flag has a what, a why, a scope, acceptance criteria, dependencies, and a size.

1. Find an open issue with the `flag` label.
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

The contract is defined in `docs/contract/`. The engine runs against PostgreSQL with CI. Code flags are open.

## Development setup

You need Node.js 22 or newer, pnpm, and Docker.

```
docker compose up -d
pnpm install
pnpm db:migrate
pnpm test
pnpm dev
```

`docker compose up -d` starts a local PostgreSQL. `pnpm db:migrate` applies the schema. `pnpm test` runs the integration tests against that database. `pnpm dev` starts both the API on port 3000 and the staff app on port 5173.

The API lives in `apps/api`. The staff frontend lives in `apps/web`; run `pnpm --filter @opencovers/web dev` to start only the frontend.

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
