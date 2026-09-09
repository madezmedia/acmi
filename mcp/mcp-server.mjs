#!/usr/bin/env node

/**
 * ACMI MCP Server v2.0 — Model Context Protocol interface
 * Agentic Context Management Infrastructure
 *
 * v2.0.1 (2026-07-22):
 *   - DEGRADED MODE: when no Redis backend is reachable, falls back to
 *     in-memory store + optional local ledger file instead of hard exit.
 *   - New tool: acmi_mcp_status — reports connection mode, tenant, degraded state.
 *   - Every tool response includes `degraded: true` + `mode: "in-memory"` when
 *     operating in degraded mode.
 *   - ACMI_LOCAL_LEDGER env var: if set, all write operations are logged to
 *     <path>/ledger.jsonl for later replay.
 *   - No more process.exit(1) when all backends unreachable.
 * - Native Redis support (node-redis) in addition to Upstash REST
 * - Tenant prefix support: acmi:<tenant>:<namespace>:<id>:*
 * - Multi-tenant validation (read/write namespaces per actor)
 * - Backward compatible with v1.x clients
 * - NEW tool: acmi_tenant_list
 *
 * Connection selection (priority):
 *   1. ACMI_REDIS_HOST → native Redis (TCP)
 *   2. ACMI_BRIDGE_URL → VM HTTP bridge (fleet PRIMARY for remote/edge)
 *   3. UPSTASH_REDIS_REST_URL → Upstash REST (secondary / rate-limited)
 *
 * Tenant selection:
 *   - ACMI_DEFAULT_TENANT=madez (default)
 *   - ACMI_ALLOWED_TENANTS=madez,client:duane,client:suzanne
 *   - Per-tool tenant via context.tenant (from actor profile)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { validateKeySegments, validateJson, isProtectedKey, isBridgeUrl, restEndpoint } from "./mcp-server-helpers.mjs";
import { mkdirSync, writeFileSync } from "fs";

// ─── Connection layer (v2.0 + bridge) ────────────────────────────

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
const nativeHost = process.env.ACMI_REDIS_HOST;
const nativePort = parseInt(process.env.ACMI_REDIS_PORT || "6379");
const nativePassword = process.env.ACMI_REDIS_PASSWORD;
const nativeDb = parseInt(process.env.ACMI_REDIS_DB || "0");
// Fleet PRIMARY for agents that cannot open TCP:6379/26379 (edge, cloud sandboxes).
// Polar exec URLs stuffed into UPSTASH_* also count as bridge (no trailing slash).
const bridgeUrl = process.env.ACMI_BRIDGE_URL || process.env.ACMI_REDIS_BRIDGE_URL || (isBridgeUrl(upstashUrl) ? upstashUrl : "");
const bridgeToken = process.env.ACMI_BRIDGE_TOKEN || process.env.ACMI_REDIS_BRIDGE_TOKEN || (isBridgeUrl(upstashUrl) ? upstashToken : "") || "vm-local-bridge";

const defaultTenant = process.env.ACMI_DEFAULT_TENANT || "madez";
const allowedTenants = (process.env.ACMI_ALLOWED_TENANTS || "madez").split(",");
const localLedgerPath = process.env.ACMI_LOCAL_LEDGER || "";

let nativeClient = null;
let useNative = false;
let useBridge = false;
let useMemory = false;
global.__acmi_start = Date.now();


if (nativeHost) {
  // Native Redis mode (v2.0)
  try {
    const { createClient } = await import("redis");
    nativeClient = createClient({
      socket: { host: nativeHost, port: nativePort },
      password: nativePassword || undefined,
      database: nativeDb,
    });
    await nativeClient.connect();
    useNative = true;
    console.error(`[acmi-mcp v2.0] connected to native Redis at ${nativeHost}:${nativePort}`);
  } catch (e) {
    console.error(`[acmi-mcp v2.0] native Redis connection failed: ${e.message}`);
    useNative = false;
  }
}

if (!useNative && bridgeUrl) {
  useBridge = true;
  console.error(`[acmi-mcp v2.0] using VM HTTP bridge at ${restEndpoint(bridgeUrl)}`);
}

if (!useNative && !useBridge) {
  if (upstashUrl && upstashToken) {
    console.error(`[acmi-mcp v2.0] using Upstash REST (v1.x compat / secondary)`);
  } else {
    console.error(`[acmi-mcp v2.0] WARNING: no Redis backend reachable — entering DEGRADED MODE (in-memory store)`);
    if (localLedgerPath) {
      try { mkdirSync(localLedgerPath, { recursive: true }); } catch {}
      console.error(`[acmi-mcp v2.0] local ledger: ${localLedgerPath}`);
    }
    useMemory = true;
  }
}

// ─── In-memory degraded store (when no Redis backend reachable) ───

const __mem = new Map();

function memWriteLedger(kind, key, detail) {
  if (!localLedgerPath) return;
  try {
    const entry = { ts: Date.now(), kind, key, detail, mode: "degraded" };
    writeFileSync(`${localLedgerPath}/ledger.jsonl`, JSON.stringify(entry) + "\n", { flag: "a" });
  } catch {}
}

function memGet(key) {
  const v = __mem.get(key);
  return v !== undefined ? v : null;
}

function memSet(key, value) {
  __mem.set(key, value);
  return "OK";
}

function memDel(...keys) {
  let c = 0;
  for (const k of keys) if (__mem.delete(k)) c++;
  return c >>> 0;
}

function memExists(key) {
  return __mem.has(key) ? 1 : 0;
}

function memType(key) {
  const v = __mem.get(key);
  if (v === undefined) return "none";
  if (Array.isArray(v)) return "list";
  if (typeof v === "object") return "hash";
  return "string";
}

function memScan(args) {
  let cursor = parseInt(args[0] || "0");
  const matchIdx = args.indexOf("MATCH");
  const countIdx = args.indexOf("COUNT");
  const pattern = matchIdx >= 0 ? args[matchIdx + 1] : "*";
  const count = countIdx >= 0 ? parseInt(args[countIdx + 1]) : 100;
  const allKeys = [...__mem.keys()].filter(k => {
    try { return new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$").test(k); } catch { return false; }
  });
  const page = allKeys.slice(cursor, cursor + count);
  const nextCursor = cursor + count >= allKeys.length ? "0" : String(cursor + count);
  return [nextCursor, page];
}

function memHGet(key, field) {
  const h = __mem.get(key);
  if (!h || typeof h !== "object") return null;
  const v = h[field];
  return v !== undefined ? String(v) : null;
}

function memHSet(key, ...args) {
  let h = __mem.get(key);
  if (!h || typeof h !== "object") { h = {}; __mem.set(key, h); }
  let c = 0;
  if (args.length === 2) { h[args[0]] = args[1]; c = 1; }
  else { for (let i = 0; i + 1 < args.length; i += 2) { h[args[i]] = args[i + 1]; c++; } }
  return c;
}

function memHGetAll(key) {
  const h = __mem.get(key);
  if (!h || typeof h !== "object") return [];
  const r = [];
  for (const [k, v] of Object.entries(h)) r.push(k, String(v));
  return r;
}

function memHDel(key, ...fields) {
  const h = __mem.get(key);
  if (!h || typeof h !== "object") return 0;
  let c = 0;
  for (const f of fields) if (delete h[f]) c++;
  return c;
}

// ZADD key score member [score member ...]
function memZAdd(key, ...args) {
  let z = __mem.get(key);
  if (!z || !Array.isArray(z)) { z = []; __mem.set(key, z); }
  let c = 0;
  for (let i = 0; i + 1 < args.length; i += 2) {
    const score = parseFloat(args[i]);
    const member = String(args[i + 1]);
    const idx = z.findIndex(e => e.m === member);
    if (idx >= 0) { z[idx].s = score; c++; }
    else { z.push({ s: score, m: member }); c++; }
  }
  return c;
}

function memParseScore(s) {
  if (s === "+inf" || s === "+inf" || s === Infinity) return Infinity;
  if (s === "-inf" || s === "-inf" || s === -Infinity) return -Infinity;
  return parseFloat(s);
}

function memZRangeByScoreGeneric(key, min, max, reverse, withScores, limit, offset) {
  const z = __mem.get(key);
  if (!z || !Array.isArray(z)) return [];
  const lo = memParseScore(min);
  const hi = memParseScore(max);
  let entries = z.filter(e => e.s >= lo && e.s <= hi);
  if (reverse) entries.reverse();
  if (withScores) {
    const r = [];
    for (const e of entries) { r.push(e.m, String(e.s)); }
    return r;
  }
  return entries.map(e => e.m);
}

function memZRevRangeByScore(key, ...args) {
  const max = args[0] || "+inf";
  const min = args[1] || "0";
  const withScores = args.indexOf("WITHSCORES") >= 0;
  const limitIdx = args.indexOf("LIMIT");
  let limOffset = 0, limCount = Infinity;
  if (limitIdx >= 0 && limitIdx + 2 < args.length) {
    limOffset = parseInt(args[limitIdx + 1]) || 0;
    limCount = parseInt(args[limitIdx + 2]) || Infinity;
  }
  const all = memZRangeByScoreGeneric(key, min, max, true, withScores);
  if (limCount === Infinity) return all;
  return all.slice(limOffset * 2, (limOffset + limCount) * 2);
}

function memZRem(key, ...members) {
  const z = __mem.get(key);
  if (!z || !Array.isArray(z)) return 0;
  const before = z.length;
  __mem.set(key, z.filter(e => !members.includes(e.m)));
  return before - z.length;
}

function memZCard(key) {
  const z = __mem.get(key);
  return z && Array.isArray(z) ? z.length : 0;
}

function memZScore(key, member) {
  const z = __mem.get(key);
  if (!z || !Array.isArray(z)) return null;
  const e = z.find(e => e.m === member);
  return e ? String(e.s) : null;
}

function memLPush(key, ...values) {
  let l = __mem.get(key);
  if (!l || !Array.isArray(l)) { l = []; __mem.set(key, l); }
  l.unshift(...values);
  return l.length;
}

function memRPush(key, ...values) {
  let l = __mem.get(key);
  if (!l || !Array.isArray(l)) { l = []; __mem.set(key, l); }
  l.push(...values);
  return l.length;
}

function memLRange(key, start, stop) {
  const l = __mem.get(key);
  if (!l || !Array.isArray(l)) return [];
  return l.slice(start, stop + 1);
}

function memSAdd(key, ...members) {
  let s = __mem.get(key);
  if (!s || !Array.isArray(s)) { s = []; __mem.set(key, s); }
  let c = 0;
  for (const m of members) { if (!s.includes(m)) { s.push(m); c++; } }
  return c;
}

function memSMembers(key) {
  const s = __mem.get(key);
  return s && Array.isArray(s) ? [...s] : [];
}

function memSRem(key, ...members) {
  const s = __mem.get(key);
  if (!s || !Array.isArray(s)) return 0;
  const before = s.length;
  __mem.set(key, s.filter(m => !members.includes(m)));
  return before - s.length;
}

function memKeys(pattern) {
  const regex = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  return [...__mem.keys()].filter(k => regex.test(k));
}

function memDbSize() { return __mem.size; }

function memFlushDb() { __mem.clear(); return "OK"; }

function memFlushAll() { __mem.clear(); return "OK"; }

function memExpire() { return 1; }

function memTtl() { return -1; }

function memIncr(key) {
  const v = parseInt(__mem.get(key) || "0");
  __mem.set(key, String(v + 1));
  return v + 1;
}

function memDecr(key) {
  const v = parseInt(__mem.get(key) || "0");
  __mem.set(key, String(v - 1));
  return v - 1;
}

async function memRedisCommand(command, ...args) {
  const cmd = command.toUpperCase();
  switch (cmd) {
    case "GET": return memGet(args[0]);
    case "SET": return memSet(args[0], args[1]);
    case "DEL": return memDel(...args);
    case "EXISTS": return memExists(args[0]);
    case "TYPE": return memType(args[0]);
    case "SCAN": return memScan(args);
    case "HGET": return memHGet(args[0], args[1]);
    case "HSET": return memHSet(args[0], ...args.slice(1));
    case "HGETALL": return memHGetAll(args[0]);
    case "HDEL": return memHDel(args[0], ...args.slice(1));
    case "ZADD": return memZAdd(args[0], ...args.slice(1));
    case "ZREVRANGEBYSCORE": return memZRevRangeByScore(args[0], ...args.slice(1));
    case "ZRANGEBYSCORE": return memZRangeByScoreGeneric(args[0], args[1], args[2], false, args.indexOf("WITHSCORES") >= 0);
    case "ZRANGE": return memZRangeByScoreGeneric(args[0], args[1], args[2], false, args[3]?.toUpperCase() === "WITHSCORES");
    case "ZREVRANGE": return memZRangeByScoreGeneric(args[0], args[1], args[2], true, args[3]?.toUpperCase() === "WITHSCORES");
    case "ZRANGEBYSCORE": return memZRangeByScoreGeneric(args[0], args[1], args[2], false, args.indexOf("WITHSCORES") >= 0);
    case "ZREM": return memZRem(args[0], ...args.slice(1));
    case "ZCARD": return memZCard(args[0]);
    case "ZSCORE": return memZScore(args[0], args[1]);
    case "LPUSH": return memLPush(args[0], ...args.slice(1));
    case "RPUSH": return memRPush(args[0], ...args.slice(1));
    case "LRANGE": return memLRange(args[0], parseInt(args[1]), parseInt(args[2]));
    case "SADD": return memSAdd(args[0], ...args.slice(1));
    case "SMEMBERS": return memSMembers(args[0]);
    case "SREM": return memSRem(args[0], ...args.slice(1));
    case "DBSIZE": return memDbSize();
    case "PING": return "PONG";
    case "KEYS": return memKeys(args[0]);
    case "FLUSHDB": return memFlushDb();
    case "FLUSHALL": return memFlushAll();
    case "EXPIRE": return memExpire();
    case "TTL": return memTtl();
    case "INCR": return memIncr(args[0]);
    case "DECR": return memDecr(args[0]);
    default:
      if (__mem.has("__debug")) console.error(`[mem] unhandled: ${cmd}`, args);
      throw new Error(`in-memory: unhandled command ${cmd}`);
  }
}

// ─── Redis abstraction ───────────────────────────────────────────

async function redis(command, ...args) {
  if (useMemory) {
    const result = await memRedisCommand(command, ...args);
    if (["SET","HSET","ZADD","LPUSH","RPUSH","DEL","HDEL","ZREM","SREM","SADD","FLUSHDB","FLUSHALL"].includes(command.toUpperCase())) {
      memWriteLedger(command, args[0], { args, result });
    }
    return result;
  } else if (useNative) {
    return await nativeRedisCommand(nativeClient, command, ...args);
  } else if (useBridge) {
    return await redisCommandBridge(bridgeUrl, bridgeToken, command, ...args);
  } else {
    return await upstashRedisCommand(upstashUrl, upstashToken, command, ...args);
  }
}

/** VM bridge: POST JSON command array → { result } or { error } */
async function redisCommandBridge(url, token, command, ...args) {
  // Polar/nginx ACMI bridge is /bridge/exec with no trailing slash (slash → 404).
  const endpoint = restEndpoint(url);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([command, ...args]),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Bridge: ${data.error}`);
  return data.result;
}

async function upstashRedisCommand(url, token, command, ...args) {
  const endpoint = restEndpoint(url);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([command, ...args]),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Upstash: ${data.error}`);
  return data.result;
}

