import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Guard: no source file may carry a literal bridge bearer.
//
// A hardcoded bearer in a public repository lets anyone who clones it read and
// write the fleet datastore. The bearer must come from the environment only.
// This test scans the tracked tree for the pattern so it cannot come back.

// This test lives in mcp/, so the repository root is one level up.
const ROOT = new URL("../", import.meta.url).pathname;

const SCAN_DIRS = ["mcp", "src", "docs", "cli", "examples"];
const SCAN_FILES = ["README.md", "smithery.yaml"];
const TEXT_EXT = new Set([".mjs", ".js", ".ts", ".tsx", ".jsx", ".html", ".yaml", ".yml", ".json", ".md"]);

// This file holds the patterns themselves, so it skips its own scan.
const SELF = "no-hardcoded-bridge-token.test.mjs";

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git" || name === "dist" || name === ".next") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// A bearer literal looks like `|| "some-token"` or `|| 'some-token'` next to a
// token variable name or a token resolver call. This catches the fallback
// shape without naming a value.
const FALLBACK_PATTERNS = [
  /(?:BRIDGE_TOKEN|BRIDGE_TOK|REDIS_TOKEN|UPSTASH_TOKEN|VM_AUTH)[^=\n]*\|\|\s*["'][^"']+["']/,
  // A resolver call with a literal fallback: resolveBridgeToken() || "secret"
  /bridgeToken\([^)]*\)\s*\|\|\s*["'][^"']+["']/,
  /resolveBridgeToken\([^)]*\)\s*\|\|\s*["'][^"']+["']/,
  /Authorization:\s*Bearer\s+[A-Za-z0-9_-]{8,}/,
  // A placeholder such as "<your-bridge-token>" is fine. A real value is not.
  /"ACMI_BRIDGE_TOKEN":\s*"(?![<$])\S[^"]*"/,
];

function collectFiles() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    for (const f of walk(join(ROOT, dir))) {
      if (f.endsWith(SELF)) continue;
      const ext = f.slice(f.lastIndexOf("."));
      if (TEXT_EXT.has(ext)) files.push(f);
    }
  }
  for (const f of SCAN_FILES) {
    const full = join(ROOT, f);
    try {
      statSync(full);
      files.push(full);
    } catch {}
  }
  return files;
}

test("no source file carries a hardcoded bridge bearer", () => {
  const offenders = [];
  for (const file of collectFiles()) {
    const text = readFileSync(file, "utf8");
    for (const pattern of FALLBACK_PATTERNS) {
      const m = text.match(pattern);
      if (m) offenders.push(`${relative(ROOT, file)}: ${m[0].slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, [], `hardcoded bridge bearer found:\n${offenders.join("\n")}`);
});
