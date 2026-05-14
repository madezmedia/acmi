#!/usr/bin/env node

/**
 * Agentic Context Memory Interface (ACMI)
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

async function main() {
  const [action, ...rest] = process.argv.slice(2);

  try {
    switch (action) {
      case 'profile':       await cmdProfile(rest); break;
      case 'event':         await cmdEvent(rest); break;
      case 'signal':        await cmdSignal(rest); break;
      case 'get':           await cmdGet(rest); break;
      case 'list':          await cmdList(rest); break;
      case 'delete':        await cmdDelete(rest); break;
      case 'bootstrap':     await cmdBootstrap(rest[0]); break;
      case 'spawn':         await cmdSpawn(rest[0], rest[1], rest[2]); break;
      case 'active':        await cmdActive(rest[0], rest[1], rest[2], rest[3]); break;
      case 'rollup-set':    await cmdRollupSet(rest[0], rest[1]); break;
      case 'cat':           await cmdCat(rest); break;
      case 'exec':          await cmdExec(rest); break;
      case 'work':          await cmdWork(rest[0], rest.slice(1)); break;
      case '--help':
      case 'help':
      default:
        printHelp();
    }
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

function validateKeySegments(...segments) {
  for (const s of segments) {
    if (!s || s === 'undefined' || s === 'null') {
      throw new Error(`Invalid key segment detected: "${s}". Check your arguments.`);
    }
  }
}

async function cmdProfile(args) {
  const [ns, id, json] = args;
  if (!ns || !id || !json) throw new Error("Usage: acmi profile <ns> <id> '<json>'");
  validateKeySegments(ns, id);
  const key = `acmi:${ns}:${id}:profile`;
  await redis('SET', key, json);
  await redis('SADD', `acmi:${ns}:list`, id);
  console.log(`✅ Profile updated: ${key}`);
}

async function cmdEvent(args) {
  let [ns, id, source, summary] = args;

  // Fix for 'thread:X' colon-form footgun (CID: acmi-cli-cmdevent-namespace-footgun)
  // Allows: node acmi.mjs event thread:bentley-pm source "summary"
  if (ns && ns.includes(':') && !summary) {
    const parts = ns.split(':');
    if (parts.length === 2) {
      summary = source;
      source = id;
      id = parts[1];
      ns = parts[0];
    }
  }

  if (!ns || !id || !source || !summary) throw new Error("Usage: acmi event <ns> <id> <source> '<summary>'");
  validateKeySegments(ns, id);

  const key = `acmi:${ns}:${id}:timeline`;
  const ts = Date.now();
  const event = JSON.stringify({ ts, source, summary });
  await redis('ZADD', key, ts, event);
  await redis('SADD', `acmi:${ns}:list`, id);
  console.log(`✅ Event logged: ${key} <- ${source}`);
}

async function cmdSignal(args) {
  const [ns, id, json] = args;
  if (!ns || !id || !json) throw new Error("Usage: acmi signal <ns> <id> '<json>'");
  validateKeySegments(ns, id);
  const key = `acmi:${ns}:${id}:signals`;
  await redis('SET', key, json);
  await redis('SADD', `acmi:${ns}:list`, id);
  console.log(`✅ Signals updated: ${key}`);
}

async function cmdGet(args) {
  const [ns, id] = args;
  if (!ns || !id) throw new Error("Usage: acmi get <ns> <id>");
  const prefix = `acmi:${ns}:${id}`;
  const profile = await redis('GET', `${prefix}:profile`);
  const signals = await redis('GET', `${prefix}:signals`);
  const timeline = await redis('ZREVRANGE', `${prefix}:timeline`, 0, 9);
  console.log(JSON.stringify({
    profile: profile ? tryParse(profile) : null,
    signals: signals ? tryParse(signals) : null,
    timeline_recent: (timeline || []).map(tryParse)
  }, null, 2));
}

async function cmdList(ns) {
  if (!ns) throw new Error("Usage: acmi list <ns>");
  const arr = await redis('SMEMBERS', `acmi:${ns}:list`);
  console.log(JSON.stringify(arr || [], null, 2));
}

async function cmdDelete(args) {
  const [namespace, id] = args;
  if (!namespace || !id) throw new Error("Usage: acmi delete <ns> <id>");
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
    // Handle high-precision timestamps (e.g. 17-digit) by truncating to 13-digit ms
    let ts = m.ts;
    if (isNaN(ts)) continue;
    if (ts > 9999999999999) {
      ts = Number(String(ts).slice(0, 13));
    }
    const iso = new Date(ts).toISOString().slice(0, 16).replace('T', ' ') + 'Z';
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
  const data = JSON.stringify({ ts, session_id: sessionId || 'unknown', model_id: modelId || 'unknown' });
  await redis('ZADD', `acmi:agent:${agentId}:spawns`, ts, data);
  console.log(`✅ Spawn logged for ${agentId}`);
}

async function cmdActive(agentId, action, threadKey, role) {
  if (!agentId || !action) throw new Error("Usage: acmi active <agent_id> add|remove|list [thread_key] [role]");
  const key = `acmi:agent:${agentId}:active_context`;
  if (action === 'add') {
    if (!threadKey) throw new Error("thread_key required for add");
    await redis('HSET', key, threadKey, JSON.stringify({ role: role || 'participant', joined_at: Date.now() }));
    console.log(`✅ Joined thread ${threadKey}`);
  } else if (action === 'remove') {
    if (!threadKey) throw new Error("thread_key required for remove");
    await redis('HDEL', key, threadKey);
    console.log(`✅ Left thread ${threadKey}`);
  } else {
    const res = await redis('HGETALL', key);
    console.log(JSON.stringify(parseHash(res), null, 2));
  }
}

async function cmdRollupSet(agentId, text) {
  if (!agentId || !text) throw new Error("Usage: acmi rollup-set <agent_id> '<text>'");
  await redis('SET', `acmi:agent:${agentId}:rollup:latest`, JSON.stringify({ ts: Date.now(), summary: text }));
  console.log(`✅ Rollup updated for ${agentId}`);
}

async function cmdWork(sub, rest) {
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

async function cmdExec(args) {
  const [ns, id, source, ...cmdArgs] = args;
  if (!ns || !id || !source || !cmdArgs.length) {
    throw new Error("Usage: acmi exec <ns> <id> <source> <command> [args...]");
  }
  
  validateKeySegments(ns, id);
  const command = cmdArgs.join(' ');
  const key = `acmi:${ns}:${id}:timeline`;
  const correlationId = `exec-${Date.now()}`;

  console.log(`🚀 Executing: ${command}`);
  
  // Log tool-call
  await redis('ZADD', key, Date.now(), JSON.stringify({
    ts: Date.now(),
    source,
    kind: 'tool-call',
    correlationId,
    summary: `Executing tool: ${command.slice(0, 100)}`,
    payload: { command }
  }));

  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  try {
    const { stdout, stderr } = await execAsync(command);
    const result = stdout || stderr;
    
    // Log tool-result
    await redis('ZADD', key, Date.now(), JSON.stringify({
      ts: Date.now(),
      source,
      kind: 'tool-result',
      correlationId,
      summary: `Tool finished: ${command.split(' ')[0]}`,
      payload: { 
        stdout: stdout.slice(0, 5000), 
        stderr: stderr.slice(0, 1000),
        status: 'success'
      }
    }));
    
    console.log(stdout);
    if (stderr) console.error(stderr);
  } catch (err) {
    // Log tool-failure
    await redis('ZADD', key, Date.now(), JSON.stringify({
      ts: Date.now(),
      source,
      kind: 'tool-result',
      correlationId,
      summary: `Tool failed: ${command.split(' ')[0]}`,
      payload: { 
        error: err.message,
        status: 'error'
      }
    }));
    throw err;
  }
}

function printHelp() {
  console.log(`
🧠 Agentic Context Memory Interface (ACMI)
===================================================
A universal framework for persistent, timeline-based agent memory.

Core:
  node acmi.mjs profile <ns> <id> '<json>'
  node acmi.mjs event <ns> <id> <source> '<summary>'
  node acmi.mjs signal <ns> <id> '<json>'
  node acmi.mjs get <ns> <id>
  node acmi.mjs list <ns>
  node acmi.mjs delete <ns> <id>

Tool Orchestration (Unix-style):
  node acmi.mjs exec <ns> <id> <source> <cmd>      # run command and log call/result to timeline

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
  node acmi.mjs exec work fix-bug-123 agent:claude "npm test"
  node acmi.mjs work create acmi-launch '{"title":"ACMI public launch","owner":"bentley"}'
  node acmi.mjs work event acmi-launch claude-engineer "manifesto draft v0 done" sess_abc123
`);
}

main();
