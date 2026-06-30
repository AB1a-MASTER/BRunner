# BRunner Master Roadmap

## Product direction

BRunner evolves from a reliable sequential recorder into a graph-based automation system. Each milestone is gated: the next milestone begins only after its acceptance tests pass.

## Current baseline — complete

- Semantic target packages with stable candidates and snapshots.
- Direct, controls-tree, and document-fuzzy target resolution.
- Page-aware execution and same-tab cross-page recording/replay.
- Domain binding, same/new-tab navigation, native persistence, and replay diagnostics.
- Studio normalization preserves recorder metadata and structured targets.

## Milestone 1 — Multi-tab and runtime closure

Implement configurable tab following, restricted-page classification, logical tab references, recovery behavior, and one runtime-state source shared by Studio and sidebar.

**Gate:** descendant-tab and active-tab recording, tab closure/recovery, restricted-page behavior, autosave, and synchronized UI state all pass.

See [01_MULTI_TAB_RUNTIME.md](specs/01_MULTI_TAB_RUNTIME.md).

## Milestone 2 — Data and node engine (functional baseline complete)

Introduce a canonical node registry, per-run variables, strict expressions, focused extraction nodes, and randomized waits while retaining legacy workflow support.

**Gate:** extraction and expression data can cross pages/tabs; missing variables produce diagnostics; legacy workflows still execute.

The initial data controls are functionally accepted but intentionally basic. Their Studio UX, variable discovery, and structured-data inspection are deferred to Milestone 3.

See [02_DATA_NODE_ENGINE.md](specs/02_DATA_NODE_ENGINE.md).

## Milestone 2.5 — Sequential runtime expansion (complete)

While the graph UX is deferred, add high-value browser, element, wait, and transformation nodes that work safely in the current sequential engine. Implement in the phases defined by the [Node Catalogue](specs/04_NODE_CATALOG.md).

**Gate:** each added node is registry-driven, expression-aware, backward compatible, and covered by deterministic execution tests.

Phase A and Phase B are implemented and live accepted. Phase B includes secure
HTTP requests, permission-gated clipboard operations, virtual and allowlisted
local-file uploads, download waiting/metadata, and visible-tab screenshots.
Native OS dialog automation remains deferred to Milestone 4 because direct
allowlisted file-input injection is safer and deterministic.

## Milestone 3 — Studio graph UX (functional gate complete)

Move Studio to React Flow and Vite, add graph schema v2, explicit v1 upgrades with backups, node properties, validation, and live execution visualization.

The schema-v2 adapter, initial single-success-path validator, sequential runtime
view, atomic native-host v1 backup/upgrade command, visual graph scaffold,
registry-driven properties, graph persistence, user-facing upgrade action,
graph execution visualization, bounded secret-safe structured graph logs,
explicit Hand/Selector navigation modes, accidental-edit guards,
marquee/additive selection, group movement, runtime-aware minimap colors, and
deterministic accessibility/responsive polish are implemented. The functional
graph-editor acceptance gate is complete.
Next, complete a separate user-directed UI/UX refinement
pass; ask the user for detailed design direction when that phase begins rather
than inventing the redesign in advance.

The user-directed scope is captured in
[05_STUDIO_UI_UX_REFINEMENT.md](specs/05_STUDIO_UI_UX_REFINEMENT.md). Its user
decisions are confirmed and the implementation slices are substantially
complete. Live extension acceptance and responsive visual tuning remain.

**Gate:** v1 compatibility, safe upgrades, graph save/reload fidelity, editing, validation, and execution highlighting pass.

See [03_STUDIO_GRAPH_UX.md](specs/03_STUDIO_GRAPH_UX.md).

## Milestone 3.1 — Runtime and authoring closure (next)

Correct the integration gaps found during the Studio review before expanding
control flow:

- declare required versus fallback-only native-host capabilities per node and
  fail a required node clearly when reached without its capability;
- make recording appear exactly once in Graph Studio and synchronize recording
  state across every UI;
- retain the same compatible open workflow when switching Studios without
  silently losing dirty drafts;
- record dropdown choices and clicks using user-facing semantic text/name before
  fragile value, selector, or index fallbacks;
- defer a final macro-recording polish pass until the end of this phase; known
  quirks will be collected now and fixed together after the core runtime,
  authoring, and data work is in place;
- show registry-backed descriptions, examples, requirements, inputs, and
  outputs for selected nodes in Inspector.

**Gate:** host-dependent nodes diagnose correctly, Graph recording is visible,
Studio switching preserves workflow identity safely, semantic select/click
recordings survive reordered controls, and every node exposes usage guidance.

