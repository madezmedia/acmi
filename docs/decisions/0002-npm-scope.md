# 0002 — npm scope: stay `@madezmedia/*` or move to `@logmem/*`

**Status:** proposed, waiting on the operator · **Date:** 2026-10-10 · **cid:** `logmemPhase0Briefs-1791628200000`

## Decision

Should the published packages stay under `@madezmedia/*`, or move to a new `@logmem/*` scope?

## What the registry shows (npm, checked 2026-10-10)

| Package | npm latest | Repo version | Versions | Downloads (last month) |
|---|---|---|---|---|
| `@madezmedia/acmi` | **1.2.0** | **2.0.0 (unpublished)** | 1 | 10 |
| `@madezmedia/acmi-mcp` | 2.0.3 | 2.0.3 | 6 | 356 |
| MCP Registry `io.github.madezmedia/acmi-mcp` (`acmi-skill/server.json`) | pins **1.4.0** | — | — | — |

- `logmem`, `@logmem/core`, `@logmem/sdk` and unscoped `acmi` return "not found" as packages.
- Whether the **npm org** `logmem` is free could not be checked from here (npm answered 403).
- **Version drift:** the SDK in `main` (2.0.0) is not on npm. The MCP Registry entry points at an MCP version three releases old.

## Recommendation

**Stay on `@madezmedia/*` through launch. Reserve the `@logmem` npm org now as a holding action. Publish under `@logmem/*` only for the new hosted client, and only after trademark clearance.**

- The MIT packages are protocol packages. Under 0001 they keep the ACMI name, so `@madezmedia/acmi` and `@madezmedia/acmi-mcp` stay where they are. There are no migration costs and no broken installs.
- The hosted API (Phase 2) will need a thin client: API key, workspace, metering headers. It is a new package with no installed base. If it launches as `@logmem/client`, the scope arrives with the product and nothing has to be migrated.
- Reserving the org costs nothing on npm and prevents squatting. Creating it is still an outbound account action, so it needs your yes.

## Trade-offs

| | Stay `@madezmedia/*` (recommended) | Move everything to `@logmem/*` |
|---|---|---|
| Existing users | Nothing changes (356 MCP installs/month) | Every install line, Smithery config, MCP Registry entry, skill doc (1,001 mentions in `acmi-skill`) and example has to change |
| Migration mechanics | — | Publish under the new name, `npm deprecate` the old one with a pointer, and keep both for one or more minor versions |
| Brand | The publisher name stays visible; it reads as an organization, which is fine for a protocol | Product name in every `import` |
| Trademark | No exposure | Public packages under an uncleared mark |

## Required regardless of the decision (HITL: npm publish)

1. Publish `@madezmedia/acmi@2.0.0` so npm matches `main`, or roll `main` back to 1.x semantics.
2. Bump `acmi-skill/server.json` to the current MCP version and re-submit it to the MCP Registry.

## What it unblocks

- Phase 1 install docs and the 5-minute quickstart can use stable package names.
- Phase 2 has a namespace for its client package.

## Operator question

> **Keep the MIT packages on `@madezmedia/*`, reserve the `@logmem` npm org now, and use `@logmem/*` only for the new hosted client after the trademark clears?** (yes / no)
