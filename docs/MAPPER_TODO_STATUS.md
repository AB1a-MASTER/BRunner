# Mapper Completion Status

This checklist consolidates the mapper backlog from the roadmap, reliability
specification, Inspector/mobile specification, platform-profile specification,
manual acceptance guide, and current handoff. Semantic form-fill execution
remains in the node phase and is not mapper-phase work.

## Source Complete

- [x] Workflow/page-scoped maps with locked readable Component IDs.
- [x] Separate page profiles and bounded retention of up to three versions.
- [x] Automatic reconciliation that treats uncertain identities as new instead
  of creating routine manual review work.
- [x] Runtime fallback, ambiguity, not-found, and reliability diagnostics.
- [x] Dynamic DOM refresh and bounded `hybrid_dynamic` region mapping.
- [x] Static and dynamic map lanes are separated in Mapper Core: static
  reconciliation stays primary, dynamic/loaded-window records reconcile only
  against dynamic history, and deferred dynamic limits do not erase ready
  static components.
- [x] Mapper Inspector Policy diagnostics show static/dynamic layer counts,
  states, removed records, and deferred dynamic reasons.
- [x] Loaded-window-only behavior for feeds and virtualized platform regions.
- [x] Open Shadow DOM traversal, persisted composed shadow paths, and mutation
  observation inside discovered open roots.
- [x] Same-origin frame aggregation and path-based execution/highlight routing.
- [x] Inspector Structure mode separates same-origin frame document roots from
  the top-page DOM so iframe `body/main/form` paths cannot merge with the
  parent page hierarchy.
- [x] Protected unsupported outcomes for cross-origin frames and unsafe inferred
  repeated chat/social controls.
- [x] Known chat/social host detection with redacted landmark scopes.
- [x] Top-down chat/social app shells with major panes, semantic subregions,
  compact repeated templates, persisted redacted structure, and highlightable
  pane boundaries.
- [x] Explicit chat/social fixture roots fence platform grouping: page-level
  chrome and controls outside the actual app shell stay out of chat/feed panes,
  while fixture profile controls are grouped under shell/profile controls.
- [x] Inspector Tree, desktop Graph, and mobile Graph now share the same
  canonical DOM structure root. Platform scope remains semantic metadata for
  identity, resolution, Regions, and details, but it no longer replaces the
  actual `body > main > section` hierarchy in Structure/Graph views.
- [x] Passive status/log/pre/output text containers are mapped when visible, so
  fixture event-log text such as `Ready.` is not skipped.
- [x] Thread/card/container scope boundaries before locator scoring.
- [x] Ephemeral badge/timestamp exclusion from durable identity text.
- [x] Global, site, and page automatic/manual-map-only policy behavior.
- [x] Consolidated site/page/version navigation and direct deletion controls.
- [x] Compact Tree/Graph/Regions/Types views, vertical/horizontal Graph layout,
  search, color legend, live checks,
  component and container highlighting, aliases, Review Queue, and
  reliability/scope diagnostics.
- [x] Session-safe click/hover highlight requests and explicit repeated-record
  Tree groups for chat contacts, messages, and social posts.
- [x] Resolver-anchored container highlighting resilient to dynamic sibling
  movement, plus one Graph node per repeated template across all template parts.
- [x] Responsive stacked Inspector layout and phone Graph hierarchy fallback.
- [x] Chrome MapStore with bounded history and schema-safe persistence. A
  hardened native filesystem adapter exists but is intentionally inactive.

## Manual Extension Acceptance

- [ ] Reload the unpacked extension after the `all_frames` manifest change.
- [ ] Run every section of `MAPPER_MANUAL_ACCEPTANCE.md` in the live extension.
- [ ] Confirm same-origin frame components map, highlight, and execute after a
  page reload; confirm cross-origin frames remain protected.
- [ ] Confirm mutation-heavy bounded regions stay `hybrid_dynamic`, update on
  Refresh Map, and never erase stable page regions.
- [ ] Confirm a dynamic loaded-window record with the same text/locator shape
  as an older static record becomes a new dynamic record instead of inheriting
  the static Component ID.
- [ ] Confirm platform fixture thread/card actions never drift and ephemeral
  ticks do not change durable Component IDs.
- [ ] Confirm chat Graph renders Navigation Rail, Contacts Pane, and Chat Pane
  as separate lanes and aggregates contact/message templates.
- [ ] Confirm platform fixture page header/results stay in generic DOM
  structure, and fixture toolbar controls appear under Chat/Social Shell ->
  Profile Controls instead of Thread Header, Chat Pane, or Feed Pane.
- [ ] Confirm Tree Structure and Graph show the same page hierarchy for static
  and platform fixtures: website -> page -> body -> header/main -> sections ->
  nested containers -> mapped elements. Graph may change orientation, but it
  must not flatten everything into one region layer or use a different platform
  hierarchy than Tree Structure.
- [ ] Confirm social Graph renders navigation/feed/right-rail lanes and
  aggregates post template parts rather than flattening feed components.
- [ ] Confirm phone/narrow Inspector layout, horizontal collapsed bars, touch
  controls, and Graph list fallback visually.
- [ ] Confirm intermediate Structure rows highlight their complete live DOM
  containers while their chevrons independently expand and collapse the tree.
- [ ] Run redacted live checks on WhatsApp Web and one social app before calling
  either product profile supported.

## Product Decisions

- [x] Keep mapper states in extension Chrome storage. Maps are disposable and
  should be recreated after loss instead of persisted to the filesystem.
- [x] Do not add periodic native mapper snapshots.
- [x] Remove the approved old source/artifact candidates listed in the handoff.

## Intentional Limits

- [x] Closed Shadow DOM is unsupported.
- [x] Cross-origin iframe DOM interaction is protected unsupported.
- [x] Visible-host coordinate fallback inside nested frames is protected until
  frame-to-screen coordinate translation is implemented.
- [x] Loaded-window mapping does not auto-scroll or paginate feeds.
- [x] Semantic form-fill node/runtime implementation stays deferred to
  Milestone 3.4 Phase 3.
