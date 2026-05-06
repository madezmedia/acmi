#!/usr/bin/env node
// Generic Upstash Redis REST command runner. Extension to acmi family.
// Usage: node redis-cmd.mjs <CMD> [args...]
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const env = readFileSync(join(homedir(), 'clawd/.env'), 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const url = process.env.UPSTASH_REDIS_REST_URL;
const tok = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!url || !tok) { console.error('missing UPSTASH env'); process.exit(1); }

const args = process.argv.slice(2);
if (!args.length) { console.error('usage: redis-cmd.mjs <CMD> [args...]'); process.exit(1); }

const r = await fetch(url, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(args),
});
const j = await r.json();
console.log(JSON.stringify(j));
