#!/usr/bin/env node
// drift-diff.mjs — Hourly alignment check across the swarm
//
// Detects three kinds of drift and posts a single delta event to
// acmi:thread:bentley-pm:timeline so Bentley can resolve in one pass.
//
//   1. Model drift   — signals.model_id != configured runtime model
//   2. Stale events  — merge-needed / hitl-required / handoff-request
//                       older than 24h with no matching resolution
//   3. Date drift    — payloads referencing absolute dates in the past
//                       without a closeout event
//
// Schedule: 15 * * * * (hourly, offset 15min)
// Env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN

const URL = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "") + "/";
const TOK = process.env.UPSTASH_REDIS_REST_TOKEN || "";
if (!URL || !TOK) { console.error("ERROR: Upstash env not set"); process.exit(2); }

const NOW = Date.now();
const TODAY = new Date(NOW).toISOString().slice(0, 10);
const STALE_MS = 24 * 60 * 60 * 1000;

async function redis(...cmd) {
  const res = await fetch(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOK}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`Upstash: ${j.error}`);
  return j.result;
}

async function loadPolicy() {
  const raw = await redis("GET", "acmi:registry:agent-model-policy");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function modelSuffix(m) { return (m || "").split("/").pop().toLowerCase(); }

function modelMatch(claimed, expected) {
  if (!claimed || !expected) return "unknown";
  if (claimed === expected) return "exact";
  if (modelSuffix(claimed) === modelSuffix(expected)) return "suffix"; // missing-provider-prefix only
  return "mismatch";
}

async function detectModelDrift(policy) {
  if (!policy) return { major: [], minor: [] };
  const profiles = (await redis("KEYS", "acmi:agent:*:profile")) || [];
  const major = []; const minor = [];
  for (const pkey of profiles) {
    const id = pkey.split(":")[2];
    const sigKey = `acmi:agent:${id}:signals`;
    const raw = await redis("GET", sigKey);
    if (!raw) continue;
    let sig;
    try { sig = JSON.parse(raw); } catch { continue; }
    const claimed = sig.model_id;
    if (!claimed) continue;
    const expected = policy.agents?.[id];
    if (!expected) continue;
    const m = modelMatch(claimed, expected);
    if (m === "exact") continue;
    const entry = { agent: id, claimed, expected };
    if (m === "suffix") minor.push(entry);
    else major.push(entry);
  }
  return { major, minor };
}

async function detectStaleEvents() {
  const threads = [
    "acmi:thread:bentley-pm:timeline",
    "acmi:thread:agent-coordination:timeline",
    "acmi:thread:claude-daily-driver:timeline",
    "acmi:tracker:cloud-handoffs:timeline",
    "acmi:tracker:daily-agents-fleet:timeline",
    "acmi:user:mikey:hitl-queue",
  ];
  const stale = [];
  const TRACKED_KINDS = new Set(["merge-needed", "hitl-required", "handoff-request"]);
  const RESOLVED_KINDS = new Set([
    "merge-resolved", "merge-complete",
    "hitl-resolved", "hitl-cleared",
    "handoff-ack", "handoff-delegated", "handoff-rejected",
    "handoff-resolved", "handoff-superseded", "handoff-status-update",
    "handoff-complete",
  ]);

  // v1.1: also build set of original_event ts AND inferred correlationIds that
  // have a comms-correction event pointing at them — those count as resolutions
  // even when the original event was missing a correlationId entirely.
  const correctedOriginalTs = new Set();
  const inferredResolvedCids = new Set();
  for (const key of threads) {
    const evs = (await redis("ZRANGE", key, "0", "199", "REV")) || [];
    for (const raw of evs) {
      let ev; try { ev = JSON.parse(raw); } catch { continue; }
      if (ev.kind !== "comms-correction") continue;
      const origTs = ev.payload?.original_event?.ts || ev.payload?.original_ts;
      if (origTs) correctedOriginalTs.add(Number(origTs));
      const m = (ev.details || "").match(/at\s+(17\d{11})/);
      if (m) correctedOriginalTs.add(Number(m[1]));
      // The inferred correlationId points at the original handoff/roundtable —
      // if a comms-correction recovered it, treat the underlying thread as resolved.
      const inferred = ev.payload?.inferred_correlationId || ev.payload?.inferred_cid;
      if (inferred) inferredResolvedCids.add(inferred);
    }
  }

  for (const key of threads) {
    const events = (await redis("ZRANGE", key, "0", "199", "REV")) || [];
    const open = new Map(); // cid -> open event
    const resolved = new Set(); // cids that got resolved

    const parsed = [];
    for (const raw of events) {
      try { parsed.push(JSON.parse(raw)); } catch {}
    }
    parsed.reverse(); // oldest → newest

    for (const ev of parsed) {
      // v1.1: check both correlationId (camel, current standard) and correlation_id (snake, legacy)
      const cid =
        ev.correlationId ||
        ev.correlation_id ||
        ev.payload?.correlationId ||
        ev.payload?.correlation_id ||
        ev.payload?.responding_to_correlation_id;
      if (TRACKED_KINDS.has(ev.kind) && cid) {
        open.set(cid, { ...ev, _thread: key });
      }
      if (RESOLVED_KINDS.has(ev.kind) && cid) {
        resolved.add(cid);
      }
    }

    for (const [cid, ev] of open) {
      if (resolved.has(cid)) continue;
      // v1.1: also skip if a comms-correction recovered this cid as its inferred target
      if (inferredResolvedCids.has(cid)) continue;
      const ts = ev.ts || ev.timestamp || 0;
      if (NOW - ts < STALE_MS) continue;
      // v1.1: also skip if a comms-correction event points at this original ts
      if (correctedOriginalTs.has(ts)) continue;
      stale.push({
        thread: key.replace("acmi:", "").replace(":timeline", ""),
        kind: ev.kind,
        correlation_id: cid,
        age_hours: Math.round((NOW - ts) / 3600000),
        summary: (ev.summary || "").slice(0, 140),
      });
    }
  }
  return stale;
}

async function detectDateDrift() {
  // Scan bentley-pm and agent-coordination for events whose summary or
  // payload mentions a date string in the past (YYYY-MM-DD) with terms
  // like "due", "deadline", "by", "scheduled" — flag any that are <today.
  const threads = [
    "acmi:thread:bentley-pm:timeline",
    "acmi:thread:agent-coordination:timeline",
  ];
  const flagged = [];
  const DATE_RE = /\b(20\d{2}-\d{2}-\d{2})\b/g;
  const TRIGGER_RE = /\b(due|deadline|by|scheduled|expire|expires|expired)\b/i;

  for (const key of threads) {
    const events = (await redis("ZRANGE", key, "0", "49", "REV")) || [];
    for (const raw of events) {
      let ev;
      try { ev = JSON.parse(raw); } catch { continue; }
      const text = JSON.stringify(ev);
      if (!TRIGGER_RE.test(text)) continue;
      const ts = ev.ts || ev.timestamp || 0;
      if (!ts || NOW - ts > 7 * 24 * 60 * 60 * 1000) continue;

      // Real drift = event was posted BEFORE the date it references, AND that
      // date is now past. That's a missed deadline. If the event was posted
      // ON or AFTER the past_date, it's a historical reference (e.g., a
      // wrap-up posted 04-27 mentioning 04-27) — informational, not drift.
      const eventDateISO = new Date(ts).toISOString().slice(0, 10);
      const dates = [...text.matchAll(DATE_RE)].map(m => m[1]);
      const past = dates.filter(d => d < TODAY && d > eventDateISO);
      if (past.length === 0) continue;

      flagged.push({
        thread: key.replace("acmi:", "").replace(":timeline", ""),
        ts,
        kind: ev.kind || "?",
        past_dates: [...new Set(past)],
        summary: (ev.summary || "").slice(0, 140),
      });
    }
  }
  return flagged;
}

// v1.1 comms enforcement: flag any roundtable-*/handoff-*/hitl-* event in the
// last 24h that uses snake_case correlation_id without correlationId, OR is
// missing both fields entirely (where one is required).
async function detectCommsDrift() {
  const REQUIRES_CID = new Set([
    "roundtable-input", "roundtable-open", "roundtable-merged", "roundtable-synthesis",
    "roundtable-plan", "roundtable-assignment", "roundtable-nudge", "roundtable-reminder",
    "handoff-request", "handoff-ack", "handoff-resolved", "handoff-superseded",
    "handoff-status-update", "handoff-complete", "handoff-rejected", "handoff-delegated",
    "hitl-required", "hitl-resolved", "hitl-cleared", "hitl-pending",
    "schema-proposal", "comms-pattern-proposed", "comms-rule-ack",
  ]);
  const threads = [
    "acmi:thread:agent-coordination:timeline",
    "acmi:thread:bentley-pm:timeline",
  ];
  const out = { snake_only: [], missing_cid: [] };
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Build set of original_event timestamps that have an existing comms-correction.
  // These are considered "resolved" and should not be flagged as missing_cid.
  const correctedTs = new Set();
  for (const key of threads) {
    const corrEvents = (await redis("ZRANGE", key, "0", "199", "REV")) || [];
    for (const raw of corrEvents) {
      let ev;
      try { ev = JSON.parse(raw); } catch { continue; }
      if (ev.kind !== "comms-correction") continue;
      // Support multiple correction shapes (claude-engineer structured + bentley details-string)
      const origTs =
        ev.payload?.original_event?.ts ||
        ev.payload?.original_ts ||
        ev.payload?.target_event_ts ||
        ev.payload?.event_ts;
      if (origTs) correctedTs.add(Number(origTs));
      // Bentley uses `details` string: "Original event at 1777342271865 in thread:..."
      const detailsMatch = (ev.details || "").match(/at\s+(17\d{11})/);
      if (detailsMatch) correctedTs.add(Number(detailsMatch[1]));
    }
  }

  for (const key of threads) {
    const events = (await redis("ZRANGE", key, "0", "99", "REV")) || [];
    for (const raw of events) {
      let ev;
      try { ev = JSON.parse(raw); } catch { continue; }
      const ts = ev.ts || ev.timestamp || 0;
      if (!ts || NOW - ts > DAY_MS) continue;
      if (!REQUIRES_CID.has(ev.kind)) continue;
      const hasCamel = !!ev.correlationId;
      const hasSnake = !!ev.correlation_id;
      if (hasSnake && !hasCamel) {
        out.snake_only.push({ thread: key.replace("acmi:", "").replace(":timeline", ""), ts, kind: ev.kind, source: ev.source, cid: ev.correlation_id });
      } else if (!hasCamel && !hasSnake) {
        if (correctedTs.has(ts)) continue; // resolved by a comms-correction event
        out.missing_cid.push({ thread: key.replace("acmi:", "").replace(":timeline", ""), ts, kind: ev.kind, source: ev.source, summary: (ev.summary || "").slice(0, 100) });
      }
    }
  }
  return out;
}

async function postDelta(report) {
  const ts = NOW;
  const ev = {
    ts,
    source: "drift-diff",
    kind: "drift-delta",
    summary: `[drift] ${report.model_drift_major.length} major-model / ${report.stale_events.length} stale-events / ${report.date_drift.length} date-drift / ${report.minor_drift_count} minor-prefix / ${report.comms_drift.snake_only.length} comms-snake / ${report.comms_drift.missing_cid.length} comms-missing-cid`,
    payload: report,
  };
  await redis("ZADD", "acmi:thread:bentley-pm:timeline", String(ts), JSON.stringify(ev));
  return ev;
}

(async () => {
  const policy = await loadPolicy();

  const [model_drift, stale_events, date_drift, comms_drift] = await Promise.all([
    detectModelDrift(policy),
    detectStaleEvents(),
    detectDateDrift(),
    detectCommsDrift(),
  ]);

  const report = {
    ts: NOW,
    today: TODAY,
    policy_version: policy?.version ?? "missing",
    model_drift_major: model_drift.major,
    model_drift_minor: model_drift.minor,
    stale_events,
    date_drift,
    comms_drift,
    total_drift_count: model_drift.major.length + stale_events.length + date_drift.length + comms_drift.snake_only.length + comms_drift.missing_cid.length,
    minor_drift_count: model_drift.minor.length,
  };

  const ev = await postDelta(report);
  console.log(JSON.stringify({ ok: true, posted: ev.summary, ...report }, null, 2));
})().catch((e) => {
  console.error("drift-diff ERROR:", e.message);
  process.exit(1);
});
