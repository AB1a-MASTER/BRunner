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
acceptance gate. Scroll v2, Tab Control v1, and Resolve Element v1 are
implemented from source and ready for their focused live acceptance. Existing
version-1 Navigate and Scroll workflows continue to use isolated provisional
behavior; the finalized palette entries use the exact contract versions below.
The provisional `browser.tab.switch`, `browser.tab.open`, and
`browser.tab.close` actions are replaced by one finalized Tab Control contract
and are not migrated. Resolve Element is a new finalized type with no
provisional equivalent.

| Node | Type and version | Phase | Acceptance workflow | Status |
|---|---|---:|---|---|
| Navigate | `browser.navigate@2` | 1 | `001_navigate_acceptance.json` | Accepted |
| Scroll | `browser.scroll@2` | 1 | `002_scroll_acceptance.json` | Acceptance pending |
| Tab Control | `browser.tab.control@1` | 1 | `003_tab_control_acceptance.json` | Acceptance pending |
| Resolve Element | `element.resolve@1` | 1 | `004_resolve_element_acceptance.json` | Acceptance pending |

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

## Scroll — Acceptance pending

- **Contract:** `browser.scroll@2`
- **Ports:** `input`, `success`, `error`, `unresolved`
- **Native host:** optional visible fallback for vertical wheel scrolling
- **Status:** Source implementation and automated acceptance guards pass. The
  focused unpacked-extension live check is pending.

### Purpose and requirements

Scroll moves the current supported web page, a resolved scroll container, or a
resolved destination element. Use it for fixed movement, jumping to a vertical
boundary, aligning an element, or repeating bounded movement until a safe
condition is met.

The node needs an existing normal Chrome/Chromium page and content-script
access. It fails on browser-controlled pages such as `chrome://`. Page scrolling
does not require a target. Container scrolling and `to_element` require the
shared canonical target editor. Ambiguous mapper targets never fall back to an
arbitrary first match; connect `unresolved` to Needs Attention or another
explicit recovery path.

Browser scrolling is the normal execution method. Optional native-host fallback
is off by default and is never required for ordinary use. When enabled, it is a
last-resort, foreground-verified physical wheel action after a definite browser
failure. It supports vertical movement only, cannot safely perform
`to_element`, and is verified from browser telemetry after the host action.

### Fields

| Field | Default | How it works | Example |
|---|---|---|---|
| Enabled | On | Uncheck to skip without moving the page | Checked |
| Display Name | `Scroll` | Friendly Studio/log label | `Load more results` |
| Operation | `by_amount` | `by_amount`, `to_top`, `to_bottom`, `to_element`, or `until_condition` | `until_condition` |
| Scroll Target | `page` | Page or resolved container | `container` |
| Target Element / Container | empty | Optional for page movement; required for container and `to_element` | CSS `#results-panel` |
| Direction | `down` | Up, down, left, or right for amount/condition movement | `down` |
| Amount | `500` | Non-negative movement magnitude; supports value autocomplete | `80` |
| Amount Unit | `pixels` | Pixels, viewport percent, or viewport-sized screens | `viewport_percent` |
| Element Alignment | `center` | Top, center, bottom, or nearest for `to_element` | `nearest` |
| Smooth Scrolling | Off | Requests bounded browser smooth movement | Unchecked |
| Maximum Attempts | `10` | Hard limit for `until_condition` movement | `20` |
| Pause Between Scrolls | `250` ms | Delay between bounded attempts | `100` |
| Stop Condition | `scroll_end` | Scroll end, unchanged position, visible selector, or text present | `text_present` |
| Stop Value | empty | Required CSS selector or text for the matching stop condition | `Results complete` |
| Wait For Content After Each Scroll | Off | Briefly observes content-size/text changes before continuing | Checked |
| Timeout | `30000` ms | Bounds all movement, waits, verification, and fallback | `10000` |
| Use Visible Host Fallback | Off | Allows the validated foreground wheel fallback | Unchecked |
| If Host Is Unavailable | `fail` | Fail, skip, or take the Graph error path | `error_path` |
| Retry Count | `1` | Eligible retry after a pre-movement container readiness failure | `1` |
| Retry Delay | `250` ms | Delay before that eligible retry | `250` |
| Retry Strategy | `fixed` | Fixed or increasing delay | `fixed` |
| Retry Only For | `container_not_ready` | Fixed to the one safe Scroll retry reason | `container_not_ready` |
| On Error | `fail` | Fail, continue with warning, skip, or use `error` | `error_port` |
| Save Output As | empty | Optional alias for the complete Scroll output | `results_scroll` |
| Workflow Clipboard | `off` | Off, replace, append, or create a version | `replace` |
| Clipboard Entry Name | empty | Entry name when clipboard output is enabled | `results_scroll` |
| Log Level | `normal` | Structural summaries or verbose local values | `normal` |

