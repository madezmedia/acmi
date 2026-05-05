# Three Keys

*A memory protocol for multi-agent teams. Or: why your AI agents have amnesia and how to fix it for the cost of a Redis instance.*

**v1.0 — 2026-05-04 — Michael Shaw, Madez Media**

---

I run eight AI agents across two CLIs and a cloud runner. They handle Gmail and Vapi calls for my pump company. They draft and schedule social content. They book dispatch jobs. They audit each other's work for hallucinations. At the end of every day they leave me a one-page summary of what got done so I can sleep.

For most of last year, I tried to build this the way every tutorial said to.

- Vector DB for "memory."
- Postgres for the customer record.
- A graph DB because someone on Twitter said agents need knowledge graphs.
- Temporal — or Celery, or Inngest, or whatever — for handoffs.
- A webhook catcher glued to an n8n workflow glued to a Zap glued to a prayer.

Five services. Five auth flows. Five places state could drift. Every new agent meant five more adapters. Every outage meant debugging five integration seams at once. It worked, barely, in a way that made me question whether any of this was actually going to scale past me.

Then one night I deleted four of the five services and put everything on one Redis. The agents got faster. The code got shorter. The bugs got fewer. And a pattern I'd been half-seeing for months snapped into focus.

I'm calling it **ACMI** — the Agentic Context Memory Interface. Three keys per entity, one substrate, one schema that fits every domain I run. That's it. That's the whole thing.

It's not a new idea so much as a new arrangement of old ideas that happens to be exactly the shape AI agents want to read and write. This essay is about why that arrangement is beautiful — not "clever," **beautiful**, in the sense that every line of code you delete makes the system feel more correct, not less.

It's also the first piece of a public release. The npm package is live: `npm install @madezmedia/acmi`. The repo is at github.com/madezmedia/acmi. There's a CLI, an SDK, three storage adapters, and a conformance test suite that any other implementation can run to claim ACMI compatibility. None of which would matter if the underlying shape weren't right.

Let me show you the shape.

---

## The amnesia problem

Modern LLMs are extraordinary at single-turn reasoning. They are catastrophic at remembering anything between turns. Every product built around them ships some band-aid for this — a vector store, a context-stuffing pattern, a "memory" feature that quietly ignores most of what you tell it.

For one agent talking to one user, the band-aid mostly works. Tools like Mem0, Zep, and Letta are well-engineered solutions to *that* problem and you should use them when it's your problem.

But the moment you have **more than one agent collaborating on the same business**, the band-aids start tearing. Here is what actually happens:

- Agent A runs at 9am over your Gmail inbox. It updates a customer record and writes a reply.
- Agent B runs at 11am from a different cron, on a different model, with a different prompt. It tries to qualify the same customer and has no idea Agent A already replied.
- Agent C is your Telegram-ops bot. It nudges you about the same customer at lunch, oblivious to either of the prior agents.
- You finally read all three messages and try to reconstruct what your own systems did to your own customer. Forty minutes later you decide to stop using AI agents for sales.

Per-agent memory does not fix this. It makes it worse. Each agent gets *better* at remembering its own version of reality, which makes them harder to reconcile when their realities disagree.

The right primitive isn't "agent memory." It's **a shared, append-only timeline that any number of heterogeneous agents — running on different runtimes, different models, different schedules — can read from and write to as their first action and their last action**.

That primitive doesn't have a category yet. Mem0 is per-user. LangGraph checkpoints are per-graph. MCP is per-tool-call. The cross-agent, cross-runtime, cross-platform coordination log is unclaimed ground.

ACMI's job is to claim it.

---

## Why the shape matters

Every working system I've ever admired had the same quality: one primitive, used everywhere.

Unix has files. Devices are files. Pipes are files. Network sockets are files. It's not that every Unix tool is great — it's that the *substrate* is the same primitive, and every tool becomes legible the moment you learn it.

Git has the commit. Branches are pointers to commits. Tags are pointers to commits. Merges produce commits. Reverts are commits. A whole distributed version-control universe, and the object graph has three types.

Redis has keys and a handful of data types. The Lisp of databases.