async function nativeRedisCommand(client, command, ...args) {
  // Map Upstash-style commands to node-redis
  switch (command.toUpperCase()) {
    case "GET": return await client.get(args[0]);
    case "SET": return await client.set(args[0], args[1]);
    case "DEL": return await client.del(args);
    case "EXISTS": return await client.exists(args[0]);
    case "TYPE": return await client.type(args[0]);
    case "SCAN": return await scanRedis(client, args);
    case "HGET": return await client.hGet(args[0], args[1]);
    case "HSET": return await hSetRedis(client, args);
    case "HGETALL": return await hGetAllRedis(client, args[0]);
    case "HDEL": return await client.hDel(args[0], args.slice(1));
    case "ZADD": return await zAddRedis(client, args);
    case "ZRANGE": return await zRangeRedis(client, args, false);
    case "ZREVRANGE": return await zRangeRedis(client, args, true);
    case "ZREVRANGEBYSCORE": return await zRevRangeByScore(client, args);
    case "ZRANGEBYSCORE": return await zRangeByScore(client, args);
    case "ZREM": return await client.zRem(args[0], args.slice(1));
    case "ZCARD": return await client.zCard(args[0]);
    case "ZSCORE": return await client.zScore(args[0], args[1]);
    case "LPUSH": return await client.lPush(args[0], args.slice(1));
    case "RPUSH": return await client.rPush(args[0], args.slice(1));
    case "LRANGE": return await client.lRange(args[0], parseInt(args[1]), parseInt(args[2]));
    case "SADD": return await client.sAdd(args[0], args.slice(1));
    case "SMEMBERS": return await client.sMembers(args[0]);
    case "SREM": return await client.sRem(args[0], args.slice(1));
    case "DBSIZE": return await client.dbSize();
    case "PING": return "PONG";
    case "INFO": return await client.info();
    case "EXPIRE": return await client.expire(args[0], parseInt(args[1]));
    case "TTL": return await client.ttl(args[0]);
    case "INCR": return await client.incr(args[0]);
    case "DECR": return await client.decr(args[0]);
    case "KEYS": return await client.keys(args[0]);
    case "XADD": return await client.xAdd(args[0], "*", kvFromArgs(args, 1));
    case "XRANGE": return await client.xRange(args[0], args[1] || "-", args[2] || "+");
    case "XLEN": return await client.xLen(args[0]);
    case "FLUSHDB": await client.flushDb(); return "OK";
    case "FLUSHALL": await client.flushAll(); return "OK";
    default: throw new Error(`native: unknown command ${command}`);
  }
}

