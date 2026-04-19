# Agentic Context Management Infrastructure (ACMI)

ACMI is a universal architectural framework for giving AI agents persistent, real-time context. It replaces fragmented, multi-table database joins with a single, lightning-fast Key-Value engine (Upstash Redis) optimized specifically for LLM context windows.

## The Core Concept

Agents don't need highly normalized relational databases. They need **state snapshots** and **chronological timelines**. 

ACMI decouples the application layer from the agent layer by standardizing how context is stored, regardless of the use case. It organizes data by `namespace` (the domain) and `id` (the entity).

### The Three Pillars of ACMI
1. **Profile (State):** `acmi:{namespace}:{id}:profile` -> A JSON snapshot of the entity's current hard data (Name, Stage, Budget, Specs).
2. **Signals (AI State):** `acmi:{namespace}:{id}:signals` -> A JSON snapshot of AI-synthesized soft data (Churn Risk, Sentiment, Next Best Action).
3. **Timeline (Event Stream):** `acmi:{namespace}:{id}:timeline` -> A Redis Sorted Set (`ZSET`) that chronologically merges events from *every* platform (Gmail, Slack, Vapi, Calendar, System Webhooks).

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

## Agent Operating Instructions

- **Always Read First:** Before acting on a request involving an entity, ALWAYS run `get <namespace> <id>` to load the unified timeline into your context window.
- **Synthesize & Update:** If you notice the timeline has changed significantly, automatically update the entity's signals using `signal <namespace> <id> <json>` to save compute for the next agent iteration.