Most AI agent stacks I've seen are the opposite of that. They're a pile of *different* primitives — vectors, rows, nodes, queue messages, tool calls — each with its own consistency model, its own auth flow, its own answer to "when does this change and who can see it." You end up reasoning about five substrates at once every time an agent has to do something useful.

I kept asking: what is the one primitive an agent actually needs to do its job?

The answer my stack eventually gave me was: **a key, a JSON snapshot, and a timeline.**

That's the whole thing.

---

## The Three Keys

Every entity in my business — a customer, a truck, a project, a support ticket, a sales deal, an autonomous character my media company publishes — gets exactly three Redis keys. Nothing else.

### Profile — the hard state

`acmi:sales:gardine-wilson:profile` is a JSON document. Company name, stage, budget, contact, last-quoted price. The facts that would go in a database row if this were 2015. When the facts change, an agent overwrites the JSON. That's it. There's no migration ceremony, no foreign-key gymnastics, no ORM. There's a key and there's JSON.

```bash
acmi profile sales gardine-wilson '{"company":"Gardine-Wilson","stage":"Proposal Sent","budget":85000}'
```

### Signals — the soft state

`acmi:sales:gardine-wilson:signals` is JSON the agent *synthesizes*. Churn risk: low. Sentiment: warming. Next best action: "follow up Friday with the revised proposal." The agent reads the profile and the timeline, thinks, and writes signals back. The next agent that shows up — maybe a different model, maybe a different runtime — reads the signals first and doesn't have to re-derive them.

```bash
acmi signal sales gardine-wilson '{"churn_risk":"low","next_action":"Follow up Friday"}'
```

This is the line between facts and AI synthesis. Profile is source-of-truth. Signals can be wrong, stale, or recomputed at any time. When an agent goes sideways, you nuke its Signals and the Profile survives untouched. That's the most important boundary in the schema.

### Timeline — the event stream

`acmi:sales:gardine-wilson:timeline` is a Redis sorted set. Score is `unix_ms`. Each member is a JSON event: the Gmail thread that came in, the Vapi call that happened, the proposal you sent, the webhook from your CRM, the note an agent left for its future self. Everything that has ever happened to this customer, in one chronological log, from every platform that touched them.

```bash
acmi event sales gardine-wilson "gmail" "Sent revised proposal PDF, $82.5K with 5% net-30 discount."
```

That's the API. Three commands plus a `get`:

```bash
acmi get sales gardine-wilson
```

`get` returns Profile + Signals + the last 50 timeline events as a single JSON payload that fits in a context window. The agent reads it, decides, writes its own event back to the timeline, updates Signals, and moves on.

Four commands total. Same four commands work for sales, support, dispatch, content, project management, customer success, autonomous characters my media side publishes — different namespace, same surface.

That's the separation.

---

## What the Three Keys actually separate

This is the part I think most stacks are getting wrong. When you bolt a vector DB onto an agent, you're coupling *retrieval strategy* to *storage*. When you put your customer data in Postgres and your conversation history in Pinecone and your task queue in Redis, you're coupling *source system* to *access pattern*.

ACMI separates three things every other stack tangles:

**1. Application layer ↔ Agent layer.** My pump company doesn't need to know anything about AI. It fires webhooks into Redis. Agents read the timeline, write back, change Signals. If I swap Claude for Gemini tomorrow, the pump company doesn't notice. If I swap Redis for Upstash for KeyDB, the agents don't notice. The substrate is the boundary.

**2. Hard state ↔ Soft state.** Facts (Profile) and AI synthesis (Signals) live in different keys with different lifecycles. Profile is curated. Signals are disposable. When an agent hallucinates, you wipe Signals and the truth survives. This is the boundary that lets me ship aggressive AI synthesis without losing sleep about data integrity.

**3. State ↔ History.** The current snapshot (Profile + Signals) is cheap to read and cheap to update. The full history (Timeline) is append-only and chronologically ordered. Different access patterns, different keys, no foreign-key dance.

All three separations collapse into one schema:

```
acmi:{namespace}:{id}:{profile|signals|timeline}
```

Three keys, three concerns, one substrate.

This isn't new thinking. It's CQRS — Fowler wrote about it in 2005. It's event sourcing. It's the blackboard pattern from 1980s AI research. What's new — for agents, in 2026 — is how *exactly* these shapes match the way an LLM actually wants to consume context.

