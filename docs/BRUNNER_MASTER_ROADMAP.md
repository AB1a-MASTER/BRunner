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

Current implementation status: baseline host tests, executable-aware app paths,
shared atomic I/O, schema-v2 settings migration, workflow repository service,
approved-directory read/data-source aliases, PySide6 app entry point, initial
Status/Workflow Storage/Pairing/Diagnostics tabs, tray behavior, and workflow
folder use-new/copy/move/default controls, dedicated Approved Folders UI,
alias add/edit/remove, read/write/recursive controls, and find/write/export
directory service behavior are implemented. Initial `host.hello`,
`host.window`, and `host.action` service/bridge foundations are implemented,
including foreground-window checks, coordinate bounds checks, and visible
pointer/keyboard dispatch helpers. Host Fallback companion tab and capability
activity diagnostics are implemented. Initial browser-runtime fallback
integration is implemented for opt-in click, double-click, and type nodes with
post-action verification and a dedicated live acceptance workflow. The refreshed
host-served manual acceptance workflows passed for browser smoke, file upload,
clipboard, download wait, HTTP request, data inspector, screenshot capture, and
visible host fallback. Final release packaging now emits two user-facing
artifacts: the extension zip and the Windows host executable.

Pairing source is complete: manual extension-ID entry was replaced with a clean
key-based flow. The extension stores/generates/shows a validated 128-bit key,
the companion displays it in readable groups, successful auth stores the
extension runtime ID as the trusted fingerprint, and pairing changes restart a
managed host to revoke old sessions. A shorter PIN was intentionally rejected
to preserve entropy. Final manual packaged acceptance remains.

Implementation phases:

1. Baseline and safety-net tests for current host CRUD, config, file access,
   data parsing, execution logs, and protocol behavior. **Implemented for
   current host services.**
2. Application path helper and shared atomic I/O. **Implemented.**
3. Workflow repository service. **Implemented.**
4. Native PySide6 companion shell with Status, Workflow Storage, Pairing,
   Diagnostics, and tray behavior. **Initial implementation complete.**
   **Pairing UX source pass implemented: extension-side key controls,
   companion key/port controls, internal trusted extension fingerprinting, and
   auth gating before host commands.**
5. User-selectable workflow directory with use-new, copy, and move migration
   choices. **Implemented.**
6. Approved directory registry and alias-based file/data access. **Implemented:
   schema, read/data-source aliases, folder-management UI, and
   find/write/export service behavior and approved-directory workflow
   acceptance are in.**
7. Versioned protocol v2 and structured visible host fallback. **Source complete:
   initial `host.hello`, `host.window`, `host.action`, and
   `host.visual_match` service/bridge
   foundations are in, and the Host Fallback companion tab plus diagnostics are
   in; opt-in browser-runtime fallback integration for click, double-click, and
   type is in with refreshed host-served manual acceptance workflow coverage
   passing; initial opt-in PyAutoGUI visual-match recovery is implemented
   after coordinate/debugger recovery and has passed manual acceptance with
   Chrome side UI open. Visual search is now clipped to the foreground browser
   window and reports bounded search-region/timing diagnostics.**
   This visual fallback remains opt-in, foreground-window
   gated, confidence-thresholded, and verified by extension-side post-action
   checks before the step counts as successful.
8. Packaging and release cleanup. **Implemented for the current release shape:
   PyInstaller hidden imports/excludes are centralized, runtime/development
   outputs are ignored for release hygiene, `release_builder.py` emits exactly
   `BRunner-extension.zip` and `BRunnerHost.exe`, and the packaged host service
   smoke passes from the final release directory. Packaged `--self-check` and
   strict release archive/executable validation are included.**

Pre-shipping blocker status before packaging/install acceptance:

- Implemented in code: Sequential Studio display/view options scale the broader
  shell, command bar, panels, canvas spacing, cards, and form controls.
- Implemented in code: Sequential Studio action and workflow-details panels are
  independently collapsible, with restored space going back to the workflow
  surface and state persisted in shared Studio preferences.
- Implemented in code: Sequential Studio has clearer panel headers, hierarchy,
  and spacing for the action browser, sequence surface, and workflow details.
- Implemented in code: Chrome extension panel workflow failures show concise
  run status while node/workflow details remain in diagnostics/logs.
- Implemented in code: Graph Studio display/view settings now scale command
  controls, panels, nodes, inspector forms, canvas tools, and execution logs
  through shared density-derived Graph tokens.
- Source gate complete: configured host autostart, idempotent shutdown,
  packaged self-check, strict release validation, and exact two-artifact output.
- Remaining gate: final manual install/load acceptance with the two release
  artifacts and companion GUI/tray path.

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
   **Initial source foundation complete: pure Mapper Core, v3 schema validation,
   placeholder `ComponentRef`, Graph Studio source defaults/handles, and
   Chrome-storage `MapStore` skeleton are in. Build-output integration and live
   Graph Studio acceptance remain.**
