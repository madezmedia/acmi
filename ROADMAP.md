# ACMI Roadmap

This is a living document. Items move, get cut, ship faster, ship slower. Last updated 2026-05-02.

The protocol's value is in restraint. Anything that doesn't serve the three-keys-per-entity thesis (Profile / Signals / Timeline) gets pushed to a later version or to an extension.

---

## Shipped

### v1.0 — Core (April 2026)
- Three-key data model: Profile, Signals, Timeline.
- Lock-Protocol v1.0 (optimistic locking via versioned signals).
- Anti-Dead Heartbeats (probabilistic liveness, 48h STALLED escalation).
- Reinforcement Learning Cycle (`logAssessment` 0–100 per workflow step).
- Comms v1.1 — five mandatory camelCase fields (`ts`, `source`, `kind`, `correlationId`, `summary`).

### v1.2 — Stable spec + reference SDK (April 2026)
- `@madezmedia/acmi` v1.2.0 published to npm 2026-05-01.
- Three reference adapters: in-memory (zero-dep), Redis (`ioredis`), Upstash (REST/edge).
- 31-test conformance suite (`@madezmedia/acmi/testing/conformance`) — passing in-memory + live Upstash.
- Five reference agent integrations (Claude, Gemini, Codex, Antigravity, OpenClaw).
- ESM + CJS dual builds via `tsup`. Node ≥ 18.

---

## In progress

### v1.3 — Multi-actor + Multi-tenant (May 2026)
Additive only. v1.2 deployments continue to work without modification.

- **§11 Multi-actor** — REQUIRED `actor_type` field on profiles (`agent` / `human` / `system` / `external`). SDK auto-fills from entity-id namespace. Per-actor HITL queues. Dual-projection collisions deprecated.
- **§12 Multi-tenant** — OPTIONAL `tenant_id` field. `acmi:tenant:<id>:*` key prefix convention. Cross-tenant `tenant_id: "shared"` for registries and coordination threads.

Status: SPEC text drafted in `SPEC.md` §11–§12. SDK code updates and conformance suite extensions follow in `1.3.0-beta.1+`. Migration is phased; live keyspace writes gated on per-phase ratification.

---

## Next

### v1.4 — Federation (target Q3 2026)
- Cross-instance ACMI federation: agents in deployment A can read/write entities in deployment B with explicit grants.
- Tenant interop: a `tenant_id` declared in deployment A is portable to deployment B.
- Eventually-consistent timeline merging across instances.

### v1.5 — Streaming + change notification (target Q4 2026)
- Native pub/sub on Profile / Signals / Timeline writes.
- Adapter contract extension: optional `subscribe(entityId, slot, handler)` method.
- Edge-runtime support (Workers, Vercel Edge, Deno Deploy WebSockets).

### Adapter ecosystem (continuous)
- DynamoDB adapter (community contribution welcome — see `CONTRIBUTING.md`).
- Cloudflare KV adapter.
- FoundationDB / FaunaDB adapters.
- Postgres LISTEN/NOTIFY adapter (for teams already on Postgres).

---

## v2.0 — ACMI-Sigil

Optional cryptographic identity and trust layer for ACMI. Enables multi-vendor agent collaboration, regulated/enterprise audit trails, and personal sovereignty over agent identity. PGP-inspired but built for modern agent comms — Ed25519 signatures, X25519 sealed signals, group-encrypted timelines, web-of-trust between agents. Spec drafting begins after ACMI core hits 5K stars. Cryptographically audited before v1.0.

---

## Explicitly out of scope (and likely staying that way)

- **Vector search built into the protocol.** Vector search is a retrieval pattern *on top of* Timeline. Adapters can layer it. The protocol does not.
- **LLM-driven memory consolidation.** ACMI is the data layer; consolidation is a higher-layer concern.
- **A managed UI / dashboard product in the open-source repo.** That belongs in `hyvmynd Studio` (commercial layer) when it ships.

---

*Three keys. That's all agent memory ever needed to be.*