function kvFromArgs(args, start) {
  const obj = {};
  for (let i = start; i < args.length; i += 2) obj[args[i]] = args[i + 1];
  return obj;
}

async function scanRedis(client, args) {
  // Map Upstash-style SCAN with proper cursor handling
  // args: [cursor, "MATCH", pattern, "COUNT", count]
  let cursor = parseInt(args[0] || "0");
  const matchIdx = args.indexOf("MATCH");
  const countIdx = args.indexOf("COUNT");
  const match = matchIdx >= 0 ? args[matchIdx + 1] : "*";
  const count = countIdx >= 0 ? parseInt(args[countIdx + 1]) : 100;
  
  // Use explicit SCAN with cursor (not scanIterator which hangs)
  const result = await client.sendCommand(["SCAN", String(cursor), "MATCH", match, "COUNT", String(count)]);
  // Upstash returns: [nextCursor, keys[]]
  // node-redis returns: [nextCursor, keys[]]
  return result;
}

async function hSetRedis(client, args) {
  if (args.length === 3) return await client.hSet(args[0], args[1], args[2]);
  const obj = {};
  for (let i = 1; i < args.length; i += 2) obj[args[i]] = args[i + 1];
  return await client.hSet(args[0], obj);
}

async function hGetAllRedis(client, key) {
  const obj = await client.hGetAll(key);
  const result = [];
  for (const [k, v] of Object.entries(obj)) result.push(k, v);
  return result;
}

