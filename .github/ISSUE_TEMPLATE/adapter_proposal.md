---
name: Adapter proposal
about: Propose a new ACMI adapter for an unsupported backend
title: "[adapter] "
labels: adapter
---

**Backend**
e.g. DynamoDB, Cloudflare KV, FoundationDB, …

**Why this backend?**
- Edge-compat? yes/no
- Existing user base?
- Pricing tier that's free/cheap for hobby use?

**Storage shape**
How would you map the three slots (Profile, Signals, Timeline) to this backend's primitives?

| Slot | Storage shape | Notes |
|---|---|---|
| Profile | | |
| Signals | | |
| Timeline | | |

**Conformance**
Have you read `CONTRIBUTING.md` and the conformance suite at `src/testing/conformance.ts`? Any tests you anticipate failing?

**Maintenance**
Are you committing to maintain this adapter long-term, or is this a "feel free to take it from here" contribution?
