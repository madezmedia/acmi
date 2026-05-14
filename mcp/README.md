<p align="center">
  <img src="https://v3b.fal.media/files/b/0a98cb49/ns7vLT2QV8YBH1LTtzSXr.jpg" alt="ACMI Protocol Hero" width="800">
</p>

# @madezmedia/acmi-mcp

> **Persistent agent memory in any MCP host.** A drop-in Model Context Protocol server that gives Claude Desktop, Cursor, Cline, Windsurf — or any MCP-compatible AI tool — direct read/write access to **ACMI** (Agentic Context Memory Interface) on Upstash Redis.

[![npm](https://img.shields.io/npm/v/@madezmedia/acmi-mcp.svg)](https://www.npmjs.com/package/@madezmedia/acmi-mcp)
[![Protocol v1.3](https://img.shields.io/badge/Protocol-v1.3-2d4a3e)](https://github.com/madezmedia/acmi/blob/main/SPEC.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Tools: 16](https://img.shields.io/badge/Tools-16-2d4a3e)](#the-16-tools)

ACMI is the **three-key protocol for agent memory**: every entity stores exactly three things an LLM needs to make decisions — a **Profile** (who/what), **Signals** (current state), and a **Timeline** (event log). This MCP package exposes 16 tools that wrap that model so any LLM tool can persist, retrieve, and coordinate across sessions, agents, and surfaces — no SQL joins, no schema migrations, no token bloat.

```
Profile  →  who   (identity, preferences — stable)
Signals  →  now   (current state — what's open, what's pending)
Timeline →  then  (append-only event log of everything that happened)
```

That's it. No vector index. No knowledge graph. No fact-extraction pass. Three keys per entity, stored in the simplest data store on earth.

---

## Why this exists

LLM tools are stateless by default. Every conversation starts cold; agents can't remember decisions, share context with siblings, or pick up where they left off. ACMI fixes that with a single Redis-backed primitive (Profile + Signals + Timeline per entity), and this package makes it accessible to any MCP host with one config line.

**You get:**
- **Cross-session memory** that survives restarts, model swaps, and tool changes.
- **Multi-agent coordination** — Claude, Cursor, Cline, your custom agents all reading/writing the same store.
- **Real-time event timelines** with correlation tracking, so you can answer *"what did Agent X decide about Project Y last Tuesday?"* in one query.
- **Work item tracking** with separate profile/signal/timeline keys per work item (deals, tickets, projects, sprints).
- **Thread-based fan-out** so agents broadcasting a `coord-broadcast` event reach every subscriber on `thread:agent-coordination` without N×M wiring.
- **Built-in safety guards** that refuse to mutate protected registry keys, reject malformed segments, and enforce dry-run-then-confirm on every destructive operation.

---

## Install

### Global install (recommended for daily use)

```bash
npm install -g @madezmedia/acmi-mcp
```

Then point your MCP host at the `acmi-mcp` binary (config snippets below).

### Zero-install via npx

```bash
npx -y @madezmedia/acmi-mcp
```

Useful for one-off testing or for hosts (like Claude Desktop / Smithery) that prefer ephemeral execution.

### Requirements

- Node.js 18+
- An Upstash Redis REST endpoint + token (free tier works fine — [upstash.com](https://upstash.com))

---

## Quick start

### 1. Get Upstash credentials

Create a free Redis database at [console.upstash.com](https://console.upstash.com). Copy:
- `UPSTASH_REDIS_REST_URL` (e.g. `https://yourthing-12345.upstash.io`)
- `UPSTASH_REDIS_REST_TOKEN` (long token starting with `gQAAAAAAAZ...`)

### 2. Add to your MCP host

#### Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "acmi": {
      "command": "npx",
      "args": ["-y", "@madezmedia/acmi-mcp"],
      "env": {
        "UPSTASH_REDIS_REST_URL": "https://yourthing-12345.upstash.io",
        "UPSTASH_REDIS_REST_TOKEN": "gQAAAAAAAZ..."
      }
    }
  }
}
```

Restart Claude Desktop. You should now see 16 ACMI tools available.

#### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "acmi": {
      "command": "npx",
      "args": ["-y", "@madezmedia/acmi-mcp"],
      "env": {
        "UPSTASH_REDIS_REST_URL": "https://yourthing-12345.upstash.io",
        "UPSTASH_REDIS_REST_TOKEN": "gQAAAAAAAZ..."
      }
    }
  }
}
```

#### Cline / Windsurf

Both follow the standard MCP `mcpServers` config — same shape as above. Drop the snippet into the tool's MCP config file and restart.

#### Smithery (hosted, no local install)

Browse to [smithery.ai/@madezmediapartners/acmi-mcp](https://smithery.ai/@madezmediapartners/acmi-mcp), paste your Upstash credentials, and Smithery hosts the MCP server for you. Useful for Claude Web / Claude.ai Cloud Agents where local stdio servers don't apply.

### 3. Bootstrap a session

In any MCP host with ACMI connected, ask:

> *"Bootstrap me as agent `my-agent`."*

The agent will call `acmi_bootstrap` and get back a single JSON payload with the agent's profile, signals, active work items, recent timeline, and last rollup — everything needed to resume work with full context.

---

## The 16 tools

| # | Tool | Purpose |
|---|---|---|
| 1 | `acmi_profile` | Set or read an entity's profile (who/what — stable identity + metadata) |
| 2 | `acmi_signal` | Set or read current signals (state flags, status, current focus) |
| 3 | `acmi_event` | Append a timeline event (the workhorse — logs every meaningful action) |
| 4 | `acmi_get` | Generic GET for any ACMI key (escape hatch when you know what you want) |
| 5 | `acmi_list` | List entity IDs in a namespace (e.g. all `agent:*` or all `work:*`) |
| 6 | `acmi_work_create` | Create a work item (deal, ticket, project, sprint) with profile + initial signals |
| 7 | `acmi_work_event` | Append progress event to a work item's timeline |
| 8 | `acmi_work_signal` | Update a work item's signals (status, progress, blockers) |
| 9 | `acmi_work_get` | Read a work item's full context: profile + signals + timeline + sessions |
| 10 | `acmi_work_list` | List all work item IDs |
| 11 | `acmi_cat` | Multi-stream event merge across multiple timelines, sorted by timestamp |
| 12 | `acmi_spawn` | Register a new agent session (model + session_id + agent_id) |
| 13 | `acmi_bootstrap` | One-shot agent context bundle (profile + signals + active + rollup + recent timeline) |
| 14 | `acmi_active` | Manage which threads/work items an agent is actively engaged with |
| 15 | `acmi_rollup_set` | Set the agent's `rollup:latest` pointer (read by next session's bootstrap) |
| 16 | `acmi_delete` | Destructive delete with dry-run, confirm token, and protected-path guards |

All tools return `{ok: true, ...}` on success or `{ok: false, error: "..."}` on failure. No exceptions are thrown — every handler is wrapped in `safeTool()` to keep MCP transport clean.

---

## The three keys, in practice

Every entity in ACMI lives under three Redis keys following a consistent pattern:

```
acmi:<namespace>:<id>:profile   ← JSON object, stable
acmi:<namespace>:<id>:signals   ← JSON object, mutates frequently
acmi:<namespace>:<id>:timeline  ← Redis ZSET (sorted by timestamp ms)
```

### Profile — *who/what is this entity*

Stable identity. Set once, update rarely.

```json
{
  "name": "Bentley",
  "role": "PM agent",
  "model": "claude-opus-4-7",
  "owner": "mikey"
}
```

### Signals — *what is currently true*

Frequently-changing state. The LLM's working memory for "what's the situation right now."

```json
{
  "current_focus": "ACMI v1.4 RFC draft",
  "session_state": "active",
  "blocking_items": ["mikey-decision-on-feature-flag"],
  "last_heartbeat_ts": 1778776623639
}
```

### Timeline — *everything that happened*

Append-only event log. Each event has a timestamp (the ZSET score), source, kind, summary, and correlationId. Following the ACMI Communication Standard v1.1:

```json
{
  "ts": 1778776623639,
  "source": "agent:bentley",
  "kind": "decision",
  "correlationId": "v14RfcDraftStart-1778776623639",
  "parentCorrelationId": "v14LaneAssignment-1778776000000",
  "summary": "[decision @mikey] Drafting v1.4 RFC, starting with workflow identity affinity from gemini-cli's Roundtable v1.2.",
  "tags": ["acmi-protocol", "v14", "rfc"]
}
```

---

## Worked examples

### Bootstrap a fresh agent session

```javascript
// As the agent, after MCP host connects:
const ctx = await mcp.acmi_bootstrap({ agentId: "bentley" });
// → returns: profile, signals, active threads, last rollup, recent timeline
```

The agent reads one JSON blob and immediately knows: who am I, what was I doing, what threads am I subscribed to, what's open, what did the last session conclude.

### Log a multi-agent handoff

```javascript
await mcp.acmi_event({
  namespace: "thread",
  id: "agent-coordination",
  source: "agent:bentley",
  kind: "handoff",
  summary: "[handoff @gemini-cli @mikey] Finished v1.4 RFC draft, handing off to gemini-cli for protocol-side validation.",
  correlationId: "v14RfcHandoff-1778776700000",
  parentCorrelationId: "v14RfcDraftStart-1778776623639"
});
```

Other agents subscribed to `thread:agent-coordination` see this on their next `acmi_cat` call.

### Track a work item end-to-end

```javascript
// Create work item
await mcp.acmi_work_create({
  id: "deal-acme-corp",
  profile: { title: "ACME Corp — enterprise tier", owner: "duane", value_usd: 47000 }
});

// Progress event
await mcp.acmi_work_event({
  id: "deal-acme-corp",
  source: "agent:duane",
  summary: "Discovery call complete, technical eval starting Monday."
});

// Update status
await mcp.acmi_work_signal({
  id: "deal-acme-corp",
  signals: '{"stage":"technical-eval","next_milestone":"poc-demo","blockers":[]}'
});

// Read full context any time
const deal = await mcp.acmi_work_get({ id: "deal-acme-corp" });
// → profile + signals + last 50 timeline events + sessions
```

### Multi-stream merge view

Read the last 24h of activity across three threads and two agents, time-sorted:

```javascript
const recent = await mcp.acmi_cat({
  keys: [
    "thread:agent-coordination",
    "thread:deal-flow",
    "thread:incident-response",
    "agent:bentley",
    "agent:gemini-cli"
  ],
  since: "24h",
  limit: 100
});
```

### Set a session rollup for the next agent

```javascript
await mcp.acmi_rollup_set({
  agentId: "bentley",
  rollup: {
    session_window: { start_iso: "2026-05-14T16:30Z", end_iso: "2026-05-14T19:00Z" },
    shipped: ["v1.4 RFC draft", "21 stalled items triaged"],
    next_session_inputs: ["pick up #75 acmi-mcp 1.4.1 publish if Mikey merges"],
    open_blockers: ["mikey-decision-on-rule9-amendment"]
  }
});
```

Next session calls `acmi_bootstrap` and gets this back as `rollup_latest` — instant context.

---

## Safety features

This server has been hardened in production for 6 months. Specific guards:

### `validateKeySegments`
Rejects any segment that's `undefined`, `null`, empty string, the literal string `"undefined"` or `"null"`, contains a colon (`:`), or exceeds 200 chars. Prevents malformed Redis keys from poisoning the store.

### `validateJson`
Catches malformed JSON before SET. Returns a descriptive error including the field name that failed.

### `isProtectedKey`
Refuses mutation of:
- `acmi:registry:*` (policy registry — fleet-wide config)
- `acmi:notion-sync:*` (Notion mirror surface — read-only from ACMI side)
- Empty/null keys (refuse-by-default)

### `safeTool`
Every handler is wrapped in `try/catch`. MCP responses are always shape-stable; failures return `{ok: false, error: "..."}` instead of throwing.

### `acmi_delete` two-phase
- First call must be `dryRun: true` — returns what would be deleted, deletes nothing.
- Second call requires `confirm: "<exact-key-being-deleted>"` — string mismatch aborts.
- Protected paths are refused at both phases.

---

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | yes | Upstash REST endpoint URL |
| `UPSTASH_REDIS_REST_TOKEN` | yes | Upstash REST auth token |
| `ACMI_TENANT_ID` | optional | Multi-tenant prefix (default: none) |
| `ACMI_LOG_LEVEL` | optional | `silent` / `error` / `warn` / `info` / `debug` (default `warn`) |

---

## Multi-tenant pattern

ACMI is single-tenant by default. To run multiple isolated tenants on one Upstash instance, set `ACMI_TENANT_ID` per host config:

```json
{
  "mcpServers": {
    "acmi-prod": {
      "command": "npx",
      "args": ["-y", "@madezmedia/acmi-mcp"],
      "env": {
        "UPSTASH_REDIS_REST_URL": "...",
        "UPSTASH_REDIS_REST_TOKEN": "...",
        "ACMI_TENANT_ID": "madezmedia"
      }
    },
    "acmi-folana": {
      "command": "npx",
      "args": ["-y", "@madezmedia/acmi-mcp"],
      "env": {
        "UPSTASH_REDIS_REST_URL": "...",
        "UPSTASH_REDIS_REST_TOKEN": "...",
        "ACMI_TENANT_ID": "folana"
      }
    }
  }
}
```

Keys become `<tenant>:acmi:<namespace>:<id>:<key>` — fully isolated.

---

## Troubleshooting

### "All tools return `ok: false, error: WRONGPASS`"
Upstash token in your env doesn't match the URL. Double-check the REST URL + token pair come from the same Upstash database.

### "Tools/list returns empty"
Restart the MCP host after editing config. Most hosts only re-read `mcpServers` on launch.

### "Bootstrap returns 96KB+, tool errors with `result too large`"
Your agent has a deep rollup. Tell the agent to read `rollup_latest` separately via `acmi_get` and limit timeline depth, instead of one mega-bootstrap.

### "`acmi_delete` refuses my dry-run"
Check if the key matches a protected path. `acmi:registry:*` and `acmi:notion-sync:*` are refused. If you need to delete protected keys, do it in Upstash console manually.

---

## Architecture & related projects

**This package** (`@madezmedia/acmi-mcp`) is the local stdio MCP server for ACMI. There's a sibling family:

| Project | Purpose |
|---|---|
| [`@madezmedia/acmi`](https://www.npmjs.com/package/@madezmedia/acmi) | TypeScript SDK with `InMemoryAdapter` + `UpstashAdapter` for embedding ACMI directly in apps |
| [`@madezmedia/acmi-mcp`](https://www.npmjs.com/package/@madezmedia/acmi-mcp) | **This package** — stdio MCP server for Claude Desktop, Cursor, Cline, Windsurf |
| [acmi-product](https://acmi-product.vercel.app) | Hosted multi-tenant ACMI on Vercel with OAuth 2.1 + PKCE + DCR for Claude Cloud Agents |
| [acmi-skill](https://github.com/madezmedia/acmi-skill) | Operator playbook teaching agents to use ACMI correctly across every Claude surface |

---

## Cross-surface notes

| Surface | Best fit |
|---|---|
| **Claude Desktop / Code** | This npm package via stdio (most reliable) |
| **Cursor / Cline / Windsurf** | This npm package via stdio |
| **Claude Web (claude.ai)** | Smithery-hosted OR `acmi-product.vercel.app/api/mcp` with OAuth |
| **Claude.ai Cloud Agents** | Smithery-hosted via `?config=<base64>` URL pattern |
| **Perplexity** | Smithery-hosted (Perplexity supports remote MCP) |
| **Server-side / scripts** | Use `@madezmedia/acmi` SDK directly, not MCP |

---

## Versioning

Following [semver](https://semver.org/):
- **Major**: breaking changes to tool signatures or protocol semantics
- **Minor**: new tools, new optional parameters
- **Patch**: bug fixes, README/doc, internal hardening with no API change

**Current: v1.4.0** — restores source under `mcp/` after 1.3.0 was orphaned from its declared `repository.directory` in 5d27e75. Adds `mcpName` field for MCP registry compliance. Comprehensive README rewrite.

See [CHANGELOG](https://github.com/madezmedia/acmi/blob/main/CHANGELOG.md) for history.

---

## Sponsorship & support

ACMI is an open MIT protocol. We are seeking partners who believe in the future of autonomous agent fleets.

- **Infrastructure Partners**: Upstash, Redis, Vercel
- **Protocol Adopters**: Companies building reliable multi-agent architectures
- **Issues Agent**: We run an ACMI-native issues agent on this repo with a **48h resolution SLA**. Every GitHub issue is mirrored to our coordination thread; bugs are fixed by our multi-agent fleet (Claude, Gemini, Codex) and verified before close.

Read more in [ABOUT.md](https://github.com/madezmedia/acmi/blob/main/ABOUT.md).

---

## License

MIT © Michael Shaw / Mad EZ Media. See [LICENSE](./LICENSE).

---

## Links

- **Protocol spec**: [github.com/madezmedia/acmi/blob/main/SPEC.md](https://github.com/madezmedia/acmi/blob/main/SPEC.md)
- **Product page**: [v3-ten-beta.vercel.app/acmi](https://v3-ten-beta.vercel.app/acmi/)
- **GitHub**: [github.com/madezmedia/acmi](https://github.com/madezmedia/acmi)
- **Issues / bugs**: [github.com/madezmedia/acmi/issues](https://github.com/madezmedia/acmi/issues)
- **Smithery listing**: [smithery.ai/@madezmediapartners/acmi-mcp](https://smithery.ai/@madezmediapartners/acmi-mcp)
- **Manifesto** (Three Keys v1.0): [MANIFESTO.md](https://github.com/madezmedia/acmi/blob/main/MANIFESTO.md)

---

*Built with intent by Mad EZ Media in Buffalo, NY. Three keys. That's the whole protocol.*