async function zAddRedis(client, args) {
  const members = [];
  for (let i = 1; i < args.length; i += 2) {
    members.push({ score: parseFloat(args[i]), value: args[i + 1] });
  }
  return await client.zAdd(args[0], members);
}

async function zRangeRedis(client, args, reverse) {
  const opts = { BY: "SCORE" };
  if (args[3]?.toUpperCase() === "WITHSCORES") opts.WITHSCORES = true;
  const result = await client.zRange(args[0], parseInt(args[1]), parseInt(args[2]), opts);
  if (reverse) result.reverse();
  if (opts.WITHSCORES) {
    const flat = [];
    for (const item of result) {
      if (typeof item === "object" && item !== null) {
        flat.push(item.value ?? item, item.score ?? "");
      } else flat.push(item);
    }
    return flat;
  }
  return result;
}

async function zRevRangeByScore(client, args) {
  const opts = { BY: "SCORE", REV: true };
  if (args[3]?.toUpperCase() === "WITHSCORES") opts.WITHSCORES = true;
  if (args[4]?.toUpperCase() === "LIMIT") {
    opts.LIMIT = { offset: parseInt(args[5]), count: parseInt(args[6]) };
  }
  const result = await client.zRangeByScore(args[0], args[2], args[1], opts);
  if (opts.WITHSCORES) {
    const flat = [];
    for (const item of result) {
      if (typeof item === "object" && item !== null) flat.push(item.value ?? item, item.score ?? "");
      else flat.push(item);
    }
    return flat;
  }
  return result;
}

