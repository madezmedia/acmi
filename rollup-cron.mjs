#!/usr/bin/env node

/**
 * ACMI Rollup Cron
 * Synthesizes the per-agent recent-activity rollup that bootstrap reads.
 *
 * Reads:
 *   acmi:agent:<id>:profile, :signals, :active_context, :timeline (last N days)
 *
 * Writes:
 *   acmi:agent:<id>:rollup:latest = {ts, summary, source_window_days,
 *                                    source_event_count, model, usage}
 *
 * Usage:
 *   node rollup-cron.mjs <agent_id>
 *
 * Cron recipe (one entry per agent, every 6h):
 *   0 *\/6 * * * /usr/bin/env node /path/to/rollup-cron.mjs claude-engineer
 *
 * Env:
 *   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN  (required)
 *   ANTHROPIC_API_KEY                                  (required for synthesis)
 *   ROLLUP_MODEL          (default: claude-haiku-4-5)
 *   ROLLUP_WINDOW_DAYS    (default: 7)
 *   ROLLUP_MAX_TOKENS     (default: 400)
 */

const URL_ = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ROLLUP_MODEL || 'claude-haiku-4-5';
const WINDOW_DAYS = Number(process.env.ROLLUP_WINDOW_DAYS || 7);
const MAX_TOKENS = Number(process.env.ROLLUP_MAX_TOKENS || 400);

if (!URL_ || !TOKEN) {
  console.error('ERROR: Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN.');
  process.exit(1);
}

async function redis(...args) {
  const res = await fetch(URL_.replace(/\/$/, ''), {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

function tryParse(s) { try { return JSON.parse(s); } catch { return s; } }

function formatEvent(raw) {
  const d = tryParse(raw);
  if (typeof d !== 'object' || !d) return String(raw).slice(0, 200);
  const t = d.ts ? new Date(d.ts).toISOString().slice(0, 16).replace('T', ' ') : '????-??-?? ??:??';
  const tag = d.source || d.kind || '?';
  const body = (d.summary || d.message || JSON.stringify(d)).toString().slice(0, 180);
  return `${t}Z [${tag}] ${body}`;
}

async function synthesize(promptBody) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: promptBody }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`anthropic: ${data.error.message || JSON.stringify(data.error)}`);
  return {
    summary: data.content?.[0]?.text?.trim() || '',
    usage: data.usage || {},
  };
}

async function main() {
  const agentId = process.argv[2];
  if (!agentId) {
    console.error('Usage: rollup-cron <agent_id>');
    process.exit(1);
  }

  const prefix = `acmi:agent:${agentId}`;
  const since = Date.now() - WINDOW_DAYS * 86400e3;

  const profile = await redis('GET', `${prefix}:profile`);
  const signals = await redis('GET', `${prefix}:signals`);
  const active = await redis('HGETALL', `${prefix}:active_context`);
  const events = await redis('ZRANGEBYSCORE', `${prefix}:timeline`, since, '+inf');

  const eventCount = (events || []).length;
  const ts = Date.now();

  if (eventCount === 0) {
    const payload = {
      ts,
      summary: `No events in the last ${WINDOW_DAYS}d.`,
      source_window_days: WINDOW_DAYS,
      source_event_count: 0,
      model: null,
      usage: null,
    };
    await redis('SET', `${prefix}:rollup:latest`, JSON.stringify(payload));
    console.log(`[${agentId}] empty window — rollup written (no API call)`);
    return;
  }

  if (!ANTHROPIC_KEY) {
    console.error(`[${agentId}] skipped: no ANTHROPIC_API_KEY (events=${eventCount})`);
    process.exit(0);
  }

  const eventLines = events.slice(-60).map(formatEvent).join('\n');
  const activeStr = active && active.length ? JSON.stringify(active) : 'none';

  const prompt = `You are writing a session-start rollup for an AI agent named "${agentId}". The agent will read this when it spawns into a new session, instead of replaying the raw timeline. Be terse — under 200 words. Cover: what happened in the last ${WINDOW_DAYS}d, in-flight work, blockers, key handoffs. No preamble, no sign-off, just the summary.

PROFILE:
${profile || '(none)'}

SIGNALS:
${signals || '(none)'}

ACTIVE THREADS:
${activeStr}

RECENT EVENTS (${eventCount} total, showing last ${Math.min(eventCount, 60)}):
${eventLines}

ROLLUP:`;

  const { summary, usage } = await synthesize(prompt);

  const payload = {
    ts,
    summary,
    source_window_days: WINDOW_DAYS,
    source_event_count: eventCount,
    model: MODEL,
    usage,
  };
  await redis('SET', `${prefix}:rollup:latest`, JSON.stringify(payload));
  console.log(`[${agentId}] rollup written (${eventCount} events, ${usage.input_tokens || 0}→${usage.output_tokens || 0} tok, ${MODEL})`);
}

main().catch(err => {
  console.error('fatal:', err.message);
  process.exit(1);
});