A language model wants: a snapshot of facts, a synthesized summary of how to think about them, and the last N things that happened, in order. That isn't a database query. That is exactly three Redis keys.

---

## The unclaimed primitive: timeline as coordination bus

Everything above is a well-arranged application of prior patterns. Senior infra engineers have been shipping CQRS on Redis for fifteen years. I won't pretend the storage layer is a breakthrough.

Here is the part I think *is* new — or at least the part I haven't seen framed this way before:

**The timeline isn't just memory. It's a coordination bus.**

When my Claude Code session wants to hand state to my Gemini CLI session, it ZADDs an event to a *shared* timeline — `acmi:thread:fleet-coordination:timeline` — and Gemini ZRANGEs it next time it wakes up. No orchestrator. No message bus. No Temporal, Inngest, or Celery in the path.

When one agent leases an inbox item, it does:

```bash
SET NX EX 600 lease:<item_id>
```

No other agent touches that item for ten minutes. If the leasing agent crashes, the lease expires naturally and the work returns to the pool. No reaper job, no manual recovery — just TTL semantics doing exactly what TTL semantics were always good at.

When my pump-company agent writes a `kind: handoff-request` event on the dispatch thread, the next agent that ticks picks it up, executes against it, ZADDs a `kind: handoff-ack` with a `correlation_id`, and the loop closes itself. The agents don't need to know about each other. They just read and write the same ZSET and trust the chronology.

This is the part that runs against the grain of every agent framework I've seen. LangGraph wants you to define a graph of agents and the edges between them. CrewAI wants a Manager agent that orchestrates a Worker agent. AutoGen wants a conversation pattern. They all assume that **agents need to be told who to talk to**.

ACMI assumes the opposite. Agents read a shared log. They don't know each other's names. They don't have to. The chronology is the coordination.

The primitives this gives you, on a single Redis substrate:

- **Lease lock**: `SET NX EX 600 lease:<id>` — gives one agent exclusive access to an item, with crash-recovery built in.
- **Handoff**: `ZADD <thread> <ts> {"kind":"handoff-request","from":"A","to":"B","correlationId":"..."}` — followed by an ack event when the receiver picks it up.
- **Heartbeat**: `ZADD <agent>:timeline <ts> {"kind":"heartbeat","status":"online"}` — periodic, easy to query for liveness.
- **Snapshot**: `GET <entity>:profile` — atomic read of an entity's current truth.
- **Cost tracking**: append-to-list inside Signals, or a parallel `acmi:cost:<agent>:hourly` key.
- **Inbox**: ZSET keyed by priority, processed by drainer agents that lease items and emit completion events.

It's just Redis. Three or four commands. A lease key. Nothing clever. And yet I've never seen the combination — *shared timeline + lease + handoff events on the same substrate as memory* — called out as a primitive. Mem0 is per-user. LangGraph checkpoints are per-graph. MCP is per-tool-call. The cross-agent, cross-platform, cross-runtime, cross-session coordination log is the gap.

That gap is what ACMI is for.

---

## What ACMI is not

A protocol gets clearer when you say what it isn't.

- **Not a vector DB.** I don't embed anything in the core. If you need semantic retrieval later, add it as a fourth key (`acmi:<ns>:<id>:embeddings`) and keep the schema open. Today, fifty events in chronological order is more than my agents need. When that stops being true I'll add a key, not a service.

- **Not a graph DB.** Entities are flat. Relationships live in Profile JSON or in shared timeline threads. If you need true graph traversal, bolt Graphiti on top — it'll read your timelines just fine. I don't, today.

- **Not a replacement for Mem0 or Zep.** They're better at long-term per-agent personalization than ACMI is. Use them if that's your problem. ACMI is the right shape if your problem is *many agents coordinating across many platforms on many domains*. The two patterns can coexist — Mem0 inside one agent, ACMI as the cross-agent fabric.

- **Not a platform.** It's a schema, a CLI, an SDK, three storage adapters, and a conformance test suite. That's it. There is no SaaS to subscribe to. There is no proprietary vector store. There is no orchestrator service that takes a cut. The substrate is your Redis (or your Upstash, or your in-memory adapter for tests). You own everything.

