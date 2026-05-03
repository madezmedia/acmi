import type { AcmiAdapter, TimelineEvent } from "../types.js";
import { createAcmi } from "../client.js";

/**
 * Result of running the conformance suite against an adapter.
 */
export interface ConformanceResult {
  adapter: string;
  total: number;
  passed: number;
  failed: number;
  results: Array<{ name: string; pass: boolean; error?: string }>;
}

/**
 * The ACMI conformance suite. Any adapter that passes this runner can claim
 * ACMI compliance.
 *
 * The suite is framework-agnostic — it returns a ConformanceResult you can
 * either `console.log` directly, throw on failure, or wire into Vitest /
 * Jest / Mocha via a single `describe` + `it` per result.
 *
 * @example
 * ```ts
 * import { runConformanceTests } from "@madezmedia/acmi/testing/conformance";
 * import { InMemoryAdapter } from "@madezmedia/acmi/adapters/in-memory";
 *
 * const result = await runConformanceTests(() => new InMemoryAdapter());
 * console.log(`${result.passed}/${result.total} passed`);
 * if (result.failed > 0) process.exit(1);
 * ```
 */
export async function runConformanceTests(
  adapterFactory: () => AcmiAdapter | Promise<AcmiAdapter>
): Promise<ConformanceResult> {
  const results: ConformanceResult["results"] = [];
  let adapterName = "unknown";

  for (const [name, fn] of Object.entries(TESTS)) {
    let adapter: AcmiAdapter | undefined;
    try {
      adapter = await adapterFactory();
      adapterName = adapter.name;
      const acmi = createAcmi(adapter);
      await fn(acmi);
      results.push({ name, pass: true });
    } catch (err) {
      results.push({
        name,
        pass: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (adapter?.close) {
        try {
          await adapter.close();
        } catch {
          // ignore close errors
        }
      }
    }
  }

  return {
    adapter: adapterName,
    total: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    results,
  };
}

// ─── Test fixtures ────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<TimelineEvent> = {}): Omit<TimelineEvent, "ts"> & { ts?: number } {
  return {
    source: "agent:test",
    kind: "test-event",
    correlationId: `corr-${Math.random().toString(36).slice(2)}`,
    summary: "test event",
    ...overrides,
  };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  const isObject = (x: unknown) => x && typeof x === "object";
  const sortKeys = (obj: any): any => {
    if (!isObject(obj)) return obj;
    if (Array.isArray(obj)) return obj.map(sortKeys);
    return Object.keys(obj)
      .sort()
      .reduce((acc: any, key) => {
        acc[key] = sortKeys(obj[key]);
        return acc;
      }, {});
  };

  const a = JSON.stringify(sortKeys(actual));
  const e = JSON.stringify(sortKeys(expected));
  if (a !== e) {
    throw new Error(`${msg}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────

type TestFn = (acmi: ReturnType<typeof createAcmi>) => Promise<void>;

const TESTS: Record<string, TestFn> = {
  // ─── Profile ──────────────────────────────────────────────────────────

  "profile.get returns null when missing": async (acmi) => {
    const got = await acmi.profile.get("user:does-not-exist");
    assert(got === null, "expected null for missing profile");
  },

  "profile.set then profile.get round-trips": async (acmi) => {
    await acmi.profile.set("user:alice", { name: "Alice", tz: "UTC" });
    const got = await acmi.profile.get("user:alice");
    assertEqual(got, {
      name: "Alice",
      tz: "UTC",
      actor_type: "human",
      tenant_id: "madez",
    }, "profile round-trip");
  },

  "profile.set overwrites existing": async (acmi) => {
    await acmi.profile.set("user:bob", { name: "Bob", role: "admin" });
    await acmi.profile.set("user:bob", { name: "Bob" });
    const got = await acmi.profile.get("user:bob");
    assertEqual(got, {
      name: "Bob",
      actor_type: "human",
      tenant_id: "madez",
    }, "set should overwrite");
  },

  "profile.merge combines new + existing keys": async (acmi) => {
    await acmi.profile.set("user:carol", { name: "Carol", tz: "UTC" });
    const merged = await acmi.profile.merge("user:carol", { tz: "PT", role: "user" });
    assertEqual(merged, {
      name: "Carol",
      tz: "PT",
      role: "user",
      actor_type: "human",
      tenant_id: "madez",
    }, "merge result");
    const got = await acmi.profile.get("user:carol");
    assertEqual(got, {
      name: "Carol",
      tz: "PT",
      role: "user",
      actor_type: "human",
      tenant_id: "madez",
    }, "merge persisted");
  },

  "profile.merge on missing entity creates it": async (acmi) => {
    const merged = await acmi.profile.merge("user:dave", { name: "Dave" });
    assertEqual(merged, {
      name: "Dave",
      actor_type: "human",
      tenant_id: "madez",
    }, "merge from null");
  },

  "profile.delete removes the entity": async (acmi) => {
    await acmi.profile.set("user:eve", { name: "Eve" });
    await acmi.profile.delete("user:eve");
    const got = await acmi.profile.get("user:eve");
    assert(got === null, "profile should be null after delete");
  },

  "profile reads return a copy (caller mutation does not affect storage)": async (acmi) => {
    await acmi.profile.set("user:frank", { name: "Frank" });
    const got1 = (await acmi.profile.get("user:frank")) as { name: string };
    got1.name = "MUTATED";
    const got2 = await acmi.profile.get("user:frank");
    assertEqual(got2, {
      name: "Frank",
      actor_type: "human",
      tenant_id: "madez",
    }, "stored profile must be isolated from caller mutation");
  },

  // ─── Signals ──────────────────────────────────────────────────────────

  "signals.get returns undefined when missing": async (acmi) => {
    const got = await acmi.signals.get("user:s1", "missing");
    assert(got === undefined, "expected undefined for missing signal");
  },

  "signals.set + signals.get round-trip primitives": async (acmi) => {
    await acmi.signals.set("user:s2", "task", "writing");
    await acmi.signals.set("user:s2", "count", 42);
    await acmi.signals.set("user:s2", "active", true);
    assertEqual(await acmi.signals.get("user:s2", "task"), "writing", "string");
    assertEqual(await acmi.signals.get("user:s2", "count"), 42, "number");
    assertEqual(await acmi.signals.get("user:s2", "active"), true, "boolean");
  },

  "signals.set + signals.get round-trip nested objects": async (acmi) => {
    const value = { current: { task: "x", priority: 1 }, tags: ["a", "b"] };
    await acmi.signals.set("user:s3", "state", value);
    const got = await acmi.signals.get("user:s3", "state");
    assertEqual(got, value, "nested signal round-trip");
  },

  "signals.set overwrites existing key": async (acmi) => {
    await acmi.signals.set("user:s4", "mode", "draft");
    await acmi.signals.set("user:s4", "mode", "final");
    assertEqual(await acmi.signals.get("user:s4", "mode"), "final", "overwrite");
  },

  "signals.all returns all signals as a flat object": async (acmi) => {
    await acmi.signals.set("user:s5", "a", 1);
    await acmi.signals.set("user:s5", "b", "two");
    const all = await acmi.signals.all("user:s5");
    assertEqual(all, { a: 1, b: "two" }, "signals.all");
  },

  "signals.all returns empty object when none set": async (acmi) => {
    const all = await acmi.signals.all("user:s6-empty");
    assertEqual(all, {}, "empty signals");
  },

  "signals.delete removes a single key": async (acmi) => {
    await acmi.signals.set("user:s7", "keep", 1);
    await acmi.signals.set("user:s7", "drop", 2);
    await acmi.signals.delete("user:s7", "drop");
    assertEqual(await acmi.signals.all("user:s7"), { keep: 1 }, "after delete");
  },

  // ─── Timeline ─────────────────────────────────────────────────────────

  "timeline.append + timeline.read round-trips": async (acmi) => {
    const ev = await acmi.timeline.append("user:t1", makeEvent({ summary: "first" }));
    const read = await acmi.timeline.read("user:t1");
    assertEqual(read.length, 1, "one event");
    assertEqual(read[0]?.summary, "first", "summary");
    assertEqual(read[0]?.ts, ev.ts, "ts preserved");
  },

  "timeline.append auto-fills ts when missing": async (acmi) => {
    const before = Date.now();
    const ev = await acmi.timeline.append("user:t2", makeEvent());
    const after = Date.now();
    assert(ev.ts >= before && ev.ts <= after, "ts should be Date.now()");
  },

  "timeline events are read in chronological order": async (acmi) => {
    await acmi.timeline.append("user:t3", makeEvent({ ts: 1000, summary: "a" }));
    await acmi.timeline.append("user:t3", makeEvent({ ts: 3000, summary: "c" }));
    await acmi.timeline.append("user:t3", makeEvent({ ts: 2000, summary: "b" }));
    const read = await acmi.timeline.read("user:t3");
    assertEqual(
      read.map((e) => e.summary),
      ["a", "b", "c"],
      "chronological order"
    );
  },

  "timeline.read with reverse:true returns newest-first": async (acmi) => {
    await acmi.timeline.append("user:t4", makeEvent({ ts: 1000, summary: "old" }));
    await acmi.timeline.append("user:t4", makeEvent({ ts: 2000, summary: "new" }));
    const read = await acmi.timeline.read("user:t4", { reverse: true });
    assertEqual(
      read.map((e) => e.summary),
      ["new", "old"],
      "reverse"
    );
  },

  "timeline.read respects limit": async (acmi) => {
    for (let i = 0; i < 10; i++) {
      await acmi.timeline.append("user:t5", makeEvent({ ts: 1000 + i, summary: `e${i}` }));
    }
    const read = await acmi.timeline.read("user:t5", { limit: 3 });
    assertEqual(read.length, 3, "limit applied");
    assertEqual(
      read.map((e) => e.summary),
      ["e0", "e1", "e2"],
      "first 3 in order"
    );
  },

  "timeline.read sinceMs is inclusive": async (acmi) => {
    await acmi.timeline.append("user:t6", makeEvent({ ts: 1000, summary: "old" }));
    await acmi.timeline.append("user:t6", makeEvent({ ts: 2000, summary: "boundary" }));
    await acmi.timeline.append("user:t6", makeEvent({ ts: 3000, summary: "new" }));
    const read = await acmi.timeline.read("user:t6", { sinceMs: 2000 });
    assertEqual(
      read.map((e) => e.summary),
      ["boundary", "new"],
      "sinceMs inclusive"
    );
  },

  "timeline.read untilMs is inclusive": async (acmi) => {
    await acmi.timeline.append("user:t7", makeEvent({ ts: 1000, summary: "old" }));
    await acmi.timeline.append("user:t7", makeEvent({ ts: 2000, summary: "boundary" }));
    await acmi.timeline.append("user:t7", makeEvent({ ts: 3000, summary: "new" }));
    const read = await acmi.timeline.read("user:t7", { untilMs: 2000 });
    assertEqual(
      read.map((e) => e.summary),
      ["old", "boundary"],
      "untilMs inclusive"
    );
  },

  "timeline.size reflects appended event count": async (acmi) => {
    assertEqual(await acmi.timeline.size("user:t8"), 0, "initial");
    await acmi.timeline.append("user:t8", makeEvent());
    await acmi.timeline.append("user:t8", makeEvent());
    assertEqual(await acmi.timeline.size("user:t8"), 2, "after 2 appends");
  },

  "timeline preserves event payload": async (acmi) => {
    const payload = { foo: "bar", nested: { count: 5, tags: ["x", "y"] } };
    await acmi.timeline.append("user:t9", makeEvent({ payload }));
    const read = await acmi.timeline.read("user:t9");
    assertEqual(read[0]?.payload, payload, "payload round-trip");
  },

  "timeline preserves parentCorrelationId": async (acmi) => {
    await acmi.timeline.append(
      "user:t10",
      makeEvent({ correlationId: "child", parentCorrelationId: "parent" })
    );
    const read = await acmi.timeline.read("user:t10");
    assertEqual(read[0]?.parentCorrelationId, "parent", "parent CID preserved");
  },

  "timeline.append is idempotent for exact duplicates": async (acmi) => {
    const ev = makeEvent({ ts: 12345, summary: "duplicate" });
    await acmi.timeline.append("user:t-dup", ev);
    await acmi.timeline.append("user:t-dup", ev);

    assertEqual(await acmi.timeline.size("user:t-dup"), 1, "should deduplicate exact matches");
  },

  "batching executes all operations": async (acmi) => {
    const entity = "user:batch-test";
    await acmi.batch((b) => {
      b.profile.set(entity, { batch: true });
      b.signals.set(entity, "batch-key", 123);
      b.timeline.append(entity, makeEvent({ summary: "batched" }));
    });

    assertEqual(await acmi.profile.get(entity), {
      batch: true,
      actor_type: "human",
      tenant_id: "madez",
    }, "profile");
    assertEqual(await acmi.signals.get(entity, "batch-key"), 123, "signal");
    const timeline = await acmi.timeline.read(entity);
    assertEqual(timeline.length, 1, "timeline count");
    assertEqual(timeline[0]?.summary, "batched", "timeline content");
  },

  "v1.3: auto-fills actor_type and tenant_id in profile": async (acmi) => {
    const userEntity = "user:mikey-v13";
    const agentEntity = "agent:claude-v13";

    await acmi.profile.set(userEntity, { name: "Mikey" });
    await acmi.profile.set(agentEntity, { name: "Claude" });

    const userProfile = await acmi.profile.get(userEntity);
    const agentProfile = await acmi.profile.get(agentEntity);

    assertEqual(userProfile?.actor_type, "human", "user -> human");
    assertEqual(agentProfile?.actor_type, "agent", "agent -> agent");
    assertEqual(userProfile?.tenant_id, "madez", "default tenant");
  },

  "v1.3: auto-fills speaker_type and tenant_id in timeline": async (acmi) => {
    const entity = "thread:sync-v13";
    
    // 1. Human source
    await acmi.timeline.append(entity, {
      source: "user:mikey",
      kind: "chat",
      correlationId: "c1",
      summary: "hello"
    });

    // 2. Agent source
    await acmi.timeline.append(entity, {
      source: "agent:claude",
      kind: "reply",
      correlationId: "c1",
      summary: "hi"
    });

    // 3. Explicit override
    await acmi.timeline.append(entity, {
      source: "system:cron",
      kind: "tick",
      correlationId: "c2",
      summary: "pulse",
      speaker_type: "system",
      tenant_id: "external-org"
    });

    const events = await acmi.timeline.read(entity);
    assertEqual(events[0]?.speaker_type, "human", "mikey -> human");
    assertEqual(events[1]?.speaker_type, "agent", "claude -> agent");
    assertEqual(events[2]?.speaker_type, "system", "explicit system");
    assertEqual(events[2]?.tenant_id, "external-org", "explicit tenant");
  },

  "v1.3: batch also auto-fills": async (acmi) => {
    const entity = "agent:batch-v13";
    await acmi.batch((b) => {
      b.profile.set(entity, { batch: true });
      b.timeline.append(entity, {
        source: entity,
        kind: "batch",
        correlationId: "bc1",
        summary: "test"
      });
    });

    const profile = await acmi.profile.get(entity);
    const events = await acmi.timeline.read(entity);
    
    assertEqual(profile?.actor_type, "agent", "batch profile auto-fill");
    assertEqual(events[0]?.speaker_type, "agent", "batch timeline auto-fill");
    assertEqual(events[0]?.tenant_id, "madez", "batch tenant auto-fill");
  },

  // ─── Validation (Comms v1.1) ──────────────────────────────────────────

  "rejects timeline events missing source": async (acmi) => {
    let threw = false;
    try {
      // biome-ignore lint: testing invalid input
      await acmi.timeline.append("user:v1", { kind: "x", correlationId: "y", summary: "z" } as never);
    } catch {
      threw = true;
    }
    assert(threw, "missing source should throw");
  },

  "rejects timeline events missing kind": async (acmi) => {
    let threw = false;
    try {
      // biome-ignore lint: testing invalid input
      await acmi.timeline.append("user:v2", { source: "x", correlationId: "y", summary: "z" } as never);
    } catch {
      threw = true;
    }
    assert(threw, "missing kind should throw");
  },

  "rejects timeline events missing correlationId (Comms v1.1)": async (acmi) => {
    let threw = false;
    try {
      // biome-ignore lint: testing invalid input
      await acmi.timeline.append("user:v3", { source: "x", kind: "y", summary: "z" } as never);
    } catch {
      threw = true;
    }
    assert(threw, "missing correlationId should throw");
  },

  "rejects timeline events missing summary": async (acmi) => {
    let threw = false;
    try {
      // biome-ignore lint: testing invalid input
      await acmi.timeline.append("user:v4", { source: "x", kind: "y", correlationId: "z" } as never);
    } catch {
      threw = true;
    }
    assert(threw, "missing summary should throw");
  },

  "rejects malformed entityIds": async (acmi) => {
    for (const bad of ["", "no-colon", ":missing-cat", "cat:", "Cat:Bad"]) {
      let threw = false;
      try {
        await acmi.profile.get(bad);
      } catch {
        threw = true;
      }
      assert(threw, `entityId ${JSON.stringify(bad)} should be rejected`);
    }
  },

  // ─── Isolation between entities ───────────────────────────────────────

  "different entities have independent profiles, signals, and timelines": async (acmi) => {
    await acmi.profile.set("user:iso-a", { who: "a" });
    await acmi.profile.set("user:iso-b", { who: "b" });
    await acmi.signals.set("user:iso-a", "k", "va");
    await acmi.signals.set("user:iso-b", "k", "vb");
    await acmi.timeline.append("user:iso-a", makeEvent({ summary: "a-event" }));
    await acmi.timeline.append("user:iso-b", makeEvent({ summary: "b-event" }));

    assertEqual(await acmi.profile.get("user:iso-a"), {
      who: "a",
      actor_type: "human",
      tenant_id: "madez",
    }, "profile a");
    assertEqual(await acmi.profile.get("user:iso-b"), {
      who: "b",
      actor_type: "human",
      tenant_id: "madez",
    }, "profile b");
    assertEqual(await acmi.signals.get("user:iso-a", "k"), "va", "signal a");
    assertEqual(await acmi.signals.get("user:iso-b", "k"), "vb", "signal b");
    const aEvents = await acmi.timeline.read("user:iso-a");
    const bEvents = await acmi.timeline.read("user:iso-b");
    assertEqual(aEvents.length, 1, "a events");
    assertEqual(bEvents.length, 1, "b events");
    assertEqual(aEvents[0]?.summary, "a-event", "a content");
    assertEqual(bEvents[0]?.summary, "b-event", "b content");
  },
};
