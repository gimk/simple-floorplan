# Simple Floorplan MCP Stdio Wrapper

Zero-dependency Node.js (`>= 18`) stdio bridge for the Simple Floorplan MCP Streamable HTTP endpoint (`POST /api/mcp`).

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `SFP_URL` | `http://localhost:8788/api/mcp` | Full URL of the Simple Floorplan MCP endpoint. |
| `SFP_TOKEN` | _(empty)_ | Optional Bearer API token (`Authorization: Bearer <token>`). |
| `SFP_PASSCODE` | _(empty)_ | Optional legacy passcode (`x-passcode: <passcode>`). |

## Claude Code

### Remote Streamable HTTP (recommended when deployed)

```bash
claude mcp add --transport http simple-floorplan https://your-app.pages.dev/api/mcp \
  --header "Authorization: Bearer sfp_your_token"
```

### Local stdio wrapper

```bash
claude mcp add simple-floorplan \
  -e SFP_URL=http://localhost:8788/api/mcp \
  -e SFP_TOKEN=sfp_your_token \
  -- node /absolute/path/to/simple-floorplan/mcp-stdio/index.mjs
```

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "simple-floorplan": {
      "command": "node",
      "args": ["/absolute/path/to/simple-floorplan/mcp-stdio/index.mjs"],
      "env": {
        "SFP_URL": "https://your-app.pages.dev/api/mcp",
        "SFP_TOKEN": "sfp_your_token"
      }
    }
  }
}
```

## Scopes, event log, and `get_events`

The stdio bridge just forwards your credentials, so scoped tokens work the same as over HTTP:

- `POST /api/mcp` itself requires the `read` scope; each `tools/call` is then checked per tool
  (read-only tools need `read`, `set_measurement` needs `measure`, `run_commands` is checked per
  command type, other write tools need `edit`). A missing scope returns a tool error
  (`isError: true`, `structuredContent.error.requiredScope`).
- Every successful MCP write appends one event per command to the project event log
  (`kind: "command"`, actor = token name); `create_project` logs a `project_create` event.
- Read the log with the MCP tool `get_events` (`{ projectId, since?, limit? }`), the resource
  `floorplan://projects/{id}/events.json`, or `GET /api/projects/{id}/events`.

## Direct Streamable HTTP test (`curl`)

```bash
curl -sS -X POST http://localhost:8788/api/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sfp_your_token" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'
```
