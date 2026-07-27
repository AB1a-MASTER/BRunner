# BRunner Node User Catalogue

**Status:** Living end-user documentation  
**Updated:** 2026-07-27

This catalogue documents finalized nodes for Graph Studio, BRunner's only
supported workflow-authoring surface. An entry marked **Accepted** is available
for normal use. An entry marked **Acceptance pending** documents a source
candidate so its final live check can be performed, but it does not count as an
accepted node yet.

The complete planned inventory and developer contracts live in
`../workflow_nodes_implementation_blueprint.md`. Progress and acceptance
evidence live in `NODE_IMPLEMENTATION_STATUS.md`.

## Current availability

Navigate is the first finalized node to complete the unpacked-extension
acceptance gate. Existing version-1 Navigate workflows continue to use isolated
provisional behavior; the accepted palette entry is the exact version-2
contract below.

| Node | Type and version | Phase | Acceptance workflow | Status |
|---|---|---:|---|---|
| Navigate | `browser.navigate@2` | 1 | `001_navigate_acceptance.json` | Accepted |

## Supported Studio

Graph Studio is BRunner's only supported authoring surface. It presents nodes,
ports, routes, and configuration on a visual canvas and saves the canonical
mapper-graph workflow consumed by the finalized runtime.

Sequential Studio is deprecated and disabled. Normal Studio launches open Graph
Studio, and the former Sequential URL redirects there without loading
authoring/run code. Dormant source remains only for reference until the final
pre-V2 cleanup; it is not a fallback editor or an acceptance target for
finalized nodes.

## Common node controls

Every finalized node exposes the applicable common controls below. Individual
entries document any different defaults.

| Field | Meaning | Example or UI behavior |
|---|---|---|
| Enabled | Skip the node without side effects when off | Checkbox, on by default |
| Display name | Friendly name used in Graph Studio and logs | `Open customer page` |
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

## Navigate — Accepted

- **Contract:** `browser.navigate@2`
- **Ports:** `input`, `success`, `error`
- **Native host:** not required
- **Status:** Accepted. Source automation, cache-safe live success, and the
  stopped-server red error route passed on 2026-07-27.

### Purpose and requirements

Navigate changes a selected browser tab in one of four explicit ways: go to an
exact URL, go back, go forward, or reload. Use it whenever later nodes need a
known page or a deliberate history action.

The node needs Chrome/Chromium tab access. DOM-ready and network-idle waits also
need scripting access on a normal supported page. Browser-controlled pages such
as `chrome://` allow tab navigation but do not allow DOM readiness checks. The
node executor never uses the native host. The source companion is needed only
if Graph Studio loads the checked-in acceptance file through its OS workflow
list.

The URL field accepts absolute URLs such as `https://example.com/account/42`.
Text such as `example search words` is rejected; Navigate never silently turns
it into a web search.

Graph Studio is a control page, not an automation target. When a workflow is
started while Graph Studio is the active tab, an entry `browser.navigate@2`
configured as `goto_url`, `current`, and `new_tab` may safely create its own
destination tab. BRunner does not navigate the Studio page or guess another
open page. Operations that need an existing tab still require a normal browser
page, a Bound Domain, or an explicitly reusable tab.

### Fields

| Field | Default | How it works | Example |
|---|---|---|---|
| Enabled | On | Uncheck to skip without touching a tab | Checked |
| Display Name | `Navigate` | Friendly Studio/log label | `Open account page` |
| Operation | `goto_url` | Dropdown: `goto_url`, `back`, `forward`, `reload` | `reload` |
| Tab Source | `current` | Dropdown: current, active, saved reference, or previous node | `saved_reference` |
| Saved Tab Reference | empty | Required for `saved_reference`; autocompletes saved tabs | `account_tab` |
| URL | empty | Required for `goto_url`; supports templates and expression autocomplete | `https://example.com/accounts/{{ variables.accountId }}` |
| Open Destination In | `current_tab` | Current selected tab or a new active tab; `new_tab` can safely start a Studio-run workflow without an existing page | `new_tab` |
| Wait Until | `dom_ready` | None, navigation start, DOM ready, full load, or network idle | `full_load` |
| Timeout | `30000` ms | Bounds the action and readiness wait | `10000` |
| When History Is Unavailable | `fail` | Dropdown: fail, skip, or continue | `continue` |
| Save Tab Reference As | empty | Saves the resulting tab for later node autocomplete | `account_tab` |
| Protected Page Policy | `fail` | Fail, skip readiness, ask the user, or wait for a supported page | `wait_until_supported` |
| Retry Count | `1` | Eligible retries after the first attempt | `1` |
| Retry Delay | `0` ms | Delay before an eligible retry | `500` |
| Retry Strategy | `fixed` | Fixed or increasing delay | `fixed` |
| Retry Only For | `navigation_failure` | Navigation failures only, or any eligible error | `navigation_failure` |
| On Error | `fail` | Fail, continue with warning, skip, or use the Graph error port | `error_port` |
| Save Output As | empty | Optional alias for the complete output object | `account_navigation` |
| Workflow Clipboard | `off` | Off, replace, append, or create a version in the run-local clipboard | `replace` |
| Clipboard Entry Name | empty | Entry name when Workflow Clipboard output is enabled | `account_navigation` |
| Log Level | `normal` | Structural summaries or verbose local values | `normal` |

