# ACMI Cheatsheet

**Version:** v1.2 · **Last Updated:** 2026-04-29 · **Audience:** humans + agents

ACMI = **A**gentic **C**ontext **M**anagement **I**nfrastructure. The shared substrate every agent in the swarm reads/writes through. Backed by Upstash Redis (REST API). One Redis, many agents, one mental model.

---

## 1 · The Three Pillars

Every entity in ACMI has the same shape:

| Pillar | Key | Type | Purpose |
|---|---|---|---|
| **Profile** | `acmi:<namespace>:<id>:profile` | STRING (JSON) | WHO/WHAT — durable identity. Slow-changing. |
| **Signals** | `acmi:<namespace>:<id>:signals` | STRING (JSON) | STATE — live status. Updated frequently. |
| **Timeline** | `acmi:<namespace>:<id>:timeline` | ZSET (score=ts_ms) | EVENTS — append-only log. Source of truth for history. |

**Rule:** STRING+JSON for profile/signals. ZSET (member=JSON event) for timelines. Always. (See "Storage Footguns" below for why.)

---

## 2 · Namespaces

| Namespace | Purpose | Example |
|---|---|---|
| `acmi:agent:<id>` | Individual agents | `acmi:agent:bentley`, `acmi:agent:claude-engineer` |
| `acmi:thread:<topic>` | Cross-agent conversations | `acmi:thread:agent-coordination`, `acmi:thread:bentley-pm` |
| `acmi:tracker:<id>` | Work-tracking lists | `acmi:tracker:cloud-handoffs`, `acmi:tracker:daily-agents-fleet` |
| `acmi:user:<id>` | Humans | `acmi:user:mikey:hitl-queue`, `acmi:user:_convention:profile` |
| `acmi:workspace:<ws>:issue:<id>` | v2 workspace-scoped issues | `acmi:workspace:madez:issue:iss-fleet-1-...` |
| `acmi:registry:<name>` | Authoritative configs | `acmi:registry:agent-model-policy`, `acmi:registry:comms-pattern` |
| `acmi:skill:<slug>` | Distilled patterns from completed work | `acmi:skill:multica-next-step-2-...` |
| `acmi:inbox:<agent>:pending` | Per-agent work queue | `acmi:inbox:claude-engineer:pending` (ZSET) |
| `acmi:cloud-deliverable:<id>:content` | Cloud→local file payloads | `acmi:cloud-deliverable:deliv-...:content` |
| `acmi:work:<id>:timeline` | Issue/task work history | `acmi:work:acmi-cli-cmdevent-namespace-footgun:timeline` |

---

## 3 · CLI Commands

The canonical helper is `~/.openclaw/skills/acmi/acmi.mjs`. **Always source ENV first** (`source ~/clawd/.env`).

### Reading
```bash
# Read agent / thread / tracker (returns profile + signals + recent timeline)
node ~/.openclaw/skills/acmi/acmi.mjs get agent bentley
node ~/.openclaw/skills/acmi/acmi.mjs get thread agent-coordination
node ~/.openclaw/skills/acmi/acmi.mjs get tracker daily-agents-fleet
```

### Writing events
```bash
# Append event to a timeline. Always include kind + correlationId + summary (Comms v1.1)
node ~/.openclaw/skills/acmi/acmi.mjs event \
  --target acmi:thread:agent-coordination:timeline \
  --kind handoff-request \
  --source claude-engineer \
  --correlationId my-task-1777411440000 \
  --summary "[handoff] task X → @gemini-cli"
```

### Profiles + signals
```bash
# Update agent profile (replace whole JSON)
node ~/.openclaw/skills/acmi/acmi.mjs profile agent claude-engineer '<merged_json_string>'

# Update agent signals
node ~/.openclaw/skills/acmi/acmi.mjs signals agent claude-engineer '<merged_json_string>'
```

### Issue helper (v2 workspace)
```bash
# Create / update / comment on issues
node ~/clawd/tools/acmi-sync/acmi-issue-helper.mjs create madez "Title" "Description" "owner-agent" "acmi:tracker:..."
node ~/clawd/tools/acmi-sync/acmi-issue-helper.mjs status madez iss-<id> done
node ~/clawd/tools/acmi-sync/acmi-issue-helper.mjs comment madez iss-<id> claude-engineer "All clear"
```

### Cron management (OpenClaw CLI)
```bash
# Add a new cron job
openclaw cron add --schedule "0 * * * *" --task "Hourly ACMI drift check"

# List all cron jobs
openclaw cron list

# Edit an existing cron job
openclaw cron edit <cron-id> --schedule "*/30 * * * *"

# Remove a cron job
openclaw cron rm <cron-id>

# Manually trigger a cron job
openclaw cron run <cron-id>
```

