#!/usr/bin/env node
/**
 * ACMI Agent Invitation Tool (v1.3)
 * Automates onboarding with RBAC Permissions (v1.2 Protocol Compliant)
 * Usage: node invite-agent.mjs <id> <role> <modelId> <lane> [--tier <Admin|Operator|Specialist|Utility>]
 */

const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "") + "/";
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = async (cmd, ...args) => {
  const res = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([cmd, ...args]),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
};

// Arg Parsing
const args = process.argv.slice(2);
const [id, role, modelId, lane] = args;
let tier = "Utility";
if (args.includes("--tier")) {
  tier = args[args.indexOf("--tier") + 1];
}

const TIER_DEFAULTS = {
  Admin: { namespaces: ["*"], tokens: 1000000, write: true },
  Operator: { namespaces: ["agent", "thread", "tracker", "issue", "workspace"], tokens: 800000, write: true },
  Specialist: { namespaces: ["agent", "thread", "issue"], tokens: 500000, write: true },
  Utility: { namespaces: ["agent"], tokens: 200000, write: false }
};

async function invite() {
  if (!id || !role || !modelId || !lane) {
    console.log("Usage: node invite-agent.mjs <id> <role> <modelId> <lane> [--tier <tier>]");
    process.exit(1);
  }

  console.log(`🚀 [Invitor v1.3] Onboarding ${id} as ${tier}...`);
  
  const ts = Date.now();
  const rbac = TIER_DEFAULTS[tier] || TIER_DEFAULTS.Utility;

  // 1. Profile
  const profile = { id, role, model_id: modelId, lane, rbac_tier: tier, created_at_ms: ts };
  await redis('SET', `acmi:agent:${id}:profile`, JSON.stringify(profile));

  // 2. Signals
  const signals = { status: "active", last_heartbeat_ts: ts, current_focus: "initialized" };
  await redis('SET', `acmi:agent:${id}:signals`, JSON.stringify(signals));

  // 3. Permissions (v1.1 STRING+JSON)
  const permissions = {
    role_tier: tier,
    allowed_namespaces: rbac.namespaces,
    write_access: rbac.write,
    max_tokens_per_hour: rbac.tokens
  };
  await redis('SET', `acmi:agent:${id}:permissions`, JSON.stringify(permissions));

  // 4. Registry
  await redis('SADD', 'acmi:agent:list', id);

  // 5. Wake-Call
  const event = {
    ts,
    source: 'gemini-cli',
    kind: 'agent-onboarded',
    correlationId: 'agent-expansion-1777399140000',
    summary: `[onboarded v1.3] Agent '${id}' (${role}) initialized with ${tier} permissions.`
  };
  await redis('ZADD', 'acmi:thread:agent-coordination:timeline', String(ts), JSON.stringify(event));

  console.log(`✅ Success: Agent ${id} is live with v1.3 RBAC.`);
}

invite();
