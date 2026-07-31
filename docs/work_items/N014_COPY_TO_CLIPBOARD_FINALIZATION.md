# Node 14 - Copy to Clipboard Finalization

**Status:** Queued - contract frozen  
**Updated:** 2026-07-27  
**Main tracker:** `../NODE_IMPLEMENTATION_STATUS.md`  
**Batch program:** `P12_PHASE_1_2_BATCH_PROGRAM.md`  
**Current resume checkpoint:** The contract below is frozen. Before Step 2,
recheck the offscreen system clipboard service, workflow clipboard publication
and version history, Select Text output, serialization helpers, and provisional
clipboard write behavior.

## Objective

Implement catalog Node 14, `clipboard.copy@1`, to copy static, workflow,
selected, element, or structured data to the System Clipboard by default and
optionally to the run-scoped Workflow Clipboard with deterministic formatting,
verification, and idempotent retry.

## Non-goals

- Do not claim clipboard data is secret, redacted, or privacy-safe.
- Do not read raw filesystem paths or invent file-reference semantics.
- Do not duplicate append/version entries during retry.
- Do not preserve provisional `clipboard.write@1` configuration.

## Frozen contract decisions

- **Identity:** `clipboard.copy@1`; new finalized type.
- **Sources:** `static_text`, `template`, `variable`, `selected_text`,
  `element_text`, `element_value`, `node_output`, and `structured_data`.
  Element sources conditionally require the shared target; all value/reference
  fields use shared autocomplete.
- **Formats:** `plain_text`, `json`, `csv`, `tsv`, and `html`, with stable
  serialization and explicit invalid-shape errors.
- **Destinations:** `system`, `workflow`, and `both`; System is default.
  Workflow Clipboard uses a required label when enabled and behavior
  `replace`, `append`, or `version`.
- **Methods:** `automatic`, `browser_api`, `keyboard_copy`, and `host`.
  Browser/offscreen clipboard is preferred; keyboard copy requires a verified
  live selection; host is optional, visible, foreground-verified, and
  last-resort. `restorePreviousSystemClipboard` is available only when the
  chosen host capability can prove restoration.
- **Verification:** `verifyWrite` defaults on. System output is read back when
  permission/capability permits; workflow publication is read from the
  run-scoped registry before completion.
- **Ports:** `success`, `unresolved`, and `error`. Unresolved applies only to
  DOM-backed sources.
- **Outputs:** `sourceType`, `format`, `destinations`, `workflowItem`,
  `characterCount`, `executionMethod`, `targetResolution`, and
  `verified`.
- **Protected pages:** non-DOM sources can still copy. Selected/element sources
  are unavailable and cannot be recovered through host bypass.
- **Retry:** safe only when the destination state is inspected first.
  Replace is idempotent; append/version must detect the already-published item
  and never add it twice.
- **Stable failures:** common target/protected/host/timeout/cancel/config errors
  plus namespaced source-unavailable, serialization-failed,
  clipboard-write-failed, and verification-failed codes.

## Affected surfaces and expected files

- `BRunner/nodes/clipboard/copy/` package and serialization/source adapters.
- Offscreen clipboard, Workflow Clipboard publication/version adapter, shared
  target/selection, and optional host clipboard behavior.
- Exact v1 registry/background/content execution and provisional write
  isolation.
- Node 014 tests, clipboard fixture/workflow, user catalogue, tracker, roadmap,
  handoff, and this record.

## Ordered implementation steps

| Step | Work | Verification | Status |
|---|---|---|---|
| 1 | Freeze sources, formats, destinations, methods, restoration, verification, output, retry idempotence, protected behavior, and provisional disposition. | Blueprint D3 and clipboard model agree with this record. | Complete |
| 2 | Implement definition, validators, serializers, source/output builders, system/workflow adapters, executor, cancellation, and retry proof. | Unit tests cover every source/format/destination and append/version idempotence. | Pending |
| 3 | Register exact v1 and integrate Graph/background/content/offscreen/workflow/host execution; isolate provisional write. | Conditional target/fields, autocomplete, save/reload/preparation, exact dispatch, and version isolation pass. | Pending |
| 4 | Add deterministic integration coverage for system default, workflow-only, both, selected/element data, JSON/CSV/TSV/HTML, browser denied/host fallback, restoration availability, disabled, retry, timeout, cancellation, output, and logs. | Focused runtime/Graph/clipboard tests pass without duplicate publication. | Pending |
| 5 | Add `014_copy-to-clipboard_acceptance.json`, fixture, and user documentation. | Synthetic selected/structured copy plus unavailable-source alternate validate. | Pending |
| 6 | Run focused source checks and mark Source complete - batch acceptance queued. | Node/clipboard/serialization/shared tests, syntax, JSON, and diff check pass. | Pending |
| 7 | Run consolidated build/full-suite/live acceptance and synchronize evidence. | Batch gate confirms System/Workflow Clipboard data and verification summary. | Pending |

## Completion gates

- Default System and optional Workflow destinations behave exactly as
  configured.
- Structured serialization is deterministic and bounded.
- Retry cannot duplicate workflow append/version or uncertain system writes.
- DOM sources obey mapper/protected-page boundaries.
- Focused workflow, user documentation, batch regression, and live evidence
  pass before acceptance.

## Recovery procedure

Read the batch program, tracker, and this file. Inspect current System and
Workflow Clipboard evidence before retrying a partial publication step. Do not
start Paste from Clipboard until Copy is source-complete and batch-queued.

