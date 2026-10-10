# 0001 — Repo rename: `acmi` → `logmem`

**Status:** proposed, waiting on the operator · **Date:** 2026-10-10 · **cid:** `logmemPhase0Briefs-1791628200000`

## Decision

Should the protocol repo `madezmedia/acmi` be renamed to `madezmedia/logmem`? If so, should the product repos (`acmi-console`, `acmi-product`, `acmi-skill`) follow, and in what order?

## What the repos show (read 2026-10-10)

| Repo | Files mentioning "acmi" | Occurrences | Public identifiers tied to the name |
|---|---|---|---|
| `acmi` | 55 | 1,191 | `package.json` repository URLs, README badges, examples, SPEC links, `mcp/smithery.yaml` |
| `acmi-product` | 138 | 1,969 | hosted MCP at `acmi-product.vercel.app/api/mcp`, Smithery listing, OAuth metadata |
| `acmi-console` | 51 | 723 | `acmi-console.vercel.app`, CI QA base URL |
| `acmi-skill` | 41 | 1,001 | MCP Registry `io.github.madezmedia/acmi-mcp`, plugin name `acmi` |

A GitHub rename redirects web URLs, git remotes and API calls, so external links keep working. The redirect breaks only if a new repo is later created under the old name. Vercel project names, `*.vercel.app` hostnames, Smithery and MCP Registry entries do **not** follow a GitHub rename; each has to be changed by hand.

## Recommendation

**Do not rename the protocol repo. Rename only the product console, and only after the trademark knockout clears.**

1. **Keep `madezmedia/acmi`.** The LogMem brand book defines ACMI as the open protocol ("Powered by ACMI"; never the headline). The protocol repo, SPEC, SDK, CLI, MCP server and conformance suite are protocol surfaces. Renaming them to the product name merges the two layers that the open-core story depends on: "ACMI is MIT and yours; LogMem is the hosted product". The "Show HN" link should go to the protocol repo under its protocol name, with a LogMem line at the top of the README.
2. **Rename `acmi-console` to `logmem-console`** once the knockout search is clean. It is the commercial chassis (see brief 0003).
3. **Leave `acmi-product` as is for now.** It mixes the marketing site, the hosted MCP and fleet-only endpoints. Split it first (0003), then name the pieces.
4. **Leave `acmi-skill` as is.** Skill and tool names stay `acmi_*` under the naming rule.

## Trade-offs

| | Keep `acmi` (recommended) | Rename to `logmem` |
|---|---|---|
| Brand clarity | Protocol and product stay distinct; open-core boundary is legible | One name everywhere, but "LogMem protocol" competes with "LogMem product" |
| Trademark risk | None until the product launches | The repo is public under an uncleared mark; if the knockout fails, it must be renamed twice |
| Link breakage | None | Low (GitHub redirects), but Vercel, Smithery and MCP Registry need manual edits |
| HN optics | "ACMI: open protocol, by the LogMem team" reads as a protocol launch | Reads as a product launch, so it is judged as one |
| Effort | 0 | About 1,200 string edits in `acmi`, plus downstream package and doc updates |

## Risks if renamed anyway

- The name is public before clearance.
- `acmi` must never be re-created as a new repo, or the redirect stops working.
- The npm scope decision (0002) is forced at the same time.

## What it unblocks

Phase 1 can start on the README landing page, quickstart and MCP schema work without waiting on trademark clearance.

## Operator question

> **Keep the protocol repo named `acmi`, and rename only `acmi-console` → `logmem-console` once the trademark knockout is clean?** (yes / no)
