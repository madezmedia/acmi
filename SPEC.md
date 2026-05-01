# ACMI Specification — v1.2

**Status:** Stable
**Date:** 2026-04-30
**License:** MIT
**Editor:** Mikey Shaw <mikey@madezmedia.co>

---

## 1. Overview

ACMI (Agentic Context Management Infrastructure) is a data protocol for agent memory. Every entity in an ACMI-conformant system has exactly three slots:

| Slot       | Question | Storage shape          | Mutation |
|------------|----------|------------------------|----------|
| `profile`  | who      | document (JSON object) | overwrite + merge |
| `signals`  | now      | key→value map (JSON)   | per-key set / delete |
| `timeline` | then     | sorted-set of events   | append-only |

The three slots together form a **canonical entity envelope**. Any read/write that an agent performs MUST map to one of these three operations on one of these three slots.

## 2. Entity IDs

Entity IDs are strings of the form:

```
<category>:<id>
```

Where:

- `<category>` matches `[a-z][a-z0-9_-]*` (lowercase, dash/underscore allowed; must start with a letter).
- `<id>` matches `[a-zA-Z0-9_.-]+`.
- Combined length MUST be ≤ 256 characters.

Examples: `user:mikey`, `agent:claude-engineer`, `project:tony-top-of-new-york`, `session:abc-123`.

Adapters MUST prefix the entity ID with `acmi:` and append the slot suffix when constructing storage keys:

```
acmi:<category>:<id>:profile
acmi:<category>:<id>:signals
acmi:<category>:<id>:timeline
```

## 3. Profile slot

A profile is a JSON object containing **stable** facts about an entity — identity, preferences, configuration, anything that wouldn't reasonably change minute-to-minute.

### Operations

- **`profileGet(entityId) → ProfileDoc | null`** — return the current profile, or `null` if none has been set.
- **`profileSet(entityId, doc)`** — overwrite the profile entirely with `doc`.
- **`profileMerge(entityId, partial)`** — shallow-merge `partial` over the current profile (creating it if missing) and return the merged document.
- **`profileDelete(entityId)`** — remove the profile.

### Storage shape

`STRING` containing JSON-serialized `ProfileDoc`. Adapters MAY use a native document type if available.

### Constraints

- `profileMerge` is shallow (top-level key replacement). Deep merge is **not** part of the protocol.
- Reads MUST return a copy; caller-side mutation MUST NOT affect storage.

## 4. Signals slot

Signals are a **flat key→value map** representing the current state of the world for an entity. Signals are mutated frequently — what task an agent is on, what's open, what's pending.

### Operations

- **`signalsGet(entityId, key) → SignalValue | undefined`**
- **`signalsSet(entityId, key, value)`** — set or overwrite a single key.
- **`signalsAll(entityId) → Record<string, SignalValue>`** — return all signals for the entity.
- **`signalsDelete(entityId, key)`**

### Storage shape

Adapters MAY choose between two equivalent shapes:

1. **STRING + JSON** (recommended for Upstash REST and edge runtimes — used by `@madezmedia/acmi/adapters/upstash` and `@madezmedia/acmi/adapters/redis`). Single key holds the full signal map as JSON.
2. **Native HASH** (e.g. Redis HSET/HGET) — one storage key per entity, fields = signal keys.

The choice MUST NOT be observable to ACMI clients.

### Signal values

A signal value is any JSON-serializable value — primitive, array, or nested object. Adapters MUST round-trip values losslessly through their storage format.

## 5. Timeline slot

The timeline is an **append-only, time-ordered log** of events.

### Storage shape

`ZSET` (sorted set) where:

- Score = `event.ts` (wall-clock milliseconds).
- Member = JSON-serialized event.

### Event schema (Comms v1.1)

Every event MUST contain these five fields:

| Field            | Type     | Description |
|------------------|----------|-------------|
| `ts`             | `number` | Wall-clock milliseconds. Monotonicity not required across writers. |
| `source`         | `string` | Who wrote the event (entity ID format encouraged). |
| `kind`           | `string` | Event taxonomy (e.g. `task-delegation`, `heartbeat`, `coord-note`). |
| `correlationId`  | `string` | ID linking related events. |
| `summary`        | `string` | One-line human-readable summary. ≤ 500 chars. |

