# Node 4 - Resolve Element Finalization

**Status:** Source complete - batch acceptance queued  
**Updated:** 2026-07-31  
**Main tracker:** `../NODE_IMPLEMENTATION_STATUS.md`  
**Batch program:** `P12_PHASE_1_2_BATCH_PROGRAM.md`  
**Current resume checkpoint:** Steps 1-6 are complete and Node 4 is **not
accepted**. Only Step 7 remains: the focused unpacked-extension run of
`004_resolve_element_acceptance.json`, which is a user-run manual gate owned by
the batch program. The consolidated automated side already passed against this
tree on 2026-07-31 - Graph Studio rebuilt from 191 modules, JavaScript 583/583,
Python 183/183, fingerprint/integrity, and whitespace - but the batch will rerun
it from the final post-Node-15 tree, and that rerun is authoritative. Do not
reopen the source unless the live run or the batch rerun fails. Two contract-visible
Step 3 decisions are recorded below under "Step 3 implementation decisions
requiring user review" and should be confirmed by the user. The next source item
is Node 5, Check Element State, which additionally needs the generic repeatable
structured-check editor described in the batch program.

## Objective

Implement catalog Node 4, `element.resolve@1`, for explicit reusable mapper
resolution of a known component, dynamic element discovery, or component
revalidation without performing a page-changing action.

## Non-goals

- Do not create an alternate DOM resolver outside the mapper.
- Do not silently choose a materially ambiguous target.
- Do not add extraction semantics beyond bounded component metadata.
- Do not make a coordinate-only input appear to be a durable ComponentRef.

## Frozen contract decisions

- **Identity:** `element.resolve@1`; this is a new finalized type with no
  provisional equivalent.
- **Modes:** `resolve_known`, `find_dynamic`, and `revalidate_component`.
- **Target:** the shared target editor is required. It retains explicit
  identifier kind/value, matching, scope, target state, freshness, fallback,
  ambiguity, confidence, and tab source controls.
- **Fields:** `mode`, `expectedElementType`, `resultCardinality`
  (`one`, `first`, `all`), `searchScope`, `visibilityRequirement`
  (`any`, `visible`, `interactable`), `mapFreshness`, `minimumConfidence`,
  `ambiguityPolicy`, and common node fields. `first` is an explicit dynamic
  discovery choice after complete candidate collection; `one` fails when the
  verified match count is not exactly one.
- **Ports:** `success`, `unresolved`, and `error`. Missing, stale-unrecoverable,
  or ambiguous mapper outcomes use `unresolved`; invalid configuration,
  protected-page, service, timeout, and cancellation failures use `error`.
- **Outputs:** `mode`, `resolvedComponentId`, `component`, `components`,
  `matchCount`, and `targetResolution`. `component` is nullable for an
  all-result and contains only bounded mapper-owned identity, semantic type,
  page/frame context, state summary, and confidence data. `components` is a
  bounded array; raw DOM nodes and unbounded evidence are forbidden.
- **Services/capabilities:** `browser-dom`, `target-resolution`, `retry-safe`,
  `async`; tabs, scripting/content transport, and mapper are required.
- **Protected pages:** DOM resolution is unavailable and follows the configured
  shared protected-page policy without retrying the protected page itself.
- **Retry:** default one for stale-map or target-not-ready categories. Dynamic
  no-match may retry only when freshness/state says the page can still change;
  ordinary ambiguity is never retried as a way to choose a candidate.
- **Stable failures:** common target/protected/timeout/cancel codes plus a
  namespaced resolution-failed code mapped to the target category.

## Step 3 implementation decisions requiring user review

These two points were not settled by the frozen contract and were decided during
Step 3. Both fail closed and neither widens the node's scope, but they are
recorded here explicitly because they are contract-visible.

1. **`first` and `all` require an explicit CSS or XPath target selector.** The
   mapper resolves exactly one component and exposes no multi-match query, so a
   complete candidate set can only be enumerated from a selector the user typed.
   With any other identifier kind, `first` and `all` fail with `CONFIG_INVALID`
   rather than silently degrading to a single match. Enumeration is bounded to
   200 elements and is a literal selector enumeration, not a second semantic
   resolver, so the mapper remains the only resolution authority.
2. **A direct explicit-locator match reports confidence `1.0`.** The recorded
   resolver returns strategy-preference scores, not match confidence, and a CSS
   selector scores 68. Passing that through would make a uniquely matched,
   user-written selector fail the default 0.75 minimum. Mapper, fuzzy, and
   controls-tree matches still report their real scores.

## Affected surfaces and expected files

- `BRunner/nodes/targeting/resolve-element/` package.
- Shared target adapter and mapper transport only for bounded all-result output
  and exact diagnostics not already exposed.
- Registry, background finalized dispatch, and content mapper query operation.
- Node 004 focused tests, mapper-regression tests, synthetic fixture/workflow,
  user catalogue, tracker, roadmap, handoff, and this record.

## Ordered implementation steps

