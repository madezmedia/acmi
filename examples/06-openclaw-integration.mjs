// OpenClaw (Vapi voice agent) + ACMI.
//
// Demonstrates "voice agent reads a status signal mid-call, answers, and
// appends the call to the user's timeline." This is the canonical OpenClaw
// pattern — Vapi server-tools call into Node, ACMI is the shared brain.
//
// Run as a Vapi server-tool. The handler signature follows Vapi's tool calling
// convention: `(req, res) => res.json({ result })`. We export it for any
// HTTP framework (Next.js route, Express, Hono, …).
//
//   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=...
//
// Demo invocation at the bottom uses a fake Vapi-shaped request.

import { createAcmi } from "@madezmedia/acmi";
import { UpstashAdapter } from "@madezmedia/acmi/adapters/upstash";

const acmi = createAcmi(
  new UpstashAdapter({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  })
);

const SELF = "agent:openclaw";

/**
 * Vapi tool handler: "where are we on project X?"
 *
 * Vapi invokes this with the user's question parsed into structured args.
 * The handler reads the project's status_report signal (written by Gemini in
 * `03-gemini-integration.mjs`) and returns the summary as the spoken answer.
 */
export async function whereAreWeHandler(req) {
  const { project_slug, caller_user_id } = req.body.args ?? {};
  if (!project_slug) return { result: "Which project?" };

  const projectId = `project:${project_slug}`;
  const userId = caller_user_id ? `user:${caller_user_id}` : null;
  const correlationId = `openclaw-call-${Date.now()}`;

  // 1. Read the latest status report.
  const status = await acmi.signals.get(projectId, "status_report");
  const reply =
    status && typeof status === "object" && "summary" in status
      ? status.summary
      : `I don't have a status report for ${project_slug} yet.`;

  // 2. Append a call event to the project timeline.
  await acmi.timeline.append(projectId, {
    source: SELF,
    kind: "voice-query",
    correlationId,
    summary: `[voice-query] caller asked 'where are we' on ${project_slug}`,
    payload: { caller: userId, replied_with: String(reply).slice(0, 200) },
  });

  // 3. ALSO append to the caller's own timeline so their feed reflects the call.
  if (userId) {
    await acmi.timeline.append(userId, {
      source: SELF,
      kind: "voice-call",
      correlationId,
      summary: `Asked OpenClaw about ${project_slug}`,
      payload: { project: projectId, query: "where_are_we" },
    });
  }

  return { result: reply };
}

// ─── Demo (skip in production) ────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const fakeReq = {
    body: { args: { project_slug: "tony-top-of-new-york", caller_user_id: "mikey" } },
  };
  const out = await whereAreWeHandler(fakeReq);
  console.log("✓ voice agent replied:", out.result);
  await acmi.close();
}
