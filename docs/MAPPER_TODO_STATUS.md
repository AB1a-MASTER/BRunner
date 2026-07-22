# Mapper Completion Status

This checklist is the current mapper-phase handoff. The mapper is a foundational
engine for the final node system, not a feature of the current provisional node
catalogue and not a saved-map viewer project.

## Phase Objective

The mapper must reliably discover and track actionable and semantic page
elements together with enough contextual hierarchy for future nodes to resolve
the intended element safely. It exposes node-neutral scan, reference, resolve,
revalidate, and refresh contracts. Final nodes will consume those contracts in
the node implementation phase.

Current nodes and their Studio controls are provisional. Mapper completion does
not require retrofitting them with `ComponentRef`, graph outcome handles, or new
authoring UI.

## Engine Foundation Present in Source

- [x] Workflow/page-scoped maps with locked readable Component IDs.
- [x] Node-neutral `ComponentRef` records that identify mapped components
  without embedding a current node type.
- [x] Page/site normalization and bounded retained map history.
- [x] Actionable controls, semantic content, and contextual structure scanning.
- [x] Hierarchy facts for page, frame, open Shadow DOM, container, form,
  repeated-record, and bounded dynamic context.
- [x] Primary-first resolution, ordered fallbacks, full candidate comparison,
  compatibility checks, fixed thresholds, and winner-margin enforcement.
- [x] Explicit resolved, fallback-resolved, ambiguous, not-found, stale,
  deferred, and protected outcomes.
- [x] Automatic reconciliation that preserves identity only with strong unique
  evidence and represents uncertain history as new plus removed.
- [x] Static and dynamic identity lanes so loaded-window records cannot take a
  stable static component's identity.
- [x] Bounded hybrid-dynamic refresh and honest `dynamic_deferred` behavior.
- [x] Open Shadow DOM traversal and persisted composed paths.
- [x] Same-origin frame aggregation and path-based resolution.
- [x] Conservative repeated-row/card scope and contextual chat/social fixture
  inference.
- [x] Chrome-storage MapStore with schema checks, per-workflow revisions,
  aggregate retention, deterministic quota eviction, and bounded tombstones.
  The native filesystem adapter remains inactive, and the companion no longer
  advertises or routes mapper-state commands.
- [x] Deterministic unit coverage for naming, scoring, ambiguity, history,
  reconciliation, dynamic lanes, Shadow DOM, and frame paths.

## Automated Mapper Source Gates

- [x] Verify the public node-neutral API surface for scan, resolve, revalidate,
  refresh, and map lookup without depending on a current node implementation.
- [x] Replace whole-corpus read/modify/write persistence with serialized,
  revision-checked per-workflow writes so concurrent frames, tabs, refreshes,
  and diagnostics cannot silently lose map updates.
- [x] Add deterministic concurrent-write, stale-delete/generation, per-record
  and aggregate-quota, mixed-legacy, global-retention, tombstone-compaction,
  large-page, and bounded-pruning tests for mapper persistence.
- [x] Bound content-side candidate discovery, fact construction, mutation
  rescans, and cross-frame aggregation before they consume an unbounded CPU or
  message payload; report overflow as `component_scan_overflow` and defer both
  map layers rather than accepting a truncated map.
- [x] Remove mapper sensitive-site/redaction policy fields, storage branches,
  diagnostic filters, and viewer controls. Raw mapper data is ordinary local
  user-managed data.
- [x] Map extension-accessible cross-origin frames as isolated frame contexts;
  only truly inaccessible frames may return `protected_unsupported`.
- [x] Cover identity drift, ambiguity refusal, bounded dynamic reconciliation,
  open Shadow DOM, frames, and repeated-record scoping with deterministic tests.
- [x] Persist exact origin/path/allowlisted-query identity behind a versioned
  collision-resistant page key, and enforce the exact fields during Inspector
  target-tab selection and again immediately before in-page resolution so a
  saved component cannot cross an SPA route, origin, scheme, or port.
- [x] Reject workflow/site/version reference mismatches, timestamp scans at DOM
  capture, and discard delayed snapshots that are older than the current stored
  map while returning the retained current map.
- [x] Whitelist and bound nested persisted maps/components/attempts, make the
  storage key authoritative, validate tombstones, and keep save/delete quota
  fallback transactional without removing unrelated legacy workflows. Cover
  blocked writes, malformed state, profile retention, overflow reload, and
  unrelated-map preservation.
