# LogMem Phase 0: decision briefs

These are the four briefs. Phase 1 does not start until the operator answers all four.

| # | Brief | Operator question (yes/no) |
|---|---|---|
| 0001 | [Repo rename](0001-repo-rename.md) | Keep the protocol repo named `acmi`; rename only `acmi-console` → `logmem-console` after the trademark knockout clears? |
| 0002 | [npm scope](0002-npm-scope.md) | Keep the MIT packages on `@madezmedia/*`, reserve the `@logmem` org now, and use `@logmem/*` only for the new hosted client after clearance? |
| 0003 | [Open-core boundary](0003-open-core-boundary.md) | Approve the four buckets: protocol MIT unchanged, console private, new hosted work in a private `logmem-cloud`, and fleet-only code plus the paid zip out of the public `acmi-product`? |
| 0004 | [Hosted v1](0004-hosted-v1.md) | v1 = a hosted managed-store API on a single Qdrant collection filtered by `workspace_id`, keeping bring-your-own-Redis mode and all MIT self-host capabilities? |

## Found during the read (to fix whatever the answers are)

Each of these needs operator approval, because each one is a push, publish, or visibility change.

1. **The paid Starter Kit zip is in a public repo:** `acmi-product/deliverables/acmi-starter-kit-v1.1.zip`.
2. **Live fleet data is publicly readable.** Unauthenticated read endpoints in `acmi-product/api` (events, fleet, comms, work, chain, …).
3. **`acmi-console` has no LICENSE file and is public.** Its CI deploys to production. It also stores customer Upstash tokens as plaintext.
4. **Leftover fleet values in the public protocol repo.** `acmi/src/client.ts` defaults `tenant_id` to `"madez"`, and `mcp/smithery.yaml` shows the fleet bridge URL and its default token string.
5. **Committed `.env.local` in `acmi-product`.** The secret variables are empty. One Vercel dev OIDC token is present, but it expired 2026-05-16. Delete the file and gitignore it.
6. **Version drift.** npm `@madezmedia/acmi` is 1.2.0 while `main` is 2.0.0, and the MCP Registry pins 1.4.0.

**Verified:** SDK tests pass, 36 passed and 3 skipped. The redis and upstash adapter tests are skipped because no credentials are present. The `parentCorrelationId` slot already exists on `acmi_event`, in MCP 2.0.3 and the hosted route, so Phase 1 step 4 only needs SPEC and sibling-tool parity.

**Still open:** trademark clearance for "LogMem", pricing tiers and numbers.