### Direct Upstash REST (for scripting)
```bash
curl -sS -X POST -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN" \
  -H "Content-Type: application/json" "$UPSTASH_REDIS_REST_URL" \
  -d '["ZRANGE","acmi:thread:bentley-pm:timeline","0","10","REV"]'
```

---

## 4 · Common Workflows

### A · Send a handoff
```js
// 1. Originator posts handoff-request on agent-coordination + recipient timeline
ZADD acmi:thread:agent-coordination:timeline <ts> '{
  ts, source: "claude-engineer", kind: "handoff-request",
  correlationId: "my-handoff-<ts>",
  summary: "[handoff] task X → @gemini-cli",
  payload: { target_agent: "gemini-cli", work_item, deadline_iso, ... }
}'
ZADD acmi:agent:gemini-cli:timeline <ts> <same event>
```

### B · Acknowledge / complete
```js
// Recipient acks
{ kind: "handoff-ack", correlationId: "<original>", summary: "[ack] taking it" }

// On completion
{ kind: "handoff-complete", correlationId: "<original>", summary: "[done] result + URL/SHA" }
```

### C · HITL escalation
```js
// Agent stuck → ZADD to mikey's queue
ZADD acmi:user:mikey:hitl-queue <deadline_ms> '{
  ts, source: <agent>, kind: "hitl-required",
  correlationId: "hitl-<topic>-<ts>",
  summary: "[HITL] <topic> needs Mikey decision",
  payload: { topic, concrete_unblock_request, urgency: "P0|P1|P2" }
}'

// Mikey resolves with hitl-resolved (matching correlationId)
```

### D · Comms correction (legacy event missing correlationId)
```js
// Don't mutate history. Post a correction event linking original → inferred cid.
{ kind: "comms-correction",
  correlationId: "<parent_task_cid>",
  summary: "[corrected] @<agent> <kind> at ts=<X> — proper correlationId is '<inferred>'",
  payload: { original_event: { ts, source, kind, summary }, inferred_correlationId, inference_basis }
}
```

### E · Run a roundtable
```js
// 1. Open
{ kind: "roundtable-open", correlationId: "<topic>-<ts>",
  payload: { title, questions: [{id: "Q1_<slug>", title, prompt, expected_input_from: [<agents>]}], deadline_iso, synthesis_threshold: 3 } }

// 2. Each agent responds
{ kind: "roundtable-input", correlationId: "<topic>-<ts>",
  payload: { from: <agent>, responses: { Q1_<slug>: { answer: "...", word_count, stance } } } }

// 3. Synthesizer (or claude-engineer) waits for threshold, then posts
{ kind: "roundtable-synthesis", correlationId: "<topic>-<ts>",
  payload: { inputs_consumed, decisions: [...], open_for_hitl: bool } }
```

### F · Lock-Protocol v1.0 (batch tasks)
```js
// Before starting a batch/multi-step task, claim coordination
{ kind: "coord-claim", correlationId: "lock-<task>-<ts>",
  summary: "[lock] claiming <task> for batch execution",
  payload: { agent: "<id>", scope: "<task>", estimated_duration_min: 5 } }

// Other agents verify: check if claim is stale (>5 min) before deferring.
// On completion:
{ kind: "coord-release", correlationId: "lock-<task>-<ts>",
  summary: "[unlock] <task> batch complete" }
```

---

## 5 · Comms Pattern v1.1 — Mandatory Fields

Every event posted to `acmi:thread:agent-coordination:timeline` (the canonical thread) **must** include:

| Field | Required | Notes |
|---|---|---|
| `ts` | ✅ | ms epoch |
| `source` | ✅ | agent id (`bentley`, `claude-engineer`, `gemini-cli`, etc.) |
| `kind` | ✅ | enum (see kinds below) |
| `correlationId` | ✅ | **camelCase ONLY**. No `correlation_id` snake-case. No missing field. |
| `summary` | ✅ | ≤140 char human-readable |
| `payload` | recommended | structured data |

**Standard kinds:** `roundtable-open`, `roundtable-input`, `roundtable-synthesis`, `roundtable-plan`, `roundtable-nudge`, `handoff-request`, `handoff-ack`, `handoff-resolved`, `handoff-complete`, `hitl-required`, `hitl-resolved`, `tick-start`, `tick-end`, `comms-correction`, `comms-rule-ack`, `coord-claim`, `coord-release`, `coord-defer`, `schema-proposal`, `deployment-shipped`, `sync-snapshot`.

**Authoritative registry:** `acmi:registry:comms-pattern`

---

## 6 · Storage Footguns

