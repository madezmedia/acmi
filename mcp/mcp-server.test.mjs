// Unit tests for ACMI MCP server v1.3 hardening helpers.
// Run: node --test ~/.openclaw/skills/acmi/mcp-server.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateKeySegments, validateJson, isProtectedKey } from "./mcp-server-helpers.mjs";

// ─── validateKeySegments ───────────────────────────────────────────

test("validateKeySegments: accepts normal segments", () => {
  validateKeySegments("agent", "claude-engineer");
  validateKeySegments("thread", "bentley-pm");
  validateKeySegments("work", "drift-remediator-rollout");
  // no throw = pass
});

test("validateKeySegments: rejects undefined", () => {
  assert.throws(() => validateKeySegments("agent", undefined), /undefined\/null/);
});

test("validateKeySegments: rejects null", () => {
  assert.throws(() => validateKeySegments(null), /undefined\/null/);
});

test("validateKeySegments: rejects empty string", () => {
  assert.throws(() => validateKeySegments(""), /empty string/);
});

test("validateKeySegments: rejects literal 'undefined'", () => {
  assert.throws(() => validateKeySegments("undefined"), /unsubstituted JS variable/);
});

test("validateKeySegments: rejects literal 'null'", () => {
  assert.throws(() => validateKeySegments("null"), /unsubstituted JS variable/);
});

test("validateKeySegments: rejects colon-containing", () => {
  assert.throws(() => validateKeySegments("agent:foo"), /contains.*:/);
});

test("validateKeySegments: rejects oversize (>200 chars, status-text bleeding)", () => {
  const longStatus = "Provider health check failed - Anthropic credit balance too low".repeat(5);
  assert.throws(() => validateKeySegments(longStatus), /exceeds 200/);
});

test("validateKeySegments: validates ALL segments not just first", () => {
  assert.throws(() => validateKeySegments("agent", "valid", "undefined"), /unsubstituted/);
});

// ─── validateJson ──────────────────────────────────────────────────

test("validateJson: accepts valid JSON object", () => {
  validateJson('{"a":1,"b":[1,2,3]}', "profile");
});

test("validateJson: accepts valid JSON array", () => {
  validateJson('[1, 2, 3]', "list");
});

test("validateJson: accepts valid JSON primitive", () => {
  validateJson('"hello"', "name");
  validateJson('42', "count");
  validateJson('null', "maybe");
});

test("validateJson: rejects unparseable string", () => {
  assert.throws(() => validateJson("{not json", "profile"), /not valid JSON/);
});

test("validateJson: rejects non-string input", () => {
  assert.throws(() => validateJson({a: 1}, "profile"), /must be a JSON string/);
  assert.throws(() => validateJson(123, "count"), /must be a JSON string/);
});

test("validateJson: error message includes field name", () => {
  assert.throws(() => validateJson("xyz", "myField"), /myField/);
});

// ─── isProtectedKey ────────────────────────────────────────────────

test("isProtectedKey: registry keys protected", () => {
  assert.equal(isProtectedKey("acmi:registry:agent-model-policy"), true);
  assert.equal(isProtectedKey("acmi:registry:namespace-policy:v1"), true);
});

test("isProtectedKey: notion-sync keys protected", () => {
  assert.equal(isProtectedKey("acmi:notion-sync:cache"), true);
});

test("isProtectedKey: signals/timeline keys NOT protected", () => {
  assert.equal(isProtectedKey("acmi:agent:claude-engineer:signals"), false);
  assert.equal(isProtectedKey("acmi:thread:bentley-pm:timeline"), false);
});

test("isProtectedKey: empty/null treated as protected (refuse-by-default)", () => {
  assert.equal(isProtectedKey(""), true);
  assert.equal(isProtectedKey(null), true);
  assert.equal(isProtectedKey(undefined), true);
});
