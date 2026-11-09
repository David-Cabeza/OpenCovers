# OpenCovers MCP server

An MCP server that exposes the OpenCovers reservation API to MCP hosts such as Claude Desktop and Cursor. It is a thin wrapper over the HTTP API: each tool maps to one API operation, and the server is scoped to a single agent key.

## Run

```bash
OPENCOVERS_API_KEY=... pnpm --filter @opencovers/mcp dev
```

Environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `OPENCOVERS_API_KEY` | (required) | The agent key the server authenticates with. |
| `OPENCOVERS_BASE_URL` | `http://localhost:3000` | The API base URL. |

The key determines which venues the server can see and which tools it may call. A read-only key is rejected on writes.

## Configure a host

Claude Desktop (`claude_desktop_config.json`):

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

See [docs/contract/mcp.md](../../docs/contract/mcp.md) for the full catalog: availability, agenda, list, search, get, create, modify, cancel, status, events, erasure, and venue config.