Operation, target scope, direction, unit, alignment, stop condition, retry
policy, host-unavailable policy, error policy, clipboard mode, and log level use
explicit controls. Amount, attempt, pause, timeout, and stop-value fields
autocomplete applicable variables, prior node outputs, Workflow Clipboard
entries, and loop values.

Safe stop conditions do not execute user-provided JavaScript:

- `scroll_end` stops at the requested directional boundary.
- `position_unchanged` stops when the last bounded action did not move.
- `selector_visible` requires a valid CSS selector in Stop Value.
- `text_present` searches the page or resolved container text for Stop Value.

### Graph Studio usage

Drag Scroll from Navigation and choose the operation first. For page movement,
leave the target empty. Choose `container` to make Target Element / Container
required, or choose `to_element` to use that target as the destination element.
Graph Studio shows whether the target is optional or required for the current
configuration.

Connect `success` to the next step. Connect `error` when On Error is
`error_port`. Connect `unresolved` whenever the node uses a mapped component or
another target whose resolution may become ambiguous or stale. Saving and
reopening preserves the exact `browser.scroll@2` contract, target data,
configuration value types, expressions, ports, and routes used by the canonical
background execution plan.

Version 1 remains provisional and accepts only its old `x`/`y` page offset
shape. It is not migrated or silently reinterpreted as version 2. The separate
provisional `element.scroll_into_view@1` action also remains isolated.

### Execution, waits, retry, and fallback behavior

For each browser attempt, Scroll resolves the selected root, records its
position, performs one bounded movement, waits for smooth motion when selected,
and records verified final position and content telemetry.

- `by_amount` performs one relative movement.
- `to_top` and `to_bottom` move to the page/container vertical boundary.
- `to_element` aligns the destination within its nearest scrollable ancestor.
- `until_condition` performs at most Maximum Attempts and checks the selected
  condition after every movement.

Cancellation is checked between actions and waits. Timeout bounds the complete
node. Inspection after host fallback never repeats movement. The only retryable
failure is `container_not_ready` before movement begins; completed or uncertain
movement is never repeated. A host action is blocked unless the browser
failure is known not to have completed, the required host capabilities are
present, the tab/window is foreground verified, and the target coordinate is
visible.

### Output

Successful output has this stable shape:

```json
{
  "operation": "until_condition",
  "scrollCount": 7,
  "finalPosition": {
    "x": 0,
    "y": 896,
    "maxX": 0,
    "maxY": 896,
    "atStart": false,
    "atEnd": true
  },
  "stopReason": "condition_met",
  "executionMethod": "browser"
}
```

`stopReason` is one of `amount_complete`, `top_reached`,
`bottom_reached`, `target_aligned`, `condition_met`, `scroll_end`,
`position_unchanged`, `max_attempts`, or `no_movement`.
`executionMethod` is `browser` or `host`.

Downstream examples:

```text
{{ nodes.scroll-fixture-panel.output.scrollCount }}
{{ variables.results_scroll.finalPosition.y }}
{{ workflowClipboard.results_scroll.stopReason }}
```