- **Not magic.** Agents will still hallucinate. They'll still write bad Signals sometimes. They'll still occasionally lease an item and then ghost. ACMI gives you the substrate to *see* those failures fast — append-only timelines mean nothing is lost — and the boundary semantics to *recover* from them — wipe Signals, profile survives. It doesn't make agents smart. It makes their dumb moments survivable.

---

## Protocol, not product

Most people building in this space are building products. I'm not. ACMI is a protocol.

The reason matters. Products win when you can lock customers in — proprietary storage, custom query languages, a platform ecosystem. Protocols win when the underlying *shape* is so right that everyone who tries it ends up implementing some version of it anyway, and standardizing the shape saves the whole ecosystem time.

HTTP is a protocol. HTML is a protocol. Markdown is a protocol. Git's object format is a protocol. Each one started as somebody's specific implementation, escaped into the wild, and became something everyone could implement against without paying rent.

I want ACMI to be that. Specifically:

1. **The schema is open.** `acmi:{namespace}:{id}:{profile|signals|timeline}` is documented at github.com/madezmedia/acmi/SPEC.md. Anyone can implement an ACMI-compatible store on any backend. The reference implementation runs on Redis/Upstash, but the conformance test suite is backend-agnostic.

2. **Multiple implementations are good.** I want ACMI on Postgres. ACMI on Cloudflare Durable Objects. ACMI on SQLite for local-first agents. ACMI on Convex. ACMI on whatever the right substrate turns out to be for embedded devices in five years. The schema doesn't care. Pass the conformance suite, claim compatibility.

3. **The npm package is the on-ramp, not the product.** `@madezmedia/acmi` is a TypeScript SDK + CLI that gives you the four commands from the top of this essay. It's deliberately small (the SDK is under a few thousand lines) so anyone can read it, fork it, port it. If you build a Python implementation, a Rust implementation, a Go implementation — please do. Open a PR to the SPEC if you find a gap. The protocol grows by use.

4. **No vendor lock-in path.** I have no plans to introduce a proprietary tier. There's no `acmi-cloud` SaaS. There's no enterprise license. The only services I'd build on top would be things like "ACMI-as-a-managed-Upstash" — and even that would be optional infrastructure, not a moat.

The whole thing is MIT licensed. Use it for anything. Take the schema and reimplement it with a different name if you want — the only thing that costs you is the chance to participate in standardizing the protocol that's about to exist whether you participate or not.

---

## The operator angle

I built this because I'm one person running several businesses. I don't have an infra team. I don't have a DevOps hire. I have a Redis instance that costs less than my Spotify subscription and eight agents that file themselves into it while I sleep.

This is what I mean when I talk about being an **augmented operator**: it's not a cyborg fantasy. It's a boring fact. *One person + a well-chosen substrate + a handful of language models* can do the work of a small team — but only if the substrate is clean enough to reason about at 11pm with one cup of coffee left.

For me that has meant a Redis instance, an `acmi` CLI, a single-file SDK, and the discipline to never let a new dependency in unless it earns its keep. The eight agents I run are heterogeneous: two are local Claude Code sessions, two are cloud Claude triggers, one is a Gemini CLI, one is an Antigravity browser agent, one is an autonomous character I publish content as, one is the daily-driver that audits the rest. They share nothing except the Redis substrate and the schema in this essay.

Every one of them, when it boots, does the same thing:

1. Read its `acmi:agent:<name>:profile` for who it is and what it's allowed to do.
2. Read its `acmi:agent:<name>:signals` for current mood, current focus, current cost budget.
3. Read the last N events on `acmi:thread:<active-thread>:timeline` to know what other agents have been up to.
4. Do its work.
5. Write its own events back.

That five-step loop — read profile, read signals, read shared timeline, work, write back — is the whole interface every agent in my fleet uses. It works whether the agent is a 600-line Python script or a 50K-token Claude session. It works on a $5 Upstash plan. It works offline if I switch to the in-memory adapter for tests.

The protocol is the small unit. Everything else compounds on top of it.

---

## What this enables

When you have eight agents that all read and write the same coordination log, things start happening that don't happen with one agent and a vector DB.

