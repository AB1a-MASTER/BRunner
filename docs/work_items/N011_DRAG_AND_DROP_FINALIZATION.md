# Node 11 - Drag and Drop Finalization

**Status:** Queued - contract frozen  
**Updated:** 2026-07-27  
**Main tracker:** `../NODE_IMPLEMENTATION_STATUS.md`  
**Batch program:** `P12_PHASE_1_2_BATCH_PROGRAM.md`  
**Current resume checkpoint:** The contract below is frozen. Before Step 2,
recheck the pointer adapter, mapper target resolver, Graph target editor, and
Chrome debugger drag support. The first shared source requirement is canonical
named target slots for `source` and `destination`; do not serialize a second
target through an ad hoc config string.

## Objective

Implement catalog Node 11, `element.drag_drop@1`, for verified dragging from a
resolved source to a resolved destination or explicit destination coordinate,
including reorder and selected-text/data transfer modes.

## Non-goals

- Do not use a second resolver or private destination selector parser.
- Do not retry an uncertain reorder/drop.
- Do not introduce the Phase 4 controlled file-reference schema. Local file
  path/file-drop authoring remains unavailable until that prerequisite exists.
- Do not drag on a hidden/background physical path.

## Frozen contract decisions

- **Identity:** `element.drag_drop@1`; new finalized type.
- **Operations:** `element_to_element`, `element_to_coordinates`,
  `selected_text_drag`, `reorder_list`, and `drop_data`.
  File-reference drops are not exposed in v1 because controlled file references
  are a Phase 4 prerequisite; unsupported raw paths fail configuration instead
  of being guessed.
- **Target slots:** definitions may declare canonical named shared target slots.
  Node 11 requires `source` and conditionally required `destination`.
  Destination coordinates are stored as an explicit coordinate target. Graph
  edit/save/reload/preparation and runtime resolution use the same slot data.
- **Fields:** operation, `dragPath` (`direct`, `stepped`, `smooth`), hold and
  movement duration, drop position/custom offset, `scrollWhileDragging`,
  bounded path steps, optional text/JSON data payload for `drop_data`, shared
  host fallback, verification mode/expected value, and common fields.
- **Execution:** resolve both slots -> verify visibility/interactability ->
  scroll as configured -> compute viewport/screen path -> browser/debugger drag
  first -> verify -> optional visible foreground host drag -> verify.
- **Ports:** `success`, `unresolved`, and `error`.
- **Outputs:** `operation`, `sourceResolution`, `destinationResolution`,
  `path`, `executionMethod`, and `verification`.
- **Protected pages:** DOM drag/drop is unavailable and host fallback cannot
  bypass protection.
- **Retry:** default zero. Retry only after verification proves no move,
  reorder, duplicate, or payload delivery occurred.
- **Stable failures:** common source/destination target, visibility,
  interactable, protected, host, timeout, cancel, and config errors plus
  namespaced invalid-path, drag-failed, drop-failed, and
  verification-failed codes.

## Affected surfaces and expected files

- `BRunner/nodes/interaction/drag-drop/` package and drag adapter.
- Shared authoring/Graph named target-slot schema, validation, autocomplete,
  serialization, and runtime preparation.
- Shared pointer/visibility/host/verification adapters.
- Exact v1 registry/background/content/debugger execution.
- Node 011 tests, drag/reorder fixture/workflow, user catalogue, tracker,
  roadmap, handoff, and this record.

## Ordered implementation steps

| Step | Work | Verification | Status |
|---|---|---|---|
| 1 | Freeze operations, named targets, data boundary, path, verification, output, host policy, protected behavior, and no-blind-retry rule. | Blueprint C5, B08 target rule, and Phase 4 prerequisite boundary agree with this record. | Complete |
| 2 | Implement canonical named target slots and isolated node/drag package. | Shared authoring/Graph tests prove independent source/destination controls and exact round-trip; unit tests cover paths and failures. | Pending |
| 3 | Register exact v1 and integrate Graph/background/content/debugger/host execution. | Slot validation/autocomplete/save/reload/preparation and exact dispatch pass. | Pending |
| 4 | Add deterministic integration coverage for sortable list, drop zone/data, selected text, source/destination missing, scrolling path, host visibility, verification, disabled, timeout, cancellation, output, logs, and retry blocking. | Focused runtime/Graph/host tests pass. | Pending |
| 5 | Add `011_drag-and-drop_acceptance.json`, fixture, and user documentation. | Synthetic reorder/drop success plus missing-destination alternate validate. | Pending |
| 6 | Run focused source checks and mark Source complete - batch acceptance queued. | Node/target-slot/pointer/host tests, syntax, JSON, and diff check pass. | Pending |
| 7 | Run consolidated build/full-suite/live acceptance and synchronize evidence. | Batch gate confirms source/destination output and verified reorder/drop. | Pending |

## Completion gates

- Source and destination use one canonical mapper target contract.
- Path and physical visibility are deterministic and bounded.
- File paths are rejected until a controlled file-reference contract exists.
- Unknown side effects block retry.
- Focused workflow, user documentation, batch regression, and live evidence
  pass before acceptance.

## Recovery procedure

Read the batch program, tracker, and this file. If target-slot work is partial,
verify classic authoring source, Graph source, validators, preparation, and
round-trip tests before continuing. Do not start Enter Text until Drag and Drop
is source-complete and batch-queued.