2. Static page map, page normalization, workflow-local site/page overrides,
   canonical Component ID naming, fixed scoring, primary-first resolution,
   action validation, ambiguity handling, and `dynamic_deferred` safe decline.
   **Initial pure Mapper Core slice complete: static page-map construction,
   canonical duplicate naming, compact fingerprints, primary/fallback resolver
   states, action compatibility, and dynamic-deferred safe decline are in.
   Live DOM adapter and recorder/runtime wiring remain next.**
   **Initial content-adapter source pass complete: recorder steps now include
   `componentRef`/`mapperFact`, static candidate scanning includes reachable
   open Shadow DOM roots, and Graph Studio auto-routes recorded mapper nodes to
   a `Needs attention` unresolved endpoint. MapStore persistence and runtime
   traversal remain next.**
   **Initial coordinator persistence complete: recorded mapper facts are
   reconciled through Chrome `MapStore`, locked Component IDs survive recorder
   drift, and `BRunner_Host/mapper_test.html` provides the mapper acceptance
   fixture for duplicate labels, drift, open Shadow DOM, and dynamic-deferred
   checks.**
   **Initial mapper-backed execution source pass complete: runtime execution now
   attaches stored page-map context, content action execution resolves through
   stored Component IDs before legacy targets, and browser/visible-host fallback
   paths return handled mapper states before dispatch. Graph traversal for the
   explicit `unresolved` route remains next.**
   **Initial v3 unresolved traversal source pass complete: mapper graph
   workflows now execute through a narrow `success`/`unresolved` traversal path,
   route handled mapper unresolved outcomes to the `unresolved` edge, and show
   unresolved runtime state in Graph Studio. This does not add general
   conditions, loops, or merge-path control flow.**
   **Mapper-aware wait/extraction source pass complete: wait-element conditions
   now resolve through the same mapper context as actions and return handled
   mapper diagnostics instead of timing out generically. Extraction nodes already
   use the shared mapper-aware action path.**
3. Open Shadow DOM traversal, shadow paths, bounded map history, stale-map
   reconciliation, stable Component IDs across drift, and structured resolver
   output/logging.
   **Initial pre-Inspector source pass complete: open-shadow candidate scanning
   exists, page-map history is bounded per workflow/page, reconciliation records
   `same`/`changed`/`new`/`removed`/`ambiguous`, strong matches preserve locked
   Component IDs, review-required states are marked, refreshed map versions are
   produced on fingerprint drift, and `mapper_stress_test.html` plus
   `MAPPER_MANUAL_ACCEPTANCE.md` cover manual acceptance. Open-shadow paths are
   now persisted, discovered open roots are observed for rescans, and
   Inspector-facing attempt logs are stored. Live extension acceptance remains.**
   **Autonomous reconciliation policy started: strong unique drift now preserves
   identity without review, weak or close historical evidence becomes a new
   component, and unmatched prior records become informational removed
   tombstones. Runtime ambiguity still blocks interaction. Static
   reconciliation now records pending/confirmed automatic rebind confirmation
   and count-only redacted reliability metrics. Runtime mapper resolution now
   feeds fallback/ambiguous/not-found counters and bounded redacted attempts
   back into the saved page map. The Mapper Inspector surfaces those counters
   and attempts as compact redacted app telemetry. Static and dynamic mapper
   lanes are now explicit: static remains the primary execution/reconciliation
   path, dynamic/loaded-window records reconcile only against dynamic history,
   and deferred dynamic limits no longer erase ready static records.**
4. Dedicated Mapper Inspector window with map browsing, live resolution checks,
   highlight, Review Queue, aliases, sensitive-site badges, and effective policy
   view. The Inspector must expose a saved-map website list plus Tree and Graph
   map views. When the Inspector and mapped site are open
   together, selecting a component in any view should highlight the live page
   element with color-coded resolver/review state overlays, similar to DevTools
   element selection.
   **Initial Inspector source pass complete: `mapper-inspector/index.html`
   lists saved map versions by website, provides Tree/Graph views,
   Review Queue, active-page mapping without recorder, and inspection-only live
   highlight through the mapper resolver. Live highlight scrolls resolved
   elements into view. Alias save,
   current-mapping review acceptance, live-candidate linking while preserving
   Component IDs, basic effective policy editing, sensitive badges/redaction,
   persisted live resolver attempts, and structured resolver logs are in
   source. Review acceptance and link decisions create fresh review map
   versions. Website view has been removed from scope. Tree view now uses a
   reference-aligned dark explorer layout with type icons, indentation, lock
   affordances, compact labels, stable Component IDs as details, and modes for
   captured page structure, regions, and component type. Structure mode follows
   saved DOM-path facts as closely as the map data allows. Graph view
   now uses a functional top-down hierarchy canvas with Site -> Page -> Region
   -> Component nodes, connector ports, right-angle relationship edges,
   pan/zoom controls, selected-node state, and live-highlight selection wiring.
   Highlight-on-hover preview is available for component rows. Mapper scanning
   now includes bounded user-visible image and leaf-text candidates for later
   extraction, click, and screenshot/crop workflows.
   Tree, Graph, and Review Queue now share component search/status filters for
   Component IDs, aliases, names, role/type, capabilities, status, and review
   state. The Component panel has an explicit live-resolution check for review
   workflows, so candidate-link attempts can be fetched without relying on
   automatic selection highlighting. The website list now consolidates saved
   maps to one card per base site, exposes saved pages from a toolbar Page
   picker, scopes retained versions to the selected page, caps retained
   versions at three, and uses a more compact Inspector layout with collapsible
   left/right rails and resizable right-side review sections. A mapper
   coordinator regression test now covers
   same-site login/home page isolation so a login-page change does not mutate
   the home-page map. Inspector Refresh Map now remaps the selected saved page
   against its open website tab, so component-only DOM changes such as appended
   feed/tree/graph items can update Tree/Graph counts without changing other
   saved pages.
   Responsive source polish now includes a phone Graph hierarchy fallback.
   Final live extension visual acceptance remains.**
