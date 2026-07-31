# Node 2 - Scroll Finalization

**Status:** Source complete - batch acceptance queued  
**Updated:** 2026-07-27  
**Main tracker:** `../NODE_IMPLEMENTATION_STATUS.md`  
**Current resume checkpoint:** Steps 1-6 and the artifact-repair Step 5A are
complete. Step 7 remains explicitly deferred into the Phase 1-2 batch. During
that batch, confirm the five live output keys and safe wrong-page/removed-target
route, then close the consolidated full-suite/build gate before acceptance.

## Objective

Implement catalog Node 2, `browser.scroll@2`, through Graph Studio and the
canonical mapper-graph runtime. It must support page and resolved-container
scrolling, amount/top/bottom/element/until-condition operations, bounded
content waits, explicit optional host fallback, stable output and errors, and a
synthetic live acceptance workflow.

## Non-goals

- Do not implement Tab Control or any later catalog node.
- Do not expand mapper or general graph semantics beyond what Scroll requires.
- Do not repair or remove dormant Sequential Studio source.
- Do not add hidden or unattended physical input; any host fallback must remain
  opt-in, visible, foreground-verified, bounded, and last-resort.
- Do not start release, packaging, or V2 saved-map viewer work.

## Frozen contract decisions

- **Identity:** `browser.scroll@2`. Reusing provisional `browser.scroll` forces
  version 2. There is no reviewed v1 migration.
- **Operations:** `by_amount`, `to_top`, `to_bottom`, `to_element`, and
  `until_condition`.
- **Scroll target:** `page` or `container`. One canonical optional target editor
  is shown for the node. A target is required for container scrolling and for
  `to_element`. In `to_element`, the target identifies the destination element
  and the browser scrolls its nearest applicable scroll root.
- **Amount:** non-negative `amount` plus `direction` (`up`, `down`, `left`,
  `right`) and `amountUnit` (`pixels`, `viewport_percent`, `screen`).
  `screen` treats the amount as a viewport multiplier.
- **Element alignment:** `top`, `center`, `bottom`, or `nearest`; mapped to the
  browser's `start`, `center`, `end`, and `nearest` block/inline semantics.
- **Until condition:** explicit dropdown values `scroll_end`,
  `position_unchanged`, `selector_visible`, and `text_present`. The latter two
  require a separate `stopValue`; arbitrary JavaScript evaluation is forbidden.
- **Loop bounds:** positive `maxAttempts`, non-negative
  `pauseBetweenScrolls`, a node `timeout`, cancellation checks between every
  action/wait, and optional bounded content-change observation after each
  scroll.
- **Host policy:** browser-first, `host_assisted`, default off, requires
  `host.window` and `host.action`, uses only the host's validated visible
  `scroll` action, and requires focus/foreground plus post-action browser
  verification. It never bypasses protected pages or repeats an unknown browser
  side effect.
- **Retry:** `verify_before_retry`, default one retry, eligible only for
  `container_not_ready` before a scroll side effect. Amount and loop movement
  are never repeated merely because later verification is uncertain.
- **Outputs:** `operation`, `scrollCount`, `finalPosition`, `stopReason`, and
  `executionMethod`. `finalPosition` includes `x`, `y`, `maxX`, `maxY`,
  `atStart`, and `atEnd`; execution method is `browser` or `host`.
- **Stable failures:** node-specific `CONTAINER_NOT_READY` and `SCROLL_FAILED`
  plus shared configuration, target, protected-page, host, timeout, and
  cancellation errors.

## Affected surfaces and expected files

- `BRunner/nodes/navigation/scroll/definition.js`
- `BRunner/nodes/navigation/scroll/validators.js`
- `BRunner/nodes/navigation/scroll/outputs.js`
- `BRunner/nodes/navigation/scroll/executor.js`
- `BRunner/nodes/navigation/scroll/chromeScrollAdapter.js`
- `BRunner/nodes/navigation/scroll/index.js`
- finalized registry and background runtime/service wiring
- shared target/resolver, retry, cancellation, and host-policy surfaces only as
  required by the frozen Scroll contract
- provisional `browser.scroll@1` and `element.scroll_into_view@1` isolation
- deterministic Scroll unit, adapter, Graph round-trip, and runtime tests
- `tests/fixtures/scroll-acceptance.html`
- `BRunner_Host/Workflows/node_acceptance/002_scroll_acceptance.json`
- `docs/NODE_USER_CATALOG.md`
- `docs/NODE_IMPLEMENTATION_STATUS.md`
- `docs/BRUNNER_MASTER_ROADMAP.md`
- `latest handoff document.txt`
- this recovery record

## Ordered implementation steps