### Expected failures and troubleshooting

| Failure | Meaning and action |
|---|---|
| `CONFIG_INVALID` | A required target, stop value, number, or dropdown option is invalid; correct the highlighted field. |
| `TARGET_NOT_FOUND` / unresolved route | The target cannot be resolved or is materially ambiguous; remap it or handle Needs Attention. |
| `browser.scroll/CONTAINER_NOT_READY` | The resolved element is not currently scrollable; wait for content/layout or inspect the target. |
| `browser.scroll/SCROLL_FAILED` | Browser movement or verification failed; inspect the local diagnostics and side-effect state. |
| `PROTECTED_PAGE` | The current tab does not allow DOM automation; select a supported web page. |
| `HOST_UNAVAILABLE` | Host fallback was enabled but its paired capabilities were unavailable; disable fallback or start/pair the source companion. |
| `HOST_FOREGROUND_REQUIRED` | The visible host fallback could not verify the expected foreground window. |
| `TIMEOUT` | The bounded movement/condition did not finish within Timeout. |
| `CANCELLED` | The user stopped the workflow; no further movement or retry occurs. |

### Acceptance workflow

The focused workflow is
`BRunner_Host/Workflows/node_acceptance/002_scroll_acceptance.json`. Start the
root-aware fixture launcher:

```powershell
& "C:\path\to\BR\start_acceptance_server.ps1"
```

Open
`http://127.0.0.1:8765/tests/fixtures/scroll-acceptance.html?acceptance=002-scroll-v2`
in a normal Chrome tab and keep it active. Load `BRunner/` as the unpacked
extension, start the source companion if Graph Studio needs its workflow list,
enable **Include workflows in subfolders**, refresh the list, select
`node_acceptance/002_scroll_acceptance.json`, and run it.

Success scrolls only `#acceptance-scroll-panel` in bounded 80% increments until
the verified scroll end and synthetic completion marker are reached. It
publishes all five output keys
under `nodes.scroll-fixture-panel.output`, `variables.scroll_acceptance`, and
`workflowClipboard.scroll_acceptance`. Running on the wrong page or with the
target removed follows `error` or `unresolved` to Needs Attention instead of
guessing or scrolling an ambiguous element. These live checks remain pending
until confirmed with the unpacked source extension.

## Tab Control — Acceptance pending

- **Contract:** `browser.tab.control@1`
- **Ports:** `input`, `success`, `error`
- **Native host:** not used
- **Status:** Source implementation and automated acceptance guards pass. The
  focused unpacked-extension live check is pending.

### Purpose and requirements

Tab Control is the single finalized node for tab-level work. Use it to open a
browser New Tab or a URL in a new tab, switch to a specific or relative tab,
return to the tab the run started on, close a tab, focus, pin, unpin, mute,
unmute, or bookmark a page.

The node needs Chrome tab and window access, which the extension always has. It
does not use the content script and does not perform DOM automation, so tab
operations still work while a browser-controlled page such as `chrome://` or a
New Tab is selected. Those pages report
`pageCapability: "tab_control_only"`, which tells later DOM nodes that the page
cannot be automated.

Bookmark operations additionally need Chrome's optional `bookmarks` permission.
Graph Studio offers a visible click-to-grant control because Chrome only
accepts an optional-permission request from a real user gesture. Without the
grant, the two bookmark operations fail with a stable
permission-unavailable error rather than silently skipping.

### Operations

