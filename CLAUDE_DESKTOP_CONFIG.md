# ACMI MCP Server — Configuration Guide

## Adding to Claude Desktop

Edit your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add this entry to `mcpServers`:

```json
{
  "mcpServers": {
    "acmi": {
      "command": "node",
      "args": ["/Users/michaelshaw/.openclaw/skills/acmi/mcp-server.mjs"],
      "env": {
        "UPSTASH_REDIS_REST_URL": "your-upstash-url-here",
        "UPSTASH_REDIS_REST_TOKEN": "your-upstash-token-here"
      }
    }
  }
}
```

Restart Claude Desktop after editing.

## Adding to Cursor

Add to your Cursor MCP settings (`Settings → MCP`):

```json
{
  "mcpServers": {
    "acmi": {
      "command": "node",
      "args": ["/Users/michaelshaw/.openclaw/skills/acmi/mcp-server.mjs"],
      "env": {
        "UPSTASH_REDIS_REST_URL": "your-upstash-url-here",
        "UPSTASH_REDIS_REST_TOKEN": "your-upstash-token-here"
      }
    }
  }
}
```

## Adding to Cline / Windsurf / Other MCP Clients

Same pattern — use stdio transport with:
- **command:** `node`
- **args:** `["/path/to/.openclaw/skills/acmi/mcp-server.mjs"]`
- **env:** `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`

## Using .env file

The ACMI skill directory already has a `.env` file. If your MCP client supports `.env` loading, you can source it:

```bash
source /Users/michaelshaw/.openclaw/skills/acmi/.env
```

Or set the env vars in your shell profile.

## Available Tools (14)

| Tool | Description |
|------|-------------|
| `acmi_profile` | Create/update entity profile |
| `acmi_signal` | Update AI signals for an entity |
| `acmi_event` | Log timeline event (the workhorse) |
| `acmi_get` | Fetch full entity context |
| `acmi_list` | List entities in a namespace |
| `acmi_work_create` | Create a work item |
| `acmi_work_event` | Log work item progress |
| `acmi_work_signal` | Update work item signals |
| `acmi_work_get` | Read work item context |
| `acmi_work_list` | List all work items |
| `acmi_cat` | Multi-stream event merge view |
| `acmi_spawn` | Log agent session start |
| `acmi_bootstrap` | One-shot agent context bundle |
| `acmi_active` | Track agent thread engagement |

## Quick Test

```bash
# Set env vars first
export UPSTASH_REDIS_REST_URL="..."
export UPSTASH_REDIS_REST_TOKEN="..."

# Run the server (it speaks MCP over stdio)
node ~/.openclaw/skills/acmi/mcp-server.mjs
```

## Troubleshooting

- **"Missing UPSTASH_REDIS_REST_URL"** — Set the env vars in the MCP client config
- **Server not showing tools** — Restart the MCP client after config changes
- **Permission denied** — Ensure `mcp-server.mjs` is executable: `chmod +x mcp-server.mjs`
