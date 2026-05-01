#!/usr/bin/env node
/**
 * ACMI Standup Brief (Fleet-1)
 * Pulls the last 24h of fleet activity and distills into a human-friendly digest.
 */

const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "") + "/";
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!UPSTASH_URL || !UPSTASH_TOKEN || !OPENAI_KEY) {
  console.error("❌ Missing required credentials (Upstash or OpenAI).");
  process.exit(1);
}

const redis = async (cmd, ...args) => {
  const res = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([cmd, ...args]),
  });
  const data = await res.json();
  return data.result;
};

const callGPT = async (prompt) => {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are Bentley, Lead Orchestrator." },
        { role: "user", content: prompt }
      ]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(`OpenAI Error: ${JSON.stringify(data.error)}`);
  return data.choices[0].message.content;
};

async function generateBrief() {
  console.log("📝 [Standup Brief] Pulling last 24h of fleet activity...");
  
  const now = Date.now();
  const cutoff = now - (24 * 60 * 60 * 1000);
  
  const threads = ['acmi:thread:agent-coordination:timeline', 'acmi:thread:bentley-pm:timeline'];
  let rawEvents = [];

  for (const key of threads) {
    const raw = await redis('ZREVRANGE', key, 0, 49);
    if (raw) rawEvents = rawEvents.concat(raw.map(r => JSON.parse(r)).filter(e => e.ts > cutoff));
  }

  const substantive = rawEvents.filter(e => 
    e.summary && 
    !e.summary.includes('heartbeat') && 
    !e.summary.includes('Aggregated:') &&
    !e.summary.includes('tick-start')
  );

  if (substantive.length === 0) {
    console.log("✅ No substantive activity in the last 24h.");
    return;
  }

  const prompt = `Distill the following fleet activity into a <300 word Standup Brief for Mikey.
  Structure:
  - 🚀 RECENT WINS
  - ⚠️ BLOCKERS
  - 🎯 ACTIONS
  Events:
  ${JSON.stringify(substantive.slice(0, 20), null, 2)}
  `;

  try {
    const brief = await callGPT(prompt);
    console.log("\n--- STANDUP BRIEF ---");
    console.log(brief);
    await redis('SET', 'acmi:user:mikey:last_brief', brief);
    await redis('HSET', 'acmi:user:mikey:signals', 'last_brief_ts', String(now));
    console.log("\n✅ Brief saved to acmi:user:mikey.");
  } catch (err) {
    console.error("❌ Brief distillation failed:", err.message);
  }
}

generateBrief();
