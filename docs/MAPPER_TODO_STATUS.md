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
- [x] Loaded-window-only behavior for feeds and virtualized platform regions.
- [x] Open Shadow DOM traversal, persisted composed shadow paths, and mutation
  observation inside discovered open roots.
- [x] Same-origin frame aggregation and path-based execution/highlight routing.
- [x] Protected unsupported outcomes for cross-origin frames and unsafe inferred
  repeated chat/social controls.
- [x] Known chat/social host detection with redacted landmark scopes.
- [x] Thread/card/container scope boundaries before locator scoring.
- [x] Ephemeral badge/timestamp exclusion from durable identity text.
- [x] Global, site, and page automatic/manual-map-only policy behavior.
- [x] Consolidated site/page/version navigation and direct deletion controls.
- [x] Compact Tree/Graph/Regions/Types views, search, color legend, live checks,
  highlighting, aliases, Review Queue, and reliability/scope diagnostics.
- [x] Responsive stacked Inspector layout and phone Graph hierarchy fallback.
- [x] Chrome and native filesystem MapStore adapters with bounded history,
  schema-safe persistence, timeouts, payload limits, and conflict metadata.

## Manual Extension Acceptance

- [ ] Reload the unpacked extension after the `all_frames` manifest change.
- [ ] Run every section of `MAPPER_MANUAL_ACCEPTANCE.md` in the live extension.
- [ ] Confirm same-origin frame components map, highlight, and execute after a
  page reload; confirm cross-origin frames remain protected.
- [ ] Confirm mutation-heavy bounded regions stay `hybrid_dynamic`, update on
  Refresh Map, and never erase stable page regions.
- [ ] Confirm platform fixture thread/card actions never drift and ephemeral
  ticks do not change durable Component IDs.
- [ ] Confirm phone/narrow Inspector layout, horizontal collapsed bars, touch
  controls, and Graph list fallback visually.
- [ ] Run redacted live checks on WhatsApp Web and one social app before calling
  either product profile supported.

## Product Decisions

- [ ] Choose whether native filesystem MapStore becomes the default after its
  live parity test. Chrome storage remains the current default until accepted.
- [ ] Decide whether periodic native snapshots are needed when Chrome storage
  remains primary; this is optional durability, not resolver correctness.
- [ ] Approve removal of the old source/artifact candidates listed in the
  handoff before cleanup.

## Intentional Limits

- [x] Closed Shadow DOM is unsupported.
- [x] Cross-origin iframe DOM interaction is protected unsupported.
- [x] Visible-host coordinate fallback inside nested frames is protected until
  frame-to-screen coordinate translation is implemented.
- [x] Loaded-window mapping does not auto-scroll or paginate feeds.
- [x] Semantic form-fill node/runtime implementation stays deferred to
  Milestone 3.4 Phase 3.
