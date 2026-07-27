# B12 - Graph Editor, Save, Reload, and Runtime Round Trip

**Status:** Complete  
**Updated:** 2026-07-25  
**Main tracker:** `../NODE_IMPLEMENTATION_STATUS.md`  
**Current resume checkpoint:** Closed. All five ordered steps and their
verification gates passed. Resume at Navigate's focused live acceptance; do not
reopen B12 unless that run exposes a reproducible preparation or round-trip
defect.

## Objective

Prove that Graph Studio's in-memory canvas, saved mapper-graph JSON, reloaded
canvas, and background execution preparation describe the same exact workflow.
The gate must cover exact node contracts, typed configuration, entry, routes,
positions, workflow metadata, semantic node data, validation, reachability
autocomplete, and the actual execution plan consumed by the background.

## Confirmed defects

- Graph Studio clones Graph v2 input and saves its original schema version
  instead of canonical mapper-graph v3.
- `workflowToCanvas` omits `entryNodeId` from editor metadata and save derives
  it again instead of retaining the explicit valid entry.
- Non-core top-level metadata such as the acceptance manifest is dropped by a
  load/save cycle.
- Canvas-only defaults can add `target`, `executionMode`, `skipWhen`, and
  `collapsed` fields to node data that did not contain them.
- Preparation returns a canonical workflow but does not expose one explicit,
  deterministic execution-plan object for the background and tests to share.
- Existing model tests cover individual fields but not one complete
  editor-save-reload-background semantic parity fixture.

## Non-goals

- Do not implement Scroll or any later catalog node.
- Do not restore, test, or modify Sequential Studio.
- Do not implement loops, joins, scopes, or general multi-port scheduling;
  those remain B18.
- Do not redesign Graph Studio UI or change finalized Navigate behavior.
- Do not perform release packaging or C12 cleanup.

## Affected surfaces

- `BRunner/studio-graph-src/src/graphStudioModel.js`
- `BRunner/core/workflowPreparation.js`
- `BRunner/background.js`
- Graph model, preparation, autocomplete, acceptance, and source tests
- generated `BRunner/studio-graph/` assets
- main tracker and this recovery record

## Ordered implementation steps

| Step | Work | Focused verification | Status | Evidence |
|---|---|---|---|---|
| 1 | Read the tracker/blueprint, trace Graph load/save/run and canonical preparation, document exact drift, and register this record. | Inventory covers versions, typed config, entry, routes, positions, workflow metadata, node data, validation, autocomplete, and runtime input. | Complete | Graph v2 persistence, omitted entry, dropped top-level metadata, injected node-data defaults, implicit preparation result, and missing complete parity fixture were confirmed. The audit also found and repaired B11's referenced Needs Attention route regression before B12 continued. |
| 2 | Make Graph Studio load/edit/save one canonical mapper-graph v3 document while preserving explicit semantic metadata and node data. | Model tests prove v2 upgrades on save, valid entry preservation, top-level metadata retention, route/position stability, typed config, and no input mutation/default data injection. | Complete | Editable Graph v2 input canonicalizes to v3; explicit valid entry and non-core metadata are retained; semantic node data no longer gains implicit UI defaults; save/reload is stable and does not mutate input. Focused model/schema/authoring checks passed 38/38. |
| 3 | Define a deterministic workflow execution plan and make the background consume that prepared plan. | Preparation/runtime tests prove the plan preserves exact contracts and canonical graph semantics and is the sole graph runtime input. | Complete | Preparation emits plan v1 with the canonical persisted workflow and identity-aligned runtime invocations. Background runtime selection, variables, traversal, and active-run metadata consume that plan. Persisted config types remain stable while finalized validation supplies runtime-normalized config. Focused checks passed 43/43. |
| 4 | Add the Navigate complete editor→save→reload→execution-plan gate, including validation and reachability-aware autocomplete. | One focused fixture asserts exact type/version, typed config, entry, success/error routes, positions, metadata, node data, validation outcome, reachable suggestions, and prepared plan equivalence. | Complete | The full fixture and checked-in acceptance workflow preserve exact contracts, typed/static and expression values, entry, success/error routes, positions, workflow/node metadata, validation, predecessor-only output/tab autocomplete, and serializable plan parity. Static invalid URLs fail in Graph save and preparation; expressions survive preflight for strict post-resolution validation. Focused checks passed 60/60. |
| 5 | Rebuild Graph Studio, run B12 focused/full gates, and synchronize the tracker and this record. | Syntax, Graph fingerprint, JavaScript, Python, and whitespace gates pass. | Complete | Graph Studio rebuilt from 191 modules. Focused checks passed 60/60; the full JavaScript suite passed 441/441 and Python passed 181/181. Ten affected JavaScript sources passed syntax checks, the production build fingerprint matched, and `git diff --check` reported no whitespace errors. |

