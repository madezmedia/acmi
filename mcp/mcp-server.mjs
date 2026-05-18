#!/usr/bin/env node

/**
 * ACMI MCP Server — Model Context Protocol interface for
 * Agentic Context Management Infrastructure.
 *
 * Transport: stdio (Claude Desktop, Cursor, Cline, Windsurf)
 * Wraps the ACMI Redis KV layer directly (same logic as acmi.mjs CLI).
 *
 * v1.3 (2026-05-06 hackathon hardening):
 * - validateKeySegments() rejects undefined/null/empty/colon-containing/oversize segments
 * - validateJson() catches malformed JSON before SET
 * - safeTool() wraps every handler in try/catch returning {ok:false, error}
 * - isProtectedKey() refuses mutation of acmi:registry:* / acmi:notion-sync:*
 * - acmi_delete tool (with dry-run + confirm + protected-path guards)
 * - acmi_rollup_set tool (companion to acmi_bootstrap's rollup_latest read)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { validateKeySegments, validateJson, isProtectedKey } from "./mcp-server-helpers.mjs";

// ─── Redis helpers (shared with acmi.mjs) ──────────────────────────

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  console.error("ERROR: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set.");
  process.exit(1);
}

async function redis(command, ...args) {
  const endpoint = `${url.replace(/\/$/, '')}/`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([command, ...args]),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Upstash: ${data.error}`);
  return data.result;
}

function tryParse(s) {
  try { return JSON.parse(s); } catch { return s; }
}

function parseZWithScores(arr) {
  const out = [];
  for (let i = 0; i < (arr || []).length; i += 2) {
    out.push({ ts: Number(arr[i + 1]), data: tryParse(arr[i]) });
  }
  return out;
}

function parseHash(arr) {
  const out = {};
  for (let i = 0; i < (arr || []).length; i += 2) {
    out[arr[i]] = tryParse(arr[i + 1]);
  }
  return out;
}

function parseSince(s) {
  const m = String(s).match(/^(\d+)([hdm])$/);
  if (!m) return 0;
  const n = Number(m[1]);
  return n * (m[2] === "h" ? 3600e3 : m[2] === "d" ? 86400e3 : 60e3);
}

/**
 * Wrap a tool handler so any thrown error becomes a structured MCP response
 * instead of an opaque transport-layer failure.
 */
function safeTool(name, fn) {
  return async (args) => {
    try {
      return await fn(args);
    } catch (e) {
      return jsonResult({ ok: false, error: e.message, tool: name });
    }
  };
}

// ─── MCP Server ─────────────────────────────────────────────────────

const server = new McpServer({
  name: "acmi",
  version: "1.3.0",
});

// Helper: JSON result as text content
function jsonResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

// ── 1. acmi_profile ────────────────────────────────────────────────

server.tool(
  "acmi_profile",
  "Create or update an entity profile in ACMI. Stores arbitrary JSON profile data for an entity (agent, thread, project, etc.).",
  {
    namespace: z.string().describe("ACMI namespace (e.g. 'agent', 'thread', 'sales')"),
    id: z.string().describe("Entity ID within the namespace"),
    profile: z.string().describe("JSON string of profile data to store"),
  },
  safeTool("acmi_profile", async ({ namespace, id, profile }) => {
    validateKeySegments(namespace, id);
    validateJson(profile, "profile");
    const key = `acmi:${namespace}:${id}:profile`;
    await redis("SET", key, profile);
    await redis("SADD", `acmi:${namespace}:list`, id);
    return jsonResult({ ok: true, key });
  })
);

// ── 2. acmi_signal ─────────────────────────────────────────────────

server.tool(
  "acmi_signal",
  "Update AI signals for an entity. Signals are mutable KV state (mood, priorities, scores, etc.) that changes frequently.",
  {
    namespace: z.string().describe("ACMI namespace"),
    id: z.string().describe("Entity ID"),
    signals: z.string().describe("JSON string of signal data to store"),
  },
  safeTool("acmi_signal", async ({ namespace, id, signals }) => {
    validateKeySegments(namespace, id);
    validateJson(signals, "signals");
    const key = `acmi:${namespace}:${id}:signals`;
    await redis("SET", key, signals);
    await redis("SADD", `acmi:${namespace}:list`, id);
    return jsonResult({ ok: true, key });
  })
);

// ── 3. acmi_event ──────────────────────────────────────────────────