async function zRangeByScore(client, args) {
  const opts = { BY: "SCORE" };
  if (args[3]?.toUpperCase() === "WITHSCORES") opts.WITHSCORES = true;
  const result = await client.zRangeByScore(args[0], args[1], args[2], opts);
  if (opts.WITHSCORES) {
    const flat = [];
    for (const item of result) {
      if (typeof item === "object" && item !== null) flat.push(item.value ?? item, item.score ?? "");
      else flat.push(item);
    }
    return flat;
  }
  return result;
}

// ─── Tenant validation (v2.0) ───────────────────────────────────

function validateTenant(t) {
  if (!allowedTenants.includes(t)) {
    throw new Error(`tenant "${t}" not in ACMI_ALLOWED_TENANTS=${allowedTenants.join(",")}`);
  }
  return t;
}

function resolveTenant(explicit) {
  const t = explicit || defaultTenant;
  return validateTenant(t);
}

function keyProfile(t, ns, id, suffix = "profile") {
  // Returns the full ACMI key for the given tenant + namespace + id
  return `acmi:${resolveTenant(t)}:${ns}:${id}:${suffix}`;
}

function parseKeyForTenant(key) {
  // Extract tenant from key: acmi:madez:agent:bentley:profile → "madez"
  const parts = key.split(":");
  if (parts.length < 4) return { tenant: null, rest: key };
  const tenant = parts[1];
  if (allowedTenants.includes(tenant)) return { tenant, rest: parts.slice(2).join(":") };
  return { tenant: null, rest: key };
}

// ─── Helpers ─────────────────────────────────────────────────────

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
 */
function safeTool(name, fn) {
  return async (args) => {
    try {
      const result = await fn(args);
      const parsed = typeof result.content?.[0]?.text === "string" ? JSON.parse(result.content[0].text) : result;
      if (useMemory && parsed && typeof parsed === "object") parsed.degraded = true;
      if (useMemory && parsed && typeof parsed === "object") parsed.mode = "in-memory";
      const text = JSON.stringify(parsed);
      return { content: [{ type: "text", text }] };
    } catch (e) { return { content: [{ type: "text", text: JSON.stringify({ ok: false, tool: name, error: String(e?.message || e), degraded: useMemory }) }] }; }
  };
}

// ─── The MCP server (v1.4 logic, v2.0 tenant-aware) ─────────────

const server = new McpServer({ name: "acmi-mcp", version: "2.0.1" });

// ── 1. acmi_profile ─────────────────────────────────────────────
server.tool(
  "acmi_profile",
  "Create or update an entity profile in ACMI. Stores arbitrary JSON profile data for an entity (agent, thread, project, etc.).",
  {
    namespace: z.string().describe("ACMI namespace (e.g. 'agent', 'thread', 'work')"),
    id: z.string().describe("Entity ID within the namespace"),
    profile: z.string().describe("JSON string of profile data to store"),
    tenant: z.string().optional().describe("Tenant override (defaults to ACMI_DEFAULT_TENANT)"),
  },
  safeTool("acmi_profile", async ({ namespace, id, profile, tenant }) => {
    validateKeySegments(namespace, id);
    validateJson(profile, "profile");
    const t = resolveTenant(tenant);
    const key = keyProfile(t, namespace, id, "profile");
    await redis("SET", key, profile);
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, tenant: t, key }) }] };
  })
);

// ── 2. acmi_signal ─────────────────────────────────────────────
server.tool(
  "acmi_signal",
  "Update AI signals for an entity. Signals are mutable KV state (mood, priorities, scores, etc.) that changes frequently.",
  {
    namespace: z.string().describe("ACMI namespace"),
    id: z.string().describe("Entity ID"),
    signals: z.string().describe("JSON string of signal data to store"),
    tenant: z.string().optional().describe("Tenant override"),
  },
  safeTool("acmi_signal", async ({ namespace, id, signals, tenant }) => {
    validateKeySegments(namespace, id);
    validateJson(signals, "signals");
    const t = resolveTenant(tenant);
    const key = keyProfile(t, namespace, id, "signals");
    await redis("SET", key, signals);
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, tenant: t, key }) }] };
  })
);

