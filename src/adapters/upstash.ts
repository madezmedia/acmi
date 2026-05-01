import type {
  AcmiAdapter,
  EntityId,
  ProfileDoc,
  SignalValue,
  TimelineEvent,
  TimelineReadOpts,
} from "../types.js";

export interface UpstashAdapterConfig {
  /** REST URL from your Upstash console (e.g. `https://us1-foo-bar.upstash.io`). */
  url: string;
  /** REST token from your Upstash console. */
  token: string;
  /** Optional key prefix; defaults to `"acmi"`. */
  prefix?: string;
  /** Optional fetch override for environments that need it (workers, edge runtimes). */
  fetch?: typeof fetch;
}

/**
 * REST-based Upstash adapter. Edge-compatible — works in Cloudflare Workers,
 * Vercel Edge, Deno Deploy, and Node 18+. No long-lived connection.
 *
 * Storage shape:
 *   - Profile  → STRING + JSON   at `<prefix>:<entityId>:profile`
 *   - Signals  → STRING + JSON   at `<prefix>:<entityId>:signals`     (Comms v1.1 unified)
 *   - Timeline → ZSET (score=ts) at `<prefix>:<entityId>:timeline`
 *
 * The `<entityId>` already contains a `:` separator (`<category>:<id>`), so
 * keys naturally produce `acmi:user:mikey:profile`, etc.
 */
export class UpstashAdapter implements AcmiAdapter {
  readonly name = "upstash";

  private readonly url: string;
  private readonly token: string;
  private readonly prefix: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: UpstashAdapterConfig) {
    if (!config.url) throw new Error("UpstashAdapter: `url` is required");
    if (!config.token) throw new Error("UpstashAdapter: `token` is required");
    this.url = config.url.replace(/\/$/, "");
    this.token = config.token;
    this.prefix = config.prefix ?? "acmi";
    this.fetchImpl = config.fetch ?? fetch;
  }

  // ─── Internal: REST call ────────────────────────────────────────────────

  private async cmd<T = unknown>(...args: Array<string | number>): Promise<T> {
    const res = await this.fetchImpl(`${this.url}/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args.map(String)),
    });
    if (!res.ok) {
      throw new Error(`Upstash REST error ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { result?: T; error?: string };
    if (data.error) throw new Error(`Upstash error: ${data.error}`);
    return data.result as T;
  }

  private k(entityId: EntityId, slot: "profile" | "signals" | "timeline"): string {
    return `${this.prefix}:${entityId}:${slot}`;
  }

  // ─── Profile ────────────────────────────────────────────────────────────

  async profileGet(entityId: EntityId): Promise<ProfileDoc | null> {
    const raw = await this.cmd<string | null>("GET", this.k(entityId, "profile"));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as ProfileDoc;
    } catch {
      throw new Error(`profile at ${this.k(entityId, "profile")} is not valid JSON`);
    }
  }

  async profileSet(entityId: EntityId, doc: ProfileDoc): Promise<void> {
    await this.cmd("SET", this.k(entityId, "profile"), JSON.stringify(doc));
  }

  async profileMerge(entityId: EntityId, partial: ProfileDoc): Promise<ProfileDoc> {
    const current = (await this.profileGet(entityId)) ?? {};
    const merged: ProfileDoc = { ...current, ...partial };
    await this.profileSet(entityId, merged);
    return merged;
  }

  async profileDelete(entityId: EntityId): Promise<void> {
    await this.cmd("DEL", this.k(entityId, "profile"));
  }

  // ─── Signals ────────────────────────────────────────────────────────────

  private async signalsLoad(entityId: EntityId): Promise<Record<string, SignalValue>> {
    const raw = await this.cmd<string | null>("GET", this.k(entityId, "signals"));
    if (raw === null) return {};
    try {
      return JSON.parse(raw) as Record<string, SignalValue>;
    } catch {
      throw new Error(`signals at ${this.k(entityId, "signals")} is not valid JSON`);
    }
  }

  private async signalsStore(entityId: EntityId, doc: Record<string, SignalValue>): Promise<void> {
    await this.cmd("SET", this.k(entityId, "signals"), JSON.stringify(doc));
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
    await this.cmd("ZADD", this.k(entityId, "timeline"), event.ts, JSON.stringify(event));
  }

  async timelineRead(entityId: EntityId, opts?: TimelineReadOpts): Promise<TimelineEvent[]> {
    const key = this.k(entityId, "timeline");
    const min = opts?.sinceMs !== undefined ? String(opts.sinceMs) : "-inf";
    const max = opts?.untilMs !== undefined ? String(opts.untilMs) : "+inf";

    const raw = opts?.reverse
      ? await this.cmd<string[]>("ZREVRANGEBYSCORE", key, max, min, ...withLimit(opts?.limit))
      : await this.cmd<string[]>("ZRANGEBYSCORE", key, min, max, ...withLimit(opts?.limit));

    return (raw ?? []).map((s) => JSON.parse(s) as TimelineEvent);
  }

  async timelineSize(entityId: EntityId): Promise<number> {
    const n = await this.cmd<number | string>("ZCARD", this.k(entityId, "timeline"));
    return typeof n === "number" ? n : Number(n) || 0;
  }
}

function withLimit(limit?: number): Array<string | number> {
  if (limit === undefined) return [];
  return ["LIMIT", 0, limit];
}
