# BRunner User Guide

## Purpose

This is the living usage guide for BRunner. It explains how workflows,
recording, Studios, nodes, variables, data sources, execution, and the native
host work together. It must be updated whenever behavior or node options change.

## System overview

BRunner records browser actions and lets users author them as sequential or
graph workflows. Graph Studio is the primary visual editor. Sequential Studio
supports compatible linear workflows. Both use the same node registry,
workflow files, runtime state, recording session, and global UI preferences.

The browser extension executes browser-safe nodes. The optional native host
provides explicitly scoped OS capabilities such as allowlisted local-file access
and host-managed log saving. Nodes label the host as required, optional fallback,
or unused. A disconnected host does not prevent a workflow from starting, but a
reached node with a required host capability fails clearly.

## Basic workflow

1. Create or load a workflow in either Studio.
2. Record browser actions or add nodes from the Node Library.
3. Select a node to read its description, example, inputs, outputs, and edit its
   options in Inspector.
4. Add workflow seed data or inspect run data in the Data panel.
5. Save valid changes, then Run.
6. Follow live node states, Execution Logs, and Data outputs.

## Recording and targets

Recording follows either tabs opened from the starting tab or the currently
active tab. BRunner stores bounded semantic target candidates. For dropdowns it
prefers visible option text, then option value, then index. For clicks it prefers
accessible name, label, visible text, role, and stable attributes before DOM
position. These priorities make replay follow the user's perspective when page
layout or option order changes.

## Workflow data

- Seed variables are saved defaults available at run start.
- Node outputs are run-scoped variables available to later nodes.
- Expressions use `{{variable}}` and fail clearly when required data is missing.
- Lists and tables can be previewed and will support bounded For Each execution.
- Host-backed files use approved data-source declarations; workflows never gain
  unrestricted filesystem access.

## Native host states

- **Not used:** node runs entirely in the extension.
- **Optional fallback:** node has browser-first behavior and may use the host as
  a documented fallback.
- **Required:** node cannot perform its primary behavior without the named host
  capability. If reached while unavailable, the node fails with a stable error.
  Current required-host nodes are **Send Keystroke** (`os.keystroke`) and
  **Upload Allowed Local File** (`local_file.read`).

## Node reference format

Every node entry in this guide must contain:

- purpose and when to use it;
- usage example;
- target behavior, when applicable;
- every option, default, and expression support;
- inputs and outputs;
- native-host requirements;
- errors, safety limits, and secret-handling notes.

The canonical supported node inventory currently lives in
[`specs/04_NODE_CATALOG.md`](specs/04_NODE_CATALOG.md). Detailed entries will be
expanded category by category from the canonical registry. Until an entry is
expanded here, Inspector and the registry definition remain authoritative.

## Node categories

### Browser

Navigation, history, reload, search, and logical tab management. Browser nodes
control where later steps execute and may create or select logical tab
references.

### Element

Click, type, focus, select, toggle, hover, clear, and scroll controls. Recorded
semantic target candidates are preferred over positional selectors.

### Wait

Wait for time, visibility, hidden state, enabled state, text, or URL conditions.
Waits are bounded by timeout and return structured timeout diagnostics.

### Data and transforms

Extract page values, set/template variables, parse/stringify JSON, use regular
expressions, convert numbers, and format dates. Output fields name the variables
available to later nodes.

### HTTP, clipboard, files, downloads, and screenshots

External operations use explicit permissions, size/time limits, safe outputs,
and secret-safe logs. Local-file operations require node approval, an enabled
native host, and an allowlisted source.

### Logic and reusable workflows

Fixed/random waits are available. Conditions, Workflow Call, and bounded For
Each over list/table records are planned in
[`specs/06_RUNTIME_AUTHORING_AND_DATA_FOLLOWUP.md`](specs/06_RUNTIME_AUTHORING_AND_DATA_FOLLOWUP.md).

## Maintenance checklist

When adding or changing a node:

1. Update its canonical registry definition and version.
2. Add or revise its detailed entry in this guide.
3. Show the same description and example in Inspector.
4. Document host requirements, safety limits, inputs, outputs, and diagnostics.
5. Add deterministic tests and a live acceptance scenario.