5. Filesystem `MapStore` adapter through the existing companion/local-host
   bridge.
   **Initial source pass complete: the host now has a mapper repository,
   native mapper-state list/get/save/delete commands, atomic JSON writes under
   the workflow storage root, and a `NativeMapStore` adapter behind the same
   extension contract. Native mapper calls now have bounded request timeouts,
   unavailable/timeout status reporting, a 1 MB normal payload cap, native
   revision stamps, and retained last-write-wins conflict metadata. The final
   product decision keeps Chrome storage as the mapper store: page maps are
   disposable and should be recreated after loss. The native adapter remains
   inactive and no periodic filesystem snapshots will be added.**
6. Dynamic, feed, same-origin frame, and platform-specific app profile work
   after static/open-shadow reliability tests are stable. Bounded region
   dynamics, loaded-window behavior, same-origin frame path routing, known-host
   profile inference, and conservative repeated-row/card protection are now in
   source. Chat/social profiles now map top-down from the application shell to
   major panes, semantic subregions, repeated templates, and leaf components.
   Saved maps retain a redacted platform-structure summary; Inspector Structure
   exposes highlightable pane boundaries and Graph renders compact pane lanes
   instead of flat repeated-component columns. Chat and
   social media products such as WhatsApp Web, Facebook, Instagram, and Reddit
   need their own mapper profile track for virtualized feeds, repeated cards,
   conversation/thread regions, composers, action bars, unread badges, and
   ephemeral dynamic content. They must not be marked supported by the generic
   mapper when grouping/tracking evidence is poor; use conservative unresolved
   or `dynamic_deferred` outcomes until a profile-specific fixture/checklist is
   accepted.

After the mapper execution and Inspector basics are complete, add a dedicated
manual mapper stress page with static, dynamic, mutation-heavy, infinite-scroll,
and open Shadow DOM sections. Use it to verify locked Component IDs,
reconciliation, honest `dynamic_deferred`/unsupported outcomes, saved-map
listing, Tree/Graph map views, and live website highlighting.
The current pre-Inspector manual acceptance checklist is
[MAPPER_MANUAL_ACCEPTANCE.md](MAPPER_MANUAL_ACCEPTANCE.md).

**Gate:** every recorded DOM node uses a locked readable Component ID; resolver
states are `resolved`, `resolved_with_fallback`, `ambiguous`, `not_found`,
`map_stale`, or `protected_unsupported`; ambiguous/not-found targets never
receive events; workflows route unresolved DOM outcomes through explicit
`unresolved` edges; maps are compact, workflow-scoped, redacted on sensitive
pages, and versioned; open-shadow controls work; dynamic-heavy and closed-shadow
surfaces fail honestly; the Inspector explains resolution without unsafe
auto-selection.

See [08_MAPPER_RELIABILITY_TRANSITION.md](specs/08_MAPPER_RELIABILITY_TRANSITION.md).

Mapper Inspector small-screen layout is tracked in
[10_MAPPER_INSPECTOR_SMALL_SCREEN.md](specs/10_MAPPER_INSPECTOR_SMALL_SCREEN.md).

Chat/social platform mapper profiles are tracked in
[11_MAPPER_PLATFORM_APP_PROFILES.md](specs/11_MAPPER_PLATFORM_APP_PROFILES.md).

Semantic form filling is specified in
[09_SEMANTIC_FORM_FILL.md](specs/09_SEMANTIC_FORM_FILL.md). Its pure matcher
foundation is preparatory only. Mapper-scoped form scanning, execution, node
registration, Studio authoring, and live acceptance are deferred to Milestone
3.4 Phase 3 and must not be implemented during the mapper phase.

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
6. Whenever a phase or milestone is completed or materially re-scoped, update
   the roadmap, relevant spec, handoff notes, and user-facing docs before
   moving to the next phase.
