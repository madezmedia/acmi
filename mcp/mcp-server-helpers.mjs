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