// ── 3. acmi_event ──────────────────────────────────────────────
server.tool(
  "acmi_event",
  "Log a timeline event for an entity. The workhorse tool — records timestamped events with source, kind, correlationId, and summary. Follows ACMI Communication Standard v1.1.",
  {
    namespace: z.string().describe("ACMI namespace"),
    id: z.string().describe("Entity ID"),
    source: z.string().describe("Event source (e.g. 'agent:bentley')"),
    summary: z.string().describe("Human-readable event summary"),
    kind: z.string().optional().describe("Event kind (default: 'event')"),
    correlationId: z.string().optional().describe("Correlation ID for chain tracking"),
    parentCorrelationId: z.string().optional().describe("Parent correlation ID for chain tracking"),
    tenant: z.string().optional().describe("Tenant override"),
  },
  safeTool("acmi_event", async ({ namespace, id, source, summary, kind, correlationId, parentCorrelationId, tenant }) => {
    validateKeySegments(namespace, id);
    const t = resolveTenant(tenant);
    const key = keyProfile(t, namespace, id, "timeline");
    const ts = Date.now();
    const event = { ts, source, summary };
    if (kind) event.kind = kind;
    if (correlationId) event.correlationId = correlationId;
    if (parentCorrelationId) event.parentCorrelationId = parentCorrelationId;
    await redis("ZADD", key, ts, JSON.stringify(event));
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, tenant: t, key, event }) }] };
  })
);

// ── 4. acmi_get ────────────────────────────────────────────────
server.tool(
  "acmi_get",
  "Fetch complete entity context: profile + signals + recent timeline events (last 10).",
  {
    namespace: z.string().describe("ACMI namespace"),
    id: z.string().describe("Entity ID"),
    tenant: z.string().optional().describe("Tenant override"),
  },
  safeTool("acmi_get", async ({ namespace, id, tenant }) => {
    validateKeySegments(namespace, id);
    const t = resolveTenant(tenant);
    const prefix = `acmi:${t}:${namespace}:${id}`;
    const [profile, signals, timeline] = await Promise.all([
      redis("GET", `${prefix}:profile`),
      redis("GET", `${prefix}:signals`),
      redis("ZREVRANGEBYSCORE", `${prefix}:timeline`, "+inf", "0", "WITHSCORES", "LIMIT", "0", "10"),
    ]);
    return { content: [{ type: "text", text: JSON.stringify({
      namespace, id, tenant: t,
      profile: profile ? tryParse(profile) : null,
      signals: signals ? tryParse(signals) : null,
      timeline_recent: parseZWithScores(timeline || []).map(e => e.data),
    }) }] };
  })
);

// ── 5. acmi_list ───────────────────────────────────────────────
server.tool(
  "acmi_list",
  "List all entity IDs within a namespace (and optional tenant).",
  {
    namespace: z.string().describe("ACMI namespace to list"),
    tenant: z.string().optional().describe("Tenant override"),
    limit: z.number().optional().describe("Max entities to return (default 100)"),
  },
  safeTool("acmi_list", async ({ namespace, tenant, limit }) => {
    const t = resolveTenant(tenant);
    const pattern = `acmi:${t}:${namespace}:*:profile`;
    const allKeys = [];
    let cursor = "0";
    let iterations = 0;
    const maxIter = 100; // safety limit
    while (iterations < maxIter) {
      const result = await redis("SCAN", cursor, "MATCH", pattern, "COUNT", "500");
      const [nextCursor, keys] = result;
      allKeys.push(...(keys || []));
      iterations++;
      if (nextCursor === "0" || nextCursor === 0) break;
      cursor = String(nextCursor);
    }
    const ids = allKeys.map(k => {
      const parts = k.split(":");
      return parts.slice(3, -1).join(":"); // acmi:tenant:namespace:ID:profile → ID
    });
    return { content: [{ type: "text", text: JSON.stringify({
      namespace, tenant: t, count: ids.length, ids: ids.slice(0, limit || 100),
    }) }] };
  })
);

// ── 6. acmi_cat ────────────────────────────────────────────────
server.tool(
  "acmi_cat",
  "Multi-stream event merge view. Combines timeline events from multiple entities, sorted by timestamp. Supports --since filtering.",
  {
    keys: z.array(z.string()).describe("ACMI stream keys (e.g. ['thread:agent-coordination', 'work:item-123'])"),
    since: z.string().optional().describe("Time window: e.g. '24h', '7d', '30m'"),
    limit: z.number().optional().describe("Max events to return (default 50)"),
  },
  safeTool("acmi_cat", async ({ keys, since, limit }) => {
    const t = parseSince(since);
    const allEvents = [];
    for (const key of keys) {
      const fullKey = `acmi:${resolveTenant()}:${key}:timeline`;
      const events = await redis("ZREVRANGEBYSCORE", fullKey, "+inf", t || "0", "WITHSCORES", "LIMIT", "0", "500");
      for (const e of parseZWithScores(events || [])) allEvents.push(e);
    }
    allEvents.sort((a, b) => b.ts - a.ts);
    const top = allEvents.slice(0, limit || 50);
    return { content: [{ type: "text", text: JSON.stringify({
      count: top.length, total: allEvents.length, events: top.map(e => e.data),
    }) }] };
  })
);

