# Shared Foundation Completion Status

This checklist covers reusable project infrastructure outside the dedicated
companion and mapper checklists. It deliberately excludes implementation or
repair of provisional nodes.

## Confirmed Boundary

- [x] Product target is local Windows plus Chrome/Chromium.
- [x] The finalized node blueprint is the sole node contract.
- [x] Current nodes, recording output, node properties, and node-specific
  validation are provisional until the node phase.
- [x] Code Node will be unrestricted.
- [x] Workflows, maps, logs, and other values are ordinary local user-managed
  data; the extension does not own redaction or credential handling.
- [x] Saved-map viewer product work is V2.
- [x] Existing release/build outputs are disposable development artifacts.

## Repository and Build Hygiene

- [ ] Delete tracked/generated `release/`, `BRunner_Host/build/`, and
  `BRunner_Host/dist/` output.
- [ ] Ignore those generated paths while keeping required source/build scripts.
- [ ] Rebuild `BRunner/studio-graph/` from `BRunner/studio-graph-src/` so the
  unpacked extension does not load stale Graph Studio code.
- [ ] Add a deterministic build-parity test that verifies the emitted Graph
  Studio bundle contains the current source schema/features and referenced
  assets.
- [ ] Make a changed Graph Studio source tree with stale generated assets fail
  validation before live acceptance.

These are source-development tasks, not release packaging. Do not rebuild ZIP or
EXE deliverables during this milestone.

## Generic Studio and Workflow Integrity

- [ ] Protect dirty drafts when creating/loading a workflow, switching Studios,
  reloading, or closing a Studio window.
- [ ] Track a mutation revision/hash for asynchronous saves; clear dirty state
  only when the saved snapshot still matches the current draft.
- [ ] Serialize conflicting save operations and retain a recoverable draft when
  host persistence fails.
- [ ] Keep Graph Studio usable at supported development widths without hiding
  generic workflow/save/data controls.
- [ ] Test workflow metadata and generic graph persistence independently of any
  provisional node contract.

Do not redesign provisional node palettes, property editors, node validation,
recorded steps, or node execution while closing these items.

## MV3 and Shared Runtime Lifecycle

- [ ] Define one serializable session model for extension runtime, cancellation,
  and host-connection state that does not embed provisional node behavior.
- [ ] Persist appropriate active-session/checkpoint state in
  `chrome.storage.session` and rehydrate it after service-worker restart.
- [ ] Reconcile restored state with open tabs/content scripts and reject stale
  session messages deterministically.
- [ ] Require a successful companion hello and accepted paired-profile state
  before reporting host capabilities as ready.
- [ ] Add service-worker restart tests for session rehydration, cancellation,
  stale messages, and host reconnection without asserting provisional node
  outcomes.

Final per-node resume, retry, output, side-effect, and recording semantics belong
to the node phase.

## Documentation Completed in This Scope Pass

- [x] Added a root README and documentation authority order.
- [x] Rewrote the roadmap and handoff around the confirmed phase boundary.
- [x] Made companion and mapper status files honest current checklists.
- [x] Made the node blueprint the sole finalized node catalog.
- [x] Marked early design and transition files as historical/superseded.
- [x] Removed the empty `latest user info todo.txt` placeholder.

## Completion Gate

The shared foundation is ready for the finalized node phase when:

- generated source assets cannot silently drift;
- generic workflow drafts and saves do not lose edits;
- MV3 restart/rehydration and companion readiness have deterministic tests;
- companion and mapper completion gates pass; and
- no gate depends on preserving a provisional node implementation.
