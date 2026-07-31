# Node 5 - Check Element State Finalization

**Status:** Queued - contract frozen  
**Updated:** 2026-07-27  
**Main tracker:** `../NODE_IMPLEMENTATION_STATUS.md`  
**Batch program:** `P12_PHASE_1_2_BATCH_PROGRAM.md`  
**Current resume checkpoint:** The contract below is frozen. Before Step 2,
recheck Node 4 output reuse, shared text matching, screenshot service, and the
Graph field renderer. The first source step must implement a canonical
repeatable typed-row field for `checks[]`; do not replace it with a free-form
JSON box.

## Objective

Implement catalog Node 5, `element.check_state@1`, as a read-only, multi-check
page-state node with explicit Passed, Not Passed, and Error routes.

## Non-goals

- Do not change page state while evaluating checks.
- Do not treat an ordinary false condition as an execution error.
- Do not allow arbitrary JavaScript in expression evaluation.
- Do not weaken mapper ambiguity rules for existence or count checks.

## Frozen contract decisions

- **Identity:** `element.check_state@1`; new finalized type.
- **Target:** shared target configuration is required and may consume the
  reusable component output from Resolve Element.
- **Checks:** `checks[]` is a repeatable canonical collection with stable row
  IDs and typed controls. Supported check kinds cover existence, visibility,
  viewport/coverage, enabled/editable/focus/checked/selected/expanded state,
  text/attribute/value comparison, count comparison, and parent/child/role/type
  relations from blueprint B2. Each row exposes only applicable dropdowns and
  expected-value/attribute/count fields with shared autocomplete.
- **Evaluation:** `evaluationMode` is `all`, `any`, or `expression`.
  `evaluationExpression` uses row IDs, parentheses, `AND`, `OR`, and `NOT`
  through a bounded boolean parser; it is not JavaScript.
- **Matching:** text-bearing checks use the complete shared matching controls:
  mode, case sensitivity, whitespace, occurrence, multiple-match behavior, and
  empty-value behavior.
- **No match:** `treatNoMatchAs` is `not_passed` or `node_error`.
  `screenshotOnFailedCheck` is explicit and uses the existing bounded
  screenshot service.
- **Ports:** `passed`, `not_passed`, and `error`; the selected route and full
  result are still published before traversal.
- **Outputs:** `passed`, `evaluationMode`, `checkResults`, and
  `targetResolution`. Each result includes row ID, check kind, observed bounded
  value/state, expected value, pass flag, and diagnostic reason.
- **Services/capabilities:** `browser-dom`, `target-resolution`, `retry-safe`,
  `async`; mapper/content inspection is required and screenshot is conditional.
- **Protected pages:** DOM checks fail or follow an explicitly configured
  protected-page policy; tab-only facts do not make the element node available.
- **Retry:** only target resolution or transient inspection errors are
  retry-eligible. A valid `not_passed` result consumes no retry.
- **Stable failures:** common target/ambiguity/protected/timeout/cancel/config
  codes plus namespaced invalid-check and inspection-failed errors.

## Affected surfaces and expected files

- `BRunner/nodes/targeting/check-element-state/` package.
- Shared authoring/Graph typed collection field and validation/round-trip
  support.
- Shared text matching, mapper inspection transport, and screenshot adapter.
- Exact v1 registry/background/content runtime integration.
- Node 005 tests, state-rich synthetic fixture/workflow, user catalogue,
  tracker, roadmap, handoff, and this record.

## Ordered implementation steps

| Step | Work | Verification | Status |
|---|---|---|---|
| 1 | Freeze checks, typed collection, safe expression grammar, ports, output, no-match, retry, and protected behavior. | Blueprint B2 and shared contracts agree with this record. | Complete |
| 2 | Implement canonical typed collection authoring/validation and isolated node package. | Renderer/schema tests prove add/edit/remove/reorder/default/help/validation semantics; node unit tests cover every check family. | Pending |
| 3 | Integrate exact v1 into Graph/background/content inspection runtime. | Save/reload/preparation preserves row IDs/types/values and routes; unsupported versions fail closed. | Pending |
| 4 | Add deterministic integration coverage for all/any/expression, false route, missing target policy, count/text matching, screenshot failure capture, disabled, retry, timeout, cancellation, output, and logs. | Focused runtime/Graph tests pass without mutating the fixture. | Pending |
| 5 | Add `005_check-element-state_acceptance.json`, fixture, and complete user documentation. | Synthetic Passed, Not Passed, and safe Error paths validate. | Pending |
| 6 | Run focused source checks and mark Source complete - batch acceptance queued. | Node/shared authoring/mapper tests, syntax, JSON, and diff check pass. | Pending |
| 7 | Run consolidated build/full-suite/live acceptance and synchronize evidence. | Batch gate confirms all three routes and detailed check results. | Pending |

## Completion gates

- Users configure checks with typed labelled controls, never guessed JSON.
- Read-only inspection produces deterministic bounded evidence.
- False checks route Not Passed and are not misclassified as errors/retries.
- Text matching and ambiguity semantics reuse the shared adapters exactly.
- Focused workflow, user documentation, batch regression, and live evidence
  pass before acceptance.

## Recovery procedure

Read the batch program, tracker, and this file. If typed-collection work is
partial, verify Graph source, shared classic-script parity, validator behavior,
and round-trip tests before continuing. Do not start Wait for Condition until
Node 5 is source-complete and batch-queued.

