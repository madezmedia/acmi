import { createAcmi } from "../src/client.js";
import { RedisAdapter } from "../src/adapters/redis.js";
import Redis from "ioredis";

/**
 * ACMI v1.3 Migration Script
 * 
 * Resolves dual-projection collisions (Mikey as agent, Claude as user)
 * and cleans up spurious keys.
 */

async function main() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.error("Missing UPSTASH_REDIS_REST_URL or _TOKEN");
    process.exit(1);
  }

  // Use raw ioredis for the custom Upstash REST URL if needed, 
  // but here we just need a basic client for the adapter.
  // Since we are running locally, we can use the RedisAdapter with a shim
  // or just hit the REST API directly.
  
  // Actually, let's use the UpstashAdapter directly to be safe with the environment.
  const { UpstashAdapter } = await import("../src/adapters/upstash.js");
  const adapter = new UpstashAdapter({ url, token });
  const acmi = createAcmi(adapter);

  console.log("🚀 Starting v1.3 migration...");

  // 1. Resolve Mikey (Primary: user:mikey, Deprecate: agent:mikey)
  await migrateTimeline("agent:mikey", "user:mikey", acmi);

  // 2. Resolve Claude (Primary: agent:claude-engineer, Deprecate: user:claude-engineer)
  await migrateTimeline("user:claude-engineer", "agent:claude-engineer", acmi);

  // 3. Fix 'list' collision (ratified as bug)
  console.log("🧹 Deleting spurious acmi:user:list...");
  await acmi.profile.delete("user:list"); // This will delete signals and timeline too if they exist via adapter.DEL
  // The adapter's profileDelete might only del the profile key. Let's be thorough.
  const redis = (adapter as any).cmd.bind(adapter);
  await redis("DEL", "acmi:user:list:profile", "acmi:user:list:signals", "acmi:user:list:timeline");
  await redis("SREM", "acmi:user:list", "list");

  console.log("✨ Migration complete.");
  process.exit(0);
}

async function migrateTimeline(from: string, to: string, acmi: any) {
  console.log(`📦 Migrating ${from} -> ${to}...`);
  
  const events = await acmi.timeline.read(from);
  if (events.length === 0) {
    console.log(`  (No events in ${from})`);
  } else {
    console.log(`  Found ${events.length} events. Appending to ${to}...`);
    for (const ev of events) {
      // Use batch for efficiency? For migration, one-by-one is safer for logging.
      await acmi.timeline.append(to, ev);
    }
  }

  console.log(`  Deleting ${from}...`);
  // Thorough delete
  const adapter = acmi.adapter;
  const redis = (adapter as any).cmd.bind(adapter);
  const prefix = `acmi:${from.split(':')[0]}:${from.split(':')[1]}`;
  await redis("DEL", `${prefix}:profile`, `${prefix}:signals`, `${prefix}:timeline`);
  await redis("SREM", `acmi:${from.split(':')[0]}:list`, from.split(':')[1]);
}

main().catch(err => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
