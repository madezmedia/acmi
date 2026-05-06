# ACMI Roadmap

This is a living document. Items move, get cut, ship faster, ship slower. Last updated 2026-05-06.

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

### v1.3 — Multi-actor + Multi-tenant + MCP Server (May 2026)
Additive only. v1.2 deployments continue to work without modification.

- **§11 Multi-actor** — REQUIRED `actor_type` field on profiles (`agent` / `human` / `system` / `external`). SDK auto-fills from entity-id namespace. Per-actor HITL queues. Dual-projection collisions deprecated.
- **§12 Multi-tenant** — OPTIONAL `tenant_id` field. `acmi:tenant:<id>:*` key prefix convention. Cross-tenant `tenant_id: "shared"` for registries and coordination threads.
- **§13 MCP Server** — Model Context Protocol server exposing 14 ACMI tools via stdio transport. Compatible with Claude Desktop, Cursor, Cline, Windsurf.

Status: §11–§12 SPEC drafted. MCP server v1 built + smoke-tested 2026-05-05. 9 bugs found, P0 hardening pending. CLI BUG-008 (flag parsing) patched same day. SSE transport + multi-tenant workspace CRUD planned for beta.

**MCP bugs (9, found by 3 independent reviewers):**
P0: missing validateKeySegments, no JSON validation, no try/catch on handlers, missing acmi_delete + acmi_rollup_set.
P1: Date.now() ZADD same-ms overwrite, no Redis timeout, CLI --kind flag parsing (PATCHED), CLI --correlationId flag parsing (PATCHED).
P2: no SSE transport.

---

## Next

### v1.4 — Consumer Product + Federation (target Q3 2026)
- **Hosted MCP** — SSE/HTTP transport, API-key auth for cloud agents.
- **Tenant isolation** — Workspace CRUD via MCP tools, key-prefix based.
- **Stripe billing** — Free/Pro/Team/Enterprise tiers.
- **Dashboard** — Next.js + shadcn/ui, 5 screens.
- **Federation** — Cross-instance agent read/write with explicit grants.
- Cross-instance ACMI federation: agents in deployment A can read/write entities in deployment B with explicit grants.
- Tenant interop: a `tenant_id` declared in deployment A is portable to deployment B.
- Eventually-consistent timeline merging across instances.

### v1.5 — Streaming + Observability + Hindsight Integration (target Q4 2026)
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