server.tool(
  "acmi_event",
  "Log a timeline event for an entity. The workhorse tool — records timestamped events with source, kind, correlationId, and summary. Follows ACMI Communication Standard v1.1.",
  {
    namespace: z.string().describe("ACMI namespace (e.g. 'thread', 'agent', 'work')"),
    id: z.string().describe("Entity ID"),
    source: z.string().describe("Source of the event (agent name, system, etc.)"),
    summary: z.string().describe("Human-readable event summary"),
    kind: z.string().optional().describe("Event kind (e.g. 'handoff-complete', 'step-done', 'decision')"),
    correlationId: z.string().optional().describe("Correlation ID for tracking across agents/sessions (camelCase)"),
  },
  safeTool("acmi_event", async ({ namespace, id, source, summary, kind, correlationId }) => {
    validateKeySegments(namespace, id);
    const key = `acmi:${namespace}:${id}:timeline`;
    const ts = Date.now();
    const event = { ts, source, summary };
    if (kind) event.kind = kind;
    if (correlationId) event.correlationId = correlationId;
    await redis("ZADD", key, ts, JSON.stringify(event));
    await redis("SADD", `acmi:${namespace}:list`, id);
    return jsonResult({ ok: true, key, event });
  })
);

// ── 4. acmi_get ────────────────────────────────────────────────────

server.tool(
  "acmi_get",
  "Fetch complete entity context: profile + signals + recent timeline events (last 10).",
  {
    namespace: z.string().describe("ACMI namespace"),
    id: z.string().describe("Entity ID"),
  },
  safeTool("acmi_get", async ({ namespace, id }) => {
    validateKeySegments(namespace, id);
    const prefix = `acmi:${namespace}:${id}`;
    const [profile, signals, timeline] = await Promise.all([
      redis("GET", `${prefix}:profile`),
      redis("GET", `${prefix}:signals`),
      redis("ZREVRANGE", `${prefix}:timeline`, 0, 9),
    ]);
    return jsonResult({
      profile: profile ? tryParse(profile) : null,
      signals: signals ? tryParse(signals) : null,
      timeline_recent: (timeline || []).map(tryParse),
    });
  })
);

// ── 5. acmi_list ───────────────────────────────────────────────────

server.tool(
  "acmi_list",
  "List all entity IDs in a namespace.",
  {
    namespace: z.string().describe("ACMI namespace to list"),
  },
  safeTool("acmi_list", async ({ namespace }) => {
    validateKeySegments(namespace);
    const arr = await redis("SMEMBERS", `acmi:${namespace}:list`);
    return jsonResult(arr || []);
  })
);

// ── 6. acmi_work_create ────────────────────────────────────────────

server.tool(
  "acmi_work_create",
  "Create a new work item (cross-session project, task, or idea).",
  {
    id: z.string().describe("Unique work item ID"),
    profile: z.string().describe("JSON string of work item profile (title, owner, status, etc.)"),
  },
  safeTool("acmi_work_create", async ({ id, profile }) => {
    validateKeySegments(id);
    validateJson(profile, "profile");
    await redis("SET", `acmi:work:${id}:profile`, profile);
    await redis("SADD", "acmi:work:list", id);
    return jsonResult({ ok: true, work_id: id });
  })
);

// ── 7. acmi_work_event ─────────────────────────────────────────────

server.tool(
  "acmi_work_event",
  "Log a progress event on a work item.",
  {
    id: z.string().describe("Work item ID"),
    source: z.string().describe("Source of the event"),
    summary: z.string().describe("Event summary"),
    sessionId: z.string().optional().describe("Optional session ID to associate"),
  },
  safeTool("acmi_work_event", async ({ id, source, summary, sessionId }) => {
    validateKeySegments(id);
    const ts = Date.now();
    const event = { ts, source, summary };
    if (sessionId) event.session_id = sessionId;
    await redis("ZADD", `acmi:work:${id}:timeline`, ts, JSON.stringify(event));
    if (sessionId) await redis("SADD", `acmi:work:${id}:sessions`, sessionId);
    return jsonResult({ ok: true, work_id: id, event });
  })
);

// ── 8. acmi_work_signal ────────────────────────────────────────────

server.tool(
  "acmi_work_signal",
  "Update signals for a work item (progress, blockers, metrics, etc.).",
  {
    id: z.string().describe("Work item ID"),
    signals: z.string().describe("JSON string of signal data"),
  },
  safeTool("acmi_work_signal", async ({ id, signals }) => {
    validateKeySegments(id);
    validateJson(signals, "signals");
    await redis("SET", `acmi:work:${id}:signals`, signals);
    return jsonResult({ ok: true, work_id: id });
  })
);

