# OpenCovers MCP server

An MCP server that exposes the OpenCovers reservation API to MCP hosts such as Claude Desktop and Cursor. It is a thin wrapper over the HTTP API: each tool maps to one API operation, and the server is scoped to a single agent key.

## Run

From npm (once published):

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

See [docs/contract/mcp.md](../../docs/contract/mcp.md) for the full catalog: availability, agenda, list, search, get, create, modify, cancel, status, events, erasure (admin key only), and venue config.

Every write that books, changes a booking or touches the waitlist takes an optional `idempotencyKey`. To retry after a timeout or an error, send the same key as the first call, and the engine returns the first result instead of writing twice. Without a key each call is a new write.

## Publishing

`pnpm --filter @opencovers/mcp build` compiles to `dist/`, and `prepack` does it automatically. The package is published to npm as `@opencovers/mcp` and listed in the official MCP registry through `server.json` (its `name` must match `mcpName` in `package.json`).
