# Publication decisions

Date: 2026-11-08

## Status

Accepted.

## Decisions

- License: Apache-2.0.
- History: keep a clean, reviewable history that excludes third-party and internal material.
- Local agent tooling: `.opencode/` and `opencode.json` stay out of the repository.
- Reference research: analyze authorized reference products with synthetic data. Keep notes private. Do not copy third-party documentation, schemas, or code into the repository.
- Status: pre-alpha, design phase.

## Consequences

- The Apache-2.0 license covers the project's own files.
- The repository starts with the project's own documentation, not with third-party material.
- Contributors can read the license and the contribution process before the engine exists.
- The first code milestone is the contract, not the engine.

## Alternatives considered

- Adopt a license later. Rejected because it blocks contributions.
- Publish the full development history as-is. Rejected in favor of a clean, reviewable history.
- Keep the project private until the engine runs. Rejected because the community cannot help with the design phase.
