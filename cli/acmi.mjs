#!/usr/bin/env node

/**
 * Agentic Context Management Infrastructure (ACMI)
 * A universal context engine for AI agents using Upstash KV (Redis)
 */

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  console.error("ERROR: Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN.");
  process.exit(1);
}

async function redis(command, ...args) {
  const endpoint = `${url.replace(/\/$/, '')}/`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([command, ...args])
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error);
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
  return n * (m[2] === 'h' ? 3600e3 : m[2] === 'd' ? 86400e3 : 60e3);
}

const action = process.argv[2];

async function main() {
  if (!action) {
    printHelp();
    return;
  }

  try {
    switch (action) {
      case 'profile':       await cmdProfile(); break;
      case 'event':         await cmdEvent(); break;
      case 'signal':        await cmdSignal(); break;
      case 'get':           await cmdGet(); break;
      case 'list':          await cmdList(); break;
      case 'delete':        await cmdDelete(); break;
      case 'bootstrap':     await cmdBootstrap(process.argv[3]); break;
      case 'cat':           await cmdCat(process.argv.slice(3)); break;
      case 'spawn':         await cmdSpawn(process.argv[3], process.argv[4], process.argv[5]); break;
      case 'active':        await cmdActive(process.argv.slice(3)); break;
      case 'rollup-set':    await cmdRollupSet(process.argv[3], process.argv[4]); break;
      case 'work':          await cmdWork(process.argv.slice(3)); break;
      default:              printHelp();
    }
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

async function cmdProfile() {
  const namespace = process.argv[3];
  const id = process.argv[4];
  const json = process.argv[5];
  if (!namespace || !id || !json) throw new Error("Usage: acmi profile <namespace> <id> '<json>'");
  const prefix = `acmi:${namespace}:${id}`;
  await redis('SET', `${prefix}:profile`, json);
  await redis('SADD', `acmi:${namespace}:list`, id);
  console.log(`✅ Profile updated for [${namespace}] ${id}`);
}

async function cmdEvent() {
  const namespace = process.argv[3];
  const id = process.argv[4];
  const source = process.argv[5];
  const summary = process.argv[6];
  if (!namespace || !id || !source || !summary) throw new Error("Usage: acmi event <namespace> <id> <source> '<summary>'");
  const ts = Date.now();
  const eventData = JSON.stringify({ ts, source, summary });
  await redis('ZADD', `acmi:${namespace}:${id}:timeline`, ts, eventData);
  console.log(`✅ Event logged for [${namespace}] ${id} from source: ${source}`);
}

async function cmdSignal() {
  const namespace = process.argv[3];
  const id = process.argv[4];
  const json = process.argv[5];
  if (!namespace || !id || !json) throw new Error("Usage: acmi signal <namespace> <id> '<json>'");
  await redis('SET', `acmi:${namespace}:${id}:signals`, json);
  console.log(`✅ Signals updated for [${namespace}] ${id}`);
}

async function cmdGet() {
  const namespace = process.argv[3];
  const id = process.argv[4];
  if (!namespace || !id) throw new Error("Usage: acmi get <namespace> <id>");
  const prefix = `acmi:${namespace}:${id}`;
  const profile = await redis('GET', `${prefix}:profile`);
  const signals = await redis('GET', `${prefix}:signals`);
  const timeline = await redis('ZREVRANGE', `${prefix}:timeline`, 0, 49);
  console.log(JSON.stringify({
    namespace,
    id,
    profile: profile ? JSON.parse(profile) : null,
    signals: signals ? JSON.parse(signals) : null,
    timeline: (timeline || []).map(tryParse),
  }, null, 2));
}

async function cmdList() {
  const namespace = process.argv[3];
  if (!namespace) throw new Error("Usage: acmi list <namespace>");
  const entities = await redis('SMEMBERS', `acmi:${namespace}:list`);
  console.log(JSON.stringify(entities || [], null, 2));
}

async function cmdDelete() {
  const namespace = process.argv[3];
  const id = process.argv[4];
  if (!namespace || !id) throw new Error("Usage: acmi delete <namespace> <id>");
  const prefix = `acmi:${namespace}:${id}`;
  await redis('DEL', `${prefix}:profile`, `${prefix}:signals`, `${prefix}:timeline`);
  await redis('SREM', `acmi:${namespace}:list`, id);
  console.log(`✅ Deleted [${namespace}] ${id}`);
}

async function cmdBootstrap(agentId) {
  if (!agentId) throw new Error("Usage: acmi bootstrap <agent_id>");
  const prefix = `acmi:agent:${agentId}`;
  const profile = await redis('GET', `${prefix}:profile`);
  const signals = await redis('GET', `${prefix}:signals`);
  const active = await redis('HGETALL', `${prefix}:active_context`);
  const rollup = await redis('GET', `${prefix}:rollup:latest`);
  const timeline = await redis('ZREVRANGE', `${prefix}:timeline`, 0, 19);
  const spawns = await redis('ZREVRANGE', `${prefix}:spawns`, 0, 4, 'WITHSCORES');

  console.log(JSON.stringify({
    agent_id: agentId,
    bootstrapped_at: new Date().toISOString(),
    profile: profile ? tryParse(profile) : null,
    signals: signals ? tryParse(signals) : null,
    active_context: parseHash(active),
    rollup_latest: rollup ? tryParse(rollup) : null,
    timeline_recent: (timeline || []).map(tryParse),
    recent_spawns: parseZWithScores(spawns),
  }, null, 2));
}

async function cmdCat(args) {
  if (!args.length) throw new Error("Usage: acmi cat <key> [key ...] [--since=24h] [--limit=50]");
  let limit = 50;
  let sinceMs = 0;
  const targets = [];
  for (const a of args) {
    if (a.startsWith('--since=')) sinceMs = parseSince(a.slice(8));
    else if (a.startsWith('--limit=')) limit = Number(a.slice(8));
    else if (a.startsWith('acmi:')) targets.push(a);
    else if (a.endsWith(':timeline')) targets.push(`acmi:${a}`);
    else targets.push(`acmi:${a}:timeline`);
  }
  if (!targets.length) throw new Error("no timeline keys provided");

  const minScore = sinceMs ? Date.now() - sinceMs : 0;
  const merged = [];
  for (const k of targets) {
    const r = await redis('ZRANGEBYSCORE', k, minScore, '+inf', 'WITHSCORES');
    for (const e of parseZWithScores(r)) merged.push({ ...e, _source: k });
  }
  merged.sort((a, b) => b.ts - a.ts);

  for (const m of merged.slice(0, limit)) {
    const iso = new Date(m.ts).toISOString().slice(0, 16).replace('T', ' ') + 'Z';
    const src = m._source.replace(/^acmi:|:timeline$/g, '');
    const d = m.data || {};
    const kind = d.kind || d.source || '?';
    const summary = (d.summary || d.message || JSON.stringify(d)).toString().slice(0, 160);
    console.log(`${iso} [${src} / ${kind}] ${summary}`);
  }
}

async function cmdSpawn(agentId, sessionId, modelId) {
  if (!agentId) throw new Error("Usage: acmi spawn <agent_id> [session_id] [model_id]");
  const ts = Date.now();
  const event = JSON.stringify({
    ts,
    session_id: sessionId || null,
    model_id: modelId || null,
    host: process.env.HOSTNAME || null,
  });
  await redis('ZADD', `acmi:agent:${agentId}:spawns`, ts, event);
  console.log(`✅ Spawn logged for [${agentId}] (session=${sessionId || '-'}, model=${modelId || '-'})`);
}

async function cmdActive(args) {
  const [agentId, sub, threadKey, role] = args;
  if (!agentId || !sub) throw new Error("Usage: acmi active <agent_id> <add|remove|list> [thread_key] [role]");
  const key = `acmi:agent:${agentId}:active_context`;

  if (sub === 'add') {
    if (!threadKey) throw new Error("Usage: acmi active <agent_id> add <thread_key> [role]");
    const value = JSON.stringify({ role: role || 'participant', since_ts: Date.now() });
    await redis('HSET', key, threadKey, value);
    console.log(`✅ ${agentId} active in ${threadKey} as ${role || 'participant'}`);
  } else if (sub === 'remove') {
    if (!threadKey) throw new Error("Usage: acmi active <agent_id> remove <thread_key>");
    await redis('HDEL', key, threadKey);
    console.log(`✅ ${agentId} left ${threadKey}`);
  } else if (sub === 'list') {
    const arr = await redis('HGETALL', key);
    console.log(JSON.stringify(parseHash(arr), null, 2));
  } else {
    throw new Error(`Unknown active subaction: ${sub}`);
  }
}

async function cmdRollupSet(agentId, text) {
  if (!agentId || !text) throw new Error("Usage: acmi rollup-set <agent_id> '<summary text>'");
  const payload = JSON.stringify({ ts: Date.now(), summary: text });
  await redis('SET', `acmi:agent:${agentId}:rollup:latest`, payload);
  console.log(`✅ Rollup set for [${agentId}]`);
}

async function cmdWork(args) {
  const [sub, ...rest] = args;
  if (!sub) throw new Error("Usage: acmi work <create|get|event|signal|sessions|list> ...");

  switch (sub) {
    case 'create': {
      const [id, json] = rest;
      if (!id || !json) throw new Error("Usage: acmi work create <id> '<profile json>'");
      await redis('SET', `acmi:work:${id}:profile`, json);
      await redis('SADD', 'acmi:work:list', id);
      console.log(`✅ Work item created: ${id}`);
      break;
    }
    case 'get': {
      const [id] = rest;
      if (!id) throw new Error("Usage: acmi work get <id>");
      const prefix = `acmi:work:${id}`;
      const profile = await redis('GET', `${prefix}:profile`);
      const signals = await redis('GET', `${prefix}:signals`);
      const timeline = await redis('ZREVRANGE', `${prefix}:timeline`, 0, 49);
      const sessions = await redis('SMEMBERS', `${prefix}:sessions`);
      console.log(JSON.stringify({
        work_id: id,
        profile: profile ? tryParse(profile) : null,
        signals: signals ? tryParse(signals) : null,
        timeline: (timeline || []).map(tryParse),
        sessions: sessions || [],
      }, null, 2));
      break;
    }
    case 'event': {
      const [id, source, summary, sessionId] = rest;
      if (!id || !source || !summary) throw new Error("Usage: acmi work event <id> <source> '<summary>' [session_id]");
      const ts = Date.now();
      const event = JSON.stringify({ ts, source, summary, session_id: sessionId || null });
      await redis('ZADD', `acmi:work:${id}:timeline`, ts, event);
      if (sessionId) await redis('SADD', `acmi:work:${id}:sessions`, sessionId);
      console.log(`✅ Work event logged: ${id} <- ${source}`);
      break;
    }
    case 'signal': {
      const [id, json] = rest;
      if (!id || !json) throw new Error("Usage: acmi work signal <id> '<signals json>'");
      await redis('SET', `acmi:work:${id}:signals`, json);
      console.log(`✅ Work signals updated: ${id}`);
      break;
    }
    case 'sessions': {
      const [id] = rest;
      if (!id) throw new Error("Usage: acmi work sessions <id>");
      const arr = await redis('SMEMBERS', `acmi:work:${id}:sessions`);
      console.log(JSON.stringify(arr || [], null, 2));
      break;
    }
    case 'list': {
      const arr = await redis('SMEMBERS', 'acmi:work:list');
      console.log(JSON.stringify(arr || [], null, 2));
      break;
    }
    default:
      throw new Error(`Unknown work subaction: ${sub}`);
  }
}

function printHelp() {
  console.log(`
🧠 Agentic Context Management Infrastructure (ACMI)
===================================================
A universal framework for persistent, timeline-based agent memory.

Core:
  node acmi.mjs profile <ns> <id> '<json>'
  node acmi.mjs event <ns> <id> <source> '<summary>'
  node acmi.mjs signal <ns> <id> '<json>'
  node acmi.mjs get <ns> <id>
  node acmi.mjs list <ns>
  node acmi.mjs delete <ns> <id>

Spawn / Identity (imp-7 extension):
  node acmi.mjs bootstrap <agent_id>                       # 6-read context bundle for fresh sessions
  node acmi.mjs spawn <agent_id> [session_id] [model_id]   # log a spawn event to :spawns ZSET
  node acmi.mjs active <agent_id> add <thread_key> [role]  # join a thread
  node acmi.mjs active <agent_id> remove <thread_key>
  node acmi.mjs active <agent_id> list
  node acmi.mjs rollup-set <agent_id> '<summary text>'     # store latest LLM-synthesized rollup

Multi-stream view:
  node acmi.mjs cat <key> [key ...] [--since=24h] [--limit=50]
    keys: 'thread:bentley-pm', 'agent:bentley', or full 'acmi:...:timeline'

Work items (cross-session ideas/projects/tasks):
  node acmi.mjs work create <id> '<profile json>'
  node acmi.mjs work event <id> <source> '<summary>' [session_id]
  node acmi.mjs work signal <id> '<signals json>'
  node acmi.mjs work get <id>
  node acmi.mjs work sessions <id>
  node acmi.mjs work list

Examples:
  node acmi.mjs profile sales gardine-wilson '{"stage": "proposal"}'
  node acmi.mjs bootstrap claude-engineer
  node acmi.mjs cat thread:bentley-pm agent:bentley --since=24h
  node acmi.mjs work create acmi-launch '{"title":"ACMI public launch","owner":"bentley"}'
  node acmi.mjs work event acmi-launch claude-engineer "manifesto draft v0 done" sess_abc123
`);
}

main();
