## v1.5.0 - 2026-05-29

### Added
- **Fleet Comms Protocol** — atomic commit pre/post events with correlationId chains
- **Roundtable coordination** — multi-agent kickoff with wake-directives and handoff-ack flow
- **Event envelope standard** — source, kind, correlationId, summary quad required
- **Signal freshness verification** — cron/agent sessions verify ACMI signals before acting
- **64 agents force-aligned to v1.5** — Bentley, Avery, grok, opencode, design-agency, and fleet

### Changed
- All agents now use `source: "agent:<id>"` format (never bare ID)
- Event summaries follow `[kind-tag @recipient] <one-line>` convention
- MCP server version bumped to 1.5.0


# Changelog

All notable changes to `@madezmedia/acmi` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] — 2026-05-18

### Added
- **Multi-actor support** - `actor_type` field on profiles and `speaker_type` on events
- **Migration script** - `scripts/migrate-v1.3.ts` to resolve namespace collisions and prepare existing deployments
- **Comprehensive v1.3 types** - TypeScript types updated with ActorType and SpeakerType enums
- **Enhanced validation** - Event summary length validation (500 char limit)
- **ACMI v1.3 Compliance** - Full compliance with SPEC-v1.3-PROPOSAL.md §11 and §12
- **Namespace collision resolution** - Fixed mikey and claude-engineer dual-projection issues
- **Spurious key cleanup** - Removed orphaned `acmi:user:list` entries

### Changed
- Version bumped to 1.3.0 reflecting multi-actor and multi-tenant capabilities
- Enhanced validation with 500-char event summary limit
- Profile migration script addresses production deployments
- All conformance tests pass for v1.3.0

### Fixed
- ActorType enum properly typed as "agent" | "human" | "system" | "external"
- SpeakerType enum added for event source discrimination
- Migration script handles long event summaries gracefully
- Git push to remote repository completed successfully

## [Unreleased]

### Added
- `ROADMAP.md` published — full version-by-version trajectory.
- README roadmap section added with shipped / in-progress / next / v2.0 (ACMI-Sigil) summary.
- v2.0 ACMI-Sigil roadmap entry: optional cryptographic identity + trust layer for ACMI. Spec drafting begins after ACMI core hits 5K stars; cryptographically audited before v1.0. Internal design memo at `~/clawd/docs/SIGIL-MEMO-v0.1.md` (not public).

## [1.3.0-beta.0] — 2026-05-02

ACMI Protocol v1.3 — additive only. v1.2 deployments continue to work.

### Added (Spec)
- **§11 Multi-actor**: `actor_type` field REQUIRED on profiles, with values `agent` / `human` / `system` / `external`. SDK auto-fills from entity-id namespace prefix.
- **§11.4** OPTIONAL `speaker_type` field on events.
- **§11.5** Collision resolution procedure for dual-projection cleanup (`mikey`, `claude-engineer`).
- **§11.6** Per-actor HITL queues (`acmi:hitl:user:<id>:*`, `acmi:hitl:agent:<id>:*`) — additive to shared queues.
- **§12 Multi-tenant**: OPTIONAL `tenant_id` field; `acmi:tenant:<id>:*` key prefix convention; cross-tenant `tenant_id: "shared"` for registries and coordination threads.

### Changed
- Spec date and version banner updated.
- §9 versioning note updated to call out v1.2 → v1.3 as minor / additive.

### Status
This is the FIRST cut of v1.3 spec text. SDK type updates and conformance suite extensions follow in 1.3.0-beta.1+. Not yet published.

### Migration notes
- 3 existing namespace collisions identified: `mikey` (real, primary `human`), `claude-engineer` (real, primary `agent`), `list` (spurious — bug; will be deleted).
- No live ACMI keyspace writes performed by this changelog entry. All migrations gated on per-phase ratification per `SPEC-v1.3-PROPOSAL.md`.

## [0.1.0] — 2026-04-30

Initial release. Implements ACMI v1.2 (`SPEC.md`).

### Added
- `createAcmi(adapter)` — high-level client wrapping any `AcmiAdapter`.
- `InMemoryAdapter` — zero-dependency reference adapter for tests, examples, and dev.
- `RedisAdapter` — `ioredis`-based adapter for self-hosted Redis or Upstash via the Redis protocol.
- `UpstashAdapter` — REST-based adapter, edge-compatible (Cloudflare Workers, Vercel Edge, Deno Deploy).
- Conformance test suite (`@madezmedia/acmi/testing/conformance`) — 31 assertions covering profile / signals / timeline / validation / isolation.
- Comms v1.1 producer-side validation: `ts`, `source`, `kind`, `correlationId`, `summary` all required and non-empty.
- Entity-ID validation: `<category>:<id>` shape enforced.
- TypeScript types exported for all public interfaces.
- ESM + CJS dual-package builds via `tsup`; types-included; Node ≥ 18.
