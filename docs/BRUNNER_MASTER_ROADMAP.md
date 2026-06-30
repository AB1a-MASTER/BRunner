# BRunner Master Roadmap

## Product direction

BRunner evolves from a reliable sequential recorder into a graph-based
automation system with a native Windows companion app, a dependable internal
element mapper, and a complete node catalog. Each milestone is gated: the next
milestone begins only after its acceptance tests pass.

## Revised forward roadmap

The next work is no longer general Studio polish or broad node expansion. The
project now moves through three deliberate foundations:

1. **Windows companion app transition.** Replace the current localhost manager
   UI with a native Windows companion app, centralize workflow persistence,
   introduce approved directory aliases, and prepare structured visible host
   fallback.
2. **Mapper reliability transition.** Replace step-owned locators with
   workflow-owned component maps, locked Component IDs, schema-v3 unresolved
   routing, a dedicated Mapper Inspector, and safe static/open-shadow support.
3. **Final node implementation program.** Implement the finalized node list in
   `workflow_nodes_implementation_blueprint.md`, domain by domain, using shared
   resolver, logging, text-matching, output, retry, and host-fallback adapters.

The immediate source of truth for the companion phase is
[07_WINDOWS_COMPANION_APP.md](specs/07_WINDOWS_COMPANION_APP.md). The source of
truth for the mapper phase is
[08_MAPPER_RELIABILITY_TRANSITION.md](specs/08_MAPPER_RELIABILITY_TRANSITION.md).
The source of truth for the later node phase is the root-level
`workflow_nodes_implementation_blueprint.md`.

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

## Milestone 3.1 — Runtime and authoring closure (complete for current scope)

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

## Milestone 3.2 — Windows companion app transition (next)

Move the existing localhost-managed Python host into a purpose-built Windows
companion app. The extension remains the workflow runtime and browser-awareness
layer; the companion app owns workflow storage, approved directory aliases,
service status, pairing, diagnostics, and final visible host fallback.

Implementation phases:

1. Baseline and safety-net tests for current host CRUD, config, file access,
   data parsing, execution logs, and protocol behavior.
2. Application path helper and shared atomic I/O.
3. Workflow repository service.
4. Native PySide6 companion shell with Status, Workflow Storage, Pairing,
   Diagnostics, and tray behavior.
5. User-selectable workflow directory with use-new, copy, and move migration
   choices.
6. Approved directory registry and alias-based file/data access.
7. Versioned protocol v2 and structured visible host fallback.
8. Packaging and release cleanup.

**Gate:** the packaged app opens as a Windows companion, no production browser
manager page is needed, workflows are saved atomically beside the executable by
default or in the user's selected folder, approved folders are managed by alias,
existing v1 commands still work, and structured host fallback refuses unsafe
foreground/window/coordinate contexts.

See [07_WINDOWS_COMPANION_APP.md](specs/07_WINDOWS_COMPANION_APP.md).

## Milestone 3.3 — Mapper reliability transition

Replace the current per-step locator recorder with a workflow-scoped,
component-oriented mapper. DOM nodes reference persistent `componentRef`
records, not raw selectors, snapshots, or `ctrlHash` identities. Supported-scope
parity is static/bounded pages plus open Shadow DOM. Dynamic regions,
infinite/repeating feeds, frame support, and closed Shadow DOM remain deferred.

Implementation phases:

1. Mapper Core foundation, build outputs, `workflow.settings.mapper`, graph
   schema v3, placeholder `ComponentRef`, and Chrome-storage `MapStore`
   skeleton.
2. Static page map, page normalization, workflow-local site/page overrides,
   canonical Component ID naming, fixed scoring, primary-first resolution,
   action validation, ambiguity handling, and `dynamic_deferred` safe decline.
3. Open Shadow DOM traversal, shadow paths, bounded map history, stale-map
   reconciliation, stable Component IDs across drift, and structured resolver
   output/logging.
4. Dedicated Mapper Inspector window with map browsing, live resolution checks,
   highlight, Review Queue, aliases, sensitive-site badges, and effective policy
   view.
5. Filesystem `MapStore` adapter through the existing companion/local-host
   bridge, with atomic writes, timeouts, bounded retention, and last-write-wins
   conflict records.
6. Deferred dynamic, feed, and same-origin frame work only after static/open-
   shadow reliability tests are stable.

**Gate:** every recorded DOM node uses a locked readable Component ID; resolver
states are `resolved`, `resolved_with_fallback`, `ambiguous`, `not_found`,
`map_stale`, or `protected_unsupported`; ambiguous/not-found targets never
receive events; workflows route unresolved DOM outcomes through explicit
`unresolved` edges; maps are compact, workflow-scoped, redacted on sensitive
pages, and versioned; open-shadow controls work; dynamic-heavy and closed-shadow
surfaces fail honestly; the Inspector explains resolution without unsafe
auto-selection.

See [08_MAPPER_RELIABILITY_TRANSITION.md](specs/08_MAPPER_RELIABILITY_TRANSITION.md).

## Milestone 3.4 — Final node implementation program

Implement the finalized node list from
`workflow_nodes_implementation_blueprint.md`, replacing or modifying the current
node catalog domain by domain. This phase starts only after the companion app
and mapper foundations are accepted.

Implementation order:

1. Shared node adapters and foundational browser nodes.
2. Core interaction nodes.
3. Form and page-level UI nodes.
4. Data input and storage integration nodes.
5. Data transformation and advanced logic nodes.
6. Workflow control and extraction nodes.
7. Output, reporting, and end-to-end acceptance packs.

**Gate:** every implemented node has metadata, schema, ports, structured output,
disabled/bypass behavior, retry policy where safe, sensitive-value exclusion,
target-resolution output where applicable, host fallback status where
applicable, deterministic tests, and cross-node acceptance workflow coverage.

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
| Stable semantic identifiers and internal DOM fallback | Current foundation complete; superseded by Milestone 3.3 mapper reliability transition |
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
| Managed seed/dataset panel and allowlisted TXT/CSV/JSON sources | Fold into companion approved-directory and final node phases |
| Native-host settings UI and packaged executable | Superseded by Milestone 3.2 Windows companion app |
| Required/fallback native-host capability contract | Milestone 3.1 |
| Cross-Studio open-workflow continuity | Milestone 3.1 |
| Semantic text-first select/click recording | Milestone 3.1 |
| Registry-backed node descriptions and examples in Inspector | Milestone 3.1 |
| Nodes completeness and user-friendly controls pass | Superseded by Milestone 3.4 final node implementation program |
| Workflow Call and bounded data For Each | Milestone 3.4 node program after host and mapper foundations |
| Stop/cancel running workflow from Studio and sidebar | Runtime foundation; immediate |

## Development rules

1. Preserve working persistence, navigation normalization, and legacy workflow behavior.
2. Prefer isolated patches over architectural rewrites.
3. Every behavior change requires deterministic tests and manual acceptance steps.
4. Reliability and diagnostics precede polish.
5. Keep [BRUNNER_USER_GUIDE.md](BRUNNER_USER_GUIDE.md) synchronized with the
   registry, Inspector guidance, and node behavior.