// ── 9. acmi_work_get ───────────────────────────────────────────────

server.tool(
  "acmi_work_get",
  "Read a work item's full context: profile, signals, timeline (last 50), and sessions.",
  {
    id: z.string().describe("Work item ID"),
  },
  safeTool("acmi_work_get", async ({ id }) => {
    validateKeySegments(id);
    const prefix = `acmi:work:${id}`;
    const [profile, signals, timeline, sessions] = await Promise.all([
      redis("GET", `${prefix}:profile`),
      redis("GET", `${prefix}:signals`),
      redis("ZREVRANGE", `${prefix}:timeline`, 0, 49),
      redis("SMEMBERS", `${prefix}:sessions`),
    ]);
    return jsonResult({
      work_id: id,
      profile: profile ? tryParse(profile) : null,
      signals: signals ? tryParse(signals) : null,
      timeline: (timeline || []).map(tryParse),
      sessions: sessions || [],
    });
  })
);

// ── 10. acmi_work_list ─────────────────────────────────────────────

server.tool(
  "acmi_work_list",
  "List all work item IDs.",
  {},
  safeTool("acmi_work_list", async () => {
    const arr = await redis("SMEMBERS", "acmi:work:list");
    return jsonResult(arr || []);
  })
);

// ── 11. acmi_cat ───────────────────────────────────────────────────

server.tool(
  "acmi_cat",
  "Multi-stream event merge view. Combines timeline events from multiple entities, sorted by timestamp. Supports --since filtering.",
  {
    keys: z.array(z.string()).describe("Timeline keys to merge. Use 'thread:name', 'agent:name', or full 'acmi:...:timeline' keys."),
    since: z.string().optional().describe("Time window filter (e.g. '24h', '7d', '30m'). Default: all time."),
    limit: z.number().optional().describe("Max events to return. Default: 50."),
  },
  safeTool("acmi_cat", async ({ keys, since, limit }) => {
    const maxResults = limit || 50;
    const sinceMs = since ? parseSince(since) : 0;
    const targets = keys.map((k) => {
      if (k.startsWith("acmi:")) return k;
      if (k.endsWith(":timeline")) return `acmi:${k}`;
      return `acmi:${k}:timeline`;
    });

    const minScore = sinceMs ? Date.now() - sinceMs : 0;
    const merged = [];
    for (const k of targets) {
      const r = await redis("ZRANGEBYSCORE", k, minScore, "+inf", "WITHSCORES");
      for (const e of parseZWithScores(r)) merged.push({ ...e, _source: k });
    }
    merged.sort((a, b) => b.ts - a.ts);

    const results = merged.slice(0, maxResults).map((m) => {
      let ts = m.ts;
      if (ts > 9999999999999) ts = Number(String(ts).slice(0, 13));
      const iso = new Date(ts).toISOString().slice(0, 16).replace("T", " ") + "Z";
      const src = m._source.replace(/^acmi:|:timeline$/g, "");
      const d = m.data || {};
      return {
        timestamp: iso,
        source_key: src,
        kind: d.kind || d.source || "?",
        summary: d.summary || d.message || JSON.stringify(d),
      };
    });

    return jsonResult(results);
  })
);

// ── 12. acmi_spawn ─────────────────────────────────────────────────

server.tool(
  "acmi_spawn",
  "Log an agent session spawn event. Records when an agent starts a new session.",
  {
    agentId: z.string().describe("Agent ID that spawned"),
    sessionId: z.string().optional().describe("Session ID"),
    modelId: z.string().optional().describe("Model ID used for the session"),
  },
  safeTool("acmi_spawn", async ({ agentId, sessionId, modelId }) => {
    validateKeySegments(agentId);
    const ts = Date.now();
    const data = JSON.stringify({
      ts,
      session_id: sessionId || "unknown",
      model_id: modelId || "unknown",
    });
    await redis("ZADD", `acmi:agent:${agentId}:spawns`, ts, data);
    return jsonResult({ ok: true, agent_id: agentId });
  })
);

// ── 13. acmi_bootstrap ─────────────────────────────────────────────

