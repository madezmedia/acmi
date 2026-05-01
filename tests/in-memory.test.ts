import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../src/adapters/in-memory.js";
import { runConformanceTests } from "../src/testing/conformance.js";

describe("InMemoryAdapter — ACMI conformance", async () => {
  const result = await runConformanceTests(() => new InMemoryAdapter());

  it("passes the full conformance suite", () => {
    const failures = result.results.filter((r) => !r.pass);
    if (failures.length > 0) {
      const detail = failures
        .map((f) => `  • ${f.name}: ${f.error}`)
        .join("\n");
      throw new Error(`${failures.length} failures:\n${detail}`);
    }
    expect(result.passed).toBe(result.total);
  });

  // Surface each conformance check as its own test for nice reporter output.
  for (const r of result.results) {
    it(r.name, () => {
      if (!r.pass) throw new Error(r.error ?? "failed");
    });
  }
});
