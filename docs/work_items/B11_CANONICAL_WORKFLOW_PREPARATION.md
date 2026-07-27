# B11 - Canonical Workflow Preparation and Runtime Selection

**Status:** Complete  
**Updated:** 2026-07-25  
**Main tracker:** `../NODE_IMPLEMENTATION_STATUS.md`  
**Current resume checkpoint:** Closed. B11, including the acceptance-shaped
error-route regression repair, is complete. Resume from B12's dedicated
work-item record.

## Objective

Give every Graph workflow and every workflow containing a finalized node one
background-owned preparation path. That path must produce validated canonical
mapper-graph v3 with exact contracts and prepared configuration before any
browser side effect. Finalized nodes must never enter the legacy linear
executor.

## Confirmed defects

- `runWorkflow` currently branches directly on input schema rather than a
  prepared execution model.
- Graph v2 is converted to linear steps and executes in the legacy executor.
- Sequential input containing a finalized contract also executes linearly.
- Node contracts and configuration are validated only when a node is reached,
  so an unsupported later node can fail after earlier side effects.
- Canonical workflow seed variables are not initialized under the
  `variables.*` namespace advertised by Graph autocomplete and the blueprint.
- Canonical error-port configuration is not preflighted against an actual
  error route.

## Non-goals

- Do not remove the legacy linear executor; provisional sidebar workflows still
  require it until their tracked cleanup.
- Do not restore or modify Sequential Studio.
- Do not implement general loops, joins, scopes, or multi-port scheduling;
  those remain B18.
- Do not implement the complete editor/save/reload/execution-plan round-trip
  matrix; that is B12.
- Do not begin Scroll or any later catalog node.

## Affected surfaces

- finalized/provisional lifecycle metadata in the node registry
- a shared, background-owned workflow preparation module
- `BRunner/background.js` run selection and canonical runtime initialization
- focused preparation, workflow-schema, runtime, and Navigate tests
- main tracker and this recovery record

## Ordered implementation steps

| Step | Work | Focused verification | Status | Evidence |
|---|---|---|---|---|
| 1 | Confirm tracker scope, inventory all run entry/preparation/runtime branches, and register this record. | Inventory distinguishes Graph/finalized canonicalization from retained provisional linear compatibility. | Complete | Graph Studio sends v3, sidebar loads arbitrary saved schemas, `runWorkflow` currently sends only input v3 to graph traversal, Graph v2/finalized sequential fall into linear execution, and contract checks occur node-by-node. |
| 2 | Add explicit contract lifecycle metadata and one deterministic workflow preparation module. | Unit tests cover v3 normalization, Graph v2 upgrade, finalized sequential upgrade, provisional sequential retention, exact contract rejection, typed config, metadata, and no input mutation. | Complete | Registry marks exact contracts finalized/provisional; preparation upgrades all Graph plus finalized sequential input, prepares every node, rejects bad contracts/config, preserves metadata/layout/routes, and leaves pure provisional sequential input linear. Syntax passed and the focused suite passed 33/33. |
| 3 | Route both background run entry points through the prepared execution model and remove the duplicate mapper normalization branch. | Source/integration tests prove all Graph/finalized workflows select canonical traversal and provisional sequential workflows alone select the retained linear executor. | Complete | Both run messages converge on `runWorkflow`; its prepared execution model alone chooses graph versus retained linear traversal. The duplicate raw v3 normalizer/schema branch was removed. Syntax passed and the focused runtime/preparation/startup/schema set passed 48/48. |
| 4 | Initialize canonical runtime namespaces and preflight finalized validation/error routes before side effects. | Tests cover `variables.*`, Navigate higher-level validation, missing error routes, route preservation, and tabless entry policy. | Complete | Canonical namespaces/preflight remain intact; mapper cleanup now removes only truly orphaned system attention nodes and preserves an actively targeted error sink. The acceptance-shaped schema/preparation/acceptance/startup set passed 30/30. |
| 5 | Run B11 focused/full gates, synchronize this record and the tracker, and leave B12 as the sole active base item. | Syntax, Graph fingerprint, JavaScript, Python, and whitespace gates pass. | Complete | After the route repair, Graph Studio rebuilt from 190 modules; production fingerprint and five affected-source syntax checks passed; JavaScript passed 436/436 and Python passed 181/181; `git diff --check` reported no errors (line-ending warnings only). |