`URL` autocompletes variables, previous node outputs, Workflow Clipboard
entries, and loop values. `Saved Tab Reference` autocompletes tab references.
Operation, destination, wait behavior, history behavior, protected-page policy,
retry policy, error policy, clipboard mode, and log level use dropdowns so their
meaning is never guessed from free-form text.

### Graph Studio usage

Drag Navigate from the Navigation category, configure the fields above,
connect `success` to the next node, and optionally connect `error` when On Error
is `error_port`.

The finalized v2 editor shows the complete field set above. The compact legacy
`URL` / `Open In` editor belongs only to `browser.navigate@1`; its `sameTab` /
`newTab` aliases are never shown for or applied to v2.

Saving and reopening in Graph Studio must preserve the exact contract version,
configuration and value types, output ports, routes, node position/layout
metadata, and expressions that the background execution plan consumes.

### Execution, readiness, and retry behavior

Navigate resolves the requested tab, validates the exact URL, performs one
browser action, waits for the selected readiness state, refreshes the resulting
tab metadata, then publishes output. Redirects are reported through
`currentUrl`; `previousUrl` remains the URL before the action.

For the safe Studio bootstrap case (`current` plus `new_tab`), no source page
exists, so the new tab has no forced opener and `previousUrl` is `null`. If a
normal current page does exist, it remains the opener and supplies
`previousUrl`.

- `none` returns after the browser action starts.
- `navigation_start` confirms the action was issued.
- `dom_ready` waits for `document.readyState` to become interactive or complete.
- `full_load` waits for the Chrome tab status to become complete.
- `network_idle` requires a complete document and at least 500 ms without a
  completed resource request. This is a bounded browser approximation, not a
  promise that application background work has ended.

The default single retry is verification-gated. If the URL already changed or
the navigation completed, Navigate does not repeat the side effect. Timeout and
user cancellation abort readiness polling. With `ask_user`, the run log asks
the user to navigate the selected protected tab to a supported page and waits
within the same timeout.

### Output

Successful output has this stable shape:

```json
{
  "operation": "goto_url",
  "previousUrl": "https://start.example/",
  "currentUrl": "https://example.com/account/42",
  "tab": {
    "id": 123,
    "windowId": 4,
    "index": 1,
    "url": "https://example.com/account/42",
    "title": "Account",
    "active": true,
    "status": "complete",
    "pageCapability": "dom_supported"
  },
  "navigationState": "dom_ready",
  "durationMs": 287
}
```

Downstream examples:

```text
{{ nodes.navigate-fixture.output.currentUrl }}
{{ variables.account_navigation.tab.id }}
{{ workflowClipboard.account_navigation.currentUrl }}
```

### Expected failures and troubleshooting

| Failure | Meaning and action |
|---|---|
| `CONFIG_INVALID` | A required option or strict absolute URL is invalid; correct the highlighted field. |
| `TAB_NOT_FOUND` | The selected/saved tab no longer exists; choose another source or recreate the reference. |
| `browser.navigate/NO_HISTORY` | Back/forward has no entry; choose skip/continue if that is acceptable. |
| `browser.navigate/NAVIGATION_FAILED` | Chrome rejected or could not complete the navigation; inspect the local cause and retry evidence. |
| `PROTECTED_PAGE` | DOM readiness is unavailable on the browser-controlled destination; change the policy or navigate away. |
| `TIMEOUT` | The action/readiness state did not finish within Timeout. |
| `CANCELLED` | The user stopped the workflow; no further retry occurs. |
| No suitable browser tab | The entry action needs an existing page. Open a normal web page, set a Bound Domain, enable explicit tab reuse, or make the enabled entry Navigate node use `current` plus `new_tab`. |

### Acceptance workflow

The focused workflow is
`BRunner_Host/Workflows/node_acceptance/001_navigate_acceptance.json`. Start the
root-aware synthetic fixture launcher from any PowerShell working directory:

```powershell
& "C:\path\to\BR\start_acceptance_server.ps1"
```

The launcher binds only to `127.0.0.1`, serves the repository root explicitly,
sends `Cache-Control: no-store` on every response, and rejects an occupied port
that does not expose the expected fixture with that cache policy. Use this
launcher rather than a generic Python HTTP server so the stopped-server failure
case cannot succeed from Chrome's cache.

Load `BRunner/` as an unpacked extension, start the source companion if needed,
enable **Include workflows in subfolders** on its Workflow Storage tab, refresh
the Studio workflow list, select
`node_acceptance/001_navigate_acceptance.json` in Graph Studio, and run it.
Success creates a new active tab for the versioned
`tests/fixtures/navigate-acceptance.html` fixture URL, saves
`navigate_acceptance_tab`, and publishes all six output keys under
`nodes.navigate-fixture.output`,
`variables.navigate_acceptance`, and
`workflowClipboard.navigate_acceptance`. With the local fixture server stopped,
the expected bounded failure follows the `error` route to Needs Attention.
Both cases were verified from the unpacked source extension on 2026-07-27.

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
