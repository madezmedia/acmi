# 0004 — Hosted confirmation: hosted multi-tenant memory API as v1

**Status:** proposed, waiting on the operator · **Date:** 2026-10-10 · **cid:** `logmemPhase0Briefs-1791628200000`

## Decision

Confirm that LogMem v1 is a **hosted, multi-tenant memory API that manages its own storage**, with the console as the proof that it works. Also confirm what self-hosters keep.

## Where we actually are (read 2026-10-10)

The hosted surfaces today run on the customer's own Redis, not on storage we manage:

- **Hosted MCP** (`acmi-product.vercel.app/api/mcp`): tenant isolation comes from the customer supplying *their own* Upstash credentials. These arrive through the Smithery base64 config or per-token OAuth credentials (`api/_lib/redis.mjs`, `auth.mjs`). Our only tenant is `madez`.
- **Console**: each org stores *its own* Upstash URL and token in Supabase (`acmi_connections`). The token is stored as plaintext.

v1 as decided means we run the store: keys of the form `acmi:{workspace}:{ns}:{id}:{slot}`, API keys, metering, quotas. That changes the data model and the trust model, which is why this brief exists.

## Recommendation

**Yes: hosted managed-store API for v1, and keep the bring-your-own-Redis mode as a free path.**

1. **v1 = a managed workspace on our Redis.**
   - Workspace-scoped API keys, with the workspace resolved from the key and never from the request body.
   - Keys prefixed with the workspace.
   - Metering on adds and retrievals from the first request.
2. **Keep bring-your-own-Redis mode working.** The hosted MCP keeps accepting customer Upstash credentials, with no managed storage, no metering, and no SLA. It costs us almost nothing, and nothing self-hosters rely on is removed.
3. **Self-host keeps everything MIT:** SDK, stdio MCP, CLI, conformance, all adapters, single-tenant use. It gains no orgs, SSO, metering or hosted recall (see 0003).

## Cost model (list prices checked 2026-10-10; estimates, not quotes)

**Redis (Upstash pay-as-you-go)**

| Item | List price |
|---|---|
| Commands | $0.20 per 100K |
| Storage | $0.25/GB, first 1 GB free |
| Bandwidth | free up to 200 GB/month |
| Fixed plans | $10/month (250 MB) up to $1,500/month (500 GB) |

**Per metered operation:**
- **Add:** ZADD + signal SET + idempotency SET + meter INCR ≈ **4 commands**.
- **Retrieval:** read + meter INCR ≈ **2–4 commands**.

| Volume | Redis command cost | Storage cost |
|---|---|---|
| 1M ops/month | **≈ $8/month** | at ~1 KB/event, ≈ 1 GB, about $0–0.25/month |
| 10M ops/month | ≈ $80/month | — |

At 10M ops/month, check a fixed plan or self-hosted Redis instead.

**Other costs**

| Item | Estimate |
|---|---|
| **Semantic recall (Qdrant)** | Dev on the Qdrant Cloud free tier (1 GB RAM / 4 GB disk, single node). Production on the Elestio-hosted Qdrant already planned. **Needs a sizing pass** (vectors × dimensions × replicas) before pricing. |
| **Embeddings** | One embedding call per timeline add; this is the largest variable cost. **Measure it in Phase 2** before any tier numbers. |
| **Vercel functions** | Measure on preview. |

**Implication for pricing (your call, numbers TBD):** at roughly $8 per million Redis ops, embeddings plus Qdrant set the floor price, not Redis. Meter adds-with-embedding and plain adds separately.

## Conflict to resolve before Phase 2

The "Decided" list says Qdrant **payload filtering = multi-tenant isolation**. Phase 2 step 2 says **a Qdrant collection per workspace**. These contradict each other.

**Recommendation:** one collection, with an indexed `workspace_id` payload marked as the tenant key, and every query forced to filter on the workspace taken from the API key.

| Approach | Fits | Drawback |
|---|---|---|
| One collection, filter by `workspace_id` | Many small tenants | — |
| Collection per workspace | Only a few large tenants | Overhead grows with tenant count |

## Prerequisites (in place or needed)

| Prerequisite | Status |
|---|---|
| Legacy-key and `WRONGTYPE` tolerance | Merged in `acmi-product` (#60, 2026-10-08) |
| Timestamp unit normalization (ms vs ns vs s) | Still needed before metering and run state can be trusted |
| Encrypt stored customer Redis tokens | Needed before any onboarding |
| CI deploys to prod | Make manual-approval (see 0003) |

## Trade-offs

| | Managed store (recommended) | Bring-your-own-Redis only |
|---|---|---|
| Onboarding | API key and go | Customer must set up Upstash first |
| Revenue | Metered, natural tiers | Hard to charge for |
| Our liability | We hold customer data: retention, deletion and security become ours | Minimal |
| Effort | Phase 2 as written | Mostly exists today |

## What it unblocks

Phase 2 can start: workspace keys, prefixing, Qdrant dual-write, metering middleware, deploy to preview only.

## Operator question

> **Confirm v1 is a hosted managed-store API (with a single Qdrant collection filtered by `workspace_id`), while keeping bring-your-own-Redis mode and all MIT self-host capabilities unchanged?** (yes / no)

---
Sources: [Upstash Redis pricing](https://upstash.com/pricing/redis.md) · [Qdrant free tier summary (costbench, verify on qdrant.tech before relying on it)](https://costbench.com/software/vector-databases/qdrant/free-plan/)
