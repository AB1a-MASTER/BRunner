# Specification 03 — Studio Graph UX

## Goal

Replace the hard-coded sequential editor with an n8n-inspired React Flow Studio driven by the canonical node registry.

## Technical foundation

Use React, React Flow, and Vite. The build emits extension-safe static assets; background and content-script architecture remains unchanged.

### Graph Studio scaffold

An isolated React 19, React Flow 12, and Vite 8 graph surface now builds to
`BRunner/studio-graph/` with relative, extension-safe assets. The accepted
sequential Studio remains available as the default and links to the scaffold.

The scaffold loads the canonical node registry, supports search, click or drag
node creation, canvas movement, success-handle connections, selection, keyboard
deletion, zoom/minimap controls, and registry-generated property fields.

Scaffold acceptance:

1. Reload the extension and open Graph Studio from the sequential Studio header.
2. Confirm registry nodes appear by category and node search filters them.
3. Drag two nodes onto the canvas and connect the first success handle to the
   second input handle.
4. Move and select a node; confirm its registry fields appear in Properties.
5. Press Delete and confirm the selected node is removed.
6. Confirm Sequential Studio returns to the accepted editor.

### Graph persistence and legacy upgrade

Graph Studio now lists native-host workflows and supports New, Load, Save, and
rename-through-name-editing. Schema-v2 workflows preserve node positions, edges,
configuration, structured targets, variables, settings, execution modes, and
workflow metadata across save/reload.

Schema-v1 workflows open as a clearly marked read-only preview: palette creation,
dragging, connections, deletion, bypass controls, and property edits are locked.
The explicit **Upgrade to v2** action shows the backup filename, invokes the
authenticated atomic host upgrade, and unlocks editing only after success. A
failed upgrade remains read-only and leaves the source untouched.

Persistence acceptance:

1. Create two connected nodes, configure them, move them apart, name the workflow,
   and save it.
2. Load another workflow, then reload the saved graph; confirm positions, edge,
   configuration summaries, bypass state, name, and domain are unchanged.
3. Disconnect a node and confirm Save reports a linear-graph validation error.
4. Load a v1 workflow and confirm every editing surface is read-only.
5. Choose Upgrade to v2, confirm the backup prompt, then verify editing unlocks
   and `<workflow>.json.v1.bak` exists beside the upgraded workflow.
6. Confirm Run executes the validated graph and Stop cancels an active run.

### Canvas organization controls

- Node Library and Properties now use bounded internal scrolling so long lists
  never push controls outside the application viewport.
- Legacy v1 previews are deterministically auto-arranged with enough spacing for
  full node cards instead of reusing obsolete compact-node coordinates.
- Workflow Layout can be Vertical or Horizontal. Arrange reapplies the selected
  direction, updates handle orientation, fits the result, and persists the
  preference in v2 workflow settings.
- Every editable connection has a midpoint remove control in addition to normal
  edge selection plus Delete/Backspace.
- Nodes can be collapsed from their header. Collapsed cards retain node name,
  execution-state indicator, handles, bypass, expand, and remove controls while
  hiding configuration summaries and technical footer. Collapse state persists.

### Canvas navigation and bulk-editing tools

Graph Studio exposes clear pointer modes rather than overloading every drag:

- **Hand/Pan** mode moves the viewport only. Pointer gestures in this mode must
  not move nodes, create or remove connections, change selection, or trigger
  deletion controls. Holding Space may temporarily activate Hand mode.
- **Selector** mode supports single selection, modifier-assisted additive
  selection, and marquee selection on empty canvas space.
- Dragging any selected node moves the complete selected group while preserving
  relative positions and existing connections. Group movement is one undoable
  edit when undo history is introduced.
- The active tool must remain visibly indicated and keyboard accessible. Mode
  switches must not discard the current selection.
- Destructive controls and connection handles must not activate from a pan
  gesture. Delete/Backspace only applies while Selector mode owns canvas focus,
  reducing accidental edits while navigating.

Navigation and bulk-editing acceptance:

1. Select Hand mode and drag across nodes, handles, edges, and empty space;
   confirm only the viewport moves and the workflow remains unchanged.
