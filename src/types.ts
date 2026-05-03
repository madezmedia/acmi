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

/**
 * Valid actor types for v1.3 multi-actor schema.
 * @see §11 of ACMI-PROTOCOL-v1.3
 */
export type ActorType = "agent" | "human" | "system" | "external";

/**
 * Valid speaker types for v1.3 Comms patterns.
 */
export type SpeakerType = "agent" | "human" | "system";

/**
 * Profile document. Stable identity and configuration.
 */
export interface ProfileDoc extends Record<string, unknown> {
  /** v1.3: Discriminator for the entity type. */
  actor_type?: ActorType;
  /** v1.3: Tenant/Org isolation ID. Defaults to "madez". */
  tenant_id?: string;
  /** v1.3: Display handle for @mentions. */
  handle?: string;
}

export type SignalValue =
  | string
  | number
  | boolean
  | null
  | SignalValue[]
  | { [k: string]: SignalValue };

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

  // v1.3 extensions
  /** v1.3: Discriminator for the source actor family. */
  speaker_type?: SpeakerType;
  /** v1.3: Tenant/Org isolation ID. */
  tenant_id?: string;
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

  // ─── Batch ──────────────────────────────────────────────────────────────
  /** Optional: execute multiple writes in a single network round-trip. */
  batch?(ops: BatchOp[]): Promise<void>;

  // ─── Lifecycle ──────────────────────────────────────────────────────────
  /** Optional: close any held connections. */
  close?(): Promise<void>;
}

/**
 * A write operation that can be part of an `acmi.batch()`.
 */
export type BatchOp =
  | { type: "profileSet"; entityId: EntityId; doc: ProfileDoc }
  | { type: "profileDelete"; entityId: EntityId }
  | { type: "signalsSet"; entityId: EntityId; key: string; value: SignalValue }
  | { type: "signalsDelete"; entityId: EntityId; key: string }
  | { type: "timelineAppend"; entityId: EntityId; event: TimelineEvent };

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

  /**
   * Pipeline multiple write operations into a single network round-trip.
   *
   * @example
   * ```ts
   * await acmi.batch(async (b) => {
   *   b.profile.set("user:mikey", { name: "Mikey" });
   *   b.signals.set("user:mikey", "status", "online");
   *   b.timeline.append("user:mikey", { source: "agent:claude", kind: "sync", summary: "batching" });
   * });
   * ```
   */
  batch(fn: (b: AcmiBatch) => void | Promise<void>): Promise<void>;

  close(): Promise<void>;
}

/**
 * The subset of AcmiClient methods available during a batch.
 */
export interface AcmiBatch {
  profile: {
    set(entityId: EntityId, doc: ProfileDoc): void;
    delete(entityId: EntityId): void;
  };
  signals: {
    set(entityId: EntityId, key: string, value: SignalValue): void;
    delete(entityId: EntityId, key: string): void;
  };
  timeline: {
    append(entityId: EntityId, event: Omit<TimelineEvent, "ts"> & { ts?: number }): void;
  };
}

/** Validation error thrown when an event is missing Comms v1.1 mandatory fields. */
export class AcmiValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcmiValidationError";
  }
}
