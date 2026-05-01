import type {
  AcmiAdapter,
  EntityId,
  ProfileDoc,
  SignalValue,
  TimelineEvent,
  TimelineReadOpts,
} from "../types.js";

/**
 * Zero-dependency in-memory adapter. Default for tests, examples, and
 * letting devs try ACMI without standing up Redis.
 *
 * NOT durable. NOT process-shared. NOT for production. The only state lives
 * in the instance — kill the process and it's gone.
 */
export class InMemoryAdapter implements AcmiAdapter {
  readonly name = "in-memory";

  private profiles = new Map<EntityId, ProfileDoc>();
  private signals = new Map<EntityId, Map<string, SignalValue>>();
  private timelines = new Map<EntityId, TimelineEvent[]>();

  // ─── Profile ────────────────────────────────────────────────────────────

  async profileGet(entityId: EntityId): Promise<ProfileDoc | null> {
    const doc = this.profiles.get(entityId);
    return doc ? structuredClone(doc) : null;
  }

  async profileSet(entityId: EntityId, doc: ProfileDoc): Promise<void> {
    this.profiles.set(entityId, structuredClone(doc));
  }

  async profileMerge(entityId: EntityId, partial: ProfileDoc): Promise<ProfileDoc> {
    const current = this.profiles.get(entityId) ?? {};
    const merged: ProfileDoc = { ...current, ...partial };
    this.profiles.set(entityId, structuredClone(merged));
    return structuredClone(merged);
  }

  async profileDelete(entityId: EntityId): Promise<void> {
    this.profiles.delete(entityId);
  }

  // ─── Signals ────────────────────────────────────────────────────────────

  async signalsGet(entityId: EntityId, key: string): Promise<SignalValue | undefined> {
    const map = this.signals.get(entityId);
    if (!map) return undefined;
    const v = map.get(key);
    return v === undefined ? undefined : cloneSignal(v);
  }

  async signalsSet(entityId: EntityId, key: string, value: SignalValue): Promise<void> {
    let map = this.signals.get(entityId);
    if (!map) {
      map = new Map();
      this.signals.set(entityId, map);
    }
    map.set(key, cloneSignal(value));
  }

  async signalsAll(entityId: EntityId): Promise<Record<string, SignalValue>> {
    const map = this.signals.get(entityId);
    if (!map) return {};
    const out: Record<string, SignalValue> = {};
    for (const [k, v] of map) out[k] = cloneSignal(v);
    return out;
  }

  async signalsDelete(entityId: EntityId, key: string): Promise<void> {
    this.signals.get(entityId)?.delete(key);
  }

  // ─── Timeline ───────────────────────────────────────────────────────────

  async timelineAppend(entityId: EntityId, event: TimelineEvent): Promise<void> {
    let list = this.timelines.get(entityId);
    if (!list) {
      list = [];
      this.timelines.set(entityId, list);
    }
    // Insert keeping the list sorted by ts ascending. Stable: ties preserve
    // append order.
    const cloned = structuredClone(event);
    let i = list.length;
    while (i > 0 && (list[i - 1] as TimelineEvent).ts > cloned.ts) i--;
    list.splice(i, 0, cloned);
  }

  async timelineRead(entityId: EntityId, opts?: TimelineReadOpts): Promise<TimelineEvent[]> {
    const list = this.timelines.get(entityId) ?? [];
    let filtered = list;
    if (opts?.sinceMs !== undefined) {
      const sinceMs = opts.sinceMs;
      filtered = filtered.filter((e) => e.ts >= sinceMs);
    }
    if (opts?.untilMs !== undefined) {
      const untilMs = opts.untilMs;
      filtered = filtered.filter((e) => e.ts <= untilMs);
    }
    if (opts?.reverse) filtered = [...filtered].reverse();
    if (opts?.limit !== undefined) filtered = filtered.slice(0, opts.limit);
    return filtered.map((e) => structuredClone(e));
  }

  async timelineSize(entityId: EntityId): Promise<number> {
    return this.timelines.get(entityId)?.length ?? 0;
  }
}

function cloneSignal(v: SignalValue): SignalValue {
  if (v === null || typeof v !== "object") return v;
  return structuredClone(v) as SignalValue;
}
