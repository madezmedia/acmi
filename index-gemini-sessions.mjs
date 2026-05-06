#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!UPSTASH_URL || !UPSTASH_TOKEN) {
  console.error("ERROR: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN required in env.");
  process.exit(1);
}

const GEMINI_TMP_ROOT = join(homedir(), ".gemini", "tmp");
const AGENT_TIMELINE_KEY = "acmi:agent:gemini-cli:timeline";
const AGENT_LIST_KEY = "acmi:agent:list";
const PROJECT_LIST_KEY = "acmi:project:list";

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

function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

async function main() {
  const days = 60;
  const cutoffMs = Date.now() - days * 86400 * 1000;
  
  let projectDirs;
  try {
    projectDirs = await readdir(GEMINI_TMP_ROOT);
  } catch (err) {
    console.error(`[index-gemini] No gemini tmp root at ${GEMINI_TMP_ROOT}`);
    return;
  }

  let written = 0;
  const projectsSeen = new Set();

  for (const projectSlug of projectDirs) {
    const chatDir = join(GEMINI_TMP_ROOT, projectSlug, "chats");
    let sessionFiles;
    try {
      sessionFiles = await readdir(chatDir);
    } catch { continue; }

    for (const file of sessionFiles) {
      if (!file.startsWith("session-") || !file.endsWith(".json")) continue;
      const fp = join(chatDir, file);
      const st = await stat(fp);
      if (st.mtimeMs < cutoffMs) continue;

      const content = await readFile(fp, "utf8");
      let data;
      try { data = JSON.parse(content); } catch { continue; }

      const sessionId = data.sessionId;
      const startTime = data.startTime;
      if (!sessionId || !startTime) continue;

      const ts = Date.parse(startTime);
      const firstUserMsg = data.messages?.find(m => m.type === "user");
      let prompt = "";
      if (firstUserMsg) {
        if (typeof firstUserMsg.content === "string") prompt = firstUserMsg.content;
        else if (Array.isArray(firstUserMsg.content)) {
          prompt = firstUserMsg.content.find(p => p.text)?.text || "";
        }
      }

      const event = {
        ts,
        source: "gemini_session",
        kind: "session",
        session_id: sessionId,
        project: projectSlug,
        summary: truncate(prompt, 500),
        byte_size: st.size,
        indexed_by: "index-gemini-sessions.mjs v1",
      };

      const projectKey = `acmi:project:${projectSlug}:timeline`;
      await redis("ZADD", projectKey, ts, JSON.stringify(event));
      await redis("ZADD", AGENT_TIMELINE_KEY, ts, JSON.stringify(event));
      projectsSeen.add(projectSlug);
      written++;
    }
  }

  for (const slug of projectsSeen) {
    await redis("SADD", PROJECT_LIST_KEY, slug);
  }
  await redis("SADD", AGENT_LIST_KEY, "gemini-cli");

  console.log(JSON.stringify({
    sessions_written: written,
    projects: [...projectsSeen].sort(),
    agent: "gemini-cli"
  }, null, 2));
}

main().catch(err => { console.error("❌", err.message); process.exit(1); });
