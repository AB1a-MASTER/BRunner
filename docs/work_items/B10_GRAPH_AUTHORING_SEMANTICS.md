# B10 - Consolidate Graph Authoring Semantics

**Status:** Complete  
**Updated:** 2026-07-25  
**Main tracker:** `../NODE_IMPLEMENTATION_STATUS.md`  
**Current resume checkpoint:** Item complete. On audit, re-run the Step 6
focused/full gates and confirm generated Graph build fingerprint parity before
relying on this evidence.

## Objective

Make the finalized node registry and shared authoring contract the single
semantic source for Graph Studio field rendering, configuration coercion,
validation, autocomplete, saved JSON, and the configuration handed to the
finalized runtime.

## Confirmed defects

- Graph Studio text inputs currently store number fields as strings.
- Graph save validation can inspect a representation that differs from the
  representation serialized into the workflow.
- Saved configuration is cloned directly on load and save instead of being
  normalized by the field contract.
- Node-output autocomplete currently includes every other canvas node,
  including downstream and unrelated branches.
- Graph Studio assembles only part of the supported autocomplete context.

## Non-goals

- Do not change finalized node type IDs, contract versions, ports, or output
  schemas.
- Do not restore or modify Sequential Studio.
- Do not implement the canonical mapper-graph preparation/runtime boundary;
  that is B11.
- Do not implement the complete save/reload/execution-plan acceptance matrix;
  that is B12.
- Do not begin Scroll or any later catalog node.

## Affected surfaces

- `BRunner/shared/nodeAuthoring.js`
- `BRunner/core/nodeAuthoring.js`
- `BRunner/studio-graph-src/src/graphStudioModel.js`
- `BRunner/studio-graph-src/src/GraphStudio.jsx`
- generated `BRunner/studio-graph/`
- focused node-authoring, Graph-model, and Graph-build tests
- main tracker and this recovery record

## Ordered implementation steps

| Step | Work | Focused verification | Status | Evidence |
|---|---|---|---|---|
| 1 | Confirm tracker scope, audit the registry/renderer/validator/coercion/autocomplete paths, and register this record. | Source inventory identifies each semantic drift without expanding into B11 or B12. | Complete | Registry is exact-contract aware; direct config cloning, string-valued number edits, validation/save representation drift, incomplete context, and all-node autocomplete were confirmed. |
| 2 | Add one shared, deterministic field coercion and configuration preparation path. | Unit tests cover defaults, booleans, finite numbers, expressions, invalid values, unknown-key policy, and validation of prepared values. | Complete | Shared preparation applies defaults, emits typed finite numbers, preserves expressions, validates prepared values, rejects unknown finalized fields, and preserves unknown provisional fields. Syntax passed and the focused contract suite passed 31/31. |
| 3 | Add one shared reachability-aware autocomplete context builder. | Unit tests cover ancestors, branches, cycles, variables, clipboard keys, tab/file references, approved directories, ordering, and deduplication. | Complete | Shared context restricts node outputs/derived refs to reachable ancestors and combines all supported sources deterministically. Cycle/downstream/unrelated cases are covered; syntax passed and the focused suite passed 15/15. |
| 4 | Integrate shared preparation into Graph load, edit, validation, and save while preserving exact contract versions. | Graph-model tests prove typed configuration and deterministic validation/save behavior. | Complete | Graph load and save use the same prepared config, save validates what it serializes, exact versions persist, and invalid config is exposed/fail-closed. Syntax passed and the focused Graph/model/schema suite passed 36/36. |
| 5 | Integrate the shared autocomplete context and field coercion into the Graph renderer, then rebuild generated Graph assets. | Source/build tests and build fingerprint parity pass. | Complete | New nodes and edits use shared preparation, field errors render inline, graph edges drive autocomplete, and generated assets were rebuilt from 190 modules. Focused source/build/model tests passed 30/30 with fingerprint parity. |
| 6 | Enforce shared preparation at the finalized Navigate runtime boundary, run B10 focused/full gates, synchronize this record and the tracker, and leave B11 as the sole active base item. | Runtime tests plus syntax, Graph build, JavaScript, Python, and whitespace gates pass. | Complete | Finalized runtime prepares and rejects config before side effects, Navigate validates the prepared object, 87 focused tests passed, six syntax checks passed, Graph fingerprint gates passed 7/7, JavaScript passed 425/425, Python passed 181/181, and `git diff --check` reported no errors. |

