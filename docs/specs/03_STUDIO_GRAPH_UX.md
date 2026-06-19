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

### Graph schema foundation

The non-visual graph foundation is implemented. A deterministic adapter converts
v1 steps into positioned v2 nodes joined by success edges while preserving step
configuration, targets, payloads, page metadata, variables, and settings. The
runtime can adapt a valid v2 graph back to its sequential execution view.

Initial v2 validation deliberately accepts only one complete, acyclic success
path. Branches, merges, cycles, duplicate identifiers, missing nodes, and
disconnected nodes are rejected before execution. The authenticated native host
also exposes an atomic upgrade command that writes the v2 file only after
retaining the original as `<workflow>.json.v1.bak`; existing backups are never
overwritten.

The user-facing Upgrade action remains deferred until the graph-capable Studio
can load and save v2 directly without flattening node positions.

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

### Variables/Data Inspector slice

The first non-graph Milestone 3 slice is implemented and live accepted in the
current Studio. It provides workflow seed variables, safe current-run
summaries, full last-run values, type/size labels, producing-node origin, search,
expression copying, explicit value copying, expandable object/list previews, and
table previews. Shared runtime state broadcasts summaries only; large screenshot,
clipboard, HTTP, and file payloads remain in the direct Studio run response.

Inspector live acceptance:

1. Reload the extension and load `Data Inspector Acceptance`.
2. Open the Data tab before running; confirm `seed_name` and `seed_object` appear.
3. Run the workflow and observe current summaries, then confirm last-run values
   for `scalar_result`, `table_result`, and `message`.
4. Search for `table`, expand the two-row preview, and copy
   `{{table_result}}` using Copy expression.

### Variable authoring and validation slice

The current sequential Studio now validates registry-required fields and target
requirements inline before save or run. Expression fields open an accessible
autocomplete list after `{{`; suggestions include workflow seeds and output
variables produced by earlier nodes only. Unknown or forward variable references
are validation errors, while nested paths such as `{{http_result.data.id}}` are
accepted when their root output is available.

Live acceptance:

1. Load `Data Inspector Acceptance` and add a Template Text node after its data nodes.
2. In Template, type `{{` and confirm seed and earlier output names appear.
3. Use Arrow keys plus Enter or click a suggestion; confirm a complete
   `{{variable_name}}` expression is inserted.
4. Clear the Template field and confirm its inline required error appears.
5. Enter `{{missing_value}}`; confirm the unknown-variable error blocks Save and Run.
6. Replace it with an available variable and confirm the workflow returns to Valid.

### Extraction authoring slice

Extraction nodes now keep selector guidance beside the relevant fields and show
their own last-run output sample directly in the node. List extraction reveals
Attribute Name only when Value Mode is `attribute`; this behavior is declared in
the canonical node registry rather than hard-coded to one form. Structured list
and table samples reuse the safe, bounded Inspector previews.

Live acceptance:

1. Add Extract List and confirm Item CSS Selector explains that it is relative
   to the Target Element.
2. Change Value Mode between `text` and `attribute`; Attribute Name should hide
   and appear without shifting or losing other field values.
3. Run an extraction workflow and confirm the extraction node shows its output
   variable, type, summary, and structured preview.
4. Change the output variable name and confirm the stale sample is not shown
   under the new name.

## Acceptance tests

Verify v1 read-only loading, upgrade backup/rollback, graph editing, save/reload fidelity, node configuration rendering, invalid graph detection, keyboard and pointer interactions, execution highlighting, and extension CSP-compatible production builds.