| Step | Work | Verification | Status | Evidence |
|---|---|---|---|---|
| 1 | Freeze the exact Scroll v2 definition and inventory provisional/shared execution surfaces. | Contract addresses every blueprint operation, field, output, retry rule, protected-page behavior, resolver need, and host-fallback boundary; affected files and isolation plan are recorded. | Complete | The frozen decisions above cover identity, operations, conditional target semantics, safe stop conditions, bounds, output, retry, protected-page behavior, and visible verified host fallback. Provisional registry/mapper handlers, canonical target adapter/editor, generic finalized runtime, background Navigate dispatch pattern, content transport, and native `scroll` action were inspected. |
| 2 | Implement the isolated Scroll package: definition, normalization/validation, output builder, executor, browser adapter, stable errors, cancellation, waits, and retry verification. | Focused deterministic definition/validator/executor/adapter/output tests pass. | Complete | Six isolated package modules plus focused node/adapter coverage pass 17/17; the affected shared execution-policy coverage passes 11/11; syntax/import and whitespace checks pass. |
| 3 | Register Scroll v2 in the shared finalized registry and canonical Graph/background runtime while keeping both provisional v1 actions exact-version isolated. | Graph fields, validation, autocomplete, save/reload/preparation, and runtime dispatch agree on `browser.scroll@2`; unsupported versions fail closed. | Complete | The registry now exposes provisional v1 and finalized v2 independently and rejects v3; shared authoring and Graph Studio support optional targets with OR-based conditional requirements; workflow preparation validates v2; background dispatches exact v2 through the generic finalized runtime; the content mapper gates v2 ahead of the preserved v1 path; visible host fallback is foreground prepared and browser verified; mapper diagnostics survive retry normalization and route through the definition's unresolved port. Syntax checks and the affected package, policy, registry, authoring, Graph, runtime, host-bridge, and Navigate-regression suite pass 101/101. |
| 4 | Add deterministic Graph/runtime integration, failure, disabled, retry, timeout, logging, protected-page, and semantic round-trip coverage. | Focused Scroll and canonical runtime suites pass with no Navigate regressions. | Complete | Direct content-runtime tests exercise provisional v1 isolation, v2 page amount/boundary telemetry, container readiness, mapper unresolved state, element alignment, safe selector/text conditions, inspection-only verification, cancellation, and vertical host preparation. Graph round-trip tests cover conditional targets, typed values, autocomplete, error/unresolved edges, preparation, and v3 rejection. Full finalized-runtime integration covers output publication, structural logging, disabled/protected paths, verified retry, timeout, and unresolved diagnostics. The affected Scroll/shared/Graph/host/Navigate suite passes 148/148 with syntax checks. |
| 5 | Add the synthetic Scroll fixture/workflow and complete the end-user catalogue entry. | Acceptance JSON passes schema/catalog guards and documents success plus a safe failure/alternate route. | Complete | Added a repository-owned scrollable-container fixture and canonical `002_scroll_acceptance.json` using bounded `until_condition`, explicit CSS target data, host fallback off, stable five-key output, and both error/unresolved Needs Attention routes. The user catalogue now covers purpose, requirements, every field, autocomplete, Graph usage, execution/retry/timeout/host behavior, output, troubleshooting, and live steps. Acceptance metadata, fixture existence/content, Graph round-trip/preparation, catalog, guidance, and presentation checks pass 20/20. |
| 5A | Restore the missing checked-in Scroll acceptance workflow discovered during the Phase 1-2 documentation audit. | The reconstructed JSON matches the frozen contract and existing focused schema/Graph expectations; fixture and catalogue references resolve. | Complete | Restored the canonical workflow with one shared Needs Attention node reached by error and unresolved routes. Acceptance schema/fixture checks and full Graph save/reload/background preparation pass 8/8; the affected whitespace check passes. |
| 6 | Rebuild Graph Studio if imported shared sources changed and run the complete JavaScript/Python, syntax, fingerprint, and whitespace gates. | All source gates pass and the built Graph bundle matches source. | Complete | The production Graph Studio bundle rebuilt from 191 modules. The complete JavaScript suite passes 481/481, Python passes 183/183, 12 changed production JavaScript files pass syntax checks, the acceptance JSON parses, build fingerprint/integrity checks pass inside the full suite, and `git diff --check` reports no errors. |
| 7 | Run unpacked-extension Scroll success and bounded alternate/failure acceptance, synchronize records, and provide a detailed user-controlled Conventional Commit handoff. | Live behavior and required output pass; tracker/catalogue/roadmap/handoff agree; no hash is requested unless the user explicitly asks. | Batch acceptance queued | On 2026-07-27 the user explicitly deferred Scroll live acceptance into the consolidated Phase 1-2 batch. Source and focused automated gates remain complete; live success/failure evidence and final batch regression evidence remain required. |

## Item-level completion gates

- Frozen `browser.scroll@2` definition covers the exact blueprint contract and
  uses stable typed ports, services, retry safety, protected-page behavior,
  host policy, and output schema.
- Every user-entered field has validation, defaults, help, advanced placement,
  examples, applicable autocomplete, and explicit dropdown/checkbox semantics.
- Browser page/container/element scroll, bounded until-condition loops, content
  waits, cancellation, timeout, no-op detection, and output publication are
  deterministic and tested.
- Optional host fallback is browser-first, visible, foreground-verified,
  opt-in, bounded, and never repeats an uncertain browser side effect.
- Provisional `browser.scroll@1` and `element.scroll_into_view@1` remain
  isolated and are never silently executed as v2.