## Item completion gates

- Graph Studio always saves editable Graph workflows as mapper-graph v3.
- A valid explicit entry is preserved; structural edits deterministically
  choose the only valid root or fail closed.
- Node type/version, configuration values and types, ports/routes, positions,
  semantic node data, settings, variables, datasets, data sources, and
  non-core top-level metadata survive save/reload.
- Canvas-only callbacks, locks, rendering state, and implicit default node
  data never leak into saved JSON.
- The background consumes one explicit plan produced after exact-contract,
  configuration, graph, and error-route preflight.
- Reachability autocomplete after reload exposes only workflow seeds and
  actually preceding outputs/tab references.
- Invalid configuration and unsupported contracts still fail closed.
- The checked-in Navigate acceptance workflow survives the complete path.
- Focused and full automated gates pass.

## Recovery procedure

On resume, read the main tracker and this file first. Inspect the files named by
the **Current resume checkpoint**, run that step's focused tests, and classify
the step as not started, partial, or complete. Repair or finish it before
advancing. Do not begin Scroll, restore Sequential Studio, or absorb B18.

## Evidence log

- 2026-07-25: Step 1 completed. The Graph model retains an input Graph schema
  version, omits explicit entry/top-level extension metadata, and can inject
  editor defaults into otherwise empty node data. Background preparation is
  canonical but its runtime product is implicit. Existing tests do not prove
  the full Navigate editor/save/reload/preparation/autocomplete chain.
- 2026-07-25: During the boundary audit, the real Navigate acceptance shape
  exposed a B11 regression: generic mapper cleanup deleted an actively
  referenced system Needs Attention error target. B11 was reopened, repaired,
  and reclosed only after 436/436 JavaScript, 181/181 Python, build,
  fingerprint, syntax, and whitespace gates passed.
- 2026-07-25: Step 2 completed. Graph v2 input is canonicalized before it
  enters the editable canvas and consequently saves as mapper-graph v3.
  Editor metadata now retains the explicit entry and non-core top-level
  fields, while node serialization distinguishes persisted semantic data from
  canvas-only/default state. A repeated save/reload produced the same canonical
  document without changing its caller input; focused checks passed 38/38.
- 2026-07-25: Step 3 completed. Preparation now produces an explicit
  serializable plan v1. Its `workflow` is the exact canonical persisted
  representation, while identity-aligned `nodeInvocations` carry any
  finalized runtime normalization without changing saved field types.
  Background execution selects its model, workflow, invocations, namespaces,
  traversal input, and recorded plan version from this object. Focused
  model/schema/preparation/runtime/startup checks passed 43/43.
- 2026-07-25: Step 4 completed. The Navigate-specific round-trip fixture
  crosses Graph load/save/reload, shared validation, reachability autocomplete,
  and background preparation. It checks exact v2 identities, typed values and
  unresolved expressions, explicit entry, blue success and red error routes,
  positions, settings/extensions, clean node data, plan serialization, and
  runtime invocation alignment. Static invalid URLs fail before save/run;
  expressions are preflighted without being resolved and remain subject to
  strict validation after runtime substitution. The focused Navigate/model/
  authoring/preparation/acceptance set passed 60/60.
- 2026-07-25: Step 5 completed. Graph Studio rebuilt from 191 modules. The
  focused B12 set passed 60/60, the complete JavaScript suite passed 441/441,
  and the Python suite passed 181/181. Ten affected JavaScript sources passed
  syntax checks, the generated Graph Studio fingerprint matched its source
  build, and `git diff --check` reported no whitespace errors. B12 is closed;
  Navigate's freshly rebuilt unpacked-extension run is the remaining Node 1
  acceptance boundary.
