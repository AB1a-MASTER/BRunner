# BRunner Node User Catalogue

**Status:** Living end-user documentation  
**Updated:** 2026-07-22

This catalogue documents finalized nodes that are actually available in both
Graph Studio and Sequential Studio. A planned node is not described as usable
until its implementation, both-Studio support, automated tests, focused
acceptance workflow, and tracker gate pass.

The complete planned inventory and developer contracts live in
`../workflow_nodes_implementation_blueprint.md`. Progress and acceptance
evidence live in `NODE_IMPLEMENTATION_STATUS.md`.

## Current availability

No finalized node has completed the full production and both-Studio acceptance
gate yet. Existing palette actions remain provisional development behavior.

This section will list each node as soon as it is accepted:

| Node | Type and version | Phase | Acceptance workflow | Status |
|---|---|---:|---|---|
| — | — | — | — | No finalized node accepted yet |

## The two Studios

BRunner has two views of the same workflow:

- **Graph Studio** presents nodes and routes on a visual canvas.
- **Sequential Studio** presents the same nodes, configuration, outputs, and
  routes through a simpler ordered or nested interface.

They use one workflow file, node registry, version contract, validation model,
and executor. Saving in one Studio must preserve behavior and layout metadata
needed by the other. The simpler Sequential Studio must not create a separate
node type or incompatible workflow format.

## Common node controls

Every finalized node exposes the applicable common controls below. Individual
entries document any different defaults.

| Field | Meaning | Example or UI behavior |
|---|---|---|
| Enabled | Skip the node without side effects when off | Checkbox, on by default |
| Display name | Friendly name used in the Studios and logs | `Open customer page` |
| Timeout | Maximum node execution time in milliseconds | `30000` |
| Retry count | Eligible retries after the first failed attempt | `1` |
| Retry delay | Delay before another eligible attempt | `500` ms |
| Retry strategy | Fixed or increasing delay | Dropdown |
| On error | Fail, warning/continue, skip, or error route where supported | Dropdown |
| Save output as | Friendly output alias for later nodes | `customer_page` |
| Workflow Clipboard | Off, replace, append, or version | Dropdown plus entry name |
| Log level | Normal or verbose local run details | Dropdown |

## Inputs, examples, and autocomplete

- Every editable input must include help text and at least one valid example.
- Expression-capable fields autocomplete variables, prior node outputs, loop
  values, workflow-clipboard entries, tab references, file references, or
  other values that are valid in that field.
- Static and expression/template modes are selected explicitly when both are
  supported. Users should not have to guess how a string will be interpreted.
- Invalid configuration is shown before execution where possible and always
  fails with a stable, actionable error at runtime.

Expression examples:

```text
{{ variables.customerEmail }}
{{ nodes.open_customer.output.currentUrl }}
{{ workflowClipboard.orderData }}
{{ loop.item }}
```

## Target and identifier fields

DOM-targeting nodes use the shared mapper-backed target editor. The user chooses
the identifier kind with a dropdown or checkbox group rather than encoding it
inside an unlabelled text field.

Supported authoring choices may include:

- mapped Component ID/reference;
- automatic semantic target;
- CSS selector or XPath;
- element ID or `name`;
- label, visible text, accessible role and name, or placeholder;
- attribute name and value;
- prior resolved component; and
- coordinates only for nodes that explicitly permit coordinate targets.

Text-like identifiers expose exact, contains, starts-with, ends-with, wildcard,
or regular-expression matching plus case and whitespace controls. Mapper
resolution remains authoritative. BRunner never silently chooses the first
materially ambiguous page target.

Example target inputs:

| Identifier kind | Example |
|---|---|
| Component reference | `submit_order_button` |
| CSS selector | `form#checkout button[type="submit"]` |
| Element ID | `customer-email` |
| Label text | `Email address` |
| Role and name | role `button`, name `Save changes` |
| Attribute | `data-testid` = `save-profile` |
| Visible text | `Continue` with exact, case-insensitive matching |

## Node entry standard

Every accepted node receives a section with this structure:

```text
Node name, stable type, contract version, and availability
Purpose and when to use it
Browser/host/file/manual requirements
Input and output ports
All fields, defaults, examples, and autocomplete behavior
Target/identifier choices where applicable
How to configure it in Graph Studio
How to configure it in Sequential Studio
Execution, retry, timeout, verification, and side-effect behavior
Output object and downstream expression examples
Expected failures and troubleshooting
Acceptance workflow and verified fixture
```

## Planned implementation order

Nodes are implemented strictly by catalog number. The current phase groups are:

1. Foundational browser/target/wait nodes, catalog 1–6.
2. Core interaction nodes, catalog 7–15.
3. Forms and page-level UI, catalog 16–30.
4. File and structured input, catalog 31–43.
5. Data, transformation, and code, catalog 44–60.
6. Control flow and extraction, catalog 61–87.
7. Output and reporting, catalog 88–94.

See `NODE_IMPLEMENTATION_STATUS.md` for the individual 94-node checklist and
the exact point at which each entry becomes available here.