| Step | Work | Verification | Status |
|---|---|---|---|
| 1 | Freeze modes, cardinality semantics, routes, bounded output, mapper authority, retry, and protected-page behavior. | Blueprint B1 and shared target contract agree with this record. | Complete |
| 2 | Implement definition, validators, outputs, mapper adapter, executor, cancellation, and retry verification. | Focused unit tests cover primary, fallback, stale refresh, cardinality, bounds, and errors. | Complete - 2026-07-31: 34 focused tests pass across `resolveElementNode.test.mjs` and `resolveElementMapperAdapter.test.mjs`. The isolated `BRunner/nodes/targeting/resolve-element/` package covers all three modes, the three cardinalities, primary and fallback resolution, stale-map retry eligibility, never-retried ambiguity, below-minimum confidence, visibility requirements, protected pages, missing tab, refresh-before-resolution, and bounded component output that drops raw DOM evidence. |
| 3 | Register v1 and integrate canonical Graph/background/content execution. | Exact-version, target editor, autocomplete, save/reload/preparation, and unsupported-version tests pass. | Complete - 2026-07-31: exact `element.resolve@1` is registered in `BRunner/core/nodeRegistry.js`, dispatched by `isFinalizedResolveElementContract` in `BRunner/background.js` with mapper-unresolved errors routed to the `unresolved` port, and resolved in `BRunner/content/mapper.js` by `executeFinalizedResolveElementStep` without touching the element. 168 focused tests pass across the Node 4 suites plus Navigate/Scroll/Tab Control, shared finalized runtime, exact-version registry, acceptance schema, canonical preparation, and recorder regressions. The shared target editor attaches generically from `targetRequired`, so no Graph Studio *source* change was needed. A rebuild was still required: `BRunner/core/nodeRegistry.js` is an imported shared module, so registering the node invalidated the production bundle fingerprint. The bundle was rebuilt from 191 modules and the fingerprint gate passes. |
| 4 | Add deterministic runtime/mapper coverage for primary success, fallback, ambiguity, shadow-aware scope, no target, disabled, retry, timeout, cancellation, downstream output, and logs. | Focused integration and Graph semantic tests pass. | Complete - 2026-07-31: 294 focused tests pass. `resolveElementRuntimeIntegration.test.mjs` covers typed output and structural logs, disabled skip, protected page, one stale-map retry that then succeeds, never-retried ambiguity on the unresolved route, not-found retry exhaustion, timeout, cancellation, the shadow-aware default scope, bounded downstream component sets under alias publication, fallback marking, and missing-target validation. `resolveElementContentRuntime.test.mjs` covers in-page bounded facts, direct-match full confidence, real scores for non-direct matches, unresolved reporting, visible/interactable rejection, complete candidate enumeration for `all`/`first`, the fail-closed non-enumerable selector, and the 200-element bound. Navigate, Scroll, Tab Control, mapper core/coordinator, and canonical preparation regressions pass alongside. |
| 5 | Add `004_resolve_element_acceptance.json`, fixture cases, and complete user documentation. | Workflow schema and synthetic success/unresolved paths validate. | Complete - 2026-07-31: added `tests/fixtures/resolve-acceptance.html` with a single-match table, four enumerable rows, and a hidden panel; added the canonical `004_resolve_element_acceptance.json` covering `resolve_known`/one, `find_dynamic`/all, and a `#absent-element` node whose `unresolved` handle reaches Needs Attention; added the dedicated guard "Resolve Element acceptance is read-only, bounded, and routes an absent target" and a checked-in acceptance Graph round-trip. The complete Node 4 user-catalog entry was added to `docs/NODE_USER_CATALOG.md` with purpose, mode table, every field and default, safe cardinality rules, Graph usage, execution/retry/verification behavior, bounded output, downstream expressions, stable failures, and the acceptance procedure. |
| 6 | Run focused source checks and mark Source complete - batch acceptance queued. | Node and affected mapper/shared tests, syntax, JSON, and diff check pass. | Complete - 2026-07-31: 382 focused tests pass across the five Node 4 suites plus Navigate, Scroll, Tab Control, shared finalized runtime, exact-version registry, acceptance schema, node authoring/catalog/contracts/presentation/guidance, shared target and result adapters, canonical workflow preparation, workflow schema, Graph Studio model, recorder recovery/semantics, mapper core and coordinator, execution policy, and text matching. All six Node 4 sources plus `background.js`, `content/mapper.js`, and `core/nodeRegistry.js` pass `node --check`, all four acceptance workflows parse as JSON, and `git diff --check` exits clean with no whitespace errors. Because registering the node changed an imported shared module, Graph Studio was rebuilt from 191 modules; after that rebuild the complete suites pass at JavaScript 583/583 and Python 183/183 with the build fingerprint/integrity gates green. |
| 7 | Run consolidated build/full-suite/live acceptance and synchronize evidence. | Batch gate confirms reusable ComponentRef output and safe ambiguity route. | Pending |

## Completion gates

- Mapper primary-first resolution and fallback diagnostics remain authoritative.
- Cardinality and ambiguity policies never silently guess.
- Outputs are bounded, serializable, and reusable by later target slots.
- Graph target semantics round-trip without conversion or evidence loss.
- Focused workflow, user documentation, batch regression, and live evidence
  pass before acceptance.

## Recovery procedure

Read the batch program, tracker, and this file. Revalidate the active step and
mapper bounds before continuing. Do not start Check Element State until Node 4
is source-complete and batch-queued.

