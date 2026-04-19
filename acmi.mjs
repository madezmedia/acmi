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

const action = process.argv[2];
const namespace = process.argv[3];
const id = process.argv[4];

async function main() {
  if (!action || !namespace) {
    printHelp();
    return;
  }

  const prefix = `acmi:${namespace}:${id}`;

  try {
    switch (action) {
      case 'profile':
        if (!id || !process.argv[5]) throw new Error("Usage: acmi profile <namespace> <id> '<json>'");
        await redis('SET', `${prefix}:profile`, process.argv[5]);
        await redis('SADD', `acmi:${namespace}:list`, id);
        console.log(`✅ Profile updated for [${namespace}] ${id}`);
        break;

      case 'event':
        if (!id || !process.argv[5] || !process.argv[6]) throw new Error("Usage: acmi event <namespace> <id> <source> '<summary>'");
        const source = process.argv[5];
        const summary = process.argv[6];
        const ts = Date.now();
        const eventData = JSON.stringify({ ts, source, summary });
        await redis('ZADD', `${prefix}:timeline`, ts, eventData);
        console.log(`✅ Event logged for [${namespace}] ${id} from source: ${source}`);
        break;

      case 'signal':
        if (!id || !process.argv[5]) throw new Error("Usage: acmi signal <namespace> <id> '<json>'");
        await redis('SET', `${prefix}:signals`, process.argv[5]);
        console.log(`✅ Signals updated for [${namespace}] ${id}`);
        break;

      case 'get':
        if (!id) throw new Error("Usage: acmi get <namespace> <id>");
        const profile = await redis('GET', `${prefix}:profile`);
        const signals = await redis('GET', `${prefix}:signals`);
        // Get last 50 events for deep context
        const timeline = await redis('ZREVRANGE', `${prefix}:timeline`, 0, 49); 
        
        console.log(JSON.stringify({
          namespace,
          id,
          profile: profile ? JSON.parse(profile) : null,
          signals: signals ? JSON.parse(signals) : null,
          timeline: timeline ? timeline.map(t => JSON.parse(t)) : []
        }, null, 2));
        break;

      case 'list':
        const entities = await redis('SMEMBERS', `acmi:${namespace}:list`);
        console.log(JSON.stringify(entities || [], null, 2));
        break;
        
      case 'delete':
         if (!id) throw new Error("Usage: acmi delete <namespace> <id>");
         await redis('DEL', `${prefix}:profile`, `${prefix}:signals`, `${prefix}:timeline`);
         await redis('SREM', `acmi:${namespace}:list`, id);
         console.log(`✅ Deleted [${namespace}] ${id}`);
         break;

      default:
        printHelp();
    }
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
🧠 Agentic Context Management Infrastructure (ACMI)
===================================================
A universal framework for persistent, timeline-based agent memory.

Usage:
  node acmi.mjs profile <namespace> <id> '<json>'
  node acmi.mjs event <namespace> <id> <source> '<summary>'
  node acmi.mjs signal <namespace> <id> '<json>'
  node acmi.mjs get <namespace> <id>
  node acmi.mjs list <namespace>
  node acmi.mjs delete <namespace> <id>

Examples:
  node acmi.mjs profile sales gardine-wilson '{"stage": "proposal"}'
  node acmi.mjs event support ticket-123 slack "User reported a bug"
  node acmi.mjs get fleet truck-004
`);
}

main();