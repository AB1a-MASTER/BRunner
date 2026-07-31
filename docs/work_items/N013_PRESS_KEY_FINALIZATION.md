# Node 13 - Press Key Finalization

**Status:** Queued - contract frozen  
**Updated:** 2026-07-27  
**Main tracker:** `../NODE_IMPLEMENTATION_STATUS.md`  
**Batch program:** `P12_PHASE_1_2_BATCH_PROGRAM.md`  
**Current resume checkpoint:** The contract below is frozen. Before Step 2,
recheck Enter Text's keyboard adapter, Chrome debugger lifecycle, run
cancellation cleanup, host keystroke capability, and provisional native-host
send-keys behavior.

## Objective

Implement catalog Node 13, `keyboard.press_key@1`, for one key, shortcut,
ordered sequence, modifier hold, or modifier release using browser-first key
dispatch with optional visible host fallback and explicit effect verification.

## Non-goals

- Do not accept unbounded or platform-ambiguous key strings.
- Do not leave modifiers held after failure, timeout, cancellation, or run end.
- Do not retry Enter/Delete/shortcuts or other uncertain effects blindly.
- Do not preserve host-required `keyboard.send_keys@1` as the finalized
  browser-first contract.

## Frozen contract decisions

- **Identity:** `keyboard.press_key@1`; new finalized type.
- **Actions:** `press`, `shortcut`, `sequence`, `modifier_down`, and
  `modifier_up`.
- **Fields:** `keyAction`; `targetScope` (`resolved_target`,
  `active_element`, `page`); conditional shared target; validated `keys`
  grammar with standard key-name autocomplete and bounded sequence length;
  `focusBeforeAction`; per-key delay; `keepModifiersHeld`; `sendMethod`
  (`automatic`, `browser_debugger`, `content_event`); shared host fallback;
  verification mode/expected value; and common fields.
- **Key grammar:** modifiers and standard named keys use canonical names
  (`Control`, `Alt`, `Shift`, `Meta`, `Enter`, `Escape`, arrows, function keys)
  plus single Unicode characters. Shortcuts use `+`; sequences use an ordered
  list. Unknown names, contradictory modifier actions, and excessive lengths
  fail validation.
- **Execution:** resolve/focus when requested -> browser debugger trusted key
  dispatch first -> content event only for explicitly supported
  page-handled cases -> verify -> optional visible foreground host keystroke ->
  verify. Held modifiers are run-scoped and always released during cleanup.
- **Ports:** `success`, `unresolved`, and `error`.
- **Outputs:** `keyAction`, `keysSent`, `focusedTarget`,
  `executionMethod`, and `verification`.
- **Protected pages:** page/DOM key automation is unavailable; host input does
  not bypass the protected-page rule.
- **Retry:** default zero. Only a verified no-effect action may retry, and
  non-repeatable keys/shortcuts remain blocked regardless of generic retry
  configuration.
- **Stable failures:** common target/focus/protected/host/timeout/cancel/config
  errors plus namespaced invalid-key, key-dispatch-failed,
  modifier-state-invalid, and verification-failed codes.

## Affected surfaces and expected files

- `BRunner/nodes/keyboard/press-key/` package and shared keyboard adapter.
- Debugger attach/detach, held-modifier run cleanup, focus/verification, and
  host fallback adapters.
- Exact v1 registry/background/content execution and provisional send-keys
  isolation.
- Node 013 tests, keyboard fixture/workflow, user catalogue, tracker, roadmap,
  handoff, and this record.

## Ordered implementation steps

| Step | Work | Verification | Status |
|---|---|---|---|
| 1 | Freeze actions, scopes, key grammar, methods, cleanup, output, retry/side-effect, host/protected behavior, and provisional disposition. | Blueprint D2 and product input rules agree with this record. | Complete |
| 2 | Implement definition, key parser/validator, outputs, keyboard/cleanup/verification adapters, executor, cancellation, and retry guard. | Unit tests cover valid/invalid keys, sequences, modifier lifecycle, and no-repeat rules. | Pending |
| 3 | Register exact v1 and integrate Graph/background/content/debugger/host execution; isolate provisional send-keys. | Conditional target, key autocomplete, save/reload/preparation, exact dispatch, and version isolation pass. | Pending |
| 4 | Add deterministic integration coverage for Enter, Escape, Ctrl+A, sequence, hold/release, focus, browser and host paths, cleanup on error/cancel, protected page, verification, disabled, timeout, retry blocking, output, and logs. | Focused runtime/Graph/host tests pass. | Pending |
| 5 | Add `013_press-key_acceptance.json`, fixture, and user documentation. | Synthetic Enter/shortcut success plus invalid/no-effect alternate validate. | Pending |
| 6 | Run focused source checks and mark Source complete - batch acceptance queued. | Node/keyboard/debugger/host tests, syntax, JSON, cleanup, and diff check pass. | Pending |
| 7 | Run consolidated build/full-suite/live acceptance and synchronize evidence. | Batch gate confirms key effects, method, and cleanup. | Pending |

## Completion gates

- Key grammar and target scope are explicit and bounded.
- Debugger and host resources/modifiers are always released.
- Browser-first behavior is real-effect verified.
- Retry cannot duplicate a potentially observed key effect.
- Focused workflow, user documentation, batch regression, and live evidence
  pass before acceptance.

## Recovery procedure

Read the batch program, tracker, and this file. Before resuming, confirm no
debugger attachment or held modifier remains from a partial step. Do not start
Copy to Clipboard until Press Key is source-complete and batch-queued.