2. Select Selector mode, marquee several nodes, add/remove one with a modifier,
   then drag the group; confirm relative spacing and connections remain intact.
3. Temporarily pan with Space and return to the prior tool without losing the
   multi-selection.
4. Confirm keyboard focus, tool announcements, and Delete/Backspace safety do
   not allow an accidental edit while Hand mode is active.

### Live graph execution

Graph Studio can run the current validated canvas without requiring a prior save.
Run changes to Stop while execution is active and uses the same authoritative
runtime/cancellation state as Sequential Studio and the sidebar. Editing, saving,
loading, arranging, deleting, and property changes are locked during execution.

Runtime state now identifies the current, completed, and bypassed node IDs. Cards
render distinct accessible states for Running, Completed, Bypassed, Failed, and
Cancelled; collapsed cards retain these indicators. Completion summaries report
executed and bypassed counts. Transient runtime state is excluded from graph
persistence.

The minimap/overview reflects the same live runtime colors as the canvas:
Running, Completed, Bypassed, Failed, and Cancelled nodes update immediately in
the overview, remain distinguishable from ordinary selection, and reset with the
transient runtime state rather than being persisted.

When node execution-precondition metadata is added, Graph Studio should display
compact capability indicators for foreground-tab, visible-target, window-focus,
and hardware-interaction requirements. These indicators should explain why a node
may activate a tab or move/scroll the viewport before execution.

Live execution acceptance:

1. Build a connected graph containing a wait plus an always-bypassed data node.
2. Run it and confirm editing locks, the active node highlights, completed nodes
   turn green, and the bypassed node receives a distinct skipped state.
3. Run a graph with a longer wait, choose Stop, and confirm the active node becomes
   Cancelled and later nodes remain idle.
4. Cause a safe validation/runtime failure and confirm the failing node turns red
   while the header announces the diagnostic.
5. Save after the run and reload; confirm no transient runtime colors are stored.
6. During each runtime state, confirm the corresponding minimap node uses the
   same state color as its full canvas card and returns to idle on the next run.

### Node readability and bypass controls

Graph nodes prioritize the information needed to read a workflow at canvas
level: target, output variable, and up to three relevant configured properties.
Long descriptions moved out of the card, sensitive HTTP/file fields show only
`Configured`, and contextual registry visibility rules are respected.

Each node has a direct remove action and an accessible bypass toggle. Execution
mode is also editable in Properties:

- **Enabled** runs normally.
- **Bypassed** always skips the node while preserving its connections.
- **Conditional bypass** evaluates `Bypass when` immediately before the node;
  true/yes/on/1 skip it and false/no/off/0 execute it. Missing or ambiguous
  expressions fail with diagnostics instead of guessing.

Static bypass is checked before any other node expressions, so a deliberately
disabled node cannot fail because one of its unused configuration variables is
missing. Conditional bypass remains linear-path behavior, not graph branching.

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

The graph-capable Studio now loads and saves v2 directly without flattening node
positions, so the user-facing Upgrade action is enabled with native backup safety.

## Studio behavior

- Palette generated from node definitions.
- Drag/drop creation, connection handles, pan/zoom, selection, keyboard deletion, and node reordering through edges.
- Explicit Hand/Selector tools, guarded navigation gestures, marquee and
  additive selection, and safe group movement.
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

Verify v1 read-only loading, upgrade backup/rollback, graph editing, save/reload fidelity, node configuration rendering, invalid graph detection, guarded Hand/Selector interactions, multi-selection/group movement, canvas and minimap execution highlighting, keyboard behavior, and extension CSP-compatible production builds.

Functional Milestone 3 acceptance is complete. The deterministic suite,
production build, runtime integration checks, and responsive interaction checks
pass. The remaining work in this milestone is the separate user-directed UI/UX
refinement defined below.

## Final user-directed UI/UX refinement

After the functional Milestone 3 acceptance gate, schedule a dedicated visual and
interaction refinement pass across Graph Studio. Do not infer or pre-empt the
desired redesign. When this phase is reached, explicitly ask the user for their
UI/UX priorities, examples, and detailed direction before changing the visual
system or interaction hierarchy. Preserve all accepted behavior while applying
that feedback, then repeat responsive and accessibility checks.
