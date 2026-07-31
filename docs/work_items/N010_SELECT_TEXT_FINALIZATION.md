# Node 10 - Select Text Finalization

**Status:** Queued - contract frozen  
**Updated:** 2026-07-27  
**Main tracker:** `../NODE_IMPLEMENTATION_STATUS.md`  
**Batch program:** `P12_PHASE_1_2_BATCH_PROGRAM.md`  
**Current resume checkpoint:** The contract below is frozen. Before Step 2,
recheck Focus, shared text matching, browser Selection/input selection APIs,
pointer/keyboard adapters, clipboard service, and output publication.

## Objective

Implement catalog Node 10, `element.select_text@1`, to select and verify text in
an editable control or page region by whole value, bounded range, phrase, or
markers, optionally copying the selected text.

## Non-goals

- Do not implement the later Read Selected Text extraction node.
- Do not select across inaccessible frames/shadow roots or guess ambiguous
  phrase occurrences.
- Do not use arbitrary script expressions for range calculation.
- Do not log or mask text under a false sensitive-data guarantee.

## Frozen contract decisions

- **Identity:** `element.select_text@1`; new finalized type.
- **Operations:** `select_all`, `select_input_value`, `character_range`,
  `line_range`, `phrase_match`, `between_markers`, and `clear_selection`.
- **Fields:** `selectionSource` (`target_control`, `target_region`,
  `active_editable`, `page_selection`), conditionally required target,
  operation, start/end character or line, phrase/start/end marker,
  occurrence and shared matching controls, `selectionMethod`
  (`browser_range`, `keyboard`, `mouse_drag`, `automatic`),
  `copySelectedText`, copy destination (`system`, `workflow`, `both`),
  workflow label/behavior, save alias, shared host fallback, and common fields.
- **Execution:** DOM input selection or browser Range is preferred; trusted
  keyboard/pointer input is used when required; visible host input is optional
  and last-resort. The selected string is read back and verified before
  success.
- **Ports:** `success`, `unresolved`, and `error`.
- **Outputs:** `operation`, `selectedText`, `selectionLength`,
  `executionMethod`, `targetResolution`, and copy publication summary when
  enabled.
- **Protected pages:** selection is DOM-dependent and unavailable.
- **Retry:** default one for no-selection/transient focus failures. If optional
  clipboard publication occurred, retry requires verified idempotent clipboard
  state and must not append/version twice.
- **Stable failures:** common target/ambiguity/visibility/protected/host/
  timeout/cancel errors plus namespaced phrase-not-found,
  invalid-range, selection-failed, and copy-failed codes.

## Affected surfaces and expected files

- `BRunner/nodes/interaction/select-text/` package and DOM selection adapter.
- Shared matching, focus, pointer/keyboard, clipboard publication, host policy,
  and target condition rendering.
- Exact v1 registry/background/content execution.
- Node 010 tests, selection fixture/workflow, user catalogue, tracker, roadmap,
  handoff, and this record.

## Ordered implementation steps

| Step | Work | Verification | Status |
|---|---|---|---|
| 1 | Freeze operations/sources, range controls, matching, optional copy, routes, output, retry, host, and protected behavior. | Blueprint C4 and shared contracts agree with this record. | Complete |
| 2 | Implement definition, validators, outputs, selection/copy adapters, executor, cancellation, and retry proof. | Unit tests cover control/page selection, ranges, matching, clear, and copy idempotence. | Pending |
| 3 | Register exact v1 and integrate Graph/background/content/clipboard/host execution. | Conditional target/range fields, autocomplete, save/reload/preparation, and exact version pass. | Pending |
| 4 | Add deterministic integration coverage for input full selection, phrase and marker selection, rich text, mouse/host path, no phrase, invalid range, disabled, retry, timeout, cancellation, output, logs, and optional copy. | Focused runtime/Graph tests pass. | Pending |
| 5 | Add `010_select-text_acceptance.json`, fixture, and user documentation. | Synthetic first-paragraph/field selection plus no-match alternate validate. | Pending |
| 6 | Run focused source checks and mark Source complete - batch acceptance queued. | Node/selection/matching/clipboard tests, syntax, JSON, and diff check pass. | Pending |
| 7 | Run consolidated build/full-suite/live acceptance and synchronize evidence. | Batch gate confirms selected text, length, and safe no-match route. | Pending |

## Completion gates

- Selection is exact, bounded, and read-back verified.
- Ambiguous phrase/marker selection obeys shared matching policy.
- Clipboard publication does not duplicate on retry.
- Browser and physical methods respect visibility/protection rules.
- Focused workflow, user documentation, batch regression, and live evidence
  pass before acceptance.

## Recovery procedure

Read the batch program, tracker, and this file. Recheck DOM selection cleanup
and clipboard publication evidence for the active step. Do not start Drag and
Drop until Select Text is source-complete and batch-queued.