// ── 7. acmi_bootstrap ──────────────────────────────────────────
server.tool(
  "acmi_bootstrap",
  "One-shot agent context bundle. Fetches everything a fresh agent session needs: profile, signals, active threads, rollup, recent timeline, and spawns.",
  {
    agentId: z.string().describe("Agent ID to bootstrap"),
    tenant: z.string().optional().describe("Tenant override"),
  },
  safeTool("acmi_bootstrap", async ({ agentId, tenant }) => {
    validateKeySegments(agentId);
    const t = resolveTenant(tenant);
    const prefix = `acmi:${t}:agent:${agentId}`;
    const [profile, signals, active, rollup, timeline, spawns] = await Promise.all([
      redis("GET", `${prefix}:profile`),
      redis("GET", `${prefix}:signals`),
      redis("GET", `${prefix}:active_context`),
      redis("GET", `${prefix}:rollup:latest`),
      redis("ZREVRANGEBYSCORE", `${prefix}:timeline`, "+inf", "0", "WITHSCORES", "LIMIT", "0", "10"),
      redis("ZREVRANGEBYSCORE", `${prefix}:timeline`, "+inf", "0", "WITHSCORES", "LIMIT", "0", "5"),
    ]);
    return { content: [{ type: "text", text: JSON.stringify({
      agent_id: agentId, tenant: t,
      profile: profile ? tryParse(profile) : null,
      signals: signals ? tryParse(signals) : null,
      active_context: active ? tryParse(active) : {},
      rollup_latest: rollup ? tryParse(rollup) : null,
      timeline_recent: parseZWithScores(timeline || []).map(e => e.data),
      recent_spawns: parseZWithScores(spawns || []).map(e => e.data),
    }) }] };
  })
);

// ── 8. acmi_spawn ──────────────────────────────────────────────
server.tool(
  "acmi_spawn",
  "Log an agent session spawn event.",
  {
    agentId: z.string().describe("Agent ID being spawned"),
    sessionId: z.string().optional().describe("Session identifier"),
    modelId: z.string().optional().describe("Model ID for this session"),
    tenant: z.string().optional().describe("Tenant override"),
  },
  safeTool("acmi_spawn", async ({ agentId, sessionId, modelId, tenant }) => {
    validateKeySegments(agentId);
    const t = resolveTenant(tenant);
    const key = `acmi:${t}:agent:${agentId}:timeline`;
    const ts = Date.now();
    const data = { ts };
    if (sessionId) data.sessionId = sessionId;
    if (modelId) data.modelId = modelId;
    await redis("ZADD", key, ts, JSON.stringify(data));
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, tenant: t, key, data }) }] };
  })
);

// ── 9. acmi_active ─────────────────────────────────────────────
server.tool(
  "acmi_active",
  "Track thread engagement for an agent.",
  {
    agentId: z.string().describe("Agent ID"),
    threadKey: z.string().describe("Thread key (e.g. 'agent-coordination')"),
    role: z.string().optional().describe("Role in thread: 'participant' or 'lead' (default 'participant')"),
    tenant: z.string().optional().describe("Tenant override"),
  },
  safeTool("acmi_active", async ({ agentId, threadKey, role, tenant }) => {
    validateKeySegments(agentId, threadKey);
    const t = resolveTenant(tenant);
    const ts = Date.now();
    await redis("SADD", `acmi:${t}:agent:${agentId}:active_threads`, `${threadKey}:${role || "participant"}:${ts}`);
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, tenant: t }) }] };
  })
);

// ── 10. acmi_rollup_set ────────────────────────────────────────
server.tool(
  "acmi_rollup_set",
  "Write the latest session rollup for an agent (read by acmi_bootstrap).",
  {
    agentId: z.string().describe("Agent ID"),
    rollup: z.string().describe("JSON string of rollup data"),
    tenant: z.string().optional().describe("Tenant override"),
  },
  safeTool("acmi_rollup_set", async ({ agentId, rollup, tenant }) => {
    validateKeySegments(agentId);
    validateJson(rollup, "rollup");
    const t = resolveTenant(tenant);
    const key = `acmi:${t}:agent:${agentId}:rollup:latest`;
    await redis("SET", key, rollup);
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, tenant: t, key }) }] };
  })
);

// ── 11-15. Work items (unchanged from v1.4, with tenant support) ─
server.tool("acmi_work_create", "Create a new work item.",
  { id: z.string(), title: z.string(), tenant: z.string().optional() },
  safeTool("acmi_work_create", async ({ id, title, tenant }) => {
    const t = resolveTenant(tenant);
    const key = `acmi:${t}:work:${id}:profile`;
    const profile = { id, title, status: "open", created_at: Date.now() };
    await redis("SET", key, JSON.stringify(profile));
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, tenant: t, work: profile }) }] };
  })
);