| Operation | What it does |
|---|---|
| `open_browser_new_tab` | Opens Chrome's New Tab page |
| `open_url_in_new_tab` | Opens an absolute URL, optionally reusing an exact-URL tab |
| `switch_tab` | Activates the tab chosen by the selector |
| `switch_relative_tab` | Moves left/right/next/previous by an offset |
| `return_to_origin_tab` | Returns to the immutable tab the run started on |
| `close_tab` | Closes the selected tab and activates a deterministic next tab |
| `focus_tab` | Activates the tab and focuses its window |
| `pin_tab` / `unpin_tab` | Sets pinned state |
| `mute_tab` / `unmute_tab` / `toggle_mute` | Sets audio mute state |
| `bookmark_page` | Bookmarks the selected page, idempotent per exact URL and folder |
| `remove_bookmark` | Removes a bookmark by exact page URL or explicit ID |

### Fields

| Field | Default | How it works | Example |
|---|---|---|---|
| Enabled | On | Uncheck to skip without changing any tab | Checked |
| Display Name | `Tab Control` | Friendly Studio/log label | `Switch to article tab` |
| Operation | `switch_tab` | The exact operation from the table above | `open_url_in_new_tab` |
| Tab Selector | `current` | `current`, `saved_reference`, `id`, `index`, `title`, `url`, `most_recently_opened`, `first`, or `last` | `saved_reference` |
| Selector Value | empty | Required for saved reference, ID, index, title, and URL; autocompletes tab references, variables, prior outputs, clipboard, and loop values | `article_tab` |
| Title / URL Match | `exact` | Shown for title/URL selectors: `exact`, `contains`, or shared `*` and `?` wildcard | `contains` |
| Multiple Matches | `fail` | Shown for title/URL selectors: `fail`, `first_matching`, or `most_recently_opened` | `fail` |
| Relative Direction | `right` | Shown for relative switching: `left`, `right`, `next`, `previous` | `right` |
| Relative Offset | `1` | Whole tab positions to move | `2` |
| Wrap Around | Off | Continue from the opposite edge instead of stopping | Unchecked |
| URL | empty | Required absolute URL for `open_url_in_new_tab`; plain search text is rejected | `https://example.com/article` |
| Open In Background | Off | Create the tab without activating it | Checked |
| Reuse Matching Tab | Off | Reuse one exact-URL tab; several exact matches fail safely | Unchecked |
| After Close | `opener` | Tab to activate after closing: `opener`, `left`, `right`, `most_recent`, `none` | `opener` |
| If Tab Is Not Found | `fail` | `fail`, `skip` (complete with a warning), or `error_port` | `skip` |
| Wait Until | `navigation_start` | Readiness after opening: `none`, `navigation_start`, `dom_ready`, `full_load`, `network_idle` | `dom_ready` |
| Save Tab Reference As | empty | Names the selected or created tab for later selectors | `article_tab` |
| Confirm Before Close | Off | Requires explicit interactive approval before closing | Unchecked |
| Bookmark Folder | `default_bar` | `default_bar` or `folder_id` for `bookmark_page` | `default_bar` |
| Bookmark Folder ID | empty | Required when the folder mode is `folder_id` | `1` |
| Bookmark Selector | `current_page_url` | `current_page_url` or `bookmark_id` for `remove_bookmark` | `current_page_url` |
| Bookmark ID | empty | Required when removing by explicit ID | `42` |
| Remove All URL Matches | Off | Removes every exact-URL bookmark; otherwise duplicates fail safely | Unchecked |
| Timeout | `30000` ms | Bounds selection, the action, and configured readiness | `10000` |
| Retry Count | `1` | Used only when verification proves the action did not complete | `1` |
| Retry Delay | `0` ms | Delay before a verified-safe retry | `250` |
| Retry Strategy | `fixed` | Fixed or increasing delay | `fixed` |
| Retry Only For | `any_error` | `target_not_found`, `timeout`, or `any_error` | `target_not_found` |
| On Error | `fail` | Fail, continue with warning, skip, or use `error` | `error_port` |
| Save Output As | empty | Optional alias for the complete output | `article_tab_result` |
| Workflow Clipboard | `off` | Off, replace, append, or version | `off` |
| Clipboard Entry Name | empty | Entry name when clipboard output is enabled | `article_tab_result` |
| Log Level | `normal` | Structural summaries or verbose local values | `normal` |

