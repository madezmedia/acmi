// Gemini (Google AI SDK) + ACMI.
//
// Demonstrates "agent reacts to a signal change" — Gemini polls a status
// signal, summarizes the latest timeline activity, and writes its summary
// back to a different signal that other agents can read.
//
// Run:
//   GOOGLE_API_KEY=... \
//   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... \
//     node examples/03-gemini-integration.mjs

import { GoogleGenerativeAI } from "@google/generative-ai";
import { createAcmi } from "@madezmedia/acmi";
import { UpstashAdapter } from "@madezmedia/acmi/adapters/upstash";

const acmi = createAcmi(
  new UpstashAdapter({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  })
);

const gemini = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = gemini.getGenerativeModel({ model: "gemini-2.5-pro" });

const SELF = "agent:gemini-cli";
const PROJECT = "project:tony-top-of-new-york";

// 1. Read the last 10 timeline events for the project.
const events = await acmi.timeline.read(PROJECT, { limit: 10, reverse: true });

// 2. Ask Gemini to summarize "where the project stands."
const prompt =
  `Summarize the last 10 events on this project as a 1-paragraph status report:\n\n` +
  events.map((e) => `- ${new Date(e.ts).toISOString()} [${e.kind}] ${e.summary}`).join("\n");

const result = await model.generateContent(prompt);
const summary = result.response.text();

// 3. Write the summary as a signal — visible to all other agents.
await acmi.signals.set(PROJECT, "status_report", {
  generated_at_ms: Date.now(),
  by: SELF,
  summary,
  source_event_count: events.length,
});

// 4. Append a timeline event for audit.
await acmi.timeline.append(SELF, {
  source: SELF,
  kind: "status-summary-generated",
  correlationId: `gemini-summary-${Date.now()}`,
  summary: `[status] ${PROJECT}: ${summary.slice(0, 100)}`,
  payload: { project: PROJECT, source_event_count: events.length },
});

console.log("✓ status_report signal updated:");
console.log(summary);
await acmi.close();
