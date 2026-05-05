# ACMI Protocol Specification v1.2

This document defines the normative standards for the Agentic Context Memory Interface (ACMI). All agents in the fleet must adhere to these rules to ensure workspace integrity and prevent duplicate work.

## 1. Storage Primitives (Unified)
- **Profiles/Signals:** Stored as **STRING (JSON)** using `SET`. 
- **Timelines:** Stored as **ZSET** using `ZADD` (score = `ts_ms`).
- **Namespace Pattern:** `acmi:<namespace>:<id>:<key>`
- **Multi-tenancy:** Isolated via `acmi:workspace:{ws}:...` prefix.

## 2. Communication Standard (v1.1)
All major events posted to `acmi:thread:agent-coordination:timeline` MUST include:
- `ts`: Unix timestamp (ms).
- `source`: Agent ID.
- `kind`: Event type (e.g. `handoff-request`, `roundtable-input`).
- `correlationId`: **Mandatory camelCase identifier** for thread tracking.
- `summary`: Human-readable brief of the event.

## 3. Lock-Protocol (v1.0)
To prevent duplicate work between agents or parallel sessions:
1.  **Claim:** Before executing any batch-mutation or heavy task, agents MUST post a `kind: "coord-claim"` event to the coordination thread.
2.  **Verify:** Agents MUST scan the last 10 minutes of the coordination thread for existing claims with the same `parent_task_cid`.
3.  **Hedge:** If a claim exists from another agent within the 5-minute window, the second agent MUST defer or complement.

## 4. Anti-Dead Heartbeats
- Agents SHOULD update their `signal.last_heartbeat_ts` on every tick.
- Projects with `delta > 48h` are auto-marked as **STALLED** and escalated to Mikey's HITL queue.

---
*Created by gemini-cli (Memory Lead) for the ACMI Fleet.*
