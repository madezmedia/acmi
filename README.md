<p align="center">
  <img src="./assets/banner.svg" alt="ACMI v1.5 banner" width="960">
</p>

# ACMI - Agentic Context Memory Interface

[![npm](https://img.shields.io/npm/v/@madezmedia/acmi.svg)](https://www.npmjs.com/package/@madezmedia/acmi)
[![Protocol v1.5](https://img.shields.io/badge/Protocol-v1.5-2d4a3e)](./SPEC.md)
[![MCP v1.5.0](https://img.shields.io/badge/MCP-v1.5.0-2d4a3e)](./mcp/README.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Conformance: 36/36](https://img.shields.io/badge/Conformance-36%2F36-2d4a3e)](./tests)

> The coordination backbone for AI agent fleets. Three Redis keys - Profile, Signals, Timeline.

ACMI is the open protocol for persistent agent context. Version `v1.5` formalizes **Fleet Comms Protocol**: atomic pre/post events, wake-directives, handoff-ack chains, and correlation-aware timelines that make multi-agent work auditable instead of anecdotal.

Every entity stores exactly three things an LLM needs to make decisions:

```text
Profile  -> who   (identity, preferences, stable facts)
Signals  -> now   (current state, blockers, next action)
Timeline -> then  (append-only event log from every source)
```

The shape is intentionally small:

- **Profile**: stable identity and configuration.
- **Signals**: mutable state and synthesized working memory.
- **Timeline**: immutable history, ordered by time.

This repo ships the public ACMI package, the MCP server subpackage, and the docs that keep the fleet aligned:

- `@madezmedia/acmi` - the TypeScript SDK, CLI, and conformance suite.
- `mcp/` - `@madezmedia/acmi-mcp`, the MCP server for hosts that need direct ACMI access.
- `SPEC.md` - canonical protocol spec.
- `CHANGELOG.md` - release history, including the `v1.5.0` fleet-comms update.
- `docs/` - operator guide, cheatsheet, and protocol notes.

## What v1.5 adds

The `v1.5.0` release aligns the fleet around a shared event language:

- atomic commit pre/post events
- roundtable coordination and wake-directives
- `source`, `kind`, `correlationId`, `summary` event envelope discipline
- signal freshness checks before action
- `agent:<id>` source naming across the fleet

## Install

```bash
npm install @madezmedia/acmi
```

## Quick start

```ts
import { createAcmi } from "@madezmedia/acmi";
import { InMemoryAdapter } from "@madezmedia/acmi/adapters/in-memory";

const acmi = createAcmi(new InMemoryAdapter());

await acmi.profile.set("user:mikey", {
  name: "Michael Shaw",
  role: "operator",
  location: "Charlotte, NC, USA",
});

await acmi.signals.set("user:mikey", "current_focus", "ACMI v1.5 fleet sync");

await acmi.timeline.append("user:mikey", {
  ts: Date.now(),
  source: "user:mikey",
  kind: "coord-note",
  correlationId: "acmiReadmeRefresh-0001",
  summary: "[coord-note @fleet] README aligned to v1.5 and local assets.",
});
```

## Production adapters

```ts
import { createAcmi } from "@madezmedia/acmi";
import { UpstashAdapter } from "@madezmedia/acmi/adapters/upstash";

const acmi = createAcmi(
  new UpstashAdapter({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
);
```

| Adapter | Use case | Edge-compatible |
|---|---|---|
| `@madezmedia/acmi/adapters/in-memory` | tests, examples, local dev | n/a |
| `@madezmedia/acmi/adapters/upstash` | Vercel, Workers, edge runtimes | yes |
| `@madezmedia/acmi/adapters/redis` | self-hosted Redis / Node | no |

## Fleet protocol

ACMI v1.5 uses a shared event format so every significant action can be traced:

```json
{
  "ts": 1780000000000,
  "source": "agent:codex",
  "kind": "handoff-ack",
  "correlationId": "codexGrantDraft-1780000000000",
  "summary": "[handoff-ack @ops-center] Draft ready for review."
}
```

Rules that matter in practice:

- use `[kind-tag @recipient]` in summaries
- keep `source` prefixed with `agent:`, `user:`, or `system:`
- link follow-up events with `parentCorrelationId`
- keep the timeline append-only
- verify signals before acting when the workflow depends on current state

## Related surfaces

- [ACMI Product / live demo](https://v3-ten-beta.vercel.app/acmi/)
- [ACMI Operator Surface](https://swarm.madezmedia.com)
- [ACMI MCP server README](./mcp/README.md)
- [Operator Guide](./docs/OPERATOR-GUIDE.md)
- [ACMI Cheatsheet](./docs/ACMI-CHEATSHEET.md)
- [Changelog](./CHANGELOG.md)

## The fleet

ACMI is used across the Mad EZ Media fleet as the common context layer for:

- `ops-center` - orchestration and routing
- `bentley` - comms and governance
- `codex` - coding and implementation support
- `hermes` - deep scans and guardian checks
- `android-worker` - mobile bridge and notifications

## License

[MIT](./LICENSE) - Copyright Michael Shaw / Mad EZ Media
