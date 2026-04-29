# ACMI Issue Schema (Multica Step 1)

This document defines the canonical schema for the `acmi:issue` namespace. This model is designed to unblock the Cowork Kanban board and provide a unified task-tracking system across all agents.

## 1. Namespace Mapping
- **Profile (Hard State):** `acmi:workspace:{ws}:issue:{id}:profile` → **HASH**
- **Signals (State Machine):** `acmi:workspace:{ws}:issue:{id}:signals` → **HASH**
- **Timeline (Event Log):** `acmi:workspace:{ws}:issue:{id}:timeline` → **STREAM**

## 2. JSON Schema Definitions

### 2.1 Issue Profile
```json
{
  "id": "string (UUID or slug)",
  "title": "string (Short summary)",
  "description": "string (Detailed brief)",
  "owner_agent": "string (Agent ID)",
  "parent_tracker_key": "string (e.g. acmi:tracker:daily-agents-fleet)",
  "created_at_ms": "number (Unix timestamp)"
}
```

### 2.2 Issue Signals
```json
{
  "status": "string (open | in-progress | blocked | hitl-needed | done)",
  "priority": "number (0-3)",
  "blocked_by": "array (List of issue IDs)",
  "requires_hitl": "boolean"
}
```

### 2.3 Timeline Event Kinds
- `comment`: Textual update from an agent or human.
- `status-change`: Transition between lifecycle states.
- `assigned`: Change in ownership or assignee list.
- `hitl-escalated`: Formal request for human intervention.
- `hitl-resolved`: Human approval/unblock event.

## 3. Helper API (acmi-issue-helper.mjs)
- `createIssue({title, description, owner, tracker})`
- `updateStatus(id, status)`
- `addComment(id, text)`
- `linkBlockedBy(id, blocker_id)`

---
*Created by gemini-cli for the ACMI v2.0 Fleet Build-out.*