## Item completion gates

- Finalized definitions come from the exact `(type, version)` registry.
- One shared helper prepares field defaults and value types.
- Graph editor state, save validation, saved JSON, and finalized runtime input
  use that prepared configuration representation.
- Invalid number/boolean/select values fail closed and are not silently
  reinterpreted.
- Expressions remain strings until runtime resolution.
- Unknown configuration keys are handled by one explicit, tested policy.
- Node-output and tab-reference autocomplete includes only reachable
  predecessors, never downstream or unrelated nodes.
- All supported autocomplete sources use one deterministic context builder.
- Generated Graph assets match their source.
- Focused and full automated gates pass.

## Recovery procedure

On resume, read the main tracker and this file first. Inspect the files named by
the **Current resume checkpoint**, run that step's focused verification, and
classify the step as not started, partial, or complete. Repair or finish it
before advancing. Do not fold B11 canonical runtime preparation or B12
round-trip acceptance into this item.

## Evidence log

- 2026-07-25: Step 1 completed. The version-aware registry is already shared,
  but Graph Studio clones raw configuration on load/save, number inputs emit
  strings, validation does not prepare the serialized value, and autocomplete
  exposes all other nodes rather than only reachable predecessors. Step 2 was
  set in progress before implementation.
- 2026-07-25: Step 2 completed. The shared authoring module now prepares
  defaults and field types deterministically, keeps numeric expressions
  unresolved, reports malformed boolean/text/number values, enforces a closed
  finalized Navigate configuration schema, and explicitly preserves unknown
  provisional configuration. Three affected sources passed syntax checks and
  the focused authoring/Navigate/registry suite passed 31/31.
- 2026-07-25: Step 3 completed. The shared context builder now intersects
  transitive ancestors with entry-reachable nodes and stops traversal at the
  selected node, preventing downstream, unrelated, and cycle-back suggestions.
  It derives prior aliases, clipboard keys, and tab references while combining
  explicit variable, directory, file, and data-source context. Syntax passed
  and the focused authoring/registry suite passed 15/15.
- 2026-07-25: Step 4 completed. Graph model load prepares exact-contract
  defaults/types and retains actionable configuration issues; save prepares
  again, validates that prepared object, and serializes the same object.
  Numeric strings become numbers, expressions remain strings, invalid/unknown
  finalized configuration fails closed, and contract version 2 persists.
  Syntax passed and the focused Graph-model/authoring/schema suite passed 36/36.
- 2026-07-25: Step 5 completed. Graph creates and edits configuration through
  the shared preparer, its field renderer emits canonical types, validation
  errors appear beside affected fields, and the Inspector passes real edges to
  the shared reachability context. The 190-module production build completed,
  build fingerprint parity passed, and the focused source/build/model suite
  passed 30/30.
- 2026-07-25: Step 6 completed. The finalized runtime now invokes the same
  shared configuration preparer before node-specific validation or executor
  side effects; Navigate's validator receives that prepared object. Invalid
  finalized fields produce `CONFIG_INVALID` without execution, and canonical
  numbers/defaults reach the executor. The expanded focused suite passed 87/87,
  six affected JavaScript sources passed syntax checks, Graph build/fingerprint
  gates passed 7/7, all 425 JavaScript tests and all 181 Python tests passed,
  and `git diff --check` reported no whitespace errors (only existing Windows
  line-ending notices).