Operation, selector kind, match mode, ambiguity behavior, relative direction,
close behavior, not-found behavior, readiness, bookmark folder/selector, retry
policy, error policy, clipboard mode, and log level all use explicit dropdowns
or checkboxes. Graph Studio shows only the fields that apply to the chosen
operation and selector.

### Selecting tabs safely

`current` needs no value and is the default. `saved_reference` uses a name
stored earlier by Save Tab Reference As, which is the recommended way to return
to a tab the workflow opened itself.

Title and URL selectors observe the complete match set before choosing, so
ambiguity is an explicit decision rather than a hidden first-match guess. With
Multiple Matches set to `fail`, several matches stop the node safely.

`most_recently_opened` uses only tab creation order tracked during the current
run. Chrome does not expose reliable creation time for tabs that already
existed, so a tab without run-tracked creation data follows If Tab Is Not Found
instead of guessing from tab ID or last-accessed time.

`return_to_origin_tab` uses the immutable tab reference captured when the run
started. It is not affected by later switching, opening, or closing.

### Graph Studio usage

Drag Tab Control from Navigation and choose the operation first; the remaining
fields appear based on that choice. Connect `success` to the next step, and
connect `error` whenever On Error is `error_port` or If Tab Is Not Found is
`error_port`.

For bookmark operations, use the visible bookmarks-permission control in the
node editor to grant Chrome's optional permission before running.

Saving and reopening preserves the exact `browser.tab.control@1` contract,
configuration value types, expressions, ports, and routes used by the canonical
background execution plan.

### Execution, retry, and side-effect behavior

Selection happens first, then the action, then verification of the resulting
state. Cancellation is checked between steps and Timeout bounds the whole node.

Open and switch may retry once for a verified transient not-ready or not-found
race. Close, pin, mute, and bookmark verify before retrying and never repeat
when the resulting state is uncertain, so a tab is never closed twice and a
bookmark is never duplicated.

`bookmark_page` is idempotent for the exact current URL within the selected
folder. `remove_bookmark` fails on duplicate URL matches unless Remove All URL
Matches is checked.

When Confirm Before Close is on, execution waits for an explicit user response.
It never assumes consent and fails clearly when no interactive confirmation
service is available.

A deliberate not-found skip completes on `success` with a `TAB_NOT_FOUND`
warning and an output whose `tab` is `null`, so the run continues without
acting on an unresolved tab.

### Output

Successful output has this stable shape:

```json
{
  "operation": "switch_tab",
  "originTab": {
    "id": 118,
    "windowId": 4,
    "index": 0,
    "url": "http://127.0.0.1:8765/tests/fixtures/navigate-acceptance.html",
    "title": "Navigate Acceptance Fixture",
    "active": false,
    "status": "complete",
    "pageCapability": "dom_supported"
  },
  "tab": {
    "id": 119,
    "windowId": 4,
    "index": 1,
    "url": "http://127.0.0.1:8765/tests/fixtures/navigate-acceptance.html?acceptance=003-tab-control-v1",
    "title": "Navigate Acceptance Fixture",
    "active": true,
    "status": "complete",
    "pageCapability": "dom_supported"
  },
  "createdTab": null,
  "pageCapability": "dom_supported",
  "matchedBy": "saved_reference",
  "pinned": null,
  "muted": null,
  "bookmarked": null
}
```

`originTab`, `tab`, and `createdTab` use the same bounded tab shape as Navigate
and may be `null` when the operation does not produce one. `matchedBy` records
how the tab was chosen, such as `saved_reference`, `created_tab`,
`reuse_exact_url`, `origin_tab`, `relative_right`, or a title/URL kind with an
ambiguity suffix like `title:first_matching`. `pinned`, `muted`, and
`bookmarked` report verified state only for the operations that change them and
are otherwise `null`.

Downstream examples:

```text
{{ nodes.switch-saved-fixture.output.tab.id }}
{{ variables.article_tab_result.tab.title }}
{{ nodes.open-background-fixture.output.createdTab.url }}
```

### Expected failures and troubleshooting

| Failure | Meaning and action |
|---|---|
| `CONFIG_INVALID` | A required selector value, URL, ID, or number is missing or invalid; correct the highlighted field. |
| `TAB_NOT_FOUND` | The selector matched no tab. Choose `skip` or `error_port` under If Tab Is Not Found to handle it as a route instead of a failure. |
| `browser.tab.control/AMBIGUOUS_SELECTOR` | Several tabs matched while Multiple Matches was `fail`; narrow the selector or pick an explicit ambiguity behavior. |
| `browser.tab.control/OPERATION_FAILED` | Chrome rejected or could not verify the tab operation; inspect the local diagnostics. |
| `browser.tab.control/BOOKMARK_PERMISSION_UNAVAILABLE` | The optional `bookmarks` permission was not granted; use the Graph Studio grant control and rerun. |
| `browser.tab.control/CLOSE_CONFIRMATION_UNAVAILABLE` | Confirm Before Close was on but no interactive confirmation service was available; the tab was not closed. |
| `browser.tab.control/CLOSE_NOT_CONFIRMED` | The user declined the close confirmation; no tab was closed. |
| `PROTECTED_PAGE` | Reported as a warning when the selected page allows tab control but not DOM automation. |
| `TIMEOUT` | Selection, the action, or the configured readiness did not finish within Timeout. |
| `CANCELLED` | The user stopped the workflow; no further tab change or retry occurs. |

### Acceptance workflow

The focused workflow is
`BRunner_Host/Workflows/node_acceptance/003_tab_control_acceptance.json`. Start
the root-aware fixture launcher:

```powershell
& "C:\path\to\BR\start_acceptance_server.ps1"
```

Load `BRunner/` as the unpacked extension, start the source companion if Graph
Studio needs its workflow list, enable **Include workflows in subfolders**,
refresh the list, select `node_acceptance/003_tab_control_acceptance.json`, and
run it from a normal web page so the run has a usable origin tab.

Success opens the versioned `tests/fixtures/navigate-acceptance.html` fixture in
a background tab, saves `tab_control_acceptance`, switches to it by saved
reference, pins and unpins it, mutes and unmutes it, closes it back to the
opener, returns explicitly to the immutable origin tab, and then completes a
deliberate not-found skip whose output has `tab: null` and a `TAB_NOT_FOUND`
warning. Every step publishes the nine output keys, and any real failure follows
`error` to Needs Attention.

Bookmark permission absence is covered by deterministic focused tests rather
than the live workflow, because a live bookmark probe would create persistent
browser data. These live checks remain pending until confirmed with the
unpacked source extension.

## Resolve Element — Acceptance pending

- **Contract:** `element.resolve@1`
- **Ports:** `input`, `success`, `error`, `unresolved`
- **Native host:** not used
- **Status:** Source implementation and automated acceptance guards pass. The
  focused unpacked-extension live check is pending.

### Purpose and requirements

Resolve Element finds an element and reports what it found without clicking,
typing, scrolling, or changing the page in any way. Use it to confirm a mapped
component still exists, to discover elements that appear at run time, or to
collect a reusable set of matching elements for later nodes.

Because it publishes a reusable component reference, it is the normal way to
resolve something once and reuse it across several later nodes instead of
repeating the same target in each one.

The node needs a normal Chrome/Chromium page and content-script access, and the
target editor is always required. It fails on browser-controlled pages such as
`chrome://`. The mapper is the only resolver; a materially ambiguous target is
never settled by picking an arbitrary match. Connect `unresolved` to Needs
Attention or another explicit recovery path.

### Modes

| Mode | What it does |
|---|---|
| `resolve_known` | Resolves a component you already mapped or recorded |
| `find_dynamic` | Discovers an element that appears at run time |
| `revalidate_component` | Re-checks a saved component and requires a mapper ComponentRef |