- **Audit becomes free.** Every action ever taken by any agent on any entity is on a timeline somewhere. When something goes wrong I `ZRANGE` and read what happened. There is no "I think Agent B did this on Tuesday" — the event is there with a timestamp.

- **Rollback becomes cheap.** Profile is the source of truth, Signals are derived. When an agent corrupts an entity's Signals, I delete the Signals and the next tick rebuilds them from the timeline. No backups, no recovery procedure, just delete-and-recompute.

- **Heterogeneous fleets become normal.** I don't have to standardize on one model, one runtime, one cloud, one schema. Anything that can read and write Redis can join. The Gemini CLI and the Claude Code session don't even know they're collaborating — they just both write to the same timeline and pick up each other's events.

- **Cost tracking becomes a primitive.** Every agent appends a `kind: cost-tick` event with token count and dollar estimate to its own timeline. Total cost is `ZRANGEBYSCORE acmi:agent:<name>:timeline +inf <today_ms> | jq sum`. No per-vendor billing dashboard, no separate observability stack.

- **Continuity across compaction becomes possible.** When my Claude session compacts and loses its conversation memory, the *agent's identity* persists in `acmi:agent:claude-engineer:profile` and the work-in-progress is in `acmi:thread:<current-project>:timeline`. The new session boots, reads both, and is back in flight in seconds. The conversation died; the work didn't.

- **An agent can be replaced by another agent without ceremony.** When I want to swap GLM-5.1 for Claude Sonnet 4.6 on a particular schedule, the only change is the model the runner invokes. Profile, signals, and timeline don't move. The substitute agent reads what the previous one wrote and continues. No state migration, no handoff document, no debugging session.

These aren't theoretical benefits. They're how I run the eight agents I run. The protocol enables them by making the underlying primitive small enough to actually trust.

---

## How to start

If you've read this far and want to try it, the fastest path is:

```bash
npm install @madezmedia/acmi
```

Then either point it at an Upstash Redis (free tier is enough), a local Redis, or the built-in in-memory adapter for testing. The README at github.com/madezmedia/acmi has a four-minute quickstart that walks you through writing a Profile, appending a Timeline event, and reading the snapshot back.

If you're already running a multi-agent stack on something else and want to discuss whether ACMI is the right fit, I'd genuinely rather hear about your problem than assume my answer applies. The repo's Discussions tab is open. If you write a great use case I'll quote you in v2 of this essay.

If you build something on it, ZADD an event on `acmi:thread:public:timeline` (the registry is in the README) and tell me what you built. I'll see it the next time my agents wake up.

If you'd rather stay anonymous and just star the repo so the protocol gets oxygen, that's enough. Stars are how protocols beat platforms in the early days. Github.com/madezmedia/acmi.

---

## What's next

This is essay one of three. Two more are coming on a tight schedule.

- **Video 1 (now):** the manifesto, told as a 4-minute walkthrough.
- **Video 2 (T+72h):** a live demo. Eight agents, one Redis, one keyboard. Watch them coordinate in real time.
- **Video 3 (T+10d):** the deep-dive. The schema, the conformance suite, the three reference adapters, and the lessons learned from running this in production for four months.

Beyond the trilogy: Folana Lanez, a fully autonomous music-and-media character my company publishes, is the first character built natively on ACMI v1 from her memory layer up. Her grounded identity, her trend-ingestion loop, her songwriting blueprints, her fan interactions — all of it lives in `acmi:character:folana:v1:*`. She's the proof that this scales beyond business operations into creative autonomy. The architecture document is public at github.com/madezmedia/acmi (more on her in Video 3).

Sigil v2 — an optional cryptographic identity layer for when you need agents to prove they actually performed an action — is on the roadmap, gated on community traction. The internal memo is published. The shippable thing is gated on you. If the protocol earns 5,000 GitHub stars, Sigil ships. If it earns 100,000, we standardize against IETF.

That's the bet. Boring substrate, surprising primitive, open protocol, multiple implementations, no platform tax. If it's the right shape, you'll feel it within a week of installing the package. If it isn't, I'll have learned something and you'll have spent less than an afternoon.

The substrate is yours. The schema is yours. The agents already know how to write to it.

The only question is whether they should.

Mine do.

— Mikey Shaw
github.com/madezmedia/acmi
