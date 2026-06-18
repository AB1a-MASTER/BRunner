# Specification 03 — Studio Graph UX

## Goal

Replace the hard-coded sequential editor with an n8n-inspired React Flow Studio driven by the canonical node registry.

## Technical foundation

Use React, React Flow, and Vite. The build emits extension-safe static assets; background and content-script architecture remains unchanged.

## Workflow schema v2

```json
{
  "schemaVersion": 2,
  "id": "workflow-id",
  "name": "Workflow Name",
  "boundDomain": "example.com",
  "settings": { "recording": { "tabPolicy": "openerDescendants" } },
  "variables": {},
  "entryNodeId": "node-1",
  "nodes": [],
  "edges": []
}
```

Nodes contain `id`, `type`, `version`, position, and configuration. Edges contain source, source handle, target, and target handle.

Initial v2 execution permits one success path. Conditions, loops, and merge semantics are deferred to Milestone 4.

## Compatibility and migration

- Load v1 `steps` workflows through an adapter without modifying the source file.
- Convert only through an explicit **Upgrade to v2** action.
- The native host atomically creates a `.v1.bak` backup before replacing the workflow.
- Failed upgrades leave the original untouched.

## Studio behavior

- Palette generated from node definitions.
- Drag/drop creation, connection handles, pan/zoom, selection, keyboard deletion, and node reordering through edges.
- Right-side properties panel generated from node configuration schemas.
- Inline validation and prevention of invalid saves/runs.
- Workflow manager, recording controls, and connection state remain available.
- Live run state highlights the active node and appends structured logs.
- A Variables/Data Inspector lists seed variables and live run values with origin node, type, search, and expression-copy actions.
- Structured values use expandable object views plus dedicated list/table previews and copy/export controls.
- Extraction nodes show last-run output samples and expose contextual configuration rather than every field at once.

## Acceptance tests

Verify v1 read-only loading, upgrade backup/rollback, graph editing, save/reload fidelity, node configuration rendering, invalid graph detection, keyboard and pointer interactions, execution highlighting, and extension CSP-compatible production builds.
