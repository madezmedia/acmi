/**
 * ACMI — The protocol for agent memory.
 *
 * Three keys per entity: Profile / Signals / Timeline.
 *
 * @packageDocumentation
 */

/**
 * Current version of the @madezmedia/acmi SDK.
 */
export const VERSION = "1.2.0";

export { createAcmi } from "./client.js";
export { InMemoryAdapter } from "./adapters/in-memory.js";
export { RedisAdapter } from "./adapters/redis.js";
export { UpstashAdapter } from "./adapters/upstash.js";
export {
  AcmiValidationError,
  type AcmiAdapter,
  type AcmiClient,
  type EntityId,
  type ProfileDoc,
  type SignalValue,
  type TimelineEvent,
  type TimelineReadOpts,
} from "./types.js";

// Adapters are also accessible via subpath imports:
//   import { InMemoryAdapter } from "@madezmedia/acmi/adapters/in-memory";
//   import { RedisAdapter } from "@madezmedia/acmi/adapters/redis";
//   import { UpstashAdapter } from "@madezmedia/acmi/adapters/upstash";
//
// The conformance suite is at:
//   import { runConformanceTests } from "@madezmedia/acmi/testing/conformance";