### Fields

| Field | Default | How it works | Example |
|---|---|---|---|
| Enabled | On | Uncheck to skip without resolving anything | Checked |
| Display Name | `Resolve Element` | Friendly Studio/log label | `Find the results table` |
| Mode | `resolve_known` | The mode from the table above | `find_dynamic` |
| Target Element | required | The shared canonical target editor | CSS `#results-table` |
| Expected Element Type | empty | Optional semantic type the match must be | `table` |
| Result Cardinality | `one` | `one` requires exactly one verified match; `first` takes the first after collecting every candidate; `all` returns the whole set | `all` |
| Search Scope | `automatic_shadow_dom` | Whole page, a frame, a selected container, or automatic shadow DOM | `whole_page` |
| Visibility Requirement | `any` | Accept any match, require visible, or require interactable | `visible` |
| Map Freshness | `revalidate_if_stale` | Use the cache, revalidate when stale, or refresh before resolving | `refresh_before_resolution` |
| Minimum Confidence | `0.75` | Rejects a match scoring below this value between 0 and 1 | `0.9` |
| If Ambiguous | `fail` | Fail safely or require explicit user review | `fail` |
| Timeout | `30000` ms | Bounds map refresh, resolution, and verification | `10000` |
| Retry Count | `1` | Retries only a stale map or a not-yet-ready target | `1` |
| Retry Delay | `250` ms | Delay before an eligible retry | `250` |
| Retry Strategy | `fixed` | Fixed or increasing delay | `fixed` |
| Retry Only For | `target_not_found` | `target_not_found` or `timeout` only | `target_not_found` |
| On Error | `fail` | Fail, continue with warning, skip, or use `error` | `error_port` |
| Save Output As | empty | Optional alias for the complete output | `results_table` |
| Workflow Clipboard | `off` | Off, replace, append, or version | `replace` |
| Clipboard Entry Name | empty | Entry name when clipboard output is enabled | `results_table` |
| Log Level | `normal` | Structural summaries or verbose local values | `normal` |

Mode, cardinality, scope, visibility, freshness, ambiguity, retry policy, error
policy, clipboard mode, and log level all use explicit dropdowns. Expected
Element Type autocompletes variables and prior node outputs.

### Choosing a cardinality safely

`one` is the safe default: it fails rather than acting on a guess when the page
contains more than one match. Use it whenever the workflow depends on a single
specific element.

`first` and `all` collect the complete candidate set before choosing, so
"first" is an explicit decision rather than a hidden guess. Both require an
explicit **CSS or XPath** target selector, because that is the only way the
complete set is knowable; with any other identifier kind they fail with
`CONFIG_INVALID` instead of quietly returning a single match. The set is bounded
to 200 elements.

### Graph Studio usage

Drag Resolve Element from Targeting and set the target first, since it is always
required. Choose the mode, then the cardinality.

Connect `success` to the next step. Connect `error` when On Error is
`error_port`. Connect `unresolved` whenever the target may become missing,
stale, or ambiguous — this is the route that carries a resolution failure, and
it is what keeps the workflow from acting on the wrong element.

Saving and reopening preserves the exact `element.resolve@1` contract, target
data, configuration value types, expressions, ports, and routes used by the
canonical background execution plan.

### Execution, retry, and verification behavior

Resolve Element performs no page action. It resolves, verifies the match against
the visibility requirement and minimum confidence, and reports the result.
Because nothing changes, it is safe to retry.

A stale map, a not-found target, or a deferred dynamic page may retry.
Ambiguity is never retried, because retrying cannot make an ambiguous page
unambiguous — it only risks eventually picking one at random. Cancellation is
checked between steps and Timeout bounds the whole node.

Confidence reporting: a uniquely matched selector that you wrote yourself is a
definite match and reports confidence `1.0`. Mapper, fuzzy, and controls-tree
matches report their real scores, so Minimum Confidence is meaningful for the
cases where the resolver actually had to judge.

