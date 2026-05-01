// Codex (OpenAI SDK) + ACMI.
//
// Demonstrates "agent appends a timeline event after every code commit" —
// the canonical pattern for making code-writing agents auditable.
//
// Run:
//   OPENAI_API_KEY=... \
//   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... \
//     node examples/04-codex-integration.mjs

import OpenAI from "openai";
import { createAcmi } from "@madezmedia/acmi";
import { UpstashAdapter } from "@madezmedia/acmi/adapters/upstash";

const acmi = createAcmi(
  new UpstashAdapter({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  })
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SELF = "agent:codex";
const PROJECT = "project:acmi";

// 1. Read the project's coding-style preferences from its profile.
const profile = (await acmi.profile.get(PROJECT)) ?? {};
const styleHints = profile.code_style ?? "TypeScript strict, ESM-first";

// 2. Generate a small code change.
const completion = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [
    {
      role: "system",
      content: `You are an automated code reviewer. Style: ${styleHints}.`,
    },
    {
      role: "user",
      content:
        "Review this snippet. Reply with PASS or FAIL plus a one-line reason:\n\n" +
        "function add(a, b) { return a + b }",
    },
  ],
});

const verdict = completion.choices[0]?.message?.content ?? "(no response)";

// 3. Append a timeline event recording the review.
const correlationId = `codex-review-${Date.now()}`;
await acmi.timeline.append(PROJECT, {
  source: SELF,
  kind: "code-review",
  correlationId,
  summary: `[code-review] ${verdict.slice(0, 100)}`,
  payload: {
    verdict,
    snippet_hash: "demo",
    model: completion.model,
    tokens: completion.usage,
  },
});

// 4. Update the agent's signals so other agents know what Codex is doing.
await acmi.signals.set(SELF, "last_review_correlationId", correlationId);
await acmi.signals.set(SELF, "last_review_verdict", verdict);

console.log("✓ review recorded:", verdict);
await acmi.close();
