#!/usr/bin/env node

/**
 * Index Claude Code session transcripts into ACMI.
 *
 * Walks ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl, reads the first line
 * of each session to pull sessionId + start timestamp + first user prompt,
 * filters by age, and writes one event per session to:
 *   - acmi:project:<slug>:timeline       (so projects have session history)
 *   - acmi:agent:claude-engineer:timeline (so Claude's own timeline populates)
 *
 * Events are written with source="claude_session" so acmi.mjs summarize
 * counts them correctly. ZADD members include sessionId to stay unique.
 *
 * Usage:
 *   node index-sessions.mjs                  # last 60 days, live
 *   node index-sessions.mjs --days 90        # custom window
 *   node index-sessions.mjs --dry-run        # preview, no writes
 *   node index-sessions.mjs --limit 10       # process first N sessions only
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { homedir } from "node:os";

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!UPSTASH_URL || !UPSTASH_TOKEN) {
  console.error("ERROR: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN required in env.");
  process.exit(1);
}

const PROJECTS_ROOT = join(homedir(), ".claude", "projects");
const AGENT_TIMELINE_KEY = "acmi:agent:claude-engineer:timeline";
const AGENT_LIST_KEY = "acmi:agent:list";
const PROJECT_LIST_KEY = "acmi:project:list";

function parseArgs(argv) {
  const args = { days: 60, limit: Infinity, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--days") args.days = parseInt(argv[++i], 10);
    else if (a === "--limit") args.limit = parseInt(argv[++i], 10);
    else if (a === "--dry-run") args.dryRun = true;
  }
  return args;
}

async function redis(...command) {
  const res = await fetch(UPSTASH_URL.replace(/\/$/, "") + "/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Upstash: ${data.error}`);
  return data.result;
}

/** -Users-michaelshaw-clawd → clawd ; paperclip-...-uuid → paperclip-<short> */
function slugFromDir(dir) {
  // Collapse "--" → "-" (happens when an actual hyphen sits in the original path)
  const cleaned = dir.replace(/^-+/, "").replace(/--+/g, "-");
  const parts = cleaned.split("-");
  const idx = parts.findIndex(p => p === "Users");
  const tail = idx >= 0 ? parts.slice(idx + 2) : parts;
  let slug = tail.join("-").toLowerCase() || "home";
  // Collapse noisy paperclip workspace paths to paperclip-<short-uuid>
  const pcMatch = slug.match(/^paperclip-instances-default-workspaces-([0-9a-f]{8})/);
  if (pcMatch) slug = `paperclip-${pcMatch[1]}`;
  return slug.length > 80 ? slug.slice(0, 80) : slug;
}

/** -Users-michaelshaw-clawd → /Users/michaelshaw/clawd */
function cwdFromDir(dir) {
  return dir.replace(/-/g, "/");
}

/** Read up to `max` lines, parse each as JSON, return the array of objects that parsed. */
async function readHeadJsonl(filePath, max = 25) {
  return new Promise((resolve, reject) => {
    const out = [];
    const stream = createReadStream(filePath, { encoding: "utf8", highWaterMark: 64 * 1024 });
    const rl = createInterface({ input: stream });
    rl.on("line", line => {
      try { out.push(JSON.parse(line)); } catch {}
      if (out.length >= max) { rl.close(); stream.destroy(); }
    });
    rl.on("close", () => resolve(out));
    rl.on("error", reject);
    stream.on("error", reject);
  });
}

function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function findFirstUserPrompt(rows) {
  for (const r of rows) {
    // queue-operation.enqueue carries the raw user text
    if (r.type === "queue-operation" && r.operation === "enqueue" && typeof r.content === "string") {
      return r.content;
    }
    // user-authored message entry
    if (r.type === "user" && r.message) {
      const m = r.message;
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        const txt = m.content.find(p => p.type === "text" && typeof p.text === "string");
        if (txt) return txt.text;
      }
    }
  }
  return "";
}

function findFirstTimestamp(rows) {
  for (const r of rows) if (typeof r.timestamp === "string") return r.timestamp;
  return null;
}

function findSessionId(rows, filePath) {
  for (const r of rows) {
    const id = r.sessionId || r.session_id;
    if (id) return id;
  }
  // Fallback: each file is named <uuid>.jsonl
  const m = filePath.match(/([0-9a-f-]{36})\.jsonl$/i);
  return m ? m[1] : null;
}

