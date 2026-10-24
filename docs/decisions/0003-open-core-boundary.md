# 0003 — Open-core boundary (file by file)

**Status:** proposed, waiting on the operator · **Date:** 2026-10-10 · **cid:** `logmemPhase0Briefs-1791628200000`

## Decision

What stays MIT, what becomes commercial, and what is fleet-internal and should leave the public repos?

**Fixed rule (already decided):**
- **MIT:** protocol, SDKs, MCP server, CLI, single-tenant self-host.
- **Commercial:** SSO/RBAC/audit, multi-tenancy/orgs, hosted control plane, retention/billing.

**Constraint:** nothing self-hosters have today is removed or gated. Code that is already published under MIT stays MIT at those commits; that cannot be revoked. "Commercial" here means *future development* happens in a private repo.

## Recommendation: four buckets

| Bucket | Where it lives | License |
|---|---|---|
| **A. Protocol** | `madezmedia/acmi`, `madezmedia/acmi-skill` | MIT (unchanged) |
| **B. Public site and demo** | `acmi-product` (marketing), later `logmem-site` | MIT code; brand assets reserved |
| **C. Commercial** | new private `logmem-cloud` + `acmi-console` (made private) | Proprietary |
| **D. Fleet-internal** | private fleet repo (next to `cowork-kanban`) | Private, not product |

## File by file

### `acmi` (public, MIT): all of it stays MIT

| Path | Bucket | Note |
|---|---|---|
| `src/**` (client, types, adapters in-memory/upstash/redis, testing) | A | Core SDK. **Fix:** `src/client.ts:236` defaults `tenant_id` to `"madez"`. It should default to `"default"` (or require a value) before the HN launch, because self-hosters should not inherit our tenant. |
| `mcp/**` (stdio MCP server, tests) | A | Keep. **Fix, done 2026-10-21:** the hardcoded bridge bearer is gone from `mcp/`. The token now resolves from the environment only, and the server fails closed when a bridge URL has no token. `mcp/smithery.yaml` and `mcp/README.md` carry placeholders. **Still open:** `mcp/smithery.yaml` documents our fleet bridge hostname. That is an infra detail, not a secret, and it needs a separate decision. |
| `cli/acmi.mjs`, `cli/conformance.mjs`, `cli/drift-diff.mjs`, `cli/invite-agent.mjs` | A | Keep. `conformance` needs `npm run build` first; the quickstart has to say so. |
| `cli/rollup-cron.mjs`, `cli/standup-brief.mjs` | A | Generic utilities; keep MIT. |
| `cli/quota-monitor.mjs` (reads `ZAI_WEEKLY_CAP`) | D | Fleet-specific. Move it out, or generalize it. |
| `SPEC.md`, `SPEC-v1.3-PROPOSAL.md`, `docs/ACMI-PROTOCOL-v1.2.md`, `docs/ACMI-CHEATSHEET.md`, `docs/SKILL.md`, `docs/acmi-issue-schema.md`, `MANIFESTO.md`, `ROADMAP.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` | A | Keep. ROADMAP should name the commercial line plainly. |
| `docs/OPERATOR-GUIDE.md` | A or D | Review for fleet hostnames before HN. |
| `examples/**` | A | Keep. `06-openclaw-integration.mjs` needs a review for fleet specifics. |
| `scripts/migrate-v1.3.ts` | A | Keep. |
| `scripts/issues-watcher.ts`, `scripts/song-catalog-schema.ts` | D | Not protocol. Move out. |
| `assets/**` | A (code) / trademark (marks) | Add a `TRADEMARKS.md`: the MIT license covers the code, not the logos or the names. |

### `acmi-skill` (public, MIT): all of it stays MIT

| Path | Bucket | Note |
|---|---|---|
| `skill/**`, `evals/**`, `.claude-plugin/**`, `dist/*.skill`, `server.json`, `scripts/publish-to-mcp-registry.sh` | A | Keep. `server.json` pins MCP 1.4.0 and is stale (see 0002). |