Optional fields:

- `parentCorrelationId: string` — chain events to a parent workflow.
- `payload: unknown` — any JSON-serializable structured data.

Producers MAY include additional fields; adapters MUST round-trip them losslessly.

### Operations

- **`timelineAppend(entityId, event)`** — score = `event.ts`, member = JSON event.
- **`timelineRead(entityId, opts?) → TimelineEvent[]`** — chronological by default.
- **`timelineSize(entityId) → number`**

### Read options

```ts
{
  limit?: number;     // max events to return
  reverse?: boolean;  // newest-first if true (default: oldest-first)
  sinceMs?: number;   // inclusive lower bound on ts
  untilMs?: number;   // inclusive upper bound on ts
}
```

### Append-only

The protocol does NOT define event mutation or deletion. Adapters MAY support it for operational reasons (compliance, GDPR), but ACMI clients MUST NOT rely on it.

## 6. Validation

The reference SDK validates on the producer side:

- Entity IDs MUST match the pattern in §2.
- Profile docs MUST be plain objects.
- Signal keys MUST be 1–128 chars.
- Timeline events MUST have all five Comms v1.1 fields populated with non-empty strings (except `ts`, which must be a finite number).

Adapters MAY perform additional validation but MUST NOT relax these rules.

## 7. Conformance

An adapter is **ACMI-conformant** if and only if it passes the conformance test suite at `@madezmedia/acmi/testing/conformance`.

The suite asserts:

- All operations from §3, §4, §5 round-trip correctly.
- Validation rules from §6 produce errors at the SDK boundary.
- Different entity IDs are isolated (no cross-talk between profiles, signals, or timelines).
- Reads return copies (caller mutation does not affect storage).

Adapter authors invoke the suite by passing a factory function that returns a fresh adapter instance:

```ts
import { runConformanceTests } from "@madezmedia/acmi/testing/conformance";
const result = await runConformanceTests(() => new YourAdapter(...));
```

## 8. Extensions (informational)

The following are layered conventions used in production but are NOT part of the core protocol:

- **Lock-Protocol** — optimistic locking via versioned signals for cross-agent write coordination.
- **Anti-Dead Heartbeats** — convention of writing periodic `kind: heartbeat` events to a `:timeline` for liveness monitoring.
- **RL Cycle** — using `payload.logAssessment` (0–100) on completion events to encode reward signal.
- **Fleet Coordination** — agent discovery via `acmi:registry:fleet:*` profiles + signals.

Each extension is documented separately and may evolve independently of the core protocol.

## 9. Versioning policy

ACMI follows semver at the SPEC level:

- **Major** — backwards-incompatible changes to the data model or operation contract.
- **Minor** — additive changes (new operations, new optional fields).
- **Patch** — clarifications, typo fixes, documentation.

The reference SDK (`@madezmedia/acmi`) follows its own semver track. SDK 0.x is allowed to make minor adjustments to the API surface as the protocol stabilizes; from 1.0.0 onward, breaking SDK changes require a major SDK bump.

## 10. Reference implementation

`https://github.com/madezmedia/acmi` — TypeScript reference SDK with in-memory, Redis (`ioredis`), and Upstash (REST) adapters.

---

## Appendix A — Complete event example

```json
{
  "ts": 1777576034881,
  "source": "agent:claude-engineer",
  "kind": "task-delegation",
  "correlationId": "acmi-launch-playbook-v1-1777576034881",
  "parentCorrelationId": "acmi-launch-playbook-v1-1777576034881",
  "summary": "[task-delegation @gemini-cli] npm scaffold Days 1-3",
  "payload": {
    "addressee": "gemini-cli",
    "deadline": "2026-05-01",
    "deliverables": ["scaffold", "in-memory adapter", "spec lock"]
  }
}
```

## Appendix B — Reserved kind prefixes (informational)

The following `kind` prefixes are conventional in the reference deployment and SHOULD NOT be redefined by extensions:

- `heartbeat` — liveness signal
- `task-delegation` / `task-completion` — work assignment lifecycle
- `coord-note` — cross-agent coordination message
- `team-sync` — broadcast announcements
- `issue-created` / `issue-closed` — HITL workflow

Other prefixes are at the operator's discretion.

---

*End of specification.*
