# Node 7 - Click Finalization

**Status:** Queued - contract frozen  
**Updated:** 2026-07-27  
**Main tracker:** `../NODE_IMPLEMENTATION_STATUS.md`  
**Batch program:** `P12_PHASE_1_2_BATCH_PROGRAM.md`  
**Current resume checkpoint:** The contract below is frozen. Before Step 2,
recheck Phase 1 source checkpoints, the shared target/host execution adapters,
Chrome debugger pointer recovery, provisional click handlers, and verification
helpers.

## Objective

Implement catalog Node 7, `element.click@2`, as the finalized target- or
coordinate-based pointer action with explicit verification, browser-first
execution, opt-in visible host fallback, and side-effect-safe retries.

## Non-goals

- Do not reinterpret provisional `element.click@1` or
  `element.double_click@1` configuration as v2.
- Do not click an unresolved, ambiguous, covered, invisible, or disallowed
  target.
- Do not retry merely because post-click state is unknown.
- Do not allow background physical input.

## Frozen contract decisions

- **Identity:** `element.click@2`; reused stable type requires version 2.
- **Operations:** `single`, `double`, `right`, `middle`, `hold`, and `release`.
- **Target:** `targetMode` is `target_identifier`, `coordinates`, or
  `prior_resolved_target`; all use the canonical target editor. Coordinate
  targets are explicit non-component targets. `clickPosition`,
  `coordinateType` (`viewport`, `element_relative`, `browser_window`),
  custom offsets, modifier-key checkboxes, `delayBefore`, `doubleClickDelay`,
  `clickCount`, `scrollIntoView`, `requireVisible`, and
  `requireInteractable` are explicit fields.
- **Verification:** `verificationMode` is `none`, `target_state`,
  `url_changed`, `target_appears`, `target_disappears`, `text_present`, or
  `value_changed`, with conditionally required expected value/verification
  target. No arbitrary JavaScript is accepted.
- **Host:** browser/content or Chrome debugger pointer action runs first.
  `useHostFallback`, trigger, unavailable behavior, foreground requirement,
  and before/after evidence use the shared host policy. Physical fallback is
  visible, foreground-verified, coordinate-confidence gated, and verified.
- **Ports:** `success`, `unresolved`, and `error`.
- **Outputs:** `clickType`, `coordinates` (viewport and screen when known),
  `executionMethod`, `targetResolution`, and `verification`.
- **Protected pages:** DOM/coordinate page clicking is unavailable. The node
  never uses host fallback to bypass a protected page.
- **Retry:** default zero. An explicit retry is allowed only when verification
  proves the action did not occur; hold/release, right/middle, navigation, and
  unknown side effects are never repeated blindly.
- **Stable failures:** common target/visibility/interactable/protected/host/
  timeout/cancel/config codes plus namespaced click-failed,
  verification-failed, and pointer-state-invalid errors.

## Affected surfaces and expected files

- `BRunner/nodes/interaction/click/` package and browser pointer adapter.
- Exact v2 registry/background/content/debugger dispatch and shared
  verification/host policy.
- Provisional click/double-click v1 isolation.
- Node 007 tests, interactive synthetic fixture/workflow, user catalogue,
  tracker, roadmap, handoff, and this record.

## Ordered implementation steps

| Step | Work | Verification | Status |
|---|---|---|---|
| 1 | Freeze operations, target/coordinate controls, verification, routes, output, host policy, protected behavior, and side-effect retry rules. | Blueprint C1 and shared policies agree with this record. | Complete |
| 2 | Implement definition, validators, outputs, pointer/verification adapters, executor, cancellation, and retry proof. | Unit tests cover all click types, coordinates/modifiers, target failures, and retry classification. | Pending |
| 3 | Register exact v2 and integrate canonical Graph/background/content/debugger execution; isolate both provisional v1 actions. | Save/reload/preparation, target modes, routes, exact dispatch, and v1/v2 rejection tests pass. | Pending |
| 4 | Add deterministic integration coverage for normal/modifier/double/right/middle/hold-release, blocked target, verified host fallback, failed verification, disabled, timeout, cancellation, output, logs, and no duplicate side effect. | Focused runtime/Graph/host tests pass. | Pending |
| 5 | Add `007_click_acceptance.json`, fixture, and complete user documentation. | Synthetic click success plus unresolved/verification failure validate. | Pending |
| 6 | Run focused source checks and mark Source complete - batch acceptance queued. | Node/pointer/host/shared tests, syntax, JSON, and diff check pass. | Pending |
| 7 | Run consolidated build/full-suite/live acceptance and synchronize evidence. | Batch gate confirms browser-first click, output, and safe failure route. | Pending |

## Completion gates

- Exact v2 is never confused with either provisional v1 action.
- Every click has an unambiguous target/coordinate and explicit pointer state.
- Browser-first and physical fallback behavior is visible and verifiable.
- Retry cannot duplicate an uncertain external action.
- Focused workflow, user documentation, batch regression, and live evidence
  pass before acceptance.

## Recovery procedure

Read the batch program, tracker, and this file. Recheck pointer attachment
cleanup and side-effect evidence before continuing an active step. Do not start
Hover until Click is source-complete and batch-queued.

