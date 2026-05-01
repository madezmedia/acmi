import { describe, it } from "vitest";
import { runConformanceTests } from "../src/testing/conformance.js";
import { UpstashAdapter } from "../src/adapters/upstash.js";

/**
 * Upstash adapter conformance — gated on `UPSTASH_REDIS_REST_URL` +
 * `UPSTASH_REDIS_REST_TOKEN`.
 *
 * Skipped by default. Set the env vars to opt in:
 *
 *     UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... npm test
 */
const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

describe.skipIf(!URL || !TOKEN)("UpstashAdapter — ACMI conformance", () => {
  it("passes the full conformance suite", async () => {
    const prefixBase = `acmi-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const result = await runConformanceTests(
      () =>
        new UpstashAdapter({
          url: URL!,
          token: TOKEN!,
          prefix: `${prefixBase}-${Math.random().toString(36).slice(2)}`,
        })
    );

    const failures = result.results.filter((r) => !r.pass);
    if (failures.length > 0) {
      const detail = failures.map((f) => `  • ${f.name}: ${f.error}`).join("\n");
      throw new Error(`${failures.length}/${result.total} failures:\n${detail}`);
    }
  }, 60_000);
});
