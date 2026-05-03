import type {
  AcmiAdapter,
  AcmiClient,
  ActorType,
  EntityId,
  ProfileDoc,
  SignalValue,
  SpeakerType,
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
      set: async (entityId, doc) => {
        validateEntityId(entityId);
        const finalDoc = { ...doc };
        autoFillActorType(entityId, finalDoc);
        autoFillTenantId(finalDoc);
        validateProfile(finalDoc);
        await adapter.profileSet(entityId, finalDoc);
      },
      merge: (entityId, partial) => {
        validateEntityId(entityId);
        const finalPartial = { ...partial };
        autoFillActorType(entityId, finalPartial);
        autoFillTenantId(finalPartial);
        validateProfile(finalPartial);
        return adapter.profileMerge(entityId, finalPartial);
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
          ...(partial.speaker_type !== undefined && { speaker_type: partial.speaker_type }),
          ...(partial.tenant_id !== undefined && { tenant_id: partial.tenant_id }),
        };

        autoFillSpeakerType(event);
        autoFillTenantId(event);
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

    batch: async (fn) => {
      const ops: any[] = [];
      const b: any = {
        profile: {
          set: (entityId: any, doc: any) => {
            validateEntityId(entityId);
            const finalDoc = { ...doc };
            autoFillActorType(entityId, finalDoc);
            autoFillTenantId(finalDoc);
            validateProfile(finalDoc);
            ops.push({ type: "profileSet", entityId, doc: finalDoc });
          },
          delete: (entityId: any) => {
            validateEntityId(entityId);
            ops.push({ type: "profileDelete", entityId });
          },
        },
        signals: {
          set: (entityId: any, key: any, value: any) => {
            validateEntityId(entityId);
            validateSignalKey(key);
            ops.push({ type: "signalsSet", entityId, key, value });
          },
          delete: (entityId: any, key: any) => {
            validateEntityId(entityId);
            validateSignalKey(key);
            ops.push({ type: "signalsDelete", entityId, key });
          },
        },
        timeline: {
          append: (entityId: any, partial: any) => {
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
              ...(partial.speaker_type !== undefined && { speaker_type: partial.speaker_type }),
              ...(partial.tenant_id !== undefined && { tenant_id: partial.tenant_id }),
            };
            autoFillSpeakerType(event);
            autoFillTenantId(event);
            validateEvent(event);
            ops.push({ type: "timelineAppend", entityId, event });
          },
        },
      };

      await fn(b);

      if (ops.length === 0) return;

      if (adapter.batch) {
        await adapter.batch(ops);
      } else {
        // Fallback: sequential writes if adapter doesn't support batching
        for (const op of ops) {
          switch (op.type) {
            case "profileSet":
              await adapter.profileSet(op.entityId, op.doc);
              break;
            case "profileDelete":
              await adapter.profileDelete(op.entityId);
              break;
            case "signalsSet":
              await adapter.signalsSet(op.entityId, op.key, op.value);
              break;
            case "signalsDelete":
              await adapter.signalsDelete(op.entityId, op.key);
              break;
            case "timelineAppend":
              await adapter.timelineAppend(op.entityId, op.event);
              break;
          }
        }
      }
    },

    close: () => adapter.close?.() ?? Promise.resolve(),
  };
}

// ─── Internal Helpers ───────────────────────────────────────────────────

function autoFillActorType(entityId: EntityId, doc: ProfileDoc) {
  if (doc.actor_type) return;
  const category = entityId.split(":")[0];
  switch (category) {
    case "agent":
      doc.actor_type = "agent";
      break;
    case "user":
      doc.actor_type = "human";
      break;
  }
}

function autoFillSpeakerType(event: TimelineEvent) {
  if (event.speaker_type) return;
  const sourceCategory = event.source.split(":")[0];
  switch (sourceCategory) {
    case "agent":
      event.speaker_type = "agent";
      break;
    case "user":
      event.speaker_type = "human";
      break;
  }
}

function autoFillTenantId(target: ProfileDoc | TimelineEvent) {
  if (target.tenant_id) return;
  target.tenant_id = "madez";
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
    const v = (ev as any)[field];
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
  ActorType,
  EntityId,
  ProfileDoc,
  SignalValue,
  SpeakerType,
  TimelineEvent,
  TimelineReadOpts,
};
