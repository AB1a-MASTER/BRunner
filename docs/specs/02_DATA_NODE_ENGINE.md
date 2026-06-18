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

## Acceptance tests

Verify scalar, attribute, list, table, and page metadata extraction; cross-page and cross-tab reuse; nested expression substitution; strict missing-variable failures; random wait bounds; fresh registry per run; and legacy workflow execution.
