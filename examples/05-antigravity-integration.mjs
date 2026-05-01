// Antigravity (Google's agentic IDE) + ACMI.
//
// Demonstrates "agent reads a plan from signals, executes, writes back."
// In a real Antigravity flow, this runs as a tool the IDE invokes; here we
// simulate it as a plain Node script.
//
// Run:
//   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... \
//     node examples/05-antigravity-integration.mjs

import { createAcmi } from "@madezmedia/acmi";
import { UpstashAdapter } from "@madezmedia/acmi/adapters/upstash";

const acmi = createAcmi(
  new UpstashAdapter({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  })
);

const SELF = "agent:antigravity";
const PROJECT = "project:landing-page";

// 1. Read the current_plan signal — written by another agent (e.g. Claude).
const signals = await acmi.signals.all(PROJECT);
const plan = signals.current_plan;

if (!plan) {
  console.log("no current_plan signal — nothing to do");
  await acmi.close();
  process.exit(0);
}

// 2. Lock-Protocol pattern — claim the plan via a per-task lease.
const taskKey = `task_${plan.id ?? Date.now()}`;
const claimed = signals[`claim_${taskKey}`];
if (claimed && claimed !== SELF) {
  console.log(`task ${taskKey} already claimed by ${claimed}; skipping`);
  await acmi.close();
  process.exit(0);
}
await acmi.signals.set(PROJECT, `claim_${taskKey}`, SELF);

// 3. Append a "started" event.
const correlationId = `antigravity-exec-${Date.now()}`;
await acmi.timeline.append(PROJECT, {
  source: SELF,
  kind: "task-started",
  correlationId,
  summary: `[task-started] executing plan ${plan.id ?? "(no id)"}`,
  payload: { plan_summary: plan.summary, claimed_as: SELF },
});

// 4. (In real life: this is where Antigravity does the IDE work — git ops,
//     code edits, browser automation, etc.) Here: just simulate.
const filesChanged = ["index.html", "styles.css", "script.js"];

// 5. Append a "completed" event with full payload.
await acmi.timeline.append(PROJECT, {
  source: SELF,
  kind: "task-completed",
  correlationId: `${correlationId}-done`,
  parentCorrelationId: correlationId,
  summary: `[task-completed] plan ${plan.id ?? "(no id)"}: ${filesChanged.length} files changed`,
  payload: {
    files_changed: filesChanged,
    duration_ms: 2300,
    plan_summary: plan.summary,
  },
});

// 6. Release the claim.
await acmi.signals.delete(PROJECT, `claim_${taskKey}`);

console.log(`✓ executed plan ${plan.id ?? "(no id)"}; ${filesChanged.length} files changed`);
await acmi.close();
