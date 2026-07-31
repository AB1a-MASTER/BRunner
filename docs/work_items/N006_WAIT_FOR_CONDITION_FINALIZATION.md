# Node 6 - Wait for Condition Finalization

**Status:** Queued - contract frozen  
**Updated:** 2026-07-27  
**Main tracker:** `../NODE_IMPLEMENTATION_STATUS.md`  
**Batch program:** `P12_PHASE_1_2_BATCH_PROGRAM.md`  
**Current resume checkpoint:** The contract below is frozen. Before Step 2,
recheck the finalized graph cancellation/timeout adapter, tab/page event
sources, Node 5 inspection helpers, and any existing workflow needs-attention
resume mechanism.

## Objective

Implement catalog Node 6, `wait.condition@1`, for bounded event-first/polled
waiting on element, page, tab, workflow-data, or explicit user-resume
conditions without substituting a fixed sleep.

## Non-goals

- Do not implement the later Delay node.
- Do not busy-loop or poll without a hard timeout and cancellation checks.
- Do not evaluate arbitrary JavaScript conditions.
- Do not add general graph pause/scope semantics beyond this node's explicit
  manual-resume condition.

## Frozen contract decisions

- **Identity:** `wait.condition@1`; new finalized type replacing provisional
  element-visible/hidden/enabled/text and URL wait actions.
- **Scopes:** `element`, `page`, `tab`, `workflow`, and `user`.
- **Conditions:** explicit dropdown values cover the blueprint B3 list:
  element exists/disappears/visible/hidden/enabled/disabled/text,
  attribute/value/count change, stable/interactable; page URL/title match,
  navigation start/complete, DOM ready/full load/network idle; tab
  created/active/URL changed/loaded/closed; workflow variable/output
  comparison; and user manual resume.
- **Fields:** `conditionScope`, `condition`, conditionally required shared
  target, `expectedValue`, attribute/output/reference fields,
  `pollingMode` (`automatic`, `fixed_interval`, `event_first_fallback`),
  `pollIntervalMs`, `stabilityDuration`, `timeout`, `onTimeout`
  (`fail`, `continue_timed_out`, `timeout_port`, `ask_user`), shared matching
  controls where applicable, `protectedPagePolicy`, and common fields.
- **Manual resume:** waits through a cancellable interactive adapter and records
  the explicit user response. If no adapter is available, it fails
  `DEPENDENCY_NOT_READY`; it never assumes resume.
- **Ports:** `success`, `timeout`, and `error`. `continue_timed_out` completes
  through success with `conditionMet: false`; `timeout_port` selects timeout.
- **Outputs:** `conditionMet`, `conditionScope`, `condition`,
  `waitDurationMs`, `finalState`, `finalUrl`, and `timeoutReason`.
- **Services/capabilities:** `async`, plus conditional browser DOM/tab,
  mapper/inspection, workflow registry, or manual-gate service.
- **Protected pages:** page/tab waits that need only tab API facts remain
  available; DOM conditions follow `fail`, `skip`, `ask_user`, or
  `wait_until_supported`.
- **Retry:** default zero because the wait already owns its duration. An
  explicit one retry is eligible only after timeout and must create a new
  bounded wait; ambiguity/configuration/protected failures are not retried.
- **Stable failures:** common target/tab/protected/timeout/cancel/config errors
  plus namespaced unsupported-condition and condition-evaluation errors.

## Affected surfaces and expected files

- `BRunner/nodes/targeting/wait-for-condition/` package.
- Reusable condition-inspection/event adapter shared with Check Element State
  only where semantics are identical.
- Exact registry/background/content execution and manual-resume bridge.
- Provisional wait actions isolated or removed from finalized selection.
- Node 006 tests, asynchronous fixture/workflow, user catalogue, tracker,
  roadmap, handoff, and this record.

## Ordered implementation steps

| Step | Work | Verification | Status |
|---|---|---|---|
| 1 | Freeze scopes/conditions, field visibility, timeout routes, outputs, protected split, manual resume, retry, and provisional disposition. | Blueprint B3 and shared runtime rules agree with this record. | Complete |
| 2 | Implement definition, validation, output, event/poll adapters, executor, cancellation, stability window, and timeout policy. | Fake-clock unit tests cover every scope and bounded cleanup. | Pending |
| 3 | Register exact v1 and integrate Graph/background/content/manual-resume execution; isolate provisional waits. | Conditional target/fields, save/reload/preparation, ports, and version rejection pass. | Pending |
| 4 | Add deterministic integration coverage for element appearance, URL match, stabilization, tab events, workflow values, manual resume, timeout variants, protected-page wait-until-navigation, disabled, retry, cancellation, output, and logs. | Focused runtime/Graph tests pass with no leaked listeners/timers. | Pending |
| 5 | Add `006_wait-for-condition_acceptance.json`, dynamic fixture, and complete user documentation. | Synthetic success and timeout/alternate paths validate. | Pending |
| 6 | Run focused source checks and mark Source complete - batch acceptance queued. | Node/condition/shared tests, syntax, JSON, listener cleanup, and diff check pass. | Pending |
| 7 | Run consolidated build/full-suite/live acceptance and synchronize evidence. | Batch gate confirms readiness wait, timeout route, and output timing. | Pending |

## Completion gates

- All waits are cancellable, bounded, stable-duration aware, and listener-safe.
- Tab-only waits remain honest on protected pages; DOM waits do not.
- Manual resume requires explicit user action and survives cancellation/timeout.
- Provisional wait actions cannot be dispatched as finalized v1.
- Focused workflow, user documentation, batch regression, and live evidence
  pass before acceptance and Phase 1 closure.

## Recovery procedure

Read the batch program, tracker, and this file. Recheck fake-clock/listener
cleanup and the one active step. Do not begin Click or Phase 2 until Node 6 is
source-complete and batch-queued.

