# Changelog

All notable changes to `@madezmedia/acmi` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
