# Specification 02 — Data and Node Engine

## Goal

Make node behavior declarative and allow data to flow reliably across steps, pages, and tabs.

## Canonical node registry

Create one registry consumed by execution and exposed to Studio through `GET_NODE_DEFINITIONS`. Each serializable definition contains type, version, category, label, description, target requirement, configuration fields, inputs, and outputs. Executor functions remain internal.

Existing hard-coded action lists become compatibility shims during migration.

## Variable and expression model

- Create a fresh `VariableRegistry` for each run.
- Seed it from workflow variables and optional run inputs.
- Persist it across navigation and tab changes, never across separate runs.
- Resolve `{{variable}}` recursively in string configuration values immediately before execution.
- Missing variables fail strictly and report the variable name, node, and configuration path.

## Initial data nodes

- `data.extract.text`
- `data.extract.attribute`
- `data.extract.list`
- `data.extract.table`
- `data.extract.page`
- `data.set`
- `data.template`

Each extraction node requires an output variable. Legacy `element.extract` maps to text extraction.

Forward mapper transition: DOM extraction nodes are DOM-dependent nodes. They
must resolve targets through mapper `componentRef` records, use the same
resolver states as interaction nodes, and route `ambiguous`, `not_found`,
exhausted `map_stale`, or `protected_unsupported` through the graph
`unresolved` handle without extracting stale or arbitrary content.

`logic.wait` supports either fixed milliseconds or random `minMs`/`maxMs`, including expressions.

## Deferred UX refinements

The first implementation establishes runtime behavior, not the final authoring experience. Milestone 3 must add:

- A searchable Variables/Data Inspector showing workflow seed variables, current run values, types, and producing nodes.
- Expandable object inspection and dedicated table/list previews so users do not need prior knowledge of extracted structures.
- Output samples and last-run values on extraction nodes.
- Variable autocomplete in expression-enabled fields.
- Conditional configuration fields, stronger validation, empty-result policy, and clearer selector guidance.
- Copy/export controls for scalar, object, list, and table values.

These refinements must preserve the current node schemas or include explicit migrations.

## Managed Data panel follow-up

The initial Variables/Data Inspector is a runtime browser, not the complete data
authoring surface. Milestone 3.2 adds one shared model for:

- editing workflow seed variables and typed defaults;
- inspecting current/last-run values and producing nodes;
- managing scalar, object, list, and table datasets;
- previewing columns/schema and mapping fields into workflow inputs;
- declaring bounded companion-backed TXT/CSV/JSON sources from approved
  directory aliases.

Persist data-source declarations and seed values in workflow schema. Keep
last-run values transient. Companion file sources use approved directory aliases
and relative references, never unrestricted paths, and follow the required-host
node contract. See
[06_RUNTIME_AUTHORING_AND_DATA_FOLLOWUP.md](06_RUNTIME_AUTHORING_AND_DATA_FOLLOWUP.md).

Dataset file sources must support user-provided list and table data in `.txt`
or `.csv` form, loaded from a configured approved directory alias each time the
workflow runs. A declared source can point to a safe relative file such as
`list.txt`, parse it into a bounded list of numbers or a table of rows, validate
encoding/size/row limits, and expose the parsed dataset to later workflow nodes.
This enables patterns such as: on every run, read `list.txt`, parse one number
per line, then use bounded For Each to run a workflow once per number and pass
that value into form-filling, lookup, or extraction steps.

Initial Milestone 3.2 foundation is implemented: schema v1/v2 adapters preserve
`datasets` and `dataSources`, Graph Studio metadata round trips them, and the
Graph Data tab can add/remove workflow seed variables and TXT/CSV/JSON source
declarations while previewing host-parsed source summaries through the native
host.

Data-driven repetition is graph control flow, not a Data-panel side effect. A
bounded For Each node composes with Workflow Call to execute mapped workflow
inputs once per list/table record under explicit limits and cancellation rules.

## Acceptance tests

Verify scalar, attribute, list, table, and page metadata extraction; cross-page and cross-tab reuse; nested expression substitution; strict missing-variable failures; random wait bounds; fresh registry per run; and legacy workflow execution.
