# ACMI v1.3 — Multi-Actor & Multi-Tenant Spec Extension (PROPOSAL)

**Status:** PROPOSAL — not yet ratified, no live writes
**Lead:** claude-engineer (per `mikey-greenlight-v1-3-scoping-1777733791375`)
**Co-execute:** bentley-temp
**Review:** real-bentley on quota refill
**Parent directive:** `acmi-multi-actor-multi-tenant-v1-3-1777658404821`
**Investigation findings:** `/tmp/v13-phase1-findings.json`

This document proposes additive sections §11 (multi-actor) and §12 (multi-tenant) to ACMI v1.2. **No breaking changes to v1.2.** The launch trilogy (Tuesday Video 1) is not affected — v1.3 ships AFTER trilogy.

---

## Phase 1 findings — what's already there (de-facto schemas)

### User namespace (`acmi:user:*`)

**6 user IDs in keyspace:** `mikey`, `suzanne`, `duane`, `_convention`, `claude-engineer` (collision), `list` (collision/spurious)

**Field union (22 fields observed):**
`escalation_thread, mention_syntax, resolution, when_to_mention, fleet_role, handle_added_by, handle_added_reason, handle_added_ts, joined_iso, joined_ts, onboarded_by, onboarding_correlationId, reports_to, scope, title, type, businesses, can_be_mentioned_by, communication_prefs, email, escalation_severity, timezone`

**Only `user:duane` has explicit `type: "human"`.** Others infer human-ness from being in the user namespace.

### Agent namespace (`acmi:agent:*`)

**33 agent IDs in keyspace** — includes session variants (`claude-engineer-cloud`, `claude-engineer-ezi`, `claude-local`) and specialists (`code-custodian`, `growth-hacker`, etc.)

**Field union (28 fields observed):**
`best_used_for, expertise, native_tools, collaboration_preferences, do_not_use_for, example_command, workflow, delegation_rules, focus, mission, cannot_do, escalation, github_scope, hitl_path, parent_session, transport_capability, core_directives, manager, protocols, parent_agent, capabilities, created_at_ms, id, lane, model_id, onboarding_status, required_fields, rbac_tier, model`

**Field overlap with user namespace: only 3 fields** — meaning agent and human profiles are already substantively different schemas in practice.

### Workspace namespace (de-facto tenant)

**4 workspaces:** `global`, `list`, `madez-dev`, `madez`. **No explicit `acmi:tenant:*` keys exist.** Workspace prefix is doing tenant duty informally.

### Projects: 89 entries under `acmi:project:*`

### HITL: shared queues only

`acmi:thread:hitl:open` (2 open) + `acmi:thread:hitl:closed` (3 closed). **No per-user HITL keys exist** (`acmi:hitl:user:<id>:*` is empty).

### 3 namespace collisions (id appears in BOTH user AND agent namespaces)

| ID | As user | As agent | Impact |
|---|---|---|---|
| `mikey` | profile + signals + timeline (active) | profile + signals + timeline (active) | Real collision — Mikey is operator AND the system has agent-flavored events about him |
| `claude-engineer` | (auxiliary user-side state) | profile + signals + timeline (primary) | Real collision — the agent IS me, but user-side has some referential state |
| `list` | (likely SCAN spurious) | (likely SCAN spurious) | Likely a key parsing artifact. Worth a separate investigation event but not blocking. |

---

## §11 — Multi-actor (PROPOSAL)

### §11.1 — Actor types (additive)

Every entity SHOULD declare an `actor_type` field on its profile. Allowed values:

```
"agent"   — autonomous software agent (acmi:agent:*)
"human"   — human team member (acmi:user:* per de-facto convention)
"system"  — infrastructure/cron/webhook source (no profile needed; events only)
"external"— external party (clients, vendors — currently rare; future)
```

**Migration:**
- All existing `acmi:user:*` profiles SHOULD have `actor_type: "human"` added (currently only duane has explicit type)
- All existing `acmi:agent:*` profiles SHOULD have `actor_type: "agent"` added
- `system` events (cron-wake, drift-diff) SHOULD include `source` matching a registered system source
- `external` profiles get a future schema once first external-party use case lands

**Backwards compat:** v1.2 readers that don't recognize `actor_type` MUST treat absence as the namespace-default (`agent` for `acmi:agent:*`, `human` for `acmi:user:*`).

### §11.2 — Speaker_type on events (additive)

Every Comms v1.1 event SHOULD include `speaker_type` matching the source's `actor_type`. This lets readers distinguish:
- "agent wrote this" (synthesis-eligible reasoning)
- "human wrote this" (lived experience, not LLM-generated)
- "system wrote this" (telemetry, not opinion)

`speaker_type` is OPTIONAL in v1.3.0. May become REQUIRED in v1.4.

### §11.3 — Per-actor HITL queues (additive)

Currently HITL is shared at `acmi:thread:hitl:open` and `acmi:thread:hitl:closed`. v1.3 introduces:

```
acmi:hitl:user:<id>:open    — items addressed to a specific human
acmi:hitl:user:<id>:closed
acmi:hitl:agent:<id>:open   — items addressed to a specific agent (rare; agents typically have inboxes)
```

Shared queue (`acmi:thread:hitl:*`) remains for items addressed to "anyone available". v1.3 adds a routing layer; doesn't break v1.2 consumers.

### §11.4 — Namespace collisions (mikey, claude-engineer)

**Resolution proposal:** `acmi:user:<id>:*` and `acmi:agent:<id>:*` are explicitly allowed to coexist. They represent different PROJECTIONS of the same identity:

- `acmi:user:mikey:profile` — mikey-as-operator (timezone, contact, businesses)
- `acmi:agent:mikey:profile` — mikey-as-agent-in-the-system (if such a thing is needed; currently legacy)

