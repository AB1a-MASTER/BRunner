# Node 12 - Enter Text Finalization

**Status:** Queued - contract frozen  
**Updated:** 2026-07-27  
**Main tracker:** `../NODE_IMPLEMENTATION_STATUS.md`  
**Batch program:** `P12_PHASE_1_2_BATCH_PROGRAM.md`  
**Current resume checkpoint:** The contract below is frozen. Before Step 2,
recheck Focus, shared target/verification/host adapters, Chrome debugger key
input, content editable/rich-text behavior, and provisional type/clear handlers.

## Objective

Implement catalog Node 12, `element.enter_text@1`, for deterministic text
replacement, append, cursor insertion, clearing, sequential typing, paste, and
value-plus-event entry into supported editable controls.

## Non-goals

- Do not claim password or other input is secret, redacted, or specially
  protected.
- Do not duplicate append/insert/paste input through blind retry.
- Do not write to non-editable, unresolved, hidden, or protected targets.
- Do not preserve provisional `element.type@1`/`element.clear@1` semantics as
  the finalized contract.

## Frozen contract decisions

- **Identity:** `element.enter_text@1`; new finalized type replacing two
  provisional actions.
- **Operations:** `replace`, `append`, `insert_at_cursor`, `clear`,
  `type_sequentially`, `paste`, and `set_value_with_events`.
- **Fields:** required shared target; expression-capable `text`; operation;
  `inputMethod` (`automatic`, `browser_value`, `browser_keyboard`,
  `browser_paste`); select-all/clear-before and preserve-existing controls;
  `delayMode` (`none`, `fixed`, `random_range`), fixed/min/max and optional
  first/last delay; explicit event checkboxes for input/change/blur/Enter plus
  validated custom event names; focus/scroll behavior; multiline policy;
  `richTextMode`; shared host fallback; verification mode/expected value; and
  common fields.
- **Execution:** resolve -> verify editable -> focus/scroll -> inspect current
  value -> perform browser DOM or debugger input -> dispatch only configured
  events -> verify. Host keyboard/paste is optional, visible,
  foreground-verified, and last-resort.
- **Ports:** `success`, `unresolved`, and `error`.
- **Outputs:** `operation`, `characterCount`, `executionMethod`,
  `targetResolution`, and `verification`. The entered raw text is not repeated
  in the node-specific output, though configured verbose logs and workflow
  inputs remain ordinary local data.
- **Protected pages:** editable DOM input is unavailable and host fallback
  cannot bypass protection.
- **Retry:** replace, clear, and set-value may retry after reading and proving
  the intended final value is absent. Append, cursor insertion, sequential
  typing, and paste default to zero and retry only with proof that no characters
  were committed.
- **Stable failures:** common target/editable/visible/protected/host/timeout/
  cancel/config errors plus namespaced input-failed,
  event-dispatch-failed, and verification-failed codes.

## Affected surfaces and expected files

- `BRunner/nodes/keyboard/enter-text/` package and editable input adapter.
- Shared focus, target, keyboard/paste, verification, timing/random adapter,
  and host policy.
- Exact v1 registry/background/content/debugger execution.
- Provisional type/clear registry and handler isolation.
- Node 012 tests, editable/rich-text fixture/workflow, user catalogue, tracker,
  roadmap, handoff, and this record.

## Ordered implementation steps

| Step | Work | Verification | Status |
|---|---|---|---|
| 1 | Freeze operations, methods, timing/events, multiline/rich text, output, retry, host/protected behavior, and provisional disposition. | Blueprint D1 and shared contracts agree with this record. | Complete |
| 2 | Implement definition, validators, outputs, editable/input/verification adapters, executor, cancellation, and operation-specific retry proof. | Unit tests cover every operation/method/delay/event and invalid editable state. | Pending |
| 3 | Register exact v1 and integrate Graph/background/content/debugger/clipboard/host execution; isolate provisional actions. | Conditional fields, autocomplete, save/reload/preparation, exact dispatch, and version isolation pass. | Pending |
| 4 | Add deterministic integration coverage for replace/append/clear/cursor/sequential fixed/random/multiline/password/rich text/events, host fallback, verification, disabled, retry rules, timeout, cancellation, output, and logs. | Focused runtime/Graph/host tests pass without duplicate input. | Pending |
| 5 | Add `012_enter-text_acceptance.json`, fixture, and user documentation. | Synthetic replace/clear/sequential success plus non-editable alternate validate. | Pending |
| 6 | Run focused source checks and mark Source complete - batch acceptance queued. | Node/input/focus/keyboard/shared tests, syntax, JSON, and diff check pass. | Pending |
| 7 | Run consolidated build/full-suite/live acceptance and synchronize evidence. | Batch gate confirms final value, character count, and safe failure. | Pending |

## Completion gates

- Every operation has explicit duplicate-safe retry classification.
- Input and configured events are verified against the actual editable state.
- Host input is opt-in, visible, foreground-verified, and protected-page safe.
- Provisional type/clear actions cannot dispatch as finalized v1.
- Focused workflow, user documentation, batch regression, and live evidence
  pass before acceptance.

## Recovery procedure

Read the batch program, tracker, and this file. Recheck the current target value
and whether any partial typing side effect occurred before resuming an active
step. Do not start Press Key until Enter Text is source-complete and
batch-queued.