### A · STRING vs HASH for profile/signals
v1 ACMI uses STRING+JSON (`SET` + `GET` + `JSON.parse`). v2 collab-platform spec proposed HASH (`HSET` + `HGETALL`) but was rolled back after gemini-cli yielded on the unification roundtable (2026-04-28). **Always use STRING+JSON.** If you see `HSET` on `acmi:workspace:*:issue:*:profile`, it's wrong — see `acmi:registry:cowork-kanban-alignment v3`.

### B · ZSET vs Stream for timelines
v1 uses ZSET (`ZADD` with score=ts_ms, member=JSON). Streams (`XADD`/`XRANGE`) were proposed for v2 but rolled back same time as A. **Always use ZSET.** Tools (drift-diff, handoff-watcher, sync helpers) all `ZRANGE` — Streams break them.

### C · CLI namespace footgun (open issue)
`cmdEvent` silently writes to orphan key when `ns` is passed in `'thread:X'` form (with embedded colon). Use **separate** `ns` and `id` args:
```bash
# WRONG — events vanish
node acmi.mjs cmdEvent --ns "thread:bentley-pm" --kind something

# RIGHT
node acmi.mjs cmdEvent --ns thread --id bentley-pm --source <kind>
```
Tracking: GitHub issue #2 at `madezmedia/acmi`. Work ID: `acmi-cli-cmdevent-namespace-footgun`.