server.tool("acmi_work_event", "Add an event to a work item timeline.",
  { id: z.string(), source: z.string(), summary: z.string(), kind: z.string().optional(), tenant: z.string().optional() },
  safeTool("acmi_work_event", async ({ id, source, summary, kind, tenant }) => {
    const t = resolveTenant(tenant);
    const key = `acmi:${t}:work:${id}:timeline`;
    const ts = Date.now();
    const ev = { ts, source, summary };
    if (kind) ev.kind = kind;
    await redis("ZADD", key, ts, JSON.stringify(ev));
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, tenant: t, event: ev }) }] };
  })
);

server.tool("acmi_work_signal", "Update work item signals.",
  { id: z.string(), signals: z.string(), tenant: z.string().optional() },
  safeTool("acmi_work_signal", async ({ id, signals, tenant }) => {
    validateJson(signals, "signals");
    const t = resolveTenant(tenant);
    const key = `acmi:${t}:work:${id}:signals`;
    await redis("SET", key, signals);
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, tenant: t, key }) }] };
  })
);

server.tool("acmi_work_get", "Fetch work item profile + signals + recent events.",
  { id: z.string(), tenant: z.string().optional() },
  safeTool("acmi_work_get", async ({ id, tenant }) => {
    const t = resolveTenant(tenant);
    const prefix = `acmi:${t}:work:${id}`;
    const signalsType = await redis("TYPE", `${prefix}:signals`);
    const [profileRaw, signalsRaw, timeline] = await Promise.all([
      redis("GET", `${prefix}:profile`),
      redis(signalsType === "hash" ? "HGETALL" : "GET", `${prefix}:signals`),
      redis("ZREVRANGEBYSCORE", `${prefix}:timeline`, "+inf", "0", "WITHSCORES", "LIMIT", "0", "20"),
    ]);
    const parsedSignals = signalsType === "hash"
      ? parseHash(signalsRaw)
      : (signalsRaw ? tryParse(signalsRaw) : null);
    return { content: [{ type: "text", text: JSON.stringify({
      id, tenant: t,
      profile: profileRaw ? tryParse(profileRaw) : null,
      signals: parsedSignals,
      timeline: parseZWithScores(timeline || []).map(e => e.data),
      _signalsType: signalsType || null,
    }) }] };
  })
);

server.tool("acmi_work_list", "List all work item IDs.",
  { tenant: z.string().optional() },
  safeTool("acmi_work_list", async ({ tenant }) => {
    const t = resolveTenant(tenant);
    const result = await redis("SCAN", "0", "MATCH", `acmi:${t}:work:*:profile`, "COUNT", "500");
    return { content: [{ type: "text", text: JSON.stringify({
      tenant: t, count: (result[1] || []).length, ids: (result[1] || []).map(k => k.split(":")[3]),
    }) }] };
  })
);

// ── 16. acmi_delete (unchanged) ────────────────────────────────
server.tool("acmi_delete",
  "Delete an ACMI key. Supports dry-run mode and refuses to delete protected paths (acmi:registry:*, acmi:notion-sync:*).",
  {
    key: z.string().describe("Full ACMI key to delete (e.g. 'acmi:agent:foo:profile')"),
    confirm: z.boolean().optional().describe("Set to true to actually delete (default is dry-run)"),
  },
  safeTool("acmi_delete", async ({ key, confirm }) => {
    if (isProtectedKey(key)) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `Refusing to delete protected key: ${key}` }) }] };
    }
    if (!confirm) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, dry_run: true, key, action: "would delete" }) }] };
    }
    await redis("DEL", key);
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, key, action: "deleted" }) }] };
  })
);

// ── 17. acmi_mcp_status ───────────────────────────────────────
server.tool(
  "acmi_mcp_status",
  "Report ACMI MCP server status: connection mode, tenant, degraded state.",
  {},
  safeTool("acmi_mcp_status", async () => {
    return { content: [{ type: "text", text: JSON.stringify({
      version: "2.0.1",
      mode: useNative ? "native-redis" : useBridge ? "vm-http-bridge" : useMemory ? "degraded-in-memory" : "upstash-rest",
      degraded: useMemory,
      tenant: defaultTenant,
      allowed_tenants: allowedTenants,
      local_ledger: localLedgerPath || null,
      uptime_ms: Date.now() - (global.__acmi_start || Date.now()),
    }) }] };
  })
);

// ── 18. acmi_tenant_list (v2.0 NEW) ───────────────────────────
server.tool("acmi_tenant_list",
  "List all tenants visible to this MCP client (from ACMI_ALLOWED_TENANTS env).",
  {},
  safeTool("acmi_tenant_list", async () => {
    return { content: [{ type: "text", text: JSON.stringify({
      allowed_tenants: allowedTenants,
      default_tenant: defaultTenant,
    }) }] };
  })
);

// ─── Run ────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
const modeLabel = useNative ? "native-redis" : useBridge ? "vm-http-bridge" : useMemory ? "degraded-in-memory" : "upstash-rest";
console.error(`[acmi-mcp v2.0] ready (mode: ${modeLabel}, tenant: ${defaultTenant})`);
