import { UpstashAdapter, type UpstashAdapterConfig } from "./upstash.js";

/**
 * Fleet PRIMARY for agents that cannot open TCP to self-hosted Redis.
 *
 * Uses the same Upstash-compatible HTTP protocol as the VM bridge:
 *   POST http://152.53.201.27:8081/
 *   Authorization: Bearer vm-local-bridge
 *   body: JSON array command e.g. ["PING"] → { "result": "PONG" }
 *
 * Prefer native Redis (ACMI_REDIS_HOST) when TCP is available.
 * Prefer this bridge for edge / sandboxed agents / Macs without Redis port access.
 */
export interface BridgeAdapterConfig {
  /** Bridge base URL (no trailing slash required). Default: fleet VM bridge. */
  url?: string;
  /** Bearer token. Default: `vm-local-bridge`. */
  token?: string;
  /** Key prefix; defaults to `"acmi"`. */
  prefix?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

const DEFAULT_BRIDGE_URL = "http://152.53.201.27:8081";
const DEFAULT_BRIDGE_TOKEN = "vm-local-bridge";

/**
 * Thin wrapper around UpstashAdapter pointing at the self-hosted HTTP bridge.
 * Protocol-compatible with Upstash REST (command array POST).
 */
export class BridgeAdapter extends UpstashAdapter {
  readonly name = "bridge";

  constructor(config: BridgeAdapterConfig = {}) {
    const upstashConfig: UpstashAdapterConfig = {
      url: (config.url ?? process.env.ACMI_BRIDGE_URL ?? DEFAULT_BRIDGE_URL).replace(/\/$/, ""),
      token: config.token ?? process.env.ACMI_BRIDGE_TOKEN ?? DEFAULT_BRIDGE_TOKEN,
      prefix: config.prefix,
      fetch: config.fetch,
      signal: config.signal,
    };
    super(upstashConfig);
  }
}

/** Helper for scripts / skills — same as `new BridgeAdapter(config)`. */
export async function redisCommand(
  cmdArray: Array<string | number>,
  opts: { url?: string; token?: string } = {}
): Promise<unknown> {
  const url = (opts.url ?? process.env.ACMI_BRIDGE_URL ?? DEFAULT_BRIDGE_URL).replace(/\/?$/, "/");
  const token = opts.token ?? process.env.ACMI_BRIDGE_TOKEN ?? DEFAULT_BRIDGE_TOKEN;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(cmdArray.map(String)),
  });
  const data = (await response.json()) as { result?: unknown; error?: string };
  if (data.error) throw new Error(`Bridge: ${data.error}`);
  return data.result;
}
