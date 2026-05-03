import type {
  AcmiAdapter,
  EntityId,
  ProfileDoc,
  SignalValue,
  TimelineEvent,
  TimelineReadOpts,
} from "../types.js";

/**
 * Minimal subset of `ioredis` we use. Lets us avoid a hard dependency at
 * compile time — `ioredis` is a peerDependency.
 */
export interface IoredisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string | string[]): Promise<unknown>;
  zadd(key: string, ...args: Array<string | number>): Promise<number | string>;
  zrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
    ...args: Array<string | number>
  ): Promise<string[]>;
  zrevrangebyscore(
    key: string,
    max: number | string,
    min: number | string,
    ...args: Array<string | number>
  ): Promise<string[]>;
  zcard(key: string): Promise<number>;
  quit?(): Promise<unknown>;
}

export interface RedisAdapterConfig {
  /** An `ioredis` (or compatible) client instance. Caller-managed. */
  client: IoredisLike;
  /** Optional key prefix; defaults to `"acmi"`. */
  prefix?: string;
  /**
   * If `true`, calling `close()` will call `client.quit()`. Defaults to
   * `false` so the caller retains lifecycle ownership.
   */
  ownClient?: boolean;
}

/**
 * `ioredis`-based adapter for self-hosted or managed Redis (including
 * Upstash via the Redis protocol — though the REST `UpstashAdapter` is
 * preferred at the edge).
 *
 * Storage shape:
 *   - Profile  → STRING + JSON   at `<prefix>:<entityId>:profile`
 *   - Signals  → STRING + JSON   at `<prefix>:<entityId>:signals`     (Comms v1.1 unified)
 *   - Timeline → ZSET (score=ts) at `<prefix>:<entityId>:timeline`
 */
export class RedisAdapter implements AcmiAdapter {
  readonly name = "redis";

  private readonly client: IoredisLike;
  private readonly prefix: string;
  private readonly ownClient: boolean;

  constructor(config: RedisAdapterConfig) {
    if (!config.client) throw new Error("RedisAdapter: `client` is required");
    this.client = config.client;
    this.prefix = config.prefix ?? "acmi";
    this.ownClient = config.ownClient ?? false;
  }

  private k(entityId: EntityId, slot: "profile" | "signals" | "timeline"): string {
    return `${this.prefix}:${entityId}:${slot}`;
  }

  // ─── Profile ────────────────────────────────────────────────────────────

  async profileGet(entityId: EntityId): Promise<ProfileDoc | null> {
    const raw = await this.client.get(this.k(entityId, "profile"));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as ProfileDoc;
    } catch {
      throw new Error(`profile at ${this.k(entityId, "profile")} is not valid JSON`);
    }
  }

  async profileSet(entityId: EntityId, doc: ProfileDoc): Promise<void> {
    await this.client.set(this.k(entityId, "profile"), JSON.stringify(doc));
  }

  async profileMerge(entityId: EntityId, partial: ProfileDoc): Promise<ProfileDoc> {
    const current = (await this.profileGet(entityId)) ?? {};
    const merged: ProfileDoc = { ...current, ...partial };
    await this.profileSet(entityId, merged);
    return merged;
  }

  async profileDelete(entityId: EntityId): Promise<void> {
    await this.client.del(this.k(entityId, "profile"));
  }

  // ─── Signals ────────────────────────────────────────────────────────────

  private async signalsLoad(entityId: EntityId): Promise<Record<string, SignalValue>> {
    const raw = await this.client.get(this.k(entityId, "signals"));
    if (raw === null) return {};
    try {
      return JSON.parse(raw) as Record<string, SignalValue>;
    } catch {
      throw new Error(`signals at ${this.k(entityId, "signals")} is not valid JSON`);
    }
  }

  private async signalsStore(entityId: EntityId, doc: Record<string, SignalValue>): Promise<void> {
    await this.client.set(this.k(entityId, "signals"), JSON.stringify(doc));
  }

  async signalsGet(entityId: EntityId, key: string): Promise<SignalValue | undefined> {
    const all = await this.signalsLoad(entityId);
    return all[key];
  }

  async signalsSet(entityId: EntityId, key: string, value: SignalValue): Promise<void> {
    const all = await this.signalsLoad(entityId);
    all[key] = value;
    await this.signalsStore(entityId, all);
  }

  async signalsAll(entityId: EntityId): Promise<Record<string, SignalValue>> {
    return this.signalsLoad(entityId);
  }

  async signalsDelete(entityId: EntityId, key: string): Promise<void> {
    const all = await this.signalsLoad(entityId);
    delete all[key];
    await this.signalsStore(entityId, all);
  }

  // ─── Timeline ───────────────────────────────────────────────────────────

  async timelineAppend(entityId: EntityId, event: TimelineEvent): Promise<void> {
    await this.client.zadd(
      this.k(entityId, "timeline"),
      "NX",
      event.ts,
      JSON.stringify(event)
    );
  }

  async timelineRead(entityId: EntityId, opts?: TimelineReadOpts): Promise<TimelineEvent[]> {
    const key = this.k(entityId, "timeline");
    const min = opts?.sinceMs !== undefined ? opts.sinceMs : "-inf";
    const max = opts?.untilMs !== undefined ? opts.untilMs : "+inf";
    const limitArgs = opts?.limit !== undefined ? ["LIMIT", 0, opts.limit] : [];

    const raw = opts?.reverse
      ? await this.client.zrevrangebyscore(key, max, min, ...limitArgs)
      : await this.client.zrangebyscore(key, min, max, ...limitArgs);

    return raw.map((s) => JSON.parse(s) as TimelineEvent);
  }

  async timelineSize(entityId: EntityId): Promise<number> {
    return this.client.zcard(this.k(entityId, "timeline"));
  }

  async batch(ops: any[]): Promise<void> {
    // If client has a multi method (like ioredis), use it for atomic batching
    const client = this.client as any;
    if (typeof client.multi === "function") {
      const multi = client.multi();
      for (const op of ops) {
        switch (op.type) {
          case "profileSet":
            multi.set(this.k(op.entityId, "profile"), JSON.stringify(op.doc));
            break;
          case "profileDelete":
            multi.del(this.k(op.entityId, "profile"));
            break;
          case "signalsSet": {
            // Signals are read-modify-write in this adapter, so we can't 
            // easily include them in a multi-exec without LUA.
            // Executing them sequentially for now.
            await this.signalsSet(op.entityId, op.key, op.value);
            break;
          }
          case "signalsDelete":
            await this.signalsDelete(op.entityId, op.key);
            break;
          case "timelineAppend":
            multi.zadd(
              this.k(op.entityId, "timeline"),
              "NX",
              op.event.ts,
              JSON.stringify(op.event)
            );
            break;
        }
      }
      await multi.exec();
    } else {
      // Fallback
      for (const op of ops) {
        switch (op.type) {
          case "profileSet":
            await this.profileSet(op.entityId, op.doc);
            break;
          case "profileDelete":
            await this.profileDelete(op.entityId);
            break;
          case "signalsSet":
            await this.signalsSet(op.entityId, op.key, op.value);
            break;
          case "signalsDelete":
            await this.signalsDelete(op.entityId, op.key);
            break;
          case "timelineAppend":
            await this.timelineAppend(op.entityId, op.event);
            break;
        }
      }
    }
  }

  async close(): Promise<void> {
    if (this.ownClient && this.client.quit) await this.client.quit();
  }
}
