/**
 * ACMI — Agentic Context Management Infrastructure
 *
 * The protocol for agent memory. Three keys per entity:
 *   - Profile: who (identity, preferences, anything stable)
 *   - Signals: now (current state — what's open, what's pending)
 *   - Timeline: then (append-only event log)
 *
 * Entity IDs follow the pattern `<category>:<id>` (e.g. `user:mikey`,
 * `agent:claude-engineer`, `project:tony-top-of-new-york`).
 *
 * The adapter is responsible for prefixing keys with `acmi:` and adding
 * the `:profile` / `:signals` / `:timeline` slot suffix.
 */

export type EntityId = string;

export type ProfileDoc = Record<string, unknown>;

export type SignalValue = string | number | boolean | null | SignalValue[] | { [k: string]: SignalValue };

/**
 * A timeline event. The five mandatory camelCase fields (Comms v1.1) are
 * `ts`, `source`, `kind`, `correlationId`, `summary`. They MUST be present
 * on every persisted event. The `append` API accepts events without `ts`
 * and fills it with `Date.now()` automatically.
 */
export interface TimelineEvent {
  /** Wall-clock milliseconds. Auto-filled by `timeline.append` if omitted. */
  ts: number;
  /** Who wrote the event. e.g. `"agent:claude-engineer"`, `"user:mikey"`. */
  source: string;
  /** Event taxonomy. Free-form but consistent (e.g. `"task-delegation"`, `"heartbeat"`). */
  kind: string;
  /** Correlation ID linking related events. Required by Comms v1.1. */
  correlationId: string;
  /** One-line human-readable summary. */
  summary: string;
  /** Optional parent correlation ID for chained workflows. */
  parentCorrelationId?: string;
  /** Optional structured payload. Anything JSON-serializable. */
  payload?: unknown;
}

export interface TimelineReadOpts {
  /** Maximum number of events to return. */
  limit?: number;
  /** If true, return newest-first. Default: oldest-first. */
  reverse?: boolean;
  /** Inclusive lower bound on event ts (ms). */
  sinceMs?: number;
  /** Inclusive upper bound on event ts (ms). */
  untilMs?: number;
}

/**
 * The adapter contract. Any backend that implements this can claim
 * ACMI compliance by passing the conformance test suite at
 * `@madezmedia/acmi/testing/conformance`.
 */
export interface AcmiAdapter {
  /** Adapter implementation name (e.g. `"in-memory"`, `"redis"`, `"upstash"`). */
  readonly name: string;

  // ─── Profile (STRING + JSON) ────────────────────────────────────────────
  profileGet(entityId: EntityId): Promise<ProfileDoc | null>;
  profileSet(entityId: EntityId, doc: ProfileDoc): Promise<void>;
  profileMerge(entityId: EntityId, partial: ProfileDoc): Promise<ProfileDoc>;
  profileDelete(entityId: EntityId): Promise<void>;

  // ─── Signals (HASH-like) ────────────────────────────────────────────────
  signalsGet(entityId: EntityId, key: string): Promise<SignalValue | undefined>;
  signalsSet(entityId: EntityId, key: string, value: SignalValue): Promise<void>;
  signalsAll(entityId: EntityId): Promise<Record<string, SignalValue>>;
  signalsDelete(entityId: EntityId, key: string): Promise<void>;

  // ─── Timeline (ZSET, ordered by ts) ─────────────────────────────────────
  timelineAppend(entityId: EntityId, event: TimelineEvent): Promise<void>;
  timelineRead(entityId: EntityId, opts?: TimelineReadOpts): Promise<TimelineEvent[]>;
  timelineSize(entityId: EntityId): Promise<number>;

  // ─── Lifecycle ──────────────────────────────────────────────────────────
  /** Optional: close any held connections. */
  close?(): Promise<void>;
}

/**
 * The high-level ACMI client API. Wraps an adapter with input validation,
 * defaulting (e.g. auto-fill `ts`), and ergonomic accessors.
 */
export interface AcmiClient {
  readonly adapter: AcmiAdapter;

  profile: {
    get(entityId: EntityId): Promise<ProfileDoc | null>;
    set(entityId: EntityId, doc: ProfileDoc): Promise<void>;
    merge(entityId: EntityId, partial: ProfileDoc): Promise<ProfileDoc>;
    delete(entityId: EntityId): Promise<void>;
  };

  signals: {
    get(entityId: EntityId, key: string): Promise<SignalValue | undefined>;
    set(entityId: EntityId, key: string, value: SignalValue): Promise<void>;
    all(entityId: EntityId): Promise<Record<string, SignalValue>>;
    delete(entityId: EntityId, key: string): Promise<void>;
  };

  timeline: {
    /** Append an event. `ts` defaults to `Date.now()`. */
    append(
      entityId: EntityId,
      event: Omit<TimelineEvent, "ts"> & { ts?: number }
    ): Promise<TimelineEvent>;
    read(entityId: EntityId, opts?: TimelineReadOpts): Promise<TimelineEvent[]>;
    size(entityId: EntityId): Promise<number>;
  };

  close(): Promise<void>;
}

/** Validation error thrown when an event is missing Comms v1.1 mandatory fields. */
export class AcmiValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcmiValidationError";
  }
}
