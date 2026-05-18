import { Octokit } from "@octokit/rest";
import { createAcmi } from "../src/client.js";
import { UpstashAdapter } from "../src/adapters/upstash.js";

/**
 * ACMI Issues Watcher
 * 
 * Periodically polls GitHub for new issues and mirrors them to ACMI
 * for agentic resolution within the 48h SLA window.
 */

async function main() {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
  const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!GITHUB_TOKEN || !UPSTASH_URL || !UPSTASH_TOKEN) {
    console.error("Missing required env vars: GITHUB_TOKEN, UPSTASH_REDIS_REST_URL, _TOKEN");
    process.exit(1);
  }

  const octokit = new Octokit({ auth: GITHUB_TOKEN });
  const adapter = new UpstashAdapter({ url: UPSTASH_URL, token: UPSTASH_TOKEN });
  const acmi = createAcmi(adapter);

  const repos = [
    { owner: "madezmedia", repo: "acmi" },
    { owner: "madezmedia", repo: "cowork-kanban" }
  ];

  console.log("🔍 Checking for new GitHub issues...");

  for (const { owner, repo } of repos) {
    const { data: issues } = await octokit.issues.listForRepo({
      owner,
      repo,
      state: "open",
      sort: "created",
      direction: "desc",
      per_page: 10
    });

    for (const issue of issues) {
      if (issue.pull_request) continue; // Skip PRs

      const issueId = `iss-gh-${repo}-${issue.number}`;
      const entityId = `issue:madez:${issueId}`;

      // Check if already in ACMI
      const existing = await acmi.profile.get(entityId);
      if (existing) continue;

      console.log(`✨ New issue detected: ${owner}/${repo}#${issue.number} - ${issue.title}`);

      const deadlineTs = Date.now() + (48 * 3600 * 1000); // 48h SLA

      await acmi.profile.set(entityId, {
        id: issueId,
        title: issue.title,
        description: issue.body || "",
        github_url: issue.html_url,
        repo: `${owner}/${repo}`,
        created_at_ms: Date.now(),
        deadline_ts: deadlineTs,
        tenant_id: "madez",
        actor_type: "system"
      });

      await acmi.signals.set(entityId, "status", "open");
      await acmi.signals.set(entityId, "priority", 1);
      await acmi.signals.set(entityId, "sla_violation", false);

      await acmi.timeline.append(entityId, {
        source: "system:gh-watcher",
        kind: "issue-mirrored",
        correlationId: `gh-sync-${issue.number}`,
        summary: `Issue mirrored from GitHub: ${issue.title}`
      });

      // Mirror to coordination thread
      await acmi.timeline.append("thread:agent-coordination", {
        source: "system:gh-watcher",
        kind: "task-delegation",
        correlationId: `gh-sync-${issue.number}`,
        summary: `[new-issue] GitHub #${issue.number}: ${issue.title} (SLA: 48h)`,
        payload: {
          issue_id: entityId,
          github_url: issue.html_url,
          deadline_iso: new Date(deadlineTs).toISOString()
        }
      });
    }
  }

  console.log("✅ Done.");
  process.exit(0);
}

main().catch(err => {
  console.error("❌ Watcher failed:", err);
  process.exit(1);
});