See
[06_RUNTIME_AUTHORING_AND_DATA_FOLLOWUP.md](specs/06_RUNTIME_AUTHORING_AND_DATA_FOLLOWUP.md).

## Milestone 3.2 — Managed data authoring

Replace the basic runtime-variable preview with a complete shared Data panel for
seed variables, runtime values, lists/tables, mappings, previews, and bounded
host-backed TXT/CSV/JSON data sources from approved directories.

Add a native-host desktop UI packaged as an easy-to-run executable. The UI must
let a user start/stop the backend, see connection/auth status, inspect and edit
backend settings such as allowed data/file directories and pairing, and diagnose
host capability availability without editing JSON files by hand.

**Gate:** users can declare and preview safe workflow data, map it into workflow
inputs, diagnose unavailable/malformed sources, and run ordinary workflows
without leaking unrestricted paths or persistent runtime values.

See [02_DATA_NODE_ENGINE.md](specs/02_DATA_NODE_ENGINE.md) and
[06_RUNTIME_AUTHORING_AND_DATA_FOLLOWUP.md](specs/06_RUNTIME_AUTHORING_AND_DATA_FOLLOWUP.md).

## Milestone 3.3 — Nodes completeness and friendliness pass

After the Data panel foundations are in place, audit the full node catalog
against the goal of complete practical browser/host automation. This pass must:

- verify which required nodes are present, missing, duplicated, or too narrow;
- improve node names, grouping, defaults, examples, and safety copy;
- replace free-text fields with friendlier controls where possible;
- add valid-value autocomplete for variable-name entries and expression fields;
- add guided keyboard controls: Send Text versus Send Keystroke, with a
  searchable/autofill list of supported keys and common modifier combinations
  such as Ctrl/Alt/Shift/Meta plus key;
- keep advanced/manual entry available for uncommon values while validating the
  common path.

**Gate:** a user can discover the right node, configure it without memorizing
internal names or key syntax, and confirm that the catalog covers the required
automation scenarios before final macro-recording polish.

## Milestone 4 — Advanced automation

- Conditions, merge paths, and reusable sub-workflows.
- Bounded For Each over list/table records, mapped workflow inputs/outputs,
  cancellation, iteration limits, and deterministic result collection.
- File upload strategies and native-dialog automation.
- Registry-driven foreground-tab, focused-window, visible-target, and pointer
  preconditions for viewport-dependent nodes such as Hover Mouse.
- CDP/headless execution and multi-monitor calibration.
- Audit trails, snapshots, telemetry, and compliance reporting.

## Original todo disposition

| Todo | Status |
|---|---|
| Stable semantic identifiers and internal DOM fallback | Complete |
| Hide sidebar content on Studio | Complete |
| Auto-bind recorded domain | Complete |
| Same/new-tab navigation execution | Complete |
| Sidebar recording autosave | Complete; regression coverage remains in Milestone 1 |
| Same-tab cross-page recording | Complete |
| New-tab/restricted-page recording | Milestone 1 |
| Studio/sidebar runtime synchronization | Milestone 1 |
| Node catalogue, variables, expressions, scraping | Milestone 2 |
| Responsive drag/drop UI and comprehensive node panels | Milestone 3 |
| Hand/Selector tools, navigation edit-safety, and bulk node movement | Milestone 3 |
| Runtime state colors in graph minimap/overview | Milestone 3 |
| User-directed final Graph Studio UI/UX refinement | After Milestone 3 functional gate; ask user for details first |
| Saved/runtime variable browser and table/list output previews | Milestone 3 |
| Managed seed/dataset panel and allowlisted TXT/CSV/JSON sources | Milestone 3.2 |
| Native-host settings UI and packaged executable | Milestone 3.2 |
| Required/fallback native-host capability contract | Milestone 3.1 |
| Cross-Studio open-workflow continuity | Milestone 3.1 |
| Semantic text-first select/click recording | Milestone 3.1 |
| Registry-backed node descriptions and examples in Inspector | Milestone 3.1 |
| Nodes completeness and user-friendly controls pass | Milestone 3.3 |
| Workflow Call and bounded data For Each | Milestone 4 |
| Stop/cancel running workflow from Studio and sidebar | Runtime foundation; immediate |

## Development rules

1. Preserve working persistence, navigation normalization, and legacy workflow behavior.
2. Prefer isolated patches over architectural rewrites.
3. Every behavior change requires deterministic tests and manual acceptance steps.
4. Reliability and diagnostics precede polish.
5. Keep [BRUNNER_USER_GUIDE.md](BRUNNER_USER_GUIDE.md) synchronized with the
   registry, Inspector guidance, and node behavior.
