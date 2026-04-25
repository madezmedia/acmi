#!/usr/bin/env node

/**
 * ACMI Quota Monitor
 * Hourly cron probe for model-provider quota/rate-limit telemetry.
 *
 * Writes to:
 *   acmi:quota:{provider}:signals   (latest snapshot)
 *   acmi:quota:{provider}:timeline  (history ZSET)
 *   acmi:thread:bentley-pm:timeline (alerts on yellow/red)
 *
 * Actions:
 *   node quota-monitor.mjs check           # run all three
 *   node quota-monitor.mjs check anthropic # individual
 *   node quota-monitor.mjs check gemini
 *   node quota-monitor.mjs check zai
 *   node quota-monitor.mjs record-zai <tokens>  # tick client-side counter
 *
 * Env:
 *   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN  (required)
 *   ANTHROPIC_API_KEY    (optional — skipped if missing)
 *   GCP_PROJECT          (optional — skipped if missing; also needs gcloud auth)
 *   ZAI_WEEKLY_CAP       (optional, default 10000000)
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!URL || !TOKEN) {
  console.error('ERROR: Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN.');
  process.exit(1);
}

const ZAI_WEEKLY_CAP = Number(process.env.ZAI_WEEKLY_CAP || 10_000_000);
const YELLOW = 0.25;
const RED = 0.10;

async function redis(...args) {
  const res = await fetch(URL.replace(/\/$/, ''), {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

function pct(remaining, limit) {
  if (!limit || limit <= 0) return null;
  return Math.max(0, Math.min(1, remaining / limit));
}

function severity(ratio) {
  if (ratio === null) return 'unknown';
  if (ratio <= RED) return 'red';
  if (ratio <= YELLOW) return 'yellow';
  return 'green';
}

async function persist(provider, snapshot) {
  const ts = Date.now();
  const record = { ts, ...snapshot };
  await redis('SET', `acmi:quota:${provider}:signals`, JSON.stringify(record));
  await redis('ZADD', `acmi:quota:${provider}:timeline`, ts, JSON.stringify(record));
  if (snapshot.severity === 'yellow' || snapshot.severity === 'red') {
    await redis('ZADD', 'acmi:thread:bentley-pm:timeline', ts, JSON.stringify({
      ts,
      source: 'quota-monitor',
      kind: `alert-${snapshot.severity}`,
      summary: `[${snapshot.severity.toUpperCase()}] ${provider}: ${snapshot.headline}`,
    }));
  }
  return record;
}

async function checkAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { skipped: 'no_api_key' };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 1,
      messages: [{ role: 'user', content: '.' }],
    }),
  });

  const h = Object.fromEntries(res.headers);
  const reqRemaining = Number(h['anthropic-ratelimit-requests-remaining'] ?? NaN);
  const reqLimit = Number(h['anthropic-ratelimit-requests-limit'] ?? NaN);
  const tokRemaining = Number(h['anthropic-ratelimit-tokens-remaining'] ?? NaN);
  const tokLimit = Number(h['anthropic-ratelimit-tokens-limit'] ?? NaN);

  const reqRatio = pct(reqRemaining, reqLimit);
  const tokRatio = pct(tokRemaining, tokLimit);
  const worst = [reqRatio, tokRatio].filter(x => x !== null).sort((a, b) => a - b)[0] ?? null;

  return {
    status: res.status,
    requests: { remaining: reqRemaining, limit: reqLimit, reset: h['anthropic-ratelimit-requests-reset'] },
    tokens: { remaining: tokRemaining, limit: tokLimit, reset: h['anthropic-ratelimit-tokens-reset'] },
    ratio: worst,
    severity: severity(worst),
    headline: `req ${reqRemaining}/${reqLimit} · tok ${tokRemaining}/${tokLimit}`,
  };
}

async function checkGemini() {
  const project = process.env.GCP_PROJECT;
  if (!project) return { skipped: 'no_gcp_project' };

  const { stdout } = await execFileP('gcloud', [
    'services', 'quotas', 'list',
    `--service=aiplatform.googleapis.com`,
    `--consumer=projects/${project}`,
    '--filter=metric:gemini',
    '--format=json',
  ], { maxBuffer: 4 * 1024 * 1024 });

  const quotas = JSON.parse(stdout || '[]');
  const worst = quotas
    .map(q => ({ name: q.name, ratio: pct(q.effectiveLimit?.value - (q.usage ?? 0), q.effectiveLimit?.value) }))
    .filter(q => q.ratio !== null)
    .sort((a, b) => a.ratio - b.ratio)[0];

  return {
    quota_count: quotas.length,
    worst_quota: worst?.name ?? null,
    ratio: worst?.ratio ?? null,
    severity: severity(worst?.ratio ?? null),
    headline: worst ? `${worst.name} at ${(worst.ratio * 100).toFixed(0)}% remaining` : 'no gemini quotas found',
  };
}

async function checkZai() {
  const used = Number((await redis('GET', 'acmi:quota:zai:weekly_tokens_used')) || 0);
  const remaining = Math.max(0, ZAI_WEEKLY_CAP - used);
  const ratio = pct(remaining, ZAI_WEEKLY_CAP);
  return {
    source: 'client_side_counter',
    cap: ZAI_WEEKLY_CAP,
    used,
    remaining,
    ratio,
    severity: severity(ratio),
    headline: `~${(ratio * 100).toFixed(0)}% remaining (${used.toLocaleString()}/${ZAI_WEEKLY_CAP.toLocaleString()} tokens used)`,
  };
}

const CHECKS = {
  anthropic: checkAnthropic,
  gemini: checkGemini,
  zai: checkZai,
};

async function runCheck(name) {
  const fn = CHECKS[name];
  if (!fn) throw new Error(`unknown provider: ${name}`);
  try {
    const snapshot = await fn();
    if (snapshot.skipped) {
      console.log(`[${name}] skipped: ${snapshot.skipped}`);
      return;
    }
    const record = await persist(name, snapshot);
    console.log(`[${name}] ${snapshot.severity}: ${snapshot.headline}`);
    return record;
  } catch (err) {
    const snapshot = { severity: 'error', headline: err.message };
    await persist(name, snapshot);
    console.error(`[${name}] error: ${err.message}`);
  }
}

async function main() {
  const [action, arg] = process.argv.slice(2);

  if (action === 'record-zai') {
    const tokens = Number(arg);
    if (!Number.isFinite(tokens) || tokens < 0) throw new Error('usage: record-zai <tokens>');
    const total = await redis('INCRBY', 'acmi:quota:zai:weekly_tokens_used', tokens);
    console.log(`zai counter: ${total} tokens used this week`);
    return;
  }

  if (action === 'reset-zai') {
    await redis('SET', 'acmi:quota:zai:weekly_tokens_used', '0');
    console.log('zai counter reset to 0');
    return;
  }

  if (action === 'check') {
    const targets = arg ? [arg] : Object.keys(CHECKS);
    for (const t of targets) await runCheck(t);
    return;
  }

  console.log(`
ACMI Quota Monitor
Usage:
  node quota-monitor.mjs check [provider]   # anthropic | gemini | zai (all if omitted)
  node quota-monitor.mjs record-zai <tokens>
  node quota-monitor.mjs reset-zai
`);
}

main().catch(err => {
  console.error('fatal:', err.message);
  process.exit(1);
});