async function extractSession(filePath, projectDir) {
  let rows;
  try {
    rows = await readHeadJsonl(filePath, 25);
  } catch (err) {
    return { error: `read: ${err.message}` };
  }
  if (!rows.length) return { error: "empty file" };

  const sessionId = findSessionId(rows, filePath);
  const timestamp = findFirstTimestamp(rows);
  if (!sessionId || !timestamp) return { error: "no sessionId/timestamp in head" };

  const ts = Date.parse(timestamp);
  if (isNaN(ts)) return { error: `bad ts: ${timestamp}` };

  const prompt = findFirstUserPrompt(rows);
  const stats = await stat(filePath);
  const slug = slugFromDir(projectDir);
  const cwd = cwdFromDir(projectDir);

  return {
    ok: true,
    session_id: sessionId,
    ts,
    project: slug,
    cwd,
    first_prompt: truncate(prompt, 500),
    byte_size: stats.size,
    file: filePath,
  };
}

async function walkSessions(cutoffMs) {
  const sessions = [];
  let projectDirs;
  try {
    projectDirs = await readdir(PROJECTS_ROOT);
  } catch (err) {
    throw new Error(`Cannot read ${PROJECTS_ROOT}: ${err.message}`);
  }
  for (const dir of projectDirs) {
    const full = join(PROJECTS_ROOT, dir);
    let entries;
    try {
      entries = await readdir(full, { withFileTypes: true });
    } catch { continue; }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
      const fp = join(full, e.name);
      const st = await stat(fp).catch(() => null);
      if (!st) continue;
      if (st.mtimeMs < cutoffMs) continue;
      sessions.push({ filePath: fp, projectDir: dir });
    }
  }
  return sessions;
}

async function writeEvent(timelineKey, event) {
  await redis("ZADD", timelineKey, event.ts, JSON.stringify(event));
}

async function main() {
  const args = parseArgs(process.argv);
  const cutoffMs = Date.now() - args.days * 86400 * 1000;
  console.error(`[index] scanning ${PROJECTS_ROOT}`);
  console.error(`[index] window: last ${args.days}d (since ${new Date(cutoffMs).toISOString()})`);

  const candidates = await walkSessions(cutoffMs);
  console.error(`[index] found ${candidates.length} session files in window`);

  const parsed = [];
  const skipped = [];
  for (const c of candidates) {
    const result = await extractSession(c.filePath, c.projectDir);
    if (result.ok) parsed.push(result);
    else skipped.push({ file: c.filePath, reason: result.error });
    if (parsed.length >= args.limit) break;
  }

  const byProject = {};
  for (const s of parsed) {
    (byProject[s.project] ||= []).push(s);
  }

  console.error(`[index] parsed ${parsed.length} sessions across ${Object.keys(byProject).length} projects`);
  if (skipped.length) console.error(`[index] skipped ${skipped.length} (see --dry-run for details)`);

  if (args.dryRun) {
    console.log(JSON.stringify({
      window_days: args.days,
      session_count: parsed.length,
      project_count: Object.keys(byProject).length,
      by_project: Object.fromEntries(Object.entries(byProject).map(([k, v]) => [k, v.length])),
      sample: parsed.slice(0, 3).map(s => ({
        project: s.project, ts: new Date(s.ts).toISOString(),
        session_id: s.session_id, prompt_preview: truncate(s.first_prompt, 120),
      })),
      skipped: skipped.slice(0, 10),
    }, null, 2));
    return;
  }

  let written = 0;
  const projectsSeen = new Set();
  for (const s of parsed) {
    const event = {
      ts: s.ts,
      source: "claude_session",
      kind: "session",
      session_id: s.session_id,
      project: s.project,
      cwd: s.cwd,
      summary: s.first_prompt,
      byte_size: s.byte_size,
      indexed_by: "index-sessions.mjs v1",
    };
    const projectKey = `acmi:project:${s.project}:timeline`;
    await writeEvent(projectKey, event);
    await writeEvent(AGENT_TIMELINE_KEY, event);
    projectsSeen.add(s.project);
    written++;
    if (written % 20 === 0) console.error(`  ...wrote ${written}/${parsed.length}`);
  }

  // Register projects + agent in their namespace lists so summarize() picks them up.
  for (const slug of projectsSeen) {
    await redis("SADD", PROJECT_LIST_KEY, slug);
  }
  await redis("SADD", AGENT_LIST_KEY, "claude-engineer");

  console.error(`[index] ✅ wrote ${written} session events`);
  console.error(`[index] ✅ registered ${projectsSeen.size} projects under acmi:project:list`);
  console.log(JSON.stringify({
    sessions_written: written,
    projects: [...projectsSeen].sort(),
    window_days: args.days,
    agent_timeline: AGENT_TIMELINE_KEY,
  }, null, 2));
}

main().catch(err => { console.error("❌", err.message); process.exit(1); });
