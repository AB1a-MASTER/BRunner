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

## Milestone 3 — Studio graph UX (deferred UX milestone)

Move Studio to React Flow and Vite, add graph schema v2, explicit v1 upgrades with backups, node properties, validation, and live execution visualization.

The schema-v2 adapter, initial single-success-path validator, sequential runtime
view, atomic native-host v1 backup/upgrade command, visual graph scaffold,
registry-driven properties, graph persistence, user-facing upgrade action, and
graph execution visualization are implemented. Structured graph logs, final
accessibility polish, and the complete graph-editor acceptance gate remain pending.

**Gate:** v1 compatibility, safe upgrades, graph save/reload fidelity, editing, validation, and execution highlighting pass.

See [03_STUDIO_GRAPH_UX.md](specs/03_STUDIO_GRAPH_UX.md).

## Milestone 4 — Advanced automation

- Conditions, loops, merge paths, and sub-workflows.
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
| Saved/runtime variable browser and table/list output previews | Milestone 3 |
| Stop/cancel running workflow from Studio and sidebar | Runtime foundation; immediate |

## Development rules

1. Preserve working persistence, navigation normalization, and legacy workflow behavior.
2. Prefer isolated patches over architectural rewrites.
3. Every behavior change requires deterministic tests and manual acceptance steps.
4. Reliability and diagnostics precede polish.
