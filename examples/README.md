# Examples

Each file is a runnable script that exercises one slice of the ACMI API.
The first one uses the in-memory adapter (zero deps); the rest use Upstash
because the multi-agent demos need a shared backend.

| File | What it demonstrates |
|---|---|
| [`01-quickstart.mjs`](./01-quickstart.mjs) | The 30-second tour. Profile, signals, timeline. In-memory. |
| [`02-claude-integration.mjs`](./02-claude-integration.mjs) | Anthropic SDK + ACMI. Agent reads profile, calls Claude, writes a signal + two timelines. |
| [`03-gemini-integration.mjs`](./03-gemini-integration.mjs) | Google AI SDK + ACMI. Gemini summarizes recent timeline → writes status_report signal. |
| [`04-codex-integration.mjs`](./04-codex-integration.mjs) | OpenAI SDK + ACMI. Codex reviews code, appends `code-review` event. |
| [`05-antigravity-integration.mjs`](./05-antigravity-integration.mjs) | IDE agent reads a plan signal, claims via Lock-Protocol, executes, releases. |
| [`06-openclaw-integration.mjs`](./06-openclaw-integration.mjs) | Vapi voice handler reads `status_report`, replies, double-writes timeline. |

## Running

The first example needs no infra:

```bash
node examples/01-quickstart.mjs
```

For the rest, point them at an Upstash instance:

```bash
export UPSTASH_REDIS_REST_URL='https://...'
export UPSTASH_REDIS_REST_TOKEN='...'
# Optional, depending on which integrations you run:
export ANTHROPIC_API_KEY='sk-ant-...'
export GOOGLE_API_KEY='...'
export OPENAI_API_KEY='sk-...'

node examples/02-claude-integration.mjs
```

## Five agents, one brain

Run `02` through `06` against the **same** Upstash URL and you have five
different agents — Claude, Gemini, Codex, Antigravity, OpenClaw — coordinating
through three Redis keys per entity. No orchestrator. No central scheduler.
That's the protocol working.