### `acmi-product` (public, MIT): split three ways

| Path | Bucket | Note |
|---|---|---|
| `*.html`, `*.jsx`, `deck*`, `brand/**`, `frameworks-demo/**`, `docs/**`, `ACMI-WORKFLOWS.md`, `.well-known/mcp/server-card.json` | B | Marketing site and demos. Stay public. |
| `api/mcp.mjs`, `api/oauth/**`, `api/well-known/**`, `api/_lib/{auth,mcp-*,redis*,idempotency,event-shape,acmi-readers}.mjs`, `api/inbox/**` | **C going forward** | This *is* the seed of the hosted control plane (OAuth, per-token tenant credentials, tenant key rewrite, idempotency, inbox). The commits already published stay MIT. New multi-tenant work (Phase 2) goes in `logmem-cloud`. The stdio MCP in `acmi/mcp` keeps self-host fully covered. |
| `api/events, fleet, comms, work, chain, chains, agent/[id], stories, gpu, governance` | B, but **audit first** | These are read endpoints with no auth check. They serve the live fleet dashboard, which means our real fleet timeline is publicly readable. Either put them behind auth, or point them at a DEMO DATA tenant. |
| `api/hitl, decision, directive, transfer, acmi-emit` | D | Authenticated fleet write paths. Move to the fleet repo. |
| `api/{bentley,avery}-voice*`, `api/*vapi-webhook*`, `api/twitter-callback`, `api/whop-webhook*`, `api/_lib/lab-buyer-secrets*` | D | Fleet and Whop business logic. Not protocol, not product. Move out. |
| `deliverables/acmi-starter-kit-v1.1.zip` and folder | **Remove** | This is the **paid** Whop Starter Kit, committed to a public repo. Anyone can download it free. |
| `.env.local`, `.DS_Store` | **Remove** | The committed `.env.local` holds empty secret variables plus one Vercel development OIDC token that expired 2026-05-16. Low risk, but delete the file and add `.env*` to `.gitignore`. |

### `acmi-console` (public, **no LICENSE file**): becomes commercial

| Path | Bucket | Note |
|---|---|---|
| Whole repo: Clerk orgs, Supabase `organizations`, members, `acmi_connections`, admin pages, `src/components/acmi/**` | C | It has never been licensed, so making it private removes nothing that self-hosters were granted. **Recommend making it private before the reskin.** |
| `supabase/migrations/001_initial_schema.sql`: `upstash_token TEXT NOT NULL` | C, **fix before any customer data** | Customer Redis tokens are stored as plaintext. Use Supabase Vault/pgsodium, or a KMS envelope. |
| `.github/workflows/deploy.yml` | C | Deploys to the **production** environment from CI. Make it manual-approval to match HITL rule 1. This is the same failure mode as the 10-06 GSD outage. |

### Out of scope (stay private and internal; not product)

`cowork-kanban` (swarm-os) and `gsd-dashboard-nextjs`. The only thing borrowed is the gsd multi-tenant API routing *pattern*.

## Trade-offs

- **Clean boundary.** Protocol repos stay 100% MIT, so the open story is credible on HN. Commercial value lives in what self-hosters do not need: orgs, SSO, metering, managed storage.
- **Cost.** About a day of moving fleet code out of `acmi-product`, plus a public-endpoint audit. The paid zip and the open fleet reads should be fixed whatever happens to this brief.
- **Fork risk.** Anyone can fork the already-MIT hosted-MCP commits. That is acceptable: the moat is operating it (multi-tenant, metered, managed), not the route code.

## What it unblocks

- Phase 1 README can state the open/commercial line exactly.
- Phase 2 has a home (`logmem-cloud`).
- Phase 3 can build on a private chassis.

## Operator question

> **Approve the four buckets above: protocol MIT unchanged, `acmi-console` goes private as the commercial chassis, new hosted work goes in a private `logmem-cloud`, and fleet-only endpoints plus the paid zip are moved out of the public `acmi-product`?** (yes / no)
