import type {
  AcmiAdapter,
  AcmiClient,
  EntityId,
  ProfileDoc,
  SignalValue,
  TimelineEvent,
  TimelineReadOpts,
} from "./types.js";
import { AcmiValidationError } from "./types.js";

/**
 * Create an ACMI client wrapping a given adapter.
 *
 * @example
 * ```ts
 * import { createAcmi, InMemoryAdapter } from "@madezmedia/acmi";
 *
 * const acmi = createAcmi(new InMemoryAdapter());
 *
 * await acmi.profile.set("user:mikey", { name: "Mikey", tz: "America/New_York" });
 * await acmi.signals.set("user:mikey", "current_task", "shooting ACMI manifesto");
 * await acmi.timeline.append("user:mikey", {
 *   source: "user:mikey",
 *   kind: "started_recording",
 *   correlationId: "manifesto-001",
 *   summary: "video 1 of 3",
 * });
 * ```
 */
export function createAcmi(adapter: AcmiAdapter): AcmiClient {
  return {
    adapter,

    profile: {
      get: (entityId) => {
        validateEntityId(entityId);
        return adapter.profileGet(entityId);
      },
      set: (entityId, doc) => {
        validateEntityId(entityId);
        validateProfile(doc);
        return adapter.profileSet(entityId, doc);
      },
      merge: (entityId, partial) => {
        validateEntityId(entityId);
        validateProfile(partial);
        return adapter.profileMerge(entityId, partial);
      },
      delete: (entityId) => {
        validateEntityId(entityId);
        return adapter.profileDelete(entityId);
      },
    },

    signals: {
      get: (entityId, key) => {
        validateEntityId(entityId);
        validateSignalKey(key);
        return adapter.signalsGet(entityId, key);
      },
      set: (entityId, key, value) => {
        validateEntityId(entityId);
        validateSignalKey(key);
        return adapter.signalsSet(entityId, key, value);
      },
      all: (entityId) => {
        validateEntityId(entityId);
        return adapter.signalsAll(entityId);
      },
      delete: (entityId, key) => {
        validateEntityId(entityId);
        validateSignalKey(key);
        return adapter.signalsDelete(entityId, key);
      },
    },

    timeline: {
      append: async (entityId, partial) => {
        validateEntityId(entityId);
        const event: TimelineEvent = {
          ts: partial.ts ?? Date.now(),
          source: partial.source,
          kind: partial.kind,
          correlationId: partial.correlationId,
          summary: partial.summary,
          ...(partial.parentCorrelationId !== undefined && {
            parentCorrelationId: partial.parentCorrelationId,
          }),
          ...(partial.payload !== undefined && { payload: partial.payload }),
        };
        validateEvent(event);
        await adapter.timelineAppend(entityId, event);
        return event;
      },
      read: (entityId, opts) => {
        validateEntityId(entityId);
        return adapter.timelineRead(entityId, opts);
      },
      size: (entityId) => {
        validateEntityId(entityId);
        return adapter.timelineSize(entityId);
      },
    },

    close: () => adapter.close?.() ?? Promise.resolve(),
  };
}

// ─── Validation ───────────────────────────────────────────────────────────

const ENTITY_ID_PATTERN = /^[a-z][a-z0-9_-]*:[a-zA-Z0-9_.-]+$/;

function validateEntityId(entityId: EntityId): void {
  if (typeof entityId !== "string" || entityId.length === 0) {
    throw new AcmiValidationError("entityId must be a non-empty string");
  }
  if (!ENTITY_ID_PATTERN.test(entityId)) {
    throw new AcmiValidationError(
      `entityId must match <category>:<id> (got: ${JSON.stringify(entityId)})`
    );
  }
  if (entityId.length > 256) {
    throw new AcmiValidationError("entityId must be <= 256 chars");
  }
}

function validateSignalKey(key: string): void {
  if (typeof key !== "string" || key.length === 0) {
    throw new AcmiValidationError("signal key must be a non-empty string");
  }
  if (key.length > 128) {
    throw new AcmiValidationError("signal key must be <= 128 chars");
  }
}

function validateProfile(doc: ProfileDoc): void {
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new AcmiValidationError("profile must be a plain object");
  }
}

function validateEvent(ev: TimelineEvent): void {
  if (typeof ev.ts !== "number" || !Number.isFinite(ev.ts)) {
    throw new AcmiValidationError("event.ts must be a finite number (ms since epoch)");
  }
  for (const field of ["source", "kind", "correlationId", "summary"] as const) {
    const v = ev[field];
    if (typeof v !== "string" || v.length === 0) {
      throw new AcmiValidationError(
        `event.${field} is required and must be a non-empty string (Comms v1.1)`
      );
    }
  }
  if (ev.summary.length > 500) {
    throw new AcmiValidationError("event.summary should be <= 500 chars (one-line)");
  }
}

export { AcmiValidationError };
export type {
  AcmiAdapter,
  AcmiClient,
  EntityId,
  ProfileDoc,
  SignalValue,
  TimelineEvent,
  TimelineReadOpts,
};
