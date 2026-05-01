// Claude (Anthropic SDK) + ACMI.
//
// Demonstrates the canonical "agent reads profile, writes a signal, appends a
// timeline event" pattern. The agent's "memory" is just three Redis keys — and
// any other agent in the fleet can read or write the same three keys.
//
// Run:
//   ANTHROPIC_API_KEY=sk-... \
//   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... \
//     node examples/02-claude-integration.mjs

import Anthropic from "@anthropic-ai/sdk";
import { createAcmi } from "@madezmedia/acmi";
import { UpstashAdapter } from "@madezmedia/acmi/adapters/upstash";

const acmi = createAcmi(
  new UpstashAdapter({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  })
);

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SELF = "agent:claude-engineer";
const USER = "user:mikey";

// 1. Read the user's profile to know how to address them.
const profile = (await acmi.profile.get(USER)) ?? { name: "friend" };

// 2. Read the latest user signals — what are they doing right now?
const userSignals = await acmi.signals.all(USER);

// 3. Drive Claude with that context.
const message = await claude.messages.create({
  model: "claude-opus-4-7",
  max_tokens: 256,
  messages: [
    {
      role: "user",
      content:
        `${profile.name} is currently working on: ${userSignals.current_task ?? "(unknown)"}. ` +
        `Suggest one concrete next step in 2 sentences.`,
    },
  ],
});

const suggestion =
  message.content[0]?.type === "text" ? message.content[0].text : "(no text)";

// 4. Write the suggestion to the agent's own signals (so other agents can see it).
await acmi.signals.set(SELF, "last_suggestion", suggestion);

// 5. Append a timeline event so the activity is durable + auditable.
await acmi.timeline.append(SELF, {
  source: SELF,
  kind: "suggestion-emitted",
  correlationId: `claude-suggest-${Date.now()}`,
  summary: `[suggestion] for ${USER}: ${suggestion.slice(0, 80)}`,
  payload: { for: USER, suggestion, model: message.model, tokens: message.usage },
});

// 6. ALSO append to the user's timeline so they see it on their own feed.
await acmi.timeline.append(USER, {
  source: SELF,
  kind: "agent-suggestion",
  correlationId: `claude-suggest-${Date.now()}`,
  summary: `Claude suggested: ${suggestion.slice(0, 100)}`,
  payload: { from_agent: SELF, suggestion },
});

console.log("✓ suggestion emitted + recorded to two timelines:", suggestion);
await acmi.close();
