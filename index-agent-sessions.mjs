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

const DAYS = 60;
const CUTOFF_MS = Date.now() - DAYS * 86400 * 1000;

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

/** -Users-michaelshaw-clawd → clawd ; paperclip-...-uuid → paperclip-<short> */
function slugFromDir(dir) {
  const cleaned = dir.replace(/^-+/, "").replace(/--+/g, "-");
  const parts = cleaned.split("-");
  const idx = parts.findIndex(p => p === "Users");
  const tail = idx >= 0 ? parts.slice(idx + 2) : parts;
  let slug = tail.join("-").toLowerCase() || "home";
  const pcMatch = slug.match(/^paperclip-instances-default-workspaces-([0-9a-f]{8})/);
  if (pcMatch) slug = `paperclip-${pcMatch[1]}`;
  return slug.length > 80 ? slug.slice(0, 80) : slug;
}

/** /Users/michaelshaw/projects/my-app -> my-app */
function slugFromPath(path) {
  if (!path) return "home";
  const parts = path.split("/");
  return parts[parts.length - 1].toLowerCase() || "home";
}

async function indexGemini() {
  const root = join(homedir(), ".gemini", "tmp");
  let projectDirs;
  try { projectDirs = await readdir(root); } catch { return 0; }

  let count = 0;
  for (const slug of projectDirs) {
    const chatDir = join(root, slug, "chats");
    let files;
    try { files = await readdir(chatDir); } catch { continue; }

    for (const file of files) {
      if (!file.startsWith("session-") || !file.endsWith(".json")) continue;
      const fp = join(chatDir, file);
      const st = await stat(fp);
      if (st.mtimeMs < CUTOFF_MS) continue;

      const data = JSON.parse(await readFile(fp, "utf8"));
      const ts = Date.parse(data.startTime);
      const firstUserMsg = data.messages?.find(m => m.type === "user");
      let prompt = "";
      if (firstUserMsg) {
        prompt = typeof firstUserMsg.content === "string" ? firstUserMsg.content : (firstUserMsg.content.find(p => p.text)?.text || "");
      }

      const event = {
        ts, source: "gemini_session", kind: "session", session_id: data.sessionId,
        project: slug, summary: truncate(prompt, 500), byte_size: st.size, indexed_by: "index-agent-sessions.mjs",
      };
      await redis("ZADD", `acmi:project:${slug}:timeline`, ts, JSON.stringify(event));
      await redis("ZADD", `acmi:agent:gemini-cli:timeline`, ts, JSON.stringify(event));
      await redis("SADD", `acmi:project:list`, slug);
      count++;
    }
  }
  await redis("SADD", "acmi:agent:list", "gemini-cli");
  return count;
}

async function indexCodex() {
  const root = join(homedir(), ".codex", "sessions");
  let count = 0;
  
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { await walk(full); }
      else if (e.name.endsWith(".jsonl")) {
        const st = await stat(full);
        if (st.mtimeMs < CUTOFF_MS) continue;
        const lines = (await readFile(full, "utf8")).split("\n");
        let metaLine = lines.find(l => { try { return JSON.parse(l).type === "session_meta"; } catch { return false; } });
        if (!metaLine) continue;
        const meta = JSON.parse(metaLine).payload;
        const ts = Date.parse(meta.timestamp);
        const slug = slugFromPath(meta.cwd);
        const firstUserMsg = lines.find(l => { try { const p = JSON.parse(l); return p.type === "event_msg" && p.payload.type === "user_message"; } catch { return false; } });
        const prompt = firstUserMsg ? JSON.parse(firstUserMsg).payload.message : "";

        const event = {
          ts, source: "codex_session", kind: "session", session_id: meta.id,
          project: slug, summary: truncate(prompt, 500), byte_size: st.size, indexed_by: "index-agent-sessions.mjs",
        };
        await redis("ZADD", `acmi:project:${slug}:timeline`, ts, JSON.stringify(event));
        await redis("ZADD", `acmi:agent:codex:timeline`, ts, JSON.stringify(event));
        await redis("SADD", `acmi:project:list`, slug);
        count++;
      }
    }
  }
  await walk(root);
  await redis("SADD", "acmi:agent:list", "codex");
  return count;
}

async function main() {
  console.log("Indexing agent sessions...");
  const geminiCount = await indexGemini();
  const codexCount = await indexCodex();
  
  console.log(JSON.stringify({
    gemini_sessions: geminiCount,
    codex_sessions: codexCount,
    total: geminiCount + codexCount
  }, null, 2));
}

main().catch(err => { console.error("❌", err.message); process.exit(1); });
