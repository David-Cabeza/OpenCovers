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

The contract is defined in `docs/contract/`. The engine skeleton runs and has CI. Code flags are open.

## Development setup

You need Node.js 22 or newer.

```
npm install
npm run typecheck
npm test
npm run dev
```

`npm run dev` starts a local Worker with the Durable Objects. `npm test` runs the tests inside the Workers runtime. `npm run typecheck` checks both the source and the tests.

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
