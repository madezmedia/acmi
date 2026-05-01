import { afterAll, describe, it } from "vitest";
import { runConformanceTests } from "../src/testing/conformance.js";
import { RedisAdapter, type IoredisLike } from "../src/adapters/redis.js";

/**
 * Redis adapter conformance — gated on `ACMI_TEST_REDIS_URL`.
 *
 * Skipped by default so `npm test` is hermetic. Set the env var to a real
 * (preferably ephemeral) Redis instance to opt in:
 *
 *     ACMI_TEST_REDIS_URL=redis://localhost:6379 npm test
 */
const REDIS_URL = process.env.ACMI_TEST_REDIS_URL;

describe.skipIf(!REDIS_URL)("RedisAdapter — ACMI conformance", () => {
  let createdClients: IoredisLike[] = [];

  afterAll(async () => {
    for (const c of createdClients) {
      try {
        await c.quit?.();
      } catch {
        /* ignore */
      }
    }
  });

  it("passes the full conformance suite", async () => {
    // Lazy-import ioredis so it isn't required for non-Redis tests.
    const { default: Redis } = await import("ioredis");
    const prefixBase = `acmi-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const result = await runConformanceTests(() => {
      // biome-ignore lint: ioredis is a peer dep
      const client = new (Redis as unknown as new (url: string) => IoredisLike)(REDIS_URL!);
      createdClients.push(client);
      return new RedisAdapter({
        client,
        prefix: `${prefixBase}-${Math.random().toString(36).slice(2)}`,
        ownClient: true,
      });
    });

    const failures = result.results.filter((r) => !r.pass);
    if (failures.length > 0) {
      const detail = failures.map((f) => `  • ${f.name}: ${f.error}`).join("\n");
      throw new Error(`${failures.length}/${result.total} failures:\n${detail}`);
    }
  }, 60_000);
});
