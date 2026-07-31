# Node 8 - Hover / Move Pointer Finalization

**Status:** Queued - contract frozen  
**Updated:** 2026-07-27  
**Main tracker:** `../NODE_IMPLEMENTATION_STATUS.md`  
**Batch program:** `P12_PHASE_1_2_BATCH_PROGRAM.md`  
**Current resume checkpoint:** The contract below is frozen. Before Step 2,
recheck Click's pointer adapter, tab/window visibility services, host foreground
verification, provisional hover handling, and context-restoration behavior.

## Objective

Implement catalog Node 8, `element.hover@2`, for visible foreground pointer
movement over a resolved target or explicit coordinate with optional hold,
verification, and restoration of prior tab/window context.

## Non-goals

- Do not perform invisible/background hover.
- Do not report browser window focus without verifying the target tab/window
  state required by the chosen execution method.
- Do not silently ignore a minimized or unavailable window.
- Do not reinterpret provisional `element.hover@1`.

## Frozen contract decisions

- **Identity:** `element.hover@2`; reused provisional type requires v2.
- **Operations:** `hover`, `move_to_coordinates`, `move_away`, and
  `pause_over_target`.
- **Fields:** canonical target or coordinates, target position/custom offset,
  movement style (`instant`, `smooth`), movement duration, hold duration,
  `restorePreviousTabAfterHover`,
  `restorePreviousWindowFocusAfterHover`, `onVisibilityFailure`
  (`fail`, `skip`, `error_port`), verification mode/expected value, shared host
  fallback controls, and common fields.
- **Mandatory visibility:** activate the selected tab, make its window visible
  and non-minimized, foreground it as required, bring the target into the
  viewport, resolve final coordinates, and fail honestly when any required
  state cannot be achieved.
- **Execution:** Chrome debugger/browser pointer movement is browser-first.
  Physical host movement is optional, foreground-verified, and last-resort.
  Restoration happens only after verification/hold and records its outcome.
- **Ports:** `success`, `unresolved`, and `error`.
- **Outputs:** `operation`, `foreground`, `windowVisible`, `coordinates`,
  `executionMethod`, `targetResolution`, `verification`, and
  `restoredContext`.
- **Protected pages:** page-target hover is unavailable and cannot fall back
  through the host.
- **Retry:** default one for visibility/transient failures only when
  verification proves no hover-triggered effect. Unknown menus/tooltips or
  page changes block retry.
- **Stable failures:** common target/visibility/protected/host/timeout/cancel
  errors plus namespaced hover-failed, visibility-failed,
  verification-failed, and restore-failed codes.

## Affected surfaces and expected files

- `BRunner/nodes/interaction/hover/` package, reusing the safe pointer adapter.
- Tab/window activation, viewport/coordinate, host foreground, and restoration
  adapters.
- Exact v2 registry/background/content/debugger integration and provisional v1
  isolation.
- Node 008 tests, hover fixture/workflow, user catalogue, tracker, roadmap,
  handoff, and this record.

## Ordered implementation steps

| Step | Work | Verification | Status |
|---|---|---|---|
| 1 | Freeze operations, mandatory visibility, restore behavior, output, verification, host policy, retry, and v1 isolation. | Blueprint C2 and product physical-input rules agree with this record. | Complete |
| 2 | Implement package and reusable pointer visibility/restoration adapter. | Unit tests cover coordinate calculation, visibility failures, restoration, verification, and cleanup. | Pending |
| 3 | Register exact v2 and integrate Graph/background/content/debugger/host execution. | Save/reload/preparation, exact dispatch, target/coordinate modes, and v1 rejection pass. | Pending |
| 4 | Add deterministic integration coverage for inactive-tab activation, minimized-window failure, tooltip/menu verification, smooth/hold, host hover, restoration, disabled, retry, timeout, cancellation, output, and logs. | Focused runtime/Graph/host tests pass. | Pending |
| 5 | Add `008_hover-move-pointer_acceptance.json`, fixture, and user documentation. | Synthetic tooltip success plus visibility/verification alternate validate. | Pending |
| 6 | Run focused source checks and mark Source complete - batch acceptance queued. | Node/pointer/window/host tests, syntax, JSON, and diff check pass. | Pending |
| 7 | Run consolidated build/full-suite/live acceptance and synchronize evidence. | Batch gate confirms visible hover, tooltip result, restoration, and safe failure. | Pending |

## Completion gates

- No hover executes on an unresolved target or hidden/background physical path.
- Foreground/visibility and restoration outcomes are structured and logged.
- Retry is blocked after an uncertain hover-triggered side effect.
- Exact v2 and provisional v1 remain isolated.
- Focused workflow, user documentation, batch regression, and live evidence
  pass before acceptance.

## Recovery procedure

Read the batch program, tracker, and this file. Recheck current tab/window
cleanup and debugger/host release before continuing. Do not start Focus until
Hover is source-complete and batch-queued.