- [x] Complete the repository acceptance harness with static control coverage,
  isolated drift, ambiguity/capability controls, keyed/unkeyed windows,
  deterministic mutation/large-page generators, open/closed shadow boundaries,
  accessible/protected frames, platform windows, and SPA route controls.
- [x] Normalize every host-served workflow and iframe URL to the canonical
  repository-root fixture server and protect the contract with file-existence
  and inline-script parse tests.
- [x] Add a read-only **Verify & Export** acceptance probe that exports the live
  PageMap, independently enumerates the current DOM, compares every visible
  top-document candidate plus stable accessible-frame candidates, and reports
  missing, duplicate, tag-mismatched, outside-body, truncated, and overflow
  evidence in one JSON artifact.
- [x] Persist explicit `html/body` ancestry for ordinary and composed Shadow DOM
  paths, and increase per-component fact work for realistic loaded windows while
  retaining the existing deterministic global cap.
- [x] Make the engineering Inspector distinguish the top document from embedded
  frame documents: the top document is always first, frame documents are grouped
  and labelled by access/path, and iframe-local coordinates never order page
  document roots.

## Manual Mapper Acceptance

The 2026-07-20 live run initially exposed loaded-window deferral, incomplete
`html/body` ancestry, off-screen fallback failure, and a verifier false positive
for `pre#event-log` after it exceeded the mapper's bounded passive-text policy.
The source fixes and deterministic regressions were completed. The operator then
reported the affected live reruns and corrected **Verify & Export** report
passing. The exported frame controls retained their own
`html:0/body:1/...` ancestry and the report contained zero outside-body records.

The later screenshot review found a presentation-only ambiguity: the Inspector
listed a synthetic iframe document root before the top document because it
compared coordinates local to different documents. The diagnostic tree now
shows **Top document** first and groups clearly labelled embedded frame
documents beneath **Embedded frame documents**. This does not change mapper
facts, frame isolation, or runtime resolution. Platform/chat highlighting and
full Tree/Graph product polish remain deferred V2 work.

- [x] Run the complete live engine checklist in
  `MAPPER_MANUAL_ACCEPTANCE.md` after reloading the unpacked extension.
- [x] Confirm actionable and semantic fixture elements are discoverable with
  their actual contextual hierarchy, not a flattened component list.
- [x] Confirm stable Component IDs across controlled attribute, text, position,
  and container drift when independent evidence remains sufficient.
- [x] Confirm duplicates and close-score candidates return ambiguity and never
  silently select the first document-order match.
- [x] Confirm revalidation and explicit refresh update the selected page only,
  preserve bounded history, and retain unrelated site/page maps.
- [x] Confirm bounded dynamic regions update without erasing stable static
  components, while over-limit or mutation-heavy pages decline honestly without
  freezing the tab or accepting a truncated map.
- [x] Confirm open-shadow, same-origin-frame, and accessible cross-origin-frame
  components scan and resolve after an extension reload.
- [x] Confirm repeated chat/social fixture records remain container-scoped and
  cannot resolve into another thread or card.
- [x] Confirm a saved component cannot resolve or highlight on another SPA route
  and returns `map_stale` / `page_profile_mismatch` instead.
- [x] Confirm persisted representative maps and Component IDs survive a real
  unpacked-extension reload.

Mapper engine acceptance is complete for final-node integration. Future
regressions may reopen this gate, but deferred Inspector polish does not.

## Data Ownership Decision

Mapper maps and diagnostics are local, user-managed data. They may contain raw
page content or values needed for reliable local mapping and debugging. Runtime
redaction, sensitive-site modes, and content-hiding policy are not mapper-phase
requirements. Storage must still be bounded and schema-valid for reliability.

## Deferred to V2 / Product UI

- Polished saved-map explorer and dedicated Mapper Inspector windows.
- Site/page/version navigation, aliases, review queues, policy editors,
  legends, graph/tree presentation, and live highlight UX as product surfaces.
- Responsive, touch, keyboard, accessibility, and visual acceptance for
  those viewer surfaces.
- Product-specific chat/social presentation and support claims beyond the
  engine's conservative contextual scope checks.
- Current-node or Studio retrofits. Final nodes will integrate the accepted
  mapper API in the node implementation phase.

## Intentional Engine Limits

- [x] Closed Shadow DOM is unsupported.
- [x] Frames where the extension cannot inject or establish a stable context are
  protected unsupported.
- [x] Loaded-window mapping does not auto-scroll or paginate feeds.
- [x] Unkeyed repeated records do not receive a guessed durable identity.
- [x] General semantic form-fill execution remains in the final-node phase.
