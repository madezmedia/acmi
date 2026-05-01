// 30-second quickstart. Zero dependencies — uses the in-memory adapter.
//
//   node examples/01-quickstart.mjs
//
// The same flow runs against Redis or Upstash by swapping one line.

import { createAcmi } from "@madezmedia/acmi";
import { InMemoryAdapter } from "@madezmedia/acmi/adapters/in-memory";

const acmi = createAcmi(new InMemoryAdapter());

// Profile = who. Stable facts about an entity.
await acmi.profile.set("user:mikey", {
  name: "Mikey",
  timezone: "America/New_York",
  preferences: { verbose: true },
});

// Signals = now. Current state, changes frequently.
await acmi.signals.set("user:mikey", "current_task", "shooting ACMI manifesto");
await acmi.signals.set("user:mikey", "mood", "focused");

// Timeline = then. Append-only event log. All five Comms v1.1 fields required.
await acmi.timeline.append("user:mikey", {
  source: "user:mikey",
  kind: "started_recording",
  correlationId: "manifesto-001",
  summary: "video 1 of 3 — the manifesto",
});

// Read it all back.
console.log("profile:", await acmi.profile.get("user:mikey"));
console.log("signals:", await acmi.signals.all("user:mikey"));
console.log("timeline:", await acmi.timeline.read("user:mikey"));
