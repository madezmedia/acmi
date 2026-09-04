// mcp-server-helpers.mjs — pure validation/guard helpers for ACMI MCP server.
// Extracted so they can be unit-tested without booting the stdio transport.
// v1.3 (2026-05-06).

/**
 * Reject key-segment values that produce malformed ACMI keys.
 * Matches the bug class drift-remediator quarantines at the read side.
 */
export function validateKeySegments(...segments) {
  for (const s of segments) {
    if (s === undefined || s === null) {
      throw new Error(`Invalid key segment: received ${s} (undefined/null)`);
    }
    const v = String(s);
    if (!v) throw new Error(`Invalid key segment: empty string`);
    if (v === "undefined" || v === "null") {
      throw new Error(`Invalid key segment: literal "${v}" — likely an unsubstituted JS variable`);
    }
    if (v.includes(":")) {
      throw new Error(`Invalid key segment: "${v}" contains ":" — would corrupt key structure`);
    }
    if (v.length > 200) {
      throw new Error(`Invalid key segment: ${v.length} chars exceeds 200 — looks like status text or error message bleeding into key`);
    }
  }
}

/**
 * Validate that a string is parseable JSON before SET.
 * Catches the "I forgot to JSON.stringify()" bug at the boundary.
 */
export function validateJson(s, fieldName) {
  if (typeof s !== "string") {
    throw new Error(`${fieldName} must be a JSON string, got ${typeof s}`);
  }
  try {
    JSON.parse(s);
  } catch (e) {
    throw new Error(`${fieldName} is not valid JSON: ${e.message}`);
  }
}

const PROTECTED_PREFIXES = [
  "acmi:registry:",
  "acmi:notion-sync:",
];

export function isProtectedKey(key) {
  if (!key) return true;
  return PROTECTED_PREFIXES.some(p => key.startsWith(p));
}

/** Polar HTTPS exec is `/bridge/exec` with no trailing slash (slash → 404). */
export function isBridgeUrl(url) {
  return /\/bridge\/exec(?:\/|$|\?)/.test(String(url || ""));
}

/**
 * POST target for HTTP Redis REST.
 * Polar exec: strip slashes. Upstash Cloud: keep a trailing slash.
 */
export function restEndpoint(url) {
  const stripped = String(url || "").replace(/\/+$/, "");
  if (!stripped) return stripped;
  if (isBridgeUrl(stripped)) return stripped;
  try {
    if (new URL(stripped).hostname.endsWith("upstash.io")) return `${stripped}/`;
  } catch {
    /* ignore */
  }
  return stripped;
}
