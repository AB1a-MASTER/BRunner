# Specification 06 — Runtime, Authoring, and Data Follow-up

## Status

Approved roadmap scope captured from live UI review on 2026-06-20. This work
follows the Studio shell refinement and precedes general visual polish.

## Goal

Close the remaining gaps between recording, authoring, execution, native-host
capabilities, and data-driven workflow reuse. A workflow may remain runnable
when the native host is unavailable, but any node whose primary implementation
requires that host must fail clearly if execution reaches it.

## Track A — Immediate correctness and authoring parity

### Native-host requirement contract

Add serializable capability metadata to every node definition. The model must
distinguish:

- `none`: the node does not use the native host;
- `fallback`: the host is an optional fallback and its absence is not itself an
  error;
- `required`: the node's primary behavior depends on the host.

The contract may name one or more capabilities such as local-file read,
hardware keystroke, or log persistence. Studio uses this metadata to show a
visible requirement and unavailable state on affected nodes and in Inspector.

Host unavailability does not block the whole workflow from starting because an
unreached branch or bypassed node may not need it. Immediately before executing
a `required` node, runtime capability checking must fail that node with a stable
`native_host_unavailable` or `native_capability_unavailable` diagnostic. It must
not silently use an unrelated fallback. Nodes marked `fallback` retain their
documented browser-first behavior.

### Recording delivery in Graph Studio

- Recorded steps must appear in Graph Studio while recording is active.
- Both Studios must consume one authoritative recording session and recorded
  step stream without duplicate insertion.
- Appending a recorded Graph node must preserve semantic target metadata,
  connect it to the current terminal success path, select it, mark the workflow
  dirty, and keep accidental-edit locks intact.
- Recording status, count, domain, and failures must remain synchronized in the
  sidebar, Graph Studio, and Sequential Studio.

### Open-workflow continuity between Studios

Introduce a shared, versioned Studio session/draft record outside workflow JSON.
At minimum it stores the current workflow filename/identity and which Studio is
active. Switching between Graph and Sequential Studio must open the same saved
workflow after compatibility validation.

Unsaved changes must never be silently discarded or copied through a lossy
conversion. Before switching with a dirty draft, Studio must save, explicitly
carry a lossless compatible draft, or ask the user to resolve it. Branching
graphs cannot be opened as editable sequential workflows unless the adapter can
prove the conversion is lossless.

### User-perspective semantic recording

Recorder target packages must prioritize how a user identifies a control over
fragile position or index:

- Select/dropdown changes record visible option text first, stable option value
  second, and index only as a last fallback. Replay resolves in that order.
- Clicks prioritize accessible name, associated label, visible text, role, and
  stable attributes before structural selectors or ordinal position.
- Recorded packages may keep multiple bounded candidates and a snapshot, but
  the Inspector must explain the primary user-facing target.
- If semantic text is ambiguous, replay uses the remaining package candidates
  and returns target-resolution diagnostics rather than choosing an arbitrary
  match.

Known macro-recording quirks discovered during this phase should be captured,
but the final polish/fix pass is deferred until the end so core runtime,
authoring, and data work can settle first.

### Node guidance in Inspector

Every registry node definition must provide:

- a plain-language description;
- when to use it;
- at least one usage example;
- input and output summary;
- native-host/capability requirements;
- relevant safety, secret-handling, and failure behavior.

Graph Inspector shows this guidance whenever a node is selected, above or next
to its editable options. Sequential Studio exposes equivalent guidance without
duplicating hard-coded node documentation.

## Track B — Managed Data panel

The existing runtime variable preview is not the complete Data panel. Build one
shared data-management model and expose it consistently in both Studios.

The panel must manage:

- workflow seed variables and defaults;
- current/last-run values, types, and producing nodes;
- reusable datasets: scalar, object, list, and table;
- previews, schema/column discovery, validation, search, and safe value editing;
- variable and dataset mapping into workflow inputs;
- data-source status, refresh, and bounded diagnostics;
- secret-safe copy/export behavior.

Data UI state stays outside workflow execution data. Persisted seed variables
and data-source declarations belong to workflow schema; last-run values remain
transient unless the user explicitly exports them.

### Host-managed file data sources

Add an allowlisted native-host data-source operation for loading a declared file
from an approved directory. The workflow stores a safe source identifier or
allowlisted relative reference, format, parsing options, and input mapping—not
an unrestricted path or file contents.

Initial formats should be JSON and CSV, with explicit encoding, size, row, and
column limits. The Data panel previews parsed data and reports stale, missing,
denied, oversized, or malformed sources without exposing full local paths.
Executing a workflow that reaches a required file-source node while the host is
unavailable fails that node under the native-host requirement contract.

## Track C — Data-driven control flow

Add graph-dependent nodes only after traversal and cycle rules are specified:

### For Each / dataset loop

- Accept a list, table, or expression yielding iterable records.
- Bind each item/row, index, and optionally key into named iteration variables.
- Execute a referenced workflow or bounded sub-workflow once per record.
- Map parent variables and current record fields into child workflow inputs.
- Collect mapped outputs with deterministic ordering.
- Start sequentially; concurrency is deferred until cancellation, isolation,
  ordering, and host-capability contention are specified.
- Require maximum iteration and timeout limits plus stop/continue/collect-error
  policy.
- Cancellation must stop the active child and prevent further iterations.

### Workflow Call

Define a reusable workflow-input/output contract. Calls must validate the
referenced workflow, prevent unbounded recursion, isolate child run variables,
surface child diagnostics, and declare how browser tab context is inherited.

For Each composes with Workflow Call; it must not duplicate an independent
hidden execution engine.

## Documentation contract

Maintain the living user guide at `docs/BRUNNER_USER_GUIDE.md`. Node definitions
are the canonical machine-readable source; the guide explains the system and
each node in user language. Adding or changing a node is incomplete until its
guide entry, Inspector guidance, deterministic tests, and live acceptance
scenario are updated.

## Implementation order

1. Audit and encode native-host requirements; add runtime enforcement. **Implemented for current native-host nodes: OS keystroke and allowlisted local-file upload.**
2. Fix Graph recording delivery and add cross-Studio workflow continuity.
   **Implemented with recorded-step replay/dedupe and a shared Studio session
   key for active saved workflow identity.**
3. Strengthen semantic recording for selects and clicks. **Initial pass
   implemented: native `<select>` records `element.select` using visible option
   text first, and target candidates now prioritize accessible name, labels,
   visible text, and role/text before structural selectors. Final
   macro-recording polish remains deferred.**
4. Add registry usage examples and Inspector node guidance. **Implemented:
   registry definitions now expose guidance metadata and both Graph and
   Sequential Studios render description, example, I/O, config, and safety
   notes.**
5. Specify and implement the managed Data panel and safe file data sources.
6. Specify graph traversal, Workflow Call, and bounded For Each execution.
7. Complete live acceptance and final visual polish.

## Acceptance gates

1. Required-host nodes visibly declare their dependency and fail only when
   reached without the required capability.
2. Recording adds each action exactly once in either Studio and remains visible
   in Graph Studio.
3. Switching Studios retains the same compatible saved workflow and never
   silently loses a dirty draft.
4. Selects replay by visible text before value/index; clicks prefer semantic
   user-facing targets.
5. Every selected node shows canonical description and usage guidance.
6. The Data panel can manage seed data and preview bounded host-backed JSON/CSV.
7. For Each safely runs a mapped workflow once per list/table record with
   limits, cancellation, and deterministic outputs.
