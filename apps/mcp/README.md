# OpenCovers MCP server

An MCP server that exposes the OpenCovers reservation API to MCP hosts such as Claude Desktop and Cursor. It is a thin wrapper over the HTTP API: each tool maps to one API operation, and the server is scoped to a single agent key.

## Run

From npm:

```bash
OPENCOVERS_API_KEY=... npx -y @opencovers/mcp
```

From a clone of the repository:

```bash
OPENCOVERS_API_KEY=... pnpm --filter @opencovers/mcp dev
```

Environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `OPENCOVERS_API_KEY` | (required) | The agent key the server authenticates with. |
| `OPENCOVERS_BASE_URL` | `http://localhost:3000` | The API base URL. |

The key determines which venues the server can see and which tools it may call. A read-only key is rejected on writes.

Create and revoke keys from the staff app under **Setup → API keys** (venue admins only).

## Configure a host

Claude Desktop (`claude_desktop_config.json`), using the npm package:

```json
{
  "mcpServers": {
    "opencovers": {
      "command": "npx",
      "args": ["-y", "@opencovers/mcp"],
      "env": {
        "OPENCOVERS_API_KEY": "your-key",
        "OPENCOVERS_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

Or from a clone of the repository:

```json
{
  "mcpServers": {
    "opencovers": {
      "command": "pnpm",
      "args": ["--filter", "@opencovers/mcp", "dev"],
      "cwd": "/path/to/OpenCovers",
      "env": {
        "OPENCOVERS_API_KEY": "your-key",
        "OPENCOVERS_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

## Tools

The server has 18 tools. See [docs/contract/mcp.md](../../docs/contract/mcp.md) for the full catalog, with the API route, hints and arguments of each.

- Reservations (12): `reservation.availability`, `reservation.agenda`, `reservation.list`, `reservation.search`, `reservation.get`, `reservation.create`, `reservation.walk_in`, `reservation.modify`, `reservation.cancel`, `reservation.status`, `reservation.events` and `reservation.erasure` (admin key only).
- Waitlist (4): `waitlist.list`, `waitlist.add`, `waitlist.seat` and `waitlist.cancel`.
- Venue (2): `venue.getConfig` and `venue.setConfig`.

Every write that books, changes a booking or touches the waitlist takes an optional `idempotencyKey`. To retry after a timeout or an error, send the same key as the first call, and the engine returns the first result instead of writing twice. Without a key each call is a new write.

## Publishing

`pnpm --filter @opencovers/mcp build` compiles to `dist/`, and `prepack` does it automatically. The package is published to npm as `@opencovers/mcp` and listed in the official MCP registry through `server.json` (its `name` must match `mcpName` in `package.json`).

## Releasing the MCP package

Only the owner publishes, with a passkey. A release PR changes the version and `CHANGELOG.md`; it never publishes. Before publishing, from a clean checkout of `main`:

1. Run `pnpm --filter @opencovers/mcp test` and `pnpm --filter @opencovers/mcp typecheck`. The version test fails if `package.json`, both fields of `server.json` and `VERSION` in `src/index.ts` differ.
2. Run `pnpm --filter @opencovers/mcp build`, then `grep -c "X-OpenCovers-Channel" dist/client.js` and `grep -c "date must be YYYY-MM-DD" dist/index.js`. Both must be above 0.
3. Run `npm pack --dry-run` in `apps/mcp` and check that the list holds only `dist/`, `README.md`, `LICENSE` and `package.json`.
4. Run `npm view @opencovers/mcp version` to confirm the version you are about to publish is new.
5. Publish: `npm publish`, then `mcp-publisher publish` from `apps/mcp`.
6. Create the GitHub release with notes copied from `CHANGELOG.md`.