## Item completion gates

- One function classifies and prepares every workflow run.
- Graph v2 and v3 inputs execute as canonical mapper-graph v3.
- Sequential input containing any finalized exact contract is upgraded to
  canonical mapper-graph v3 before execution.
- Only purely provisional sequential input may use the retained linear
  executor.
- Every canonical node contract and prepared config is checked before runtime
  state starts or browser side effects occur.
- Unsupported type/version and invalid finalized configuration fail closed.
- `onError: "error_port"` requires an actual error edge.
- Canonical seed variables resolve through `variables.<name>`.
- Metadata, entry, positions, node versions, routes, and data survive
  preparation without mutating the caller's input.
- Existing tabless Navigate startup remains valid.
- Focused and full automated gates pass.

## Recovery procedure

On resume, read the main tracker and this file first. Inspect the files named by
the **Current resume checkpoint**, run that step's focused verification, and
classify it as not started, partial, or complete. Repair or finish it before
advancing. Do not delete the legacy executor or absorb B12/B18 work here.

## Evidence log

- 2026-07-25: Step 1 completed. Both message entry points converge on
  `runWorkflow`, but that function selects graph traversal only when the raw
  input is already schema v3. Graph v2 and sequential inputs—including exact
  finalized contracts—are normalized to steps and use the legacy executor.
  Contract/config checks are deferred until each node is reached. Step 2 was
  set in progress before implementation.
- 2026-07-25: Step 2 completed. Exact registry entries now declare provisional
  or finalized lifecycle. The new preparation module converts Graph v2/v3 and
  finalized sequential compatibility input into validated mapper-graph v3,
  prepares configuration for every exact contract before execution, preserves
  caller input and metadata, and retains the linear model only for purely
  provisional sequential workflows. Syntax passed and the focused
  preparation/registry/schema/authoring suite passed 33/33.
- 2026-07-25: Step 3 completed. `runWorkflow` now calls canonical preparation
  before runtime state begins and selects traversal only from its explicit
  execution model. Both direct Graph runs and host-loaded runs share that path;
  Graph v2/v3 and finalized compatibility input cannot enter the linear
  executor. The duplicate background mapper normalizer and raw schema
  predicate were removed. Syntax passed and the focused set passed 48/48.
- 2026-07-25: Step 4 completed. Canonical runs initialize explicit
  `variables`, `nodes`, `workflowClipboard`, and
  `workflowClipboardVersions` namespaces, and named runtime writes mirror into
  `variables.*` without changing retained provisional behavior. Finalized
  Navigate configuration is fully validated and normalized before runtime
  state begins, while `onError: "error_port"` now fails closed unless its
  saved graph contains a real error edge. The focused set passed 51/51,
  including tabless Navigate startup.
- 2026-07-25: Step 5 completed. Graph Studio rebuilt from 190 modules, the
  complete JavaScript suite passed 435/435 (including its production source
  fingerprint gate), the Python suite passed 181/181, six affected JavaScript
  files passed syntax checks, and `git diff --check` reported no whitespace
  errors. B11 is closed and B12 is the sole active pre-Navigate base item.
- 2026-07-25: B12's initial boundary audit reopened Step 4. The checked-in
  Navigate acceptance graph routes its error output to a system Needs
  Attention node, but mapper-route cleanup removed every such node whenever no
  DOM-dependent node existed, including actively referenced error targets.
  B11 cannot remain closed until that route is preserved and all gates rerun.
- 2026-07-25: Step 4 regression repaired. Canonical mapper cleanup now removes
  a system Needs Attention node only when it has no non-unresolved route
  reference; Navigate's explicit error edge and target survive unchanged. A
  direct schema regression plus the actual acceptance/preparation/startup
  checks passed 30/30.
- 2026-07-25: Step 5 gates reran after the repair. Graph Studio rebuilt from
  190 modules, the production fingerprint matched, JavaScript passed 436/436,
  Python passed 181/181, five affected JavaScript sources passed syntax, and
  `git diff --check` reported no whitespace errors. B11 is closed.
