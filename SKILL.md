# Agentic Context Management Infrastructure (ACMI)

ACMI is a universal architectural framework for giving AI agents persistent, real-time context. It replaces fragmented, multi-table database joins with a single, lightning-fast Key-Value engine (Upstash Redis) optimized specifically for LLM context windows.

## The Core Concept

Agents don't need highly normalized relational databases. They need **state snapshots** and **chronological timelines**. 

ACMI decouples the application layer from the agent layer by standardizing how context is stored, regardless of the use case. It organizes data by `namespace` (the domain) and `id` (the entity).

### The Three Pillars of ACMI
1. **Profile (State):** `acmi:{namespace}:{id}:profile` -> A JSON snapshot of the entity's current hard data (Name, Stage, Budget, Specs).
2. **Signals (AI State):** `acmi:{namespace}:{id}:signals` -> A JSON snapshot of AI-synthesized soft data (Churn Risk, Sentiment, Next Best Action).
3. **Timeline (Event Stream):** `acmi:{namespace}:{id}:timeline` -> A Redis Sorted Set (`ZSET`) that chronologically merges events from *every* platform (Gmail, Slack, Vapi, Calendar, System Webhooks).

### Agent extensions (long-context + identity)

For long-lived agents that span many sessions, ACMI adds four optional keys on top of the three pillars:

- **Spawn log:** `acmi:agent:{id}:spawns` (ZSET) — every session start, scored by ts, with `{session_id, model_id, host}`. Lets you query "who was this agent on date X" (imp-7 reincarnation).
- **Active context:** `acmi:agent:{id}:active_context` (HASH) — which threads the agent is currently engaged in, with role + since_ts.
- **Rollup:** `acmi:agent:{id}:rollup:latest` (STRING JSON) — periodically synthesized summary of recent timeline; cheap to read on spawn instead of replaying raw events (imp-2 archival foundation).
- **Work items:** `acmi:work:{id}:{profile|signals|timeline|sessions}` — long-running ideas / projects / tasks that span sessions; `sessions` is a SET of every session_id that touched the work.

## Use Cases & Namespaces

Because ACMI is namespace-driven, you can drop this exact same infrastructure into any project.

*   **Sales CRM:** `acmi profile sales gardine-wilson '{"company": "ClientCo"}'`
*   **Customer Support:** `acmi profile support ticket-8922 '{"priority": "high", "user": "mikey"}'`
*   **Dispatch/Fleet:** `acmi profile fleet truck-04 '{"driver": "Travis", "status": "en_route"}'`
*   **Project Management:** `acmi profile project core-pumping '{"deadline": "April 20", "blockers": "logo"}'`

## Installation

1. Create a serverless Redis database on [Upstash](https://console.upstash.com/redis).
2. Set your environment variables:
   ```bash
   export UPSTASH_REDIS_REST_URL="https://<your-endpoint>.upstash.io"
   export UPSTASH_REDIS_REST_TOKEN="<your-token>"
   ```
3. Make the script executable: `chmod +x ~/.openclaw/skills/acmi/acmi.mjs`

## CLI Commands

Use the `exec` tool to run these commands via Node.

### 1. Update/Create Profile (The Hard State)
```bash
node ~/.openclaw/skills/acmi/acmi.mjs profile "sales" "gardine-wilson" '{"name": "Gardine Wilson", "company": "ClientCo", "stage": "Proposal Sent"}'
```

### 2. Log an Event (The Unified Timeline)
This is the workhorse of ACMI. Pipe webhooks from Make/n8n/code directly into this to build a chronological story.
```bash
node ~/.openclaw/skills/acmi/acmi.mjs event "sales" "gardine-wilson" "vapi" "Completed 15-minute discovery call."
node ~/.openclaw/skills/acmi/acmi.mjs event "sales" "gardine-wilson" "gmail" "Sent the PDF proposal."
```

### 3. Update AI Signals (The Soft State)
Agents use this to update their synthesized understanding of the entity after reading new events.
```bash
node ~/.openclaw/skills/acmi/acmi.mjs signal "sales" "gardine-wilson" '{"churn_risk": "low", "next_action": "Follow up Friday", "sentiment": "positive"}'
```

### 4. Fetch Agent Context (The Read)
Retrieves the complete profile, signals, and the last 50 timeline events as a single, LLM-optimized JSON payload.
```bash
node ~/.openclaw/skills/acmi/acmi.mjs get "sales" "gardine-wilson"
```

### 5. List Entities in a Namespace
```bash
node ~/.openclaw/skills/acmi/acmi.mjs list "sales"
```

### 6. Delete Entity Context
```bash
node ~/.openclaw/skills/acmi/acmi.mjs delete "sales" "gardine-wilson"
```

### 7. Spawn / Identity Helpers (long-lived agents)

```bash
# At the start of every session — log who is booting and bind to a session ID
node acmi.mjs spawn claude-engineer "sess_$(date +%s)" claude-opus-4-7

# One-shot context bundle — reads profile, signals, active_context, rollup, last 20 timeline, last 5 spawns
node acmi.mjs bootstrap claude-engineer

# Track which threads this agent is currently engaged in
node acmi.mjs active claude-engineer add thread:bentley-pm participant
node acmi.mjs active claude-engineer list
node acmi.mjs active claude-engineer remove thread:bentley-pm

# Set the latest rollup (caller does the LLM synthesis — agents or a background cron)
node acmi.mjs rollup-set claude-engineer "Past 7d: shipped quota-monitor.mjs; opened 2 incidents; primary infra resilient."
```

### 8. Multi-Stream View (`cat`)

Merge-sorts events from N timeline keys, newest first:

```bash
node acmi.mjs cat thread:bentley-pm agent:bentley tracker:tonight-unfinished --since=24h --limit=50
```

Keys may be `<ns>:<id>` (will look at `:timeline` suffix), or full `acmi:...:timeline`.

### 9. Work Items (cross-session ideas / projects / tasks)

For concepts that span dozens of sessions and need a stable spine — separate from CRM entities and from per-agent timelines:

```bash
# Create a work item (its profile)
node acmi.mjs work create acmi-launch '{"title":"ACMI public launch","owner":"bentley","tags":["revenue","launch"]}'

# Log progress — bind to a session_id so we can later query "which sessions touched this"
node acmi.mjs work event acmi-launch claude-engineer "Manifesto v0 drafted" "$SESSION_ID"

# Update synthesized state
node acmi.mjs work signal acmi-launch '{"status":"publishing","next_action":"create Square checkout"}'

# Read everything — profile + signals + last 50 events + every session that touched it
node acmi.mjs work get acmi-launch

# List sessions that worked on this item
node acmi.mjs work sessions acmi-launch

# List all work items
node acmi.mjs work list
```

## Agent Operating Instructions

- **Always Read First:** Before acting on a request involving an entity, ALWAYS run `get <namespace> <id>` to load the unified timeline into your context window.
- **Synthesize & Update:** If you notice the timeline has changed significantly, automatically update the entity's signals using `signal <namespace> <id> <json>` to save compute for the next agent iteration.
- **Spawn Protocol (long-lived agents):** Every session start should call `spawn <agent_id> <session_id> <model_id>` once, then `bootstrap <agent_id>` to get the 6-read context bundle. Don't replay raw timelines on every prompt — read the rollup.
- **Bind work to sessions:** When working on a long-running idea/project, log progress with `work event <id> <source> '<summary>' <session_id>` so the work item accumulates a sessions ledger. This is how cross-session continuity is reconstructed.