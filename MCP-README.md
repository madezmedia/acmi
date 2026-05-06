# @madezmedia/acmi-mcp

> **Persistent agent memory in any MCP host.** A drop-in Model Context Protocol server that gives Claude Desktop, Cursor, Cline, Windsurf — or any MCP-compatible AI tool — direct read/write access to **ACMI** (Agentic Context Management Infrastructure) on Upstash Redis.

[![npm](https://img.shields.io/npm/v/@madezmedia/acmi-mcp.svg)](https://www.npmjs.com/package/@madezmedia/acmi-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org)

ACMI is the **three-key protocol for agent memory**: every entity has a Profile (who/what), Signals (current state), and a Timeline (event log). This MCP package exposes 16 tools that wrap that model so any LLM tool can persist, retrieve, and coordinate across sessions and agents — no SQL joins, no schema migrations, no token bloat.

---

## Why this exists

LLM tools are stateless by default. Every conversation starts cold; agents can't remember decisions, share context with siblings, or pick up where they left off. ACMI fixes that with a single Redis-backed primitive (Profile + Signals + Timeline per entity), and this package makes it accessible to any MCP host with one config line.

**You get:**
- Cross-session memory that survives restarts, model swaps, and tool changes.
- Multi-agent coordination — Claude, Cursor, Cline, your custom agents all reading/writing the same store.
- Real-time event timelines with correlation tracking, so you can answer "what did Agent X decide about Project Y last Tuesday?" in one query.
- 16 tools covering profiles, signals, events, work items, multi-stream views, agent bootstrap, thread engagement, deletion, and rollups.

---

## Install

```bash
npm install -g @madezmedia/acmi-mcp
```

Set Upstash credentials:

```bash
export UPSTASH_REDIS_REST_URL="https://your-instance.upstash.io"
export UPSTASH_REDIS_REST_TOKEN="your-token"
```

(Don't have Upstash yet? Sign up free at [upstash.com](https://upstash.com) — REST API only, no Redis client needed.)

---

## Configure your MCP host

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "acmi": {
      "command": "acmi-mcp",
      "env": {
        "UPSTASH_REDIS_REST_URL": "https://your-instance.upstash.io",
        "UPSTASH_REDIS_REST_TOKEN": "your-token"
      }
    }
  }
}
```

Restart Claude Desktop. You'll see 16 ACMI tools in the tools list.

### Cursor

In Cursor settings, MCP section, add:

```json
{
  "acmi": {
    "command": "acmi-mcp",
    "env": {
      "UPSTASH_REDIS_REST_URL": "...",
      "UPSTASH_REDIS_REST_TOKEN": "..."
    }
  }
}
```

### Cline / Windsurf

Same shape — `command: "acmi-mcp"` plus the two env vars. The package installs `acmi-mcp` globally so it's on PATH.

---

## The 16 tools

| Tool | What it does |
|---|---|
| `acmi_profile` | Create or update an entity profile (who/what — stable identity & metadata) |
| `acmi_signal` | Update an entity's signals (current AI state — mutable, frequent) |
| `acmi_event` | Log a timeline event (the workhorse — timestamped, correlation-tracked) |
| `acmi_get` | Fetch an entity's full context bundle (profile + signals + recent timeline) |
| `acmi_list` | List all entities in a namespace |
| `acmi_work_create` | Create a work item (cross-session project, task, or idea) |
| `acmi_work_event` | Log progress on a work item |
| `acmi_work_signal` | Update signals on a work item (progress, blockers, metrics) |
| `acmi_work_get` | Read a work item's full context (profile + signals + timeline + sessions) |
| `acmi_work_list` | List all work item IDs |
| `acmi_cat` | Multi-stream merge view — combine timelines from multiple entities, sorted by time |
| `acmi_spawn` | Log an agent session spawn (when an agent starts a new run) |
| `acmi_bootstrap` | One-shot agent context bundle — everything a fresh session needs |
| `acmi_active` | Track agent-thread engagement (add/remove/list active threads) |
| `acmi_rollup_set` | Set a rollup snapshot for an agent (paired with `acmi_bootstrap`) |
| `acmi_delete` | Delete an ACMI key — protected paths refused, dry-run by default, requires `confirm=true` |

---

## Built-in safety

- **`validateKeySegments`** — every tool that builds a key validates input segments aren't `undefined`/`null`/empty/colon-containing/oversize. Prevents the entire bug class where unsubstituted variables or status messages leak into key names.
- **`validateJson`** — every tool that takes a JSON string argument validates it's parseable before storing. Catches "I forgot to JSON.stringify()" at the boundary.
- **`isProtectedKey`** — keys under `acmi:registry:*` and `acmi:notion-sync:*` cannot be mutated or deleted via this MCP server. Read-only by policy.
- **`safeTool`** wrapper — every tool returns a structured `{ok: false, error, tool}` payload on throw, never an opaque MCP transport error. Easier to debug from the LLM side.
- **`acmi_delete` is dry-run by default** — pass `confirm: true` to actually DELETE; otherwise returns a preview (key existence, type) so you can review.

---

## Example: agent bootstrap in two MCP calls

```js
// 1. Fresh agent session — pull everything you need:
acmi_bootstrap({ agentId: "claude-engineer" })
// Returns: profile, signals, active_context, rollup_latest, timeline_recent (last 20), recent_spawns (last 5)

// 2. Log that you started:
acmi_spawn({ agentId: "claude-engineer", sessionId: "2026-05-06-A", modelId: "claude-opus-4-7" })
```

The agent now has full context and the fleet sees it spawned. That's it — no DB schema, no ORM, no joins.

---

## ACMI protocol

This MCP package is one entry point to ACMI. The protocol itself is documented at:

- **Spec:** [github.com/madezmedia/acmi](https://github.com/madezmedia/acmi) (`SPEC.md`, `ROADMAP.md`)
- **Main JS package:** [`@madezmedia/acmi`](https://www.npmjs.com/package/@madezmedia/acmi) — direct ACMI client (no MCP layer)
- **Product page:** [v3-ten-beta.vercel.app/acmi](https://v3-ten-beta.vercel.app/acmi)

ACMI is also exposed via:
- CLI: `npx @madezmedia/acmi <command>`
- HTTP: roadmap item — REST gateway for non-Redis hosts
- Direct Redis: REST API (Upstash) — what this MCP wraps

---

## License

MIT © Michael Shaw / Mad EZ Media Partners