### Output

Successful output has this stable shape:

```json
{
  "mode": "resolve_known",
  "resolvedComponentId": "results-table",
  "component": {
    "componentId": "results-table",
    "componentUid": "uid_results_table",
    "semanticType": "table",
    "accessibleName": "Synthetic results table",
    "mappingLayer": "static",
    "pageProfileKey": "127.0.0.1:/tests/fixtures/resolve-acceptance.html",
    "frameContext": { "framePath": "main", "access": "same_origin" },
    "state": { "visible": true, "interactable": true, "status": null },
    "confidence": 1
  },
  "components": [],
  "matchCount": 1,
  "targetResolution": {
    "resolved": true,
    "state": "resolved",
    "matchedBy": "primary_locator_unique",
    "fallbackUsed": false,
    "confidence": 1,
    "matchCount": 1
  }
}
```

`component` is the single resolved element and is `null` only when an all-result
returned nothing. `components` holds the bounded set for `first` and `all`.
Component objects carry mapper-owned identity, semantic type, page/frame
context, a state summary, and confidence only — never raw DOM nodes or unbounded
evidence.

Downstream examples:

```text
{{ nodes.resolve-results-table.output.resolvedComponentId }}
{{ variables.results_table.component.accessibleName }}
{{ nodes.resolve-result-rows.output.matchCount }}
{{ workflowClipboard.results_table.component.semanticType }}
```

### Expected failures and troubleshooting

| Failure | Meaning and action |
|---|---|
| `CONFIG_INVALID` | A required target, selector, number, or dropdown option is invalid. This also covers `first`/`all` without an explicit CSS or XPath selector, and `revalidate_component` without a saved ComponentRef. |
| `TARGET_NOT_FOUND` / unresolved route | The element does not exist or the map is stale; remap it or handle Needs Attention. |
| `AMBIGUOUS_TARGET` / unresolved route | Several elements matched while cardinality was `one` or If Ambiguous was `fail`; narrow the target or use `first`/`all` deliberately. |
| `element.resolve/RESOLUTION_FAILED` | The match scored below Minimum Confidence; remap the component or lower the threshold deliberately. |
| `TARGET_NOT_VISIBLE` | The element resolved but is hidden while Visibility Requirement was `visible`. |
| `TARGET_NOT_INTERACTABLE` | The element resolved but is disabled or unusable while the requirement was `interactable`. |
| `PROTECTED_PAGE` | The current tab does not allow DOM automation; select a supported web page. |
| `TIMEOUT` | Refresh, resolution, or verification did not finish within Timeout. |
| `CANCELLED` | The user stopped the workflow. |

### Acceptance workflow

The focused workflow is
`BRunner_Host/Workflows/node_acceptance/004_resolve_element_acceptance.json`.
Start the root-aware fixture launcher:

```powershell
& "C:\path\to\BR\start_acceptance_server.ps1"
```

Open
`http://127.0.0.1:8765/tests/fixtures/resolve-acceptance.html`
in a normal Chrome tab and keep it active. Load `BRunner/` as the unpacked
extension, start the source companion if Graph Studio needs its workflow list,
enable **Include workflows in subfolders**, refresh the list, select
`node_acceptance/004_resolve_element_acceptance.json`, and run it.

Success resolves `#results-table` as exactly one visible component, enumerates
the four `#results-table tbody tr.result-row` rows as a bounded component set
with `matchCount` 4, and publishes all six output keys under
`nodes.resolve-results-table.output`, `variables.resolve_acceptance_table`, and
`workflowClipboard.resolve_acceptance_table`. The page must be unchanged
afterward. The final node targets `#absent-element`, which exists nowhere, and
must take the `unresolved` route to Needs Attention instead of resolving
something else. These live checks remain pending until confirmed with the
unpacked source extension.

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