server.tool(
  "acmi_bootstrap",
  "One-shot agent context bundle. Fetches everything a fresh agent session needs: profile, signals, active threads, rollup, recent timeline, and spawns.",
  {
    agentId: z.string().describe("Agent ID to bootstrap"),
  },
  safeTool("acmi_bootstrap", async ({ agentId }) => {
    validateKeySegments(agentId);
    const prefix = `acmi:agent:${agentId}`;
    const [profile, signals, active, rollup, timeline, spawns] = await Promise.all([
      redis("GET", `${prefix}:profile`),
      redis("GET", `${prefix}:signals`),
      redis("HGETALL", `${prefix}:active_context`),
      redis("GET", `${prefix}:rollup:latest`),
      redis("ZREVRANGE", `${prefix}:timeline`, 0, 19),
      redis("ZREVRANGE", `${prefix}:spawns`, 0, 4, "WITHSCORES"),
    ]);

    return jsonResult({
      agent_id: agentId,
      bootstrapped_at: new Date().toISOString(),
      profile: profile ? tryParse(profile) : null,
      signals: signals ? tryParse(signals) : null,
      active_context: parseHash(active),
      rollup_latest: rollup ? tryParse(rollup) : null,
      timeline_recent: (timeline || []).map(tryParse),
      recent_spawns: parseZWithScores(spawns),
    });
  })
);

// ── 14. acmi_active ────────────────────────────────────────────────

server.tool(
  "acmi_active",
  "Track agent thread engagement. Add/remove threads or list current active threads for an agent.",
  {
    agentId: z.string().describe("Agent ID"),
    action: z.enum(["add", "remove", "list"]).describe("Action: add a thread, remove a thread, or list all active threads"),
    threadKey: z.string().optional().describe("Thread key (required for add/remove)"),
    role: z.string().optional().describe("Role in thread (e.g. 'participant', 'lead'). Default: 'participant'"),
  },
  safeTool("acmi_active", async ({ agentId, action, threadKey, role }) => {
    validateKeySegments(agentId);
    const key = `acmi:agent:${agentId}:active_context`;

    if (action === "add") {
      if (!threadKey) throw new Error("threadKey is required for 'add' action");
      await redis("HSET", key, threadKey, JSON.stringify({ role: role || "participant", joined_at: Date.now() }));
      return jsonResult({ ok: true, action: "add", threadKey });
    }

    if (action === "remove") {
      if (!threadKey) throw new Error("threadKey is required for 'remove' action");
      await redis("HDEL", key, threadKey);
      return jsonResult({ ok: true, action: "remove", threadKey });
    }

    // list
    const res = await redis("HGETALL", key);
    return jsonResult(parseHash(res));
  })
);

// ── 15. acmi_rollup_set ────────────────────────────────────────────

server.tool(
  "acmi_rollup_set",
  "Set the latest rollup snapshot for an agent (acmi:agent:<id>:rollup:latest). Pairs with acmi_bootstrap which reads it.",
  {
    agentId: z.string().describe("Agent ID"),
    rollup: z.string().describe("JSON string of rollup data (cross-session summary, decisions, blockers, etc.)"),
  },
  safeTool("acmi_rollup_set", async ({ agentId, rollup }) => {
    validateKeySegments(agentId);
    validateJson(rollup, "rollup");
    const key = `acmi:agent:${agentId}:rollup:latest`;
    await redis("SET", key, rollup);
    return jsonResult({ ok: true, key });
  })
);

// ── 16. acmi_delete ────────────────────────────────────────────────

server.tool(
  "acmi_delete",
  "Delete an ACMI key. Refuses protected paths (acmi:registry:*, acmi:notion-sync:*) and any non-acmi:* key. Defaults to dry-run; pass confirm=true to actually delete.",
  {
    key: z.string().describe("Full ACMI key to delete (must start with 'acmi:')"),
    confirm: z.boolean().optional().describe("Must be true to actually delete; otherwise returns dry-run preview. Default: false (dry-run)."),
  },
  safeTool("acmi_delete", async ({ key, confirm }) => {
    if (!key || !key.startsWith("acmi:")) {
      throw new Error("key must start with 'acmi:' (refusing to operate outside ACMI namespace)");
    }
    if (isProtectedKey(key)) {
      throw new Error(`refused: ${key} is a protected path (registry/notion-sync) — protected-paths are never auto-deleted`);
    }
    const exists = await redis("EXISTS", key);
    const type = exists === 1 ? await redis("TYPE", key) : null;
    if (!confirm) {
      return jsonResult({ ok: true, dry_run: true, key, exists: exists === 1, type, hint: "pass confirm=true to actually delete" });
    }
    if (exists !== 1) {
      return jsonResult({ ok: true, dry_run: false, key, deleted: false, reason: "key did not exist" });
    }
    const deleted = await redis("DEL", key);
    return jsonResult({ ok: true, dry_run: false, key, deleted: deleted === 1, type });
  })
);

// ─── Start ──────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
