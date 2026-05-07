# ACMI — Agentic Context Management Infrastructure

> Persistent agent memory protocol. Three keys per entity: Profile, Signals, Timeline.

## When to Use

Use this skill when you need to:
- Read or write agent profiles, signals, or timeline events
- Create or manage work items with status tracking
- Post to coordination threads or read thread history
- Request or respond to HITL (human-in-the-loop) approvals
- Bootstrap new entities into the ACMI system
- Check fleet health, engagement metrics, or agent activity

## Quick Reference

### CLI (via `node acmi.mjs`)

```bash
# Bootstrap a new agent
node acmi.mjs bootstrap agent <id> --role "coding assistant" --model "claude-4"

# Read entity data
node acmi.mjs get agent <id> [--section profile|signals|timeline|all]

# Update entity profile or signals
node acmi.mjs update agent <id> --section profile --json '{"status":"active"}'

# Post a timeline event
node acmi.mjs event agent <id> --kind "work-started" --summary "Starting task X"

# Thread operations
node acmi.mjs thread post <thread-id> --kind "coordination" --summary "Message"
node acmi.mjs get thread <thread-id>

# Work items
node acmi.mjs work create <work-id> --title "Build dashboard" --status "DRAFT"
node acmi.mjs work update <work-id> --status "READY"
node acmi.mjs get work <work-id>
```

### MCP Server (16 tools)

The ACMI MCP server exposes these tools to any MCP-compatible host:

| Tool | Purpose |
|------|---------|
| `acmi_bootstrap` | Initialize entity (Profile + Signals + Timeline) |
| `acmi_read` | Read entity data (profile/signals/timeline/all) |
| `acmi_update` | Update entity profile or signals |
| `acmi_event` | Post timeline event |
| `acmi_work_create` | Create work item |
| `acmi_work_update` | Update work item status |
| `acmi_work_read` | Read work item data |
| `acmi_thread_post` | Post to coordination thread |
| `acmi_thread_read` | Read thread events |
| `acmi_hitl_request` | Request HITL approval |
| `acmi_hitl_respond` | Respond to HITL request |
| `acmi_bootstrap_batch` | Bootstrap multiple entities |
| `acmi_multi_read` | Read across multiple entities |
| `acmi_delete` | Delete entity data (protected key guards) |
| `acmi_rollup_set` | Set timeline rollup/summary |
| `acmi_engagement` | Track thread engagement |

### npm Packages

- **SDK:** `@madezmedia/acmi` — TypeScript SDK with in-memory, Redis, and Upstash adapters
- **MCP:** `@madezmedia/acmi-mcp` — MCP server binary (`acmi-mcp`)

## Key Patterns

### Event Format (v1.1)
Every event requires: `ts`, `source`, `kind`, `correlationId`, `summary`

```json
{
  "ts": 1745280000000,
  "source": "agent:bentley",
  "kind": "work-completed",
  "correlationId": "task-xyz-001",
  "summary": "Completed ACMI architecture document",
  "payload": {}
}
```

### Three-Key Model
- **Profile** (`acmi:{ns}:{id}:profile`) — WHO the entity is (role, model, config)
- **Signals** (`acmi:{ns}:{id}:signals`) — CURRENT state (status, health, quota)
- **Timeline** (`acmi:{ns}:{id}:timeline`) — EVENT LOG (chronological ZSET)

### Namespaces
- `agent` — AI agents (bentley, claude-engineer, etc.)
- `thread` — Coordination threads (agent-coordination, team-roundtable)
- `work` — Work items (tasks, projects)
- `tenant` — Multi-tenant isolation (`acmi:tenant:<id>:*`)
- `registry` — Fleet-wide registries (agent list, config)

## Environment

Requires `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to be set (stored in `.env` in this skill directory).

## Files

- `acmi.mjs` — CLI interface
- `mcp-server.mjs` — MCP server (stdio transport)
- `mcp-server-helpers.mjs` — Validation utilities for MCP
- `acmi-backup.mjs` — Backup/restore tool
- `drift-remediator.mjs` — Detect and fix ACMI drift
- `handoff-watcher.mjs` — Monitor handoff events
- `hitl-sdk.mjs` — HITL approval workflow SDK
- `standup-brief.mjs` — Generate standup briefings
- `cost-ledger.mjs` — Track token costs
- `SPEC.md` — Full protocol specification
- `MANIFESTO.md` — ACMI philosophy and principles
- `ROADMAP.md` — Version roadmap
- `CLAUDE_DESKTOP_CONFIG.md` — Claude Desktop setup guide
