# Node 15 - Paste from Clipboard Finalization

**Status:** Queued - contract frozen  
**Updated:** 2026-07-27  
**Main tracker:** `../NODE_IMPLEMENTATION_STATUS.md`  
**Batch program:** `P12_PHASE_1_2_BATCH_PROGRAM.md`  
**Current resume checkpoint:** The contract below is frozen. Before Step 2,
recheck Copy, Enter Text, Focus, offscreen/workflow clipboard reads, keyboard
input, host clipboard restoration, and operation-specific retry proof.

## Objective

Implement catalog Node 15, `clipboard.paste@1`, to read the System Clipboard by
default or a selected Workflow Clipboard entry and paste it into a verified
editable target with optional clearing, formatting normalization, restoration,
and post-paste verification.

## Non-goals

- Do not expose clipboard contents as protected or secret.
- Do not paste into unresolved, non-editable, hidden, or protected targets.
- Do not duplicate pasted content through blind retry.
- Do not preserve provisional `clipboard.read@1` semantics as the finalized
  action.

## Frozen contract decisions

- **Identity:** `clipboard.paste@1`; new finalized type.
- **Sources:** `system` (default) or `workflow`. Workflow source requires an
  explicit entry and optional version selector with shared autocomplete.
- **Target/fields:** required shared editable target; `pasteMethod`
  (`automatic`, `browser_insert`, `browser_keyboard`, `host`);
  `focusTarget`; `clearBeforePaste`; `stripFormatting`;
  `preserveLineBreaks`; `restorePriorClipboard`; shared host fallback;
  verification mode/expected final value; and common fields.
- **Execution:** read selected clipboard source -> normalize requested format ->
  resolve/focus/inspect target -> optionally clear -> browser insertion or
  trusted keyboard paste -> verify -> optional visible foreground host paste
  with bounded prior-clipboard restoration -> verify.
- **Ports:** `success`, `unresolved`, and `error`.
- **Outputs:** `source`, `workflowItem`, `characterCount`,
  `targetResolution`, `executionMethod`, `verification`, and
  `clipboardRestored`.
- **Protected pages:** editable DOM paste is unavailable and host fallback
  cannot bypass protection.
- **Retry:** default zero. Retry is permitted only when clear-before-paste or
  target inspection proves the intended content is absent and no partial text
  remains.
- **Stable failures:** common target/editable/protected/host/timeout/cancel/
  config errors plus namespaced clipboard-read-failed, entry-not-found,
  paste-failed, restoration-failed, and verification-failed codes.

## Affected surfaces and expected files

- `BRunner/nodes/clipboard/paste/` package.
- Reusable clipboard read/source adapter, Enter Text editable insertion,
  Focus/keyboard/verification, Workflow Clipboard lookup, and host restoration.
- Exact v1 registry/background/content/offscreen execution and provisional
  read isolation.
- Node 015 tests, paste fixture/workflow, user catalogue, tracker, roadmap,
  handoff, and this record.

## Ordered implementation steps

| Step | Work | Verification | Status |
|---|---|---|---|
| 1 | Freeze sources, target/methods, formatting/restoration, output, retry, host/protected behavior, and provisional disposition. | Blueprint D4 and shared clipboard/input contracts agree with this record. | Complete |
| 2 | Implement definition, validators, outputs, source/normalization/paste/verification adapters, executor, cancellation, and retry proof. | Unit tests cover both sources, formatting, clear, restoration, and partial-paste safety. | Pending |
| 3 | Register exact v1 and integrate Graph/background/content/offscreen/workflow/keyboard/host execution; isolate provisional read. | Conditional workflow fields, autocomplete, save/reload/preparation, exact dispatch, and version isolation pass. | Pending |
| 4 | Add deterministic integration coverage for system/workflow paste, version selection, clear-before, strip formatting, line breaks, rich text, browser/host paths, restoration, verification, disabled, retry rules, timeout, cancellation, output, and logs. | Focused runtime/Graph/clipboard tests pass without duplicate text. | Pending |
| 5 | Add `015_paste-from-clipboard_acceptance.json`, fixture, and user documentation. | Synthetic system/workflow paste plus missing-entry/non-editable alternate validate. | Pending |
| 6 | Run focused source checks and mark Source complete - batch acceptance queued. | Node/clipboard/input/keyboard/shared tests, syntax, JSON, and diff check pass. | Pending |
| 7 | Run consolidated build/full-suite/live acceptance and synchronize evidence. | Batch gate confirms final target content, method, and safe failure. | Pending |

## Completion gates

- Clipboard source and workflow version selection are explicit.
- Paste writes only to a unique verified editable target.
- Retry cannot duplicate partial/uncertain pasted content.
- Host restoration is reported honestly and never assumed.
- Focused workflow, user documentation, batch regression, and live evidence
  pass before Node 15 or Phase 2 is accepted.

## Recovery procedure

Read the batch program, tracker, and this file. Inspect the target's actual
content and clipboard/restoration evidence before resuming a partial paste.
After Node 15 is source-complete and batch-queued, return to the batch program
for workflows, consolidated regression/build, and live acceptance.

