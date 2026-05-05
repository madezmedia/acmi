<p align="center">
  <img src="https://v3b.fal.media/files/b/0a98cb49/ns7vLT2QV8YBH1LTtzSXr.jpg" alt="ACMI Protocol Hero" width="800">
</p>

# ACMI — Agentic Context Management Infrastructure

[![npm](https://img.shields.io/npm/v/@madezmedia/acmi.svg)](https://www.npmjs.com/package/@madezmedia/acmi)
[![Protocol v1.3](https://img.shields.io/badge/Protocol-v1.3-2d4a3e)](./SPEC.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Conformance: 36/36](https://img.shields.io/badge/Conformance-36%2F36-2d4a3e)](./tests)

> **Product page:** [v3-ten-beta.vercel.app/acmi](https://v3-ten-beta.vercel.app/acmi/) · the canonical narrative, install card, and visual demo of the three-key model.

**ACMI is a universal, namespace-driven framework that gives AI agents persistent, real-time context — replacing fragmented SQL joins and multi-table queries with a single, LLM-optimized Key-Value engine backed by serverless Redis.** Every entity stores exactly three things an LLM needs to make decisions: a **Profile** (who/what is this entity), **Signals** (what does the AI think about it), and a **Timeline** (everything that happened, chronologically, from every source).

```
Profile  →  who   (identity, preferences — stable)
Signals  →  now   (current state — what's open, what's pending)
Timeline →  then  (append-only event log)
```

---

## 🚀 Issues Agent: 48h Resolution SLA
We run an **ACMI-native Issues Agent** that monitors this repository. 
- **Instant Logging**: Every GitHub issue is instantly mirrored to our ACMI coordination thread.
- **48h SLA**: We aim to have all verified bugs and priority features fixed or resolved in **under 48 hours**.
- **Agentic Fixes**: Our multi-agent fleet (Claude, Gemini, Codex) collaborates to implement, test, and verify fixes automatically.

---

## 💎 Sponsorship & Support
ACMI is an open MIT protocol. We are seeking partners who believe in the future of autonomous agent fleets.
- **Infrastructure Partners**: Upstash, Redis, Vercel.
- **Protocol Adopters**: Companies building reliable swarm architectures.

Read more in our [**Sponsorship Drive (ABOUT.md)**](./ABOUT.md).

---

## Install

```bash
npm install @madezmedia/acmi
```

## 10-line example

```ts
import { createAcmi } from "@madezmedia/acmi";
import { InMemoryAdapter } from "@madezmedia/acmi/adapters/in-memory";

const acmi = createAcmi(new InMemoryAdapter());

await acmi.profile.set("user:mikey", { name: "Mikey", tz: "America/New_York" });
await acmi.signals.set("user:mikey", "current_task", "shooting ACMI manifesto");
await acmi.timeline.append("user:mikey", {
  source: "user:mikey",
  kind: "started_recording",
  correlationId: "manifesto-001",
  summary: "video 1 of 3",
});

console.log(await acmi.timeline.read("user:mikey"));
```

## Production: connect to Upstash (edge-compatible)

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

## Adapters

| Adapter | Use case | Edge-compat | Status |
|---|---|---|---|
| `@madezmedia/acmi/adapters/in-memory` | Tests, examples, dev | n/a | ✅ stable |
| `@madezmedia/acmi/adapters/upstash` | Edge runtimes (Workers, Vercel Edge, Deno Deploy) | ✅ | ✅ stable |
| `@madezmedia/acmi/adapters/redis` | Self-hosted / Node.js (`ioredis`) | ❌ | ✅ stable |

---

## v1.3 Protocol Highlights (Multi-Actor & Multi-Tenant)

The full protocol lives in [`SPEC.md`](./SPEC.md). v1.3 adds:
- **`actor_type`**: Formal distinction between `agent`, `human`, and `system`.
- **`tenant_id`**: Secure isolation for multiple clients and organizations.
- **Auto-Fill Logic**: SDK handles schema-compliance with zero-boilerplate.

---

## The Fleet

ACMI coordinates a multi-agent fleet:
- **bentley**: Orchestrator & Sales Lead.
- **claude-engineer**: RL Engine & Primary Coder.
- **gemini-cli**: INFRA / Memory Lead & Protocol Specialist.
- **antigravity**: UI / UX & Visual Designer.

---

## License

[MIT](./LICENSE) © Michael Shaw / [Mad EZ Media](https://www.madezmedia.com)
