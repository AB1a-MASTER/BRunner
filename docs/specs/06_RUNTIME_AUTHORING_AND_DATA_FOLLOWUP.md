# Specification 06 — Runtime, Authoring, and Data Follow-up

## Status

Approved roadmap scope captured from live UI review on 2026-06-20. This work
follows the Studio shell refinement and precedes general visual polish.

Forward planning update: the next implementation phase is now the Windows
companion app transition in
[07_WINDOWS_COMPANION_APP.md](07_WINDOWS_COMPANION_APP.md). The Data panel,
approved-directory, host capability, and final node-catalog work in this spec
should be interpreted through that companion-app architecture. After the
companion foundation is accepted, implement the mapper reliability transition in
[08_MAPPER_RELIABILITY_TRANSITION.md](08_MAPPER_RELIABILITY_TRANSITION.md),
then implement the finalized node set from the root-level
`workflow_nodes_implementation_blueprint.md`.

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
- user-provided TXT/CSV list or table files loaded from approved directories on
  each workflow run;
- previews, schema/column discovery, validation, search, and safe value editing;
- variable and dataset mapping into workflow inputs;
- data-source status, refresh, and bounded diagnostics;
- secret-safe copy/export behavior.

Data UI state stays outside workflow execution data. Persisted seed variables
and data-source declarations belong to workflow schema; last-run values remain
transient unless the user explicitly exports them.

Foundation status: schema adapters preserve `datasets` and `dataSources`, Graph
Studio can add/remove seed variables and declared TXT/CSV/JSON data sources,
and the native host can preview parsed approved-directory sources without
returning unrestricted paths. Runtime injection into workflow variables and
bounded For Each consumption remain next.

### Windows companion app and executable

The earlier small native-host settings UI is superseded by the Windows
companion app transition. The companion app must be a native desktop application
that starts/stops the host service, shows connection and pairing status, manages
workflow storage, manages approved folder aliases, exposes host-fallback
settings, and surfaces bounded diagnostics. Users should not need to edit
`brunner_config.json` manually for ordinary backend setup.

Host fallback should grow a visual-match tier after coordinate fallback. When a
browser-native action and coordinate fallback do not produce verified page
state, the extension may capture a bounded image of the resolved component and
send it to the companion. The companion then uses PyAutoGUI image matching on
the foreground browser window to find the component, click the matched center,
and return bounded match diagnostics. The extension must still perform
post-action verification before the workflow marks the step successful.

Current implementation note: `BRunner_Host/host_ui.py` and
`BRunner_Host/build_host_ui.py` are transitional artifacts from the earlier
Tkinter-based host UI and should be replaced or retired during the companion app
packaging phase. See [07_WINDOWS_COMPANION_APP.md](07_WINDOWS_COMPANION_APP.md).

### Host-managed file data sources

Add an allowlisted native-host data-source operation for loading a declared file
from an approved directory. The workflow stores a safe source identifier or
allowlisted relative reference, format, parsing options, and input mapping—not
an unrestricted path or file contents.

Initial formats should include TXT lists, CSV tables/lists, and JSON, with
explicit encoding, size, row, column, and item limits. TXT list parsing supports
one item per non-empty line, including common numeric lists such as `list.txt`.
CSV parsing supports table rows with headers and single-column list files. The
Data panel previews parsed data and reports stale, missing, denied, oversized,
or malformed sources without exposing full local paths. Executing a workflow
that reaches a required file-source node while the host is unavailable fails
that node under the native-host requirement contract.

Example: a workflow declares an approved-directory source named `numbers` that
loads `list.txt` at run start. The source parses the file into a list of
numbers. A bounded For Each node later iterates `numbers`, passes the current
number into a called workflow, and that child workflow uses it to fill forms,
perform lookups, or collect additional data.

## Track B.5 — Historical nodes friendliness pass

This earlier pass is superseded as the active node plan by
`workflow_nodes_implementation_blueprint.md`. Preserve the authoring goals below
when implementing the finalized node set, but do not use this section as the
catalog or ordering source. The new node program starts only after the companion
app and internal mapper foundations are accepted.

Original intent: after the Data panel model is in place, perform a dedicated
nodes pass before the final macro-recording polish. This pass verifies that the
catalog contains the required nodes for complete practical automation and makes
node authoring more approachable.

Scope:

- audit browser, data, logic, host, keyboard, pointer, tab/window, file,
  clipboard, HTTP, and workflow-reuse node coverage;
- identify missing nodes, duplicated capabilities, overly narrow nodes, and
  nodes that should be split or merged;
- make entries friendlier with selects, comboboxes, autocomplete, defaults, and
  validation where Studio can know valid values;
- add variable-name autocomplete/validation for valid existing variables and
  safe new output names;
- split keyboard intent into **Send Text** and **Send Keystroke**;
- add a searchable/autofill key catalog for Send Keystroke covering individual
  keys and common modifier combinations such as Ctrl/Alt/Shift/Meta plus key;
- keep advanced/manual entry for uncommon keys while validating the common path.

Acceptance for this pass: a user can discover the right node and configure it
without memorizing internal names, raw key syntax, or variable identifier rules.

## Track C — Data-driven control flow

Add graph-dependent nodes only after traversal and cycle rules are specified:

### For Each / dataset loop

- Accept a list, table, or expression yielding iterable records.
- Accept host-backed datasets loaded from declared TXT/CSV/JSON data sources.
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
5. Implement the Windows companion app transition.
6. Implement the mapper reliability transition, including Mapper Core,
   `workflow.settings.mapper`, graph schema v3 unresolved routing, ComponentRef
   targets, Chrome-storage MapStore, open Shadow DOM support, and Mapper
   Inspector.
7. Implement the finalized node set from
   `workflow_nodes_implementation_blueprint.md`.
8. Complete remaining final visual polish. Refreshed host-served manual
   acceptance workflows have passed for the current companion/runtime batch.

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
6. The companion app manages workflow storage, approved directories, pairing,
   diagnostics, and structured host capability status.
7. Mapper/resolver behavior is accepted for static/bounded pages and open
   Shadow DOM before final browser-targeting node expansion.
8. The final node program confirms required automation coverage, friendlier
   controls, bounded data/control flow, and deterministic outputs.