- Graph Studio edit/save/reload/background-plan/runtime semantics round-trip
  without conversion or field loss.
- The canonical `002_scroll_acceptance.json` workflow passes automated schema
  guards and focused unpacked-extension live acceptance using only synthetic
  repository data.
- User catalogue, tracker, roadmap, handoff, and this record agree on status.
- The user receives a detailed Conventional Commit subject and body; commit
  hashes remain untracked unless explicitly requested.

## Recovery procedure

Read the main tracker and this record first. Only the step marked **In
progress** may continue. Re-run each completed step's focused evidence before
depending on it, inspect the files named by the current checkpoint, and do not
begin Tab Control while any Scroll gate remains incomplete.

## Evidence log

- 2026-07-27: The user explicitly started the next catalog item after Navigate
  live acceptance and changed the Git SOP to require detailed commit handoffs
  without default hash tracking. Navigate was closed under that policy and
  Scroll Step 1 began.
- 2026-07-27: Blueprint A2 defines five operations (`by_amount`, `to_top`,
  `to_bottom`, `to_element`, `until_condition`), page/container targeting,
  amount units, alignment, smooth behavior, bounded attempts/content waits,
  optional host fallback, five stable outputs, and retry only for
  container-not-ready. Provisional source currently splits this behavior
  between `browser.scroll@1` pixel offsets and
  `element.scroll_into_view@1`; neither is a finalized compatibility contract.
- 2026-07-27: Shared-surface inventory confirmed that the generic finalized
  executor already owns common normalization, timeout, cancellation, retry,
  error routing, result publication, and logging. The mapper content transport
  can preserve exact node versioning, and the native host already exposes a
  validated foreground `scroll` action. The Graph target editor currently
  assumes an always-required target, so Step 3 must add explicit optional target
  support without weakening existing required-target validation.
- 2026-07-27: The isolated Scroll package now freezes 26 shared Graph fields,
  conditional target requirements, five output keys, stable errors, bounded
  adapter loops, cancellation, container-ready retry verification, and
  foreground-verified host planning. Scroll tests pass 17/17 and shared policy
  tests pass 11/11; all six new modules pass syntax/import checks and the
  affected whitespace gate reports no errors.
- 2026-07-27: Canonical integration registers finalized
  `browser.scroll@2` beside provisional v1, adds optional conditional target
  validation/editor presentation, validates Scroll during preparation, and
  dispatches exact v2 through the shared finalized runtime and a version-gated
  content transport. The browser path records bounded telemetry for page,
  container, element, and safe-condition operations; visible host preparation
  is vertical-only, foreground-gated, and post-action verified. Generic retry
  normalization now preserves mapper diagnostics so the Scroll unresolved port
  remains explicit. Affected syntax and integration tests pass 101/101.
- 2026-07-27: Step 4 added direct content-runtime, Graph semantic round-trip,
  source-dispatch, and finalized-runtime integration suites. They verify
  v1/v2 isolation, conditional target data reaching runtime validation, page
  and container movement, element alignment, bounded conditions, retry,
  timeout, cancellation, logging, protected-page failure, unresolved routing,
  and host preparation. The affected suite, including Navigate regressions,
  passes 148/148.
- 2026-07-27: Step 5 added the bounded synthetic Scroll fixture, canonical
  Node 002 acceptance workflow, dual safe-failure routes, and complete
  acceptance-pending user catalogue entry. Acceptance schema, fixture,
  Graph-round-trip/preparation, catalog, guidance, and presentation checks pass
  20/20.
- 2026-07-27: Step 6 rebuilt canonical Graph Studio from 191 modules. The full
  JavaScript suite passes 481/481 and Python passes 183/183. Twelve changed
  production JavaScript files pass syntax checks, the acceptance JSON parses,
  production build fingerprint/integrity checks pass, and `git diff --check`
  reports no errors.
- 2026-07-27: Final live-preparation review tightened
  `selector_visible` so rendered elements must also intersect the page viewport
  or resolved scroll container. The live workflow now proves repeated movement
  with `scroll_end` and reaches the fixture's bottom completion marker. Focused
  Scroll/acceptance checks pass 35/35 and the complete JavaScript suite remains
  481/481. The no-store fixture server is running on `127.0.0.1:8765`; the
  native host is running on port 8999.
- 2026-07-27: The user explicitly requested that Scroll live acceptance be
  deferred and rerun with the remaining Phase 1-2 nodes. Step 7 moved from
  active to batch-queued status without treating the node as accepted or
  complete.
- 2026-07-27: The Phase 1-2 documentation audit found
  `BRunner_Host/Workflows/node_acceptance/002_scroll_acceptance.json` missing
  while its record/tests/docs still referenced it. Step 5A reopened the source
  artifact gate; Node 3 was paused at a partial isolated-package step.
- 2026-07-27: Step 5A restored the missing workflow. The first focused run
  exposed that canonical Graph normalization permits one system Needs Attention
  node, so both safe routes now converge on that node. Acceptance and Scroll
  Graph round-trip checks pass 8/8, and Node 3 may resume.