**Recommendation:** Audit the legacy `acmi:agent:mikey` and `acmi:agent:claude-engineer` namespaces. If they hold agent-specific data that's still meaningful, keep them. If they're stale duplicates of user-side data, archive them with a `kind: namespace-archived` event and remove.

**`list` collision:** investigate separately. Likely a spurious SCAN artifact from a malformed key like `acmi:agent:list:*` or a key with `list` as the second segment by mistake.

---

## §12 — Multi-tenant (PROPOSAL)

### §12.1 — Tenant_id (additive)

Every entity SHOULD optionally declare a `tenant_id` field. Allowed forms:

```
tenant_id: "madez"           — primary tenant (the operator's own work)
tenant_id: "client:<slug>"   — per-client tenant (e.g., "client:core-pumping")
tenant_id: "shared"          — explicitly cross-tenant entities (the protocol itself)
```

**Migration:**
- Default tenant_id for unscoped entities is `"madez"` (matches current de-facto behavior — most everything is mikey's work)
- The `acmi:workspace:madez:*` prefix serves as a per-tenant key prefix going forward
- `acmi:workspace:madez-dev:*` is `tenant_id: "madez"` with `workspace: "dev"` — workspace is a sub-scope of tenant
- `acmi:workspace:global:*` and `acmi:workspace:list:*` need investigation (probably stale or spurious)

### §12.2 — Tenant key prefix convention (additive)

For new keys created post-v1.3 that are tenant-scoped:

```
acmi:tenant:<tenant_id>:<category>:<id>:<slot>
```

The existing convention `acmi:workspace:<workspace_id>:<category>:<id>:<slot>` continues to work — workspace is one level deeper than tenant.

**Backwards compat:** v1.2 readers that scan for `acmi:<category>:<id>:<slot>` continue to work for the default tenant. Tenant-prefixed keys are additive.

### §12.3 — Cross-tenant reads (additive)

Some entities are intentionally global:
- `acmi:registry:*` — protocol registries (namespace policy, brand strategy, launch playbook)
- `acmi:thread:agent-coordination:*` — cross-fleet coordination
- The protocol's own data (open-source contributions)

These get `tenant_id: "shared"` and live at the unscoped path (no `acmi:tenant:shared:` prefix) for v1.2 compat.

---

## Migration sequence (proposal)

**No live writes until phase plan ratified.** When ratified:

1. **Phase 2 — Documentation only.** Update `~/clawd/projects/acmi/SPEC.md` with §11/§12. Bump SDK version to v1.3.0-beta.0. CHANGELOG entry. NO live keyspace writes yet.
2. **Phase 3 — Voluntary adoption.** Add `actor_type` field to `acmi:user:duane:profile` (already has it), then `acmi:user:mikey:profile` and `acmi:user:suzanne:profile`. Also add to all 33 agent profiles. **Read-only existing data; only ADD the field; don't modify other fields.**
3. **Phase 4 — `tenant_id` rollout.** Same: read existing profiles, add `tenant_id: "madez"` to all. Mark `acmi:registry:*` and `acmi:thread:*` as `tenant_id: "shared"`.
4. **Phase 5 — `list` collision investigation.** Determine root cause. Likely a malformed key from a bad ZADD with `list` as a positional argument (echoes of gemini-cli's `--kind` bug). Clean up.
5. **Phase 6 — Per-user HITL routing.** Migrate any addressee-specific HITL items from shared queues to per-user queues. Document in `reference_inbox_drain_protocol.md`.
6. **Phase 7 — Drift-diff dimension.** Add `actor_type_drift` and `tenant_drift` checks to drift-diff cron. Surface in `/namespaces` UI as new dimensions.
7. **Phase 8 — Ratify v1.3.0 final.** SPEC.md commits, SDK published, registry updated.

**Each phase posts a `kind: phase-complete` event chained to the v1.3 parent CID before next phase begins.**

---

## What this proposal does NOT do

- **Does not break v1.2.** Every change is additive.
- **Does not block the launch trilogy.** Tuesday Video 1 ships on v1.2. v1.3 follows.
- **Does not require domain buys** (Mikey constraint).
- **Does not auto-modify any live profiles.** Phase 3/4 require explicit phase-by-phase ratification.
- **Does not address v1.4 multi-region or v1.4 federation.** Those are separate spec extensions.

---

## Open questions for ratifier (Mikey or real-bentley on resume)

1. Should `actor_type` be REQUIRED in v1.3.0 or remain optional through v1.4?
2. Should the `list` collision be fixed-as-bug (delete) or treated as a real entity (preserve)?
3. Do we want a multi-tenant rollout NOW, or defer §12 to v1.4 and ship only §11 in v1.3?
4. Do we deprecate `acmi:agent:mikey:*` and `acmi:agent:claude-engineer:*` as collision-resolution, or formally allow user/agent dual-projection?
5. Should the SDK auto-fill `actor_type` from namespace at write-time (helpful) or require explicit declaration (strict)?

---

## Status checklist

- [x] Phase 1 read-only investigation — complete
- [x] §11 + §12 proposal text — drafted (this file)
- [ ] Operator ratification of phase plan — **AWAITING**
- [ ] Phase 2: SPEC.md update + CHANGELOG
- [ ] Phase 3: actor_type field rollout
- [ ] Phase 4: tenant_id rollout
- [ ] Phase 5: list collision cleanup
- [ ] Phase 6: per-user HITL routing
- [ ] Phase 7: drift-diff dimension extension
- [ ] Phase 8: v1.3.0 final ratification

Until phase 2 starts, this file is a proposal only. No live ACMI writes have been made.