### D · Field-format drift
Three field-format conventions historically existed: `correlation_id` (snake), `correlationId` (camel), missing-entirely. Comms Rule v1.1 (2026-04-28, baked into Bentley's SOUL.md) locks to **camelCase `correlationId` only**. Legacy snake-case posts have been auto-corrected. Drift-diff hourly enforces v1.1.

---

## 7 · Fleet Agent Roster

| Agent | Model Tier | Role | Primary Responsibilities |
|---|---|---|---|
| **bentley** | T4 · GLM-5.1 | Orchestrator | Main session agent. Routes tasks, synthesizes results, talks to Mikey. Owns ACMI timeline + coordination. |
| **claude-engineer** | T4 · GLM-5.1 | RL Engine + Coding | Deep coding via Claude Code. Building RL infrastructure (ChromaDB, embeddings). Implements AcmiWorkflowManager.mjs improvements. |
| **gemini-cli** | T0b · Gemini Flash | Schema + Protocol | ACMI schema maintenance, critique pipeline, comms-format enforcement. Drift-diff runner. Protocol documentation. |
| **antigravity** | T0b · Gemini Flash | UI + Dashboard | Cowork-Kanban UI development, assessment dashboard, RBAC implementation. Front-end specialist. |
| **cron agents** | Various | System Maintenance | 26 active cron jobs across hourly syncs, monitoring, wake cycles, daily jobs. |

### Hourly Wake System

Three agents wake on staggered hourly schedules (all Eastern Time, Gemini Flash model):

| Schedule | Agent | Purpose |
|---|---|---|
| :15 past the hour | `gemini-cli` | ACMI schema check, drift-diff, critique pipeline |
| :30 past the hour | `claude-engineer` | Code tasks, RL engine work, ChromaDB maintenance |
| :45 past the hour | `antigravity` | Kanban UI updates, dashboard refresh, RBAC checks |

**Escalation behavior:** If any agent has been silent for 3+ hours AND has pending tasks in its inbox, the wake cycle posts a `hitl-required` event to alert the human operator. This prevents zombie tasks from stalling indefinitely.

---

## 8 · Cron System Overview

**26 active cron jobs** as of April 29, 2026. Organized by category:

| Category | Count | Examples |
|---|---|---|
| **Hourly sync** | 8 | drift-diff, handoff-watcher, quota-monitor, anti-dead |
| **Agent wakes** | 3 | gemini-cli :15, claude-engineer :30, antigravity :45 |
| **Monitoring** | 5 | ACMI backup, health checks, uptime pings |
| **Daily jobs** | 6 | Memory maintenance, wiki sync, billing reports |
| **Periodic deep** | 4 | Weekly ACMI lint, monthly backup rotation |

**Cost tracking:** All cron runs are logged to ACMI timelines with token counts and model used. Aggregate metrics tracked in `acmi:registry:cron-cost-tracking`.

---

## 9 · The Daily Sync Stack

Run by `~/clawd/tools/acmi-sync/*` and `~/clawd/tools/cloud-sync/*`. Hourly via `launchd ai.claude.acmi.drift-diff`.

| Tool | Purpose |
|---|---|
| `pickup.mjs` | Cloud→local file handoffs from `acmi:tracker:cloud-handoffs:timeline` |
| `handoff-watcher.mjs` | Surface unacked handoff-requests >24h old |
| `quota-monitor.mjs` | Anthropic/Gemini/ZAI quota health |
| `drift-diff.mjs` | Detect model_id drift, stale events, date-drift, comms-format violations |
| `acmi-backup.mjs` | Daily snapshot of full ACMI keyspace → `~/clawd/memory/acmi-backups/` |
| `acmi-issue-helper.mjs` | CRUD for `acmi:workspace:<ws>:issue:*` |
| `anti-dead.mjs` | Reap inactive trackers (>48h silence) |

---

## 10 · Reinforcement Learning Cycle

Every workflow step goes through the RL cycle:

```
Execute → Assess → Log → Analyze → Adjust → Execute (improved)
```

| Phase | What Happens | Tooling |
|---|---|---|
| **Execute** | Run the workflow step | AcmiWorkflowManager.mjs |
| **Assess** | Score output quality (0–100) against criteria | `logAssessment(stepId, score, criteria)` |
| **Log** | Record lesson + score to ACMI timeline | `logImprovement(stepId, lesson)` |
| **Analyze** | Check prior improvement logs before next run | Query `acmi:workflow:<id>:meta` |
| **Adjust** | Seed sub-agents with refined context | Pass `improvement_log` in task prompt |
| **Execute (improved)** | Run with adjusted approach | Next iteration |

**Implementation:** `logImprovement()` and `logAssessment()` are being integrated into `AcmiWorkflowManager.mjs` at `~/.openclaw/skills/acmi/`. Every step gets scored. No execution without an assessment entry.

---

## 11 · 5-Pillar Roadmap

The roadmap for evolving ACMI from coordination substrate to self-improving fleet intelligence:

| Pillar | Name | Phase | Description |
|---|---|---|---|
| **P1** | RL Engine | 🟡 Active | Reinforcement learning cycle (assess → log → adjust). `logImprovement()` + `logAssessment()` being wired into workflow manager. |
| **P2** | Semantic Search | 🟡 Active | ChromaDB + OpenAI embeddings for fleet-wide knowledge retrieval. Enables agents to find relevant past work by meaning, not just keyword. |
| **P3** | Automated Critique | 🟡 Active | AI-powered output review against quality criteria. Non-critical steps get automated scoring; critical steps route to human review. |
| **P4** | Fleet Learning | 🔵 Planned | Cross-agent knowledge sharing. When one agent learns a lesson, the entire fleet benefits. Shared improvement embeddings. |
| **P5** | External Data Ingestion | 🔵 Planned | Pull in external signals (GitHub, email, social, analytics) to enrich agent context and trigger workflows autonomously. |

---

## 12 · Quick Lookup by Task

| Task | Command |
|---|---|
| Read latest from a thread | `acmi get thread <id>` |
| Post a handoff | event with kind=`handoff-request` + correlationId |
| Check what's on Mikey's HITL queue | `ZRANGE acmi:user:mikey:hitl-queue 0 -1 REV` |
| Find drift / health issues | `node ~/clawd/tools/acmi-sync/drift-diff.mjs` |
| Backup full keyspace | `node ~/clawd/tools/acmi-sync/acmi-backup.mjs` |
| List all agents | `SMEMBERS acmi:agent:list` |
| List all workspaces | `SMEMBERS acmi:workspace:list` |
| List all issues in a workspace | `SMEMBERS acmi:workspace:<ws>:issue:list` |
| List all skills | `SMEMBERS acmi:skill:list` |
| List cron jobs | `openclaw cron list` |
| Check agent wake schedule | See Fleet Agent Roster above |

---

## 13 · Operating Surfaces (Live Today)

| URL | Purpose |
|---|---|
| https://cowork-kanban.vercel.app | Operator dashboard — Board / Insights / Projects / Swarm / Activity / HITL |
| https://sonicbrand-pricing.vercel.app | First revenue surface ($27/$47/$97 jingle tiers) |
| https://folanas-journal.vercel.app | Folana Journal content surface |

---

## 14 · References

- **Authoritative registry:** `acmi:registry:comms-pattern` (locked v1.1)
- **Agent model policy:** `acmi:registry:agent-model-policy`
- **Cowork kanban alignment:** `acmi:registry:cowork-kanban-alignment v3`
- **Cloud↔Local handoff protocol:** `~/clawd/memory/research/papers/acmi-handoffs-v1.md`
- **ACMI v1.1 spec:** `~/clawd/memory/research/papers/acmi-v1.1-spec.md`
- **FULL-PROJECT-VIEW.md:** living portfolio doc — `~/clawd/FULL-PROJECT-VIEW.md`

---

*Maintained by the swarm. To update: edit this file + `~/clawd/apps/cowork-kanban/data/ACMI-CHEATSHEET.md` (kanban /help route reads from there).*
