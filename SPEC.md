# ACMI Specification — v1.3

**Status:** Stable
**Date:** 2026-05-02
**License:** MIT
**Editor:** Mikey Shaw <mikey@madezmedia.co>
**Changes from v1.2:** Adds §11 (Multi-actor) and §12 (Multi-tenant). Both additive — no breaking changes to v1.2 behavior. v1.2 readers continue to work; v1.3 readers gain actor-type-aware and tenant-aware operations.

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

**v1.2 → v1.3** is a MINOR version bump. §11 and §12 are entirely additive: existing v1.2 deployments continue to work without modification. New `actor_type` field is REQUIRED on writes via the v1.3 SDK but auto-filled from namespace, so callers see no friction.

## 10. Reference implementation

`https://github.com/madezmedia/acmi` — TypeScript reference SDK with in-memory, Redis (`ioredis`), and Upstash (REST) adapters.

---

## 11. Multi-actor (v1.3)

ACMI distinguishes four actor types. Every entity that has a profile MUST declare an `actor_type` (REQUIRED in v1.3.0).

### 11.1 Actor type values

```
"agent"    — autonomous software agent (LLM-backed or scripted)
"human"    — human team member (operator, contractor, employee)
"system"   — infrastructure source (cron, webhook, telemetry); no profile required, source field on events identifies
"external" — external party (client, vendor, prospect); reserved for v1.3.1+
```

### 11.2 Primary namespace per actor type

Every actor has exactly ONE primary namespace, determined by `actor_type`:

| `actor_type` | Primary key prefix |
|---|---|
| `agent` | `acmi:agent:<id>:*` |
| `human` | `acmi:user:<id>:*` |
| `system` | (no profile; events only) |
| `external` | `acmi:external:<id>:*` (reserved) |

**Dual-projection (same `<id>` in both `agent:` and `user:` namespaces) is FORBIDDEN.** Each entity has one primary identity. Existing dual-projection collisions MUST be resolved via the deprecation procedure in §11.5.

### 11.3 Profile field — `actor_type` (REQUIRED)

```json
{
  "name": "Duane",
  "actor_type": "human",
  "title": "Chief Human Execution Officer",
  ...
}
```

The reference SDK auto-fills `actor_type` based on the entity-id prefix at write-time:

```ts
acmi.profile.set("user:foo", { name: "Foo" });
// SDK adds actor_type: "human" before persisting

acmi.profile.set("agent:bar", { name: "Bar" });
// SDK adds actor_type: "agent" before persisting
```

Callers MAY override the auto-fill for edge cases:

```ts
acmi.profile.set("user:duane", { name: "Duane", actor_type: "external" });
// SDK respects the explicit declaration
```

The SDK MUST validate `actor_type ∈ {agent, human, system, external}` and throw `AcmiValidationError` on any other value.

### 11.4 Event field — `speaker_type` (OPTIONAL)

Events MAY include `speaker_type` matching the source's `actor_type`:

```json
{
  "ts": 1777733791375,
  "source": "user:mikey",
  "speaker_type": "human",
  "kind": "ratification",
  "correlationId": "...",
  "summary": "..."
}
```

This lets readers distinguish synthesizable agent reasoning (`agent`), lived-experience human input (`human`), and infrastructure telemetry (`system`). v1.3.0 makes `speaker_type` OPTIONAL; v1.4 may upgrade to REQUIRED.

### 11.5 Collision resolution (deprecation procedure)

For existing entities that violate §11.2 (same `<id>` in both `agent:` and `user:`):

1. Determine the primary actor_type. (e.g., `mikey` is `human`; `claude-engineer` is `agent`.)
2. Migrate any meaningful data from the deprecated namespace into the primary profile (e.g., `mention_alias`, `fleet_role`, archival references).
3. Post a `kind: namespace-archived` event listing the deprecated path, the migration target, and a hash of the archived data.
4. Stop writing to the deprecated path. Reads from it are still allowed during the transition window.
5. After ≥30 days of zero writes, the deprecated keys MAY be deleted (operator discretion).

### 11.6 Per-actor HITL queues (additive)

v1.2 has shared HITL queues at `acmi:thread:hitl:open` and `acmi:thread:hitl:closed`. v1.3 adds:

```
acmi:hitl:user:<id>:open    — items addressed to a specific human
acmi:hitl:user:<id>:closed
acmi:hitl:agent:<id>:open   — items addressed to a specific agent
acmi:hitl:agent:<id>:closed
```

Shared queues remain valid for items addressed to "any available actor". The routing layer is additive; v1.2 consumers continue to work.

---

## 12. Multi-tenant (v1.3)

ACMI v1.3 introduces tenant scoping. Single-tenant deployments (the v1.2 default) continue to work without changes — tenant fields are OPTIONAL at the entity level but recommended for any multi-customer or multi-business use case.

### 12.1 Tenant id

Every entity MAY declare a `tenant_id` field on its profile:

```
"madez"             — default operator tenant (matches v1.2 single-tenant assumption)
"client:<slug>"     — per-client tenant (e.g., "client:core-pumping")
"shared"            — explicitly cross-tenant entity (the protocol itself, registries, threads)
```

Default tenant_id when absent: `"madez"` (preserves v1.2 single-tenant behavior).

### 12.2 Key prefix convention

For new keys created post-v1.3 that are tenant-scoped, the canonical form is:

```
acmi:tenant:<tenant_id>:<category>:<id>:<slot>
```

The existing `acmi:workspace:<workspace_id>:<category>:<id>:<slot>` convention from v1.2 continues to work. Going forward:

- **Tenant** = customer / business identity (one operator may serve multiple clients)
- **Workspace** = sub-scope within a tenant (e.g., `madez-dev`, `madez-prod`)
- A key MAY include both (`acmi:tenant:madez:workspace:dev:project:foo:profile`) but neither is required for default-tenant single-workspace use.

### 12.3 Cross-tenant entities

Some entities are intentionally global and use `tenant_id: "shared"`:

- `acmi:registry:*` — protocol registries (namespace policy, brand strategy, launch playbook)
- `acmi:thread:agent-coordination:*` — cross-fleet coordination threads
- The protocol's own data (open-source contributions)

These remain at the unscoped path (no `acmi:tenant:shared:` prefix) for v1.2 compatibility. The `tenant_id: "shared"` field on the profile signals their cross-tenant nature.

### 12.4 Tenant isolation rules

- Entities in different tenants MUST NOT share profile/signals/timeline keys.
- Cross-tenant references are allowed via `mention_alias` or `parent_correlation_id` fields, but not via direct key sharing.
- Adapters SHOULD NOT enable cross-tenant SCAN by default; tenant-scoped operations are preferred.

### 12.5 Migration from informal workspace usage

Existing `acmi:workspace:<workspace>:*` keys retain their semantics. The relationship is:

- `acmi:workspace:madez:*` keys are `tenant_id: "madez"` (default tenant) with workspace=madez
- `acmi:workspace:madez-dev:*` keys are `tenant_id: "madez"` with workspace=dev
- `acmi:workspace:global:*` and `acmi:workspace:list:*` are pre-v1.3 artifacts; investigate and either re-tenant or archive

---

## 13. Versioning policy (re-stated for v1.3)

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
