# Node 9 - Focus Element Finalization

**Status:** Queued - contract frozen  
**Updated:** 2026-07-27  
**Main tracker:** `../NODE_IMPLEMENTATION_STATUS.md`  
**Batch program:** `P12_PHASE_1_2_BATCH_PROGRAM.md`  
**Current resume checkpoint:** The contract below is frozen. Before Step 2,
recheck shared target resolution, scroll/visibility helpers, Click focus
support, active-element inspection, and provisional focus v1.

## Objective

Implement catalog Node 9, `element.focus@2`, to place and verify keyboard focus
on a uniquely resolved editable/focusable element using browser focus,
click-to-focus, or optional visible host assistance.

## Non-goals

- Do not focus an unresolved, ambiguous, hidden, or covered target.
- Do not treat dispatched focus events alone as proof that the active element
  changed.
- Do not reinterpret `element.focus@1`.
- Do not retain focus restoration semantics not requested by this node card.

## Frozen contract decisions

- **Identity:** `element.focus@2`; reused stable type requires v2.
- **Fields:** required shared target, `focusMethod` (`browser_api`,
  `click_to_focus`, `automatic`), `scrollIntoView`, `verifyFocus`, shared host
  fallback controls, and common fields. Host is a fallback method, not a value
  that bypasses browser-first execution.
- **Execution:** resolve -> optional scroll -> browser `focus()` with
  prevent-scroll semantics where possible -> active-element verification ->
  click-to-focus if configured -> foreground verified host click only if
  enabled -> final verification.
- **Ports:** `success`, `unresolved`, and `error`.
- **Outputs:** `focused`, `executionMethod`, `targetResolution`, and
  `verification`.
- **Services/capabilities:** `browser-dom`, `target-resolution`,
  `host-assisted`, `side-effect`, `retry-safe`, `async`.
- **Protected pages:** DOM focus is unavailable; host fallback cannot bypass
  the protected-page boundary.
- **Retry:** default one. Retry only while inspection proves the intended
  target is not active and no unrelated page effect occurred.
- **Stable failures:** common target/visible/interactable/protected/host/
  timeout/cancel errors plus namespaced focus-failed and
  verification-failed codes.

## Affected surfaces and expected files

- `BRunner/nodes/interaction/focus/` package and active-element adapter.
- Shared scroll/visibility, pointer, verification, and host policy.
- Exact v2 registry/background/content execution and v1 isolation.
- Node 009 tests, focus fixture/workflow, user catalogue, tracker, roadmap,
  handoff, and this record.

## Ordered implementation steps

| Step | Work | Verification | Status |
|---|---|---|---|
| 1 | Freeze focus methods, verification, routes, output, host behavior, retry, protected-page handling, and v1 isolation. | Blueprint C3 and shared policies agree with this record. | Complete |
| 2 | Implement definition, validators, outputs, focus/verification adapter, executor, cancellation, and retry proof. | Unit tests cover inputs, content-editable, overlays, methods, and failures. | Pending |
| 3 | Register exact v2 and integrate canonical Graph/background/content/host execution. | Target editor, save/reload/preparation, exact dispatch, and v1/v2 rejection pass. | Pending |
| 4 | Add deterministic integration coverage for browser focus, click-to-focus, content-editable, overlay failure, host fallback, disabled, retry, timeout, cancellation, output, and logs. | Focused runtime/Graph/host tests pass. | Pending |
| 5 | Add `009_focus-element_acceptance.json`, fixture, and user documentation. | Synthetic focus success plus covered/unresolved alternate validate. | Pending |
| 6 | Run focused source checks and mark Source complete - batch acceptance queued. | Node/focus/pointer/shared tests, syntax, JSON, and diff check pass. | Pending |
| 7 | Run consolidated build/full-suite/live acceptance and synchronize evidence. | Batch gate confirms active element and safe failure output. | Pending |

## Completion gates

- `focused: true` is emitted only after active-element verification.
- Host focus is opt-in, foreground-verified, and never bypasses protection.
- Retry cannot repeat an uncertain click effect.
- Exact v2 remains isolated from provisional v1.
- Focused workflow, user documentation, batch regression, and live evidence
  pass before acceptance.

## Recovery procedure

Read the batch program, tracker, and this file. Recheck active-element and host
evidence for the active step. Do not start Select Text until Focus is
source-complete and batch-queued.

