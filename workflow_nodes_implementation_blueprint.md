# Workflow Nodes Implementation Blueprint

**Status:** Current implementation specification  
**Scope:** Node implementation only. The base workflow runtime, execution engine, internal DOM map / element resolver, Windows companion app, workflow persistence, and controlled-directory service are assumed to already exist.  
**Purpose:** Implement the current agreed node set in a consistent, testable order.

---

## 1. How to use this document

Implement the node layer in the order shown in **Section 8**. For every node:

1. Register its metadata, configuration schema, ports, and capability tags.
2. Implement its executor using the shared contracts in Sections 3–7.
3. Implement structured outputs, warnings, errors, and run-log entries.
4. Add unit tests and browser/host integration tests listed in the node card.
5. Mark the node complete only when it meets the shared done criteria in Section 2.

This document intentionally does **not** redesign the base runtime. It tells the node layer how to use the existing runtime services.

---

## 2. Definition of done for every node

A node is complete only when it has all of the following:

- Node metadata: stable `type`, display name, category, icon, description, version.
- Config schema with validation, defaults, help text, and advanced settings.
- Input/output ports and a documented output object.
- `enabled` / bypass behavior.
- Retry behavior where retrying is safe or explicitly configured.
- Structured logs for inputs, outputs, warnings, errors, retries, duration, and execution method.
- Sensitive-value exclusion from persistent run history and previews.
- Correct interaction with node outputs, Workflow Clipboard, and System Clipboard when relevant.
- Correct use of the element resolver when a page target is involved.
- Correct use of companion-host fallback when the node supports it.
- Safe handling of protected browser pages.
- Automated tests for success, expected failure, timeout, disabled node, retry behavior, and output availability.

### Standard node lifecycle

```text
queued
→ waiting_for_dependencies
→ running
→ waiting_async (when applicable)
→ completed | failed | timed_out | cancelled | skipped_disabled
```

### Standard result envelope

Each executor should return a normalized result envelope. Node-specific values belong under `output`.

```json
{
  "status": "completed",
  "output": {},
  "warnings": [],
  "errors": [],
  "execution": {
    "nodeId": "node_123",
    "attempt": 1,
    "startedAt": "2026-06-30T10:15:00.000Z",
    "finishedAt": "2026-06-30T10:15:00.840Z",
    "durationMs": 840,
    "executionMethod": "browser"
  }
}
```

---

## 3. Shared configuration and behavior

### 3.1 Common node configuration

Every node receives these baseline properties.

| Property | Required | Behavior |
|---|---:|---|
| `enabled` | Yes | Default `true`. When `false`, node is skipped without side effects or retries. |
| `displayName` | Yes | Human-readable, editable node name used in logs and expressions. |
| `retryCount` | Where safe | Number of retries after an eligible failure. Default depends on node type. |
| `retryDelay` | Optional | Fixed delay or increasing delay between retry attempts. |
| `retryStrategy` | Optional | Fixed or increasing delay. |
| `retryOnlyFor` | Optional | Timeout, target-not-found, navigation failure, host unavailable, any error, etc. |
| `timeout` | Where applicable | Maximum execution time. |
| `onError` | Yes | Fail, continue with warning, skip, route to error port, or node-specific behavior. |
| `saveOutputAs` | Optional | Friendly alias for downstream data access. |
| `saveToWorkflowClipboard` | Optional | Off, replace entry, append entry, or create version. |
| `logLevel` | Optional | Normal or verbose. Sensitive data remains excluded. |

### 3.2 Disabled / bypass behavior

When disabled:

- Do not execute the node action.
- Do not consume retry attempts.
- Do not create side effects.
- Do not reuse output from a previous run.
- Emit a run record with `status: "skipped_disabled"`.

```json
{
  "status": "skipped_disabled",
  "output": null,
  "warnings": [],
  "errors": []
}
```

### 3.3 Outputs and workflow context

All nodes that produce output publish it immediately when they complete. Later nodes may reference the result.

```text
{{ nodes.extract_customer.output.email }}
{{ nodes.navigate_to_store.output.currentUrl }}
{{ nodes.parse_csv.output.rows }}
{{ variables.customerEmail }}
{{ workflowClipboard.orderData }}
{{ loop.item }}
```

Rules:

- A node cannot access output from a node that has not completed.
- A downstream dependency waits automatically for required output.
- Outputs are structured objects, not only text.
- Sensitive values are usable in memory but excluded from persistent run history and output previews.

### 3.4 Logging and run history

Every workflow stores a non-sensitive history of its runs. Each node logs:

- Resolved non-sensitive inputs.
- Outputs and output summary.
- Warnings and errors.
- Start/end timestamps and duration.
- Retry attempts and retry reason.
- Browser tab reference, URL, and execution method for browser nodes.
- Host fallback attempt/result where applicable.
- Optional screenshot/artifact references when enabled.

Never persist sensitive values in:

- Node logs.
- Workflow run history.
- Workflow Clipboard history.
- Debug exports.
- Output previews.

### 3.5 Clipboard model

#### System Clipboard (default)

- Copy writes to the operating system clipboard by default.
- Paste reads from the operating system clipboard by default.

#### Workflow Clipboard (optional)

- Internal, run-scoped clipboard available to all later nodes.
- Supports text, JSON, CSV, structured records, file references, and version history.
- Does not replace or depend on the System Clipboard.

```text
{{ workflowClipboard.value }}
{{ workflowClipboard.customerEmail }}
{{ workflowClipboard.orderData.versions[0] }}
```

### 3.6 Text matching configuration

Any node that finds, selects, filters, compares, or extracts text from options, lists, fields, tables, or datasets must expose this reusable configuration where relevant.

| Property | Options |
|---|---|
| `matchMode` | Exact, contains, starts with, ends with, wildcard, regex |
| `caseSensitive` | `true` or `false` |
| `whitespaceHandling` | Preserve, trim, normalize repeated whitespace |
| `occurrence` | First, last, index, all |
| `multipleMatchBehavior` | Fail, first, highest confidence, return all |
| `emptyValueBehavior` | Fail, skip, no filter, return no match |

Wildcard rules:

- `*` means any number of characters.
- `?` means one character.
- Wildcards only apply when `matchMode` is `wildcard`.

Default for user-facing text: **exact + case-insensitive + normalized whitespace**.

### 3.7 Target configuration and element resolution

All DOM-targeting nodes use the shared target configuration.

#### User-provided identifier is always Priority 1

The user may provide any supported identifier:

- CSS selector
- XPath
- Element ID
- `name`
- Label text
- Visible text
- Accessible role + name
- Placeholder
- `data-*` / test ID
- Attribute + value
- Component reference from an earlier node
- Coordinates where appropriate

Resolution order:

```text
1. Try the exact user-provided identifier.
2. If it returns zero matches or is unusable, consult stored internal-map fallbacks.
3. Reconcile against the current page when required.
4. Verify candidate against the component fingerprint.
5. Apply ambiguity and confidence policy.
6. Perform the node action or extraction.
```

The internal map supplements the user identifier; it never silently replaces a valid primary match.

#### Shared target settings

| Property | Options |
|---|---|
| `identifierType` | Auto, CSS, XPath, ID, name, label, visible text, role, placeholder, attribute, component reference, coordinates |
| `identifierValue` | Static value, variable, template, or prior node result |
| `matchMode` | Shared text matching where the identifier is text-like |
| `scope` | Whole page, frame, selected container, automatic shadow-DOM-aware scope |
| `targetState` | Any, visible, interactable |
| `mapFreshness` | Use cache, revalidate if stale, refresh before resolution |
| `fallbackPolicy` | Disabled, semantic only, all verified internal-map fallbacks |
| `ambiguityPolicy` | Fail, highest confidence, first, ask user |
| `minimumConfidence` | Minimum confidence for fallback/reconciliation result |
| `tabSource` | Current, active, saved tab reference, previous-node tab |

#### Standard target-resolution output

```json
{
  "targetResolution": {
    "primaryIdentifier": {
      "type": "visible_text",
      "value": "Submit"
    },
    "primaryMatchStatus": "not_found",
    "resolved": true,
    "matchedBy": "fallback_accessible_role_and_name",
    "fallbackUsed": true,
    "confidence": 0.96,
    "matchCount": 1
  }
}
```

### 3.8 Protected browser pages

Examples include browser New Tab pages, browser internal pages, PDF viewer pages, view-source pages, and other browser-controlled surfaces.

- Tab-level actions are allowed where browser APIs permit them: activate, close, pin, mute, navigate away, bookmark, etc.
- DOM-dependent actions are unavailable: locate, click, type, extract DOM data, or page evaluation.
- Do not blindly retry protected-page errors.
- Applicable nodes expose `protectedPagePolicy`: fail, skip, ask user, or wait until a supported page is loaded.

### 3.9 Windows companion app / host fallback

The companion app is assumed available and provides:

- Workflow persistence.
- Controlled approved-directory access.
- Final system-mouse/system-keyboard fallback.

For host-assisted nodes:

1. Attempt browser-native execution first.
2. Verify expected result.
3. If it fails and host fallback is enabled, activate correct tab/window, ensure target visible, calculate coordinates, send host action, and verify again.
4. Log execution method and host outcome.

#### Host status tags

Every applicable node displays one of:

- Host fallback: off
- Host fallback: available
- Host fallback: unavailable
- Host required: connected
- Host required: unavailable
- Host action in progress

#### Host fallback configuration

| Property | Options |
|---|---|
| `useHostFallback` | On / Off |
| `fallbackTrigger` | Browser action failed, blocked, synthetic event rejected, coordinate action required, browser access unavailable |
| `ifHostUnavailable` | Fail, skip, error path |
| `verifyAfterHostAction` | On by default |
| `requireForegroundWindow` | On by default for system input |
| `screenshotBeforeFallback` | Optional |
| `screenshotAfterFallback` | Optional |

Physical-system input requires the correct tab active, browser window visible, foregrounded, and target on-screen.

### 3.10 Async Code and Function behavior

- Code and Function nodes await any returned Promise by default.
- A downstream node waits automatically for a Code/Function output it consumes.
- Unrelated branches may continue in parallel.
- Function Node output is mandatory.
- Code Node output is optional.
- Only work represented by the returned Promise is awaited. Fire-and-forget operations are not considered complete.

---

## 4. Node package implementation template

Use the following structure for each node implementation package.

```text
nodes/
  <category>/
    <node-name>/
      definition.ts        # metadata, ports, config schema
      executor.ts          # implementation
      validators.ts        # config and output validation
      outputs.ts           # output builder and masking rules
      ui.ts                # editor form/help/advanced settings
      tests.unit.ts
      tests.integration.ts
      fixtures/
```

Every node definition should contain:

```text
- stable type key
- display name
- description
- category
- input ports
- output ports
- config schema
- capability tags
- required services
- retry safety classification
- host status classification
- protected-page behavior
- output schema
- examples
```

---

## 5. Capability tags

Use capability tags consistently in the editor and runtime.

| Tag | Meaning |
|---|---|
| `browser-dom` | Requires supported page DOM access |
| `browser-tab` | Uses browser tab APIs only |
| `host-assisted` | Can use companion app as final fallback |
| `host-required` | Cannot operate without companion app service |
| `foreground-required` | Requires active visible tab/window |
| `file-access` | Uses approved-directory file service |
| `sensitive-input` | Can accept secrets/sensitive values |
| `side-effect` | Can modify external state |
| `retry-safe` | Usually safe to retry |
| `manual-gate` | Requires user participation or approval |
| `async` | Can await long-running work |

---

## 6. Error code baseline

Use stable error codes across all node executors.

```text
CONFIG_INVALID
DEPENDENCY_NOT_READY
TARGET_NOT_FOUND
AMBIGUOUS_TARGET
TARGET_NOT_INTERACTABLE
TARGET_NOT_VISIBLE
PROTECTED_PAGE
TAB_NOT_FOUND
HOST_UNAVAILABLE
HOST_FOREGROUND_REQUIRED
HOST_COORDINATE_LOW_CONFIDENCE
TIMEOUT
VALIDATION_FAILED
FILE_NOT_FOUND
FILE_ACCESS_DENIED
FILE_PARSE_FAILED
DOWNLOAD_NOT_FOUND
DIALOG_NOT_FOUND
MISSING_REQUIRED_OUTPUT
CODE_EXECUTION_FAILED
FUNCTION_EXECUTION_FAILED
CANCELLED
```

---

## 7. Node catalog

### Navigation

1. Navigate
2. Scroll
3. Tab Control

### Targeting and waiting

4. Resolve Element
5. Check Element State
6. Wait for Condition

### Mouse and pointer

7. Click
8. Hover / Move Pointer
9. Focus Element
10. Select Text
11. Drag and Drop

### Keyboard and text

12. Enter Text
13. Press Key
14. Copy to Clipboard
15. Paste from Clipboard

### Form controls

16. Select Dropdown Option
17. Set Checkbox / Toggle
18. Select Radio Option
19. Set Date / Time
20. Set Slider Value
21. Choose Autocomplete Suggestion
22. Upload File
23. Submit Form
24. Reset Form

### Page control, dialogs, download, and capture

25. Open UI / Expand Section
26. Close Overlay / Dismiss UI
27. Handle Browser Dialog
28. Handle Download
29. Screen Capture

### Data input and file processing

30. File Input
31. Find Files
32. Wait for File
33. Raw File Input
34. Text Input
35. CSV / TSV / Delimited Data Input
36. JSON Input
37. XML Input
38. YAML Input
39. Spreadsheet Input
40. Document Input
41. PDF Input
42. Image Input

### Data, variables, transformation, and code

43. Set Variable
44. Template Text
45. Select Data
46. Transform Data
47. Convert Data Type
48. Map Fields
49. Filter List
50. Sort List
51. Remove Duplicates
52. Merge Data
53. Split Data
54. Aggregate Data
55. Calculate Value
56. Compare Values
57. Validate Data
58. Function Node
59. Code Node

### Workflow control and execution

60. If / Else
61. Switch
62. Loop Through List
63. Repeat Until
64. Pagination Loop
65. Break Loop
66. Continue Loop
67. Delay
68. Try / Catch Scope
69. Join Branches
70. Manual Confirmation
71. Manual Step Required
72. Stop Workflow

### Browser data collection and extraction

73. Extract Text
74. Extract Attribute
75. Extract Element Value
76. Extract HTML
77. Extract List / Repeating Records
78. Extract Table
79. Extract Links
80. Extract Images
81. Extract Form Data
82. Extract Page Information
83. Extract Structured Page Data
84. Extract Visible Messages
85. Get Element Count
86. Read Selected Text

### Output and reporting (initial node set)

87. Save Data
88. Export Data
89. Show Notification
90. Show Workflow Message
91. Generate Summary
92. Log Message
93. Create Run Report

---

## 8. Recommended implementation order

The base runtime exists. Implement only the node-layer dependencies shown here.

### Phase 1 — Shared node adapters and foundational browser nodes

1. Shared target configuration adapter.
2. Shared text-matching adapter.
3. Standard output/logging adapter.
4. Retry-safety and host-fallback policy adapter.
5. Navigate.
6. Tab Control.
7. Scroll.
8. Resolve Element.
9. Check Element State.
10. Wait for Condition.

**Gate:** A workflow can navigate, select a tab, resolve a target with primary-first fallback, check state, and wait reliably.

### Phase 2 — Core interaction

11. Click.
12. Hover / Move Pointer.
13. Focus Element.
14. Enter Text.
15. Press Key.
16. Select Text.
17. Copy to Clipboard.
18. Paste from Clipboard.
19. Drag and Drop.

**Gate:** A workflow can complete a basic login/search/form interaction using browser-first and host fallback paths.

### Phase 3 — Forms and page-level UI

20. Select Dropdown Option.
21. Set Checkbox / Toggle.
22. Select Radio Option.
23. Set Date / Time.
24. Set Slider Value.
25. Choose Autocomplete Suggestion.
26. Upload File.
27. Submit Form.
28. Reset Form.
29. Open UI / Expand Section.
30. Close Overlay / Dismiss UI.
31. Handle Browser Dialog.
32. Handle Download.
33. Screen Capture.

**Gate:** A workflow can complete common forms, deal with page UI, upload/download files, and capture evidence.

### Phase 4 — Data input and storage integration

34. File Input.
35. Find Files.
36. Wait for File.
37. Raw File Input.
38. Text Input.
39. CSV / TSV Input.
40. JSON Input.
41. Spreadsheet Input.
42. Document Input.
43. PDF Input.
44. Image Input.
45. XML Input.
46. YAML Input.

**Gate:** A workflow can locate live files in approved directories and convert them to structured outputs.

### Phase 5 — Data transformation and advanced logic

47. Set Variable.
48. Template Text.
49. Select Data.
50. Transform Data.
51. Convert Data Type.
52. Map Fields.
53. Filter List.
54. Sort List.
55. Remove Duplicates.
56. Merge Data.
57. Split Data.
58. Aggregate Data.
59. Calculate Value.
60. Compare Values.
61. Validate Data.
62. Function Node.
63. Code Node.

**Gate:** Browser/file outputs can be cleaned, transformed, validated, and processed with awaited custom code.

### Phase 6 — Workflow control and extraction

64. If / Else.
65. Switch.
66. Loop Through List.
67. Repeat Until.
68. Pagination Loop.
69. Break Loop.
70. Continue Loop.
71. Delay.
72. Try / Catch Scope.
73. Join Branches.
74. Manual Confirmation.
75. Manual Step Required.
76. Stop Workflow.
77. Extraction nodes 73–86 from the catalog.

**Gate:** Workflows can branch, loop, recover, pause for user action, and collect structured page data.

### Phase 7 — Outputs, reporting, and end-to-end packs

78. Save Data.
79. Export Data.
80. Show Notification.
81. Show Workflow Message.
82. Generate Summary.
83. Log Message.
84. Create Run Report.

**Gate:** Every major workflow can save results, notify the user, and generate a non-sensitive run artifact.

---

# 9. Node implementation cards

The following cards define the required node-level behavior. All cards inherit Sections 2–7 unless explicitly overridden.

---

## A. Navigation nodes

### A1. Navigate

**Purpose:** Navigate a selected tab to a URL, go back, go forward, or reload.

**Operations:** `goto_url`, `back`, `forward`, `reload`.

**Core config:**

- `operation`
- `tabSource`
- `url` for `goto_url`
- `openDestinationIn`: current tab or new tab
- `waitUntil`: none, navigation start, DOM ready, full load, network idle
- `timeout`
- `onNoHistory`: fail, skip, continue
- `saveTabReferenceAs`
- `protectedPagePolicy`

**Execution:**

1. Resolve target tab.
2. For URL navigation, validate URL and evaluate templates.
3. Execute selected navigation action.
4. Wait for configured readiness state.
5. Publish previous/current URL, tab reference, and navigation status.

**Outputs:** `operation`, `previousUrl`, `currentUrl`, `tab`, `navigationState`, `durationMs`.

**Retry:** Usually safe. Default retry `1` for navigation failures; avoid retrying a navigation after a successful URL change.

**Tests:** URL navigation, redirect, back with no history, reload, new-tab destination, timeout, protected New Tab navigation away.

---

### A2. Scroll

**Purpose:** Scroll main page or a scrollable container.

**Operations:** `by_amount`, `to_top`, `to_bottom`, `to_element`, `until_condition`.

**Core config:**

- `operation`
- `scrollTarget`: page or target container
- `direction`, `amount`, `amountUnit`: pixels, viewport percent, screen
- `target` for element mode
- `alignment`: top, center, bottom, nearest
- `smooth`
- `maxAttempts`, `pauseBetweenScrolls`, `stopCondition`
- `waitForContentAfterEachScroll`
- `useHostFallback`

**Execution:**

1. Resolve container/element as needed.
2. Browser-scroll first.
3. For `until_condition`, scroll and evaluate stop condition until success/limit.
4. If browser scrolling is insufficient and host fallback is enabled, use foreground coordinate scroll.
5. Publish final position, number of scrolls, and stop reason.

**Outputs:** `operation`, `scrollCount`, `finalPosition`, `stopReason`, `executionMethod`.

**Retry:** Safe where target state is explicit. Default retry `1` for container-not-ready only.

**Tests:** page scroll, nested container, scroll-to-element, infinite load stop, host fallback, no-op at page bottom.

---

### A3. Tab Control

**Purpose:** Open, select, close, focus, pin, unpin, mute, unmute, toggle mute, and bookmark tabs/pages.

**Operations:**

- `open_browser_new_tab`
- `open_url_in_new_tab`
- `switch_tab`
- `switch_relative_tab`
- `return_to_origin_tab`
- `close_tab`
- `focus_tab`
- `pin_tab`, `unpin_tab`
- `mute_tab`, `unmute_tab`, `toggle_mute`
- `bookmark_page`, `remove_bookmark`

**Tab selectors:** current, saved reference, ID, index, exact/contains title, exact/contains URL, URL pattern, most recently opened, first matching, left/right adjacent, N left/right, first, last, next/previous with optional wrap.

**Core config:**

- `operation`
- `tabSelector`
- `relativeDirection`, `relativeOffset`, `wrapAround` for relative navigation
- `url` for new URL tab
- `openInBackground`
- `reuseMatchingTab`
- `closeBehavior`
- `ifNotFound`
- `waitUntil`
- `saveTabReferenceAs`
- `confirmBeforeClose`
- bookmark destination/folder where supported

**Protected/new-tab rule:** Browser-controlled pages permit tab control but not DOM automation. A created New Tab has `pageCapability: tab_control_only` until navigated to a supported page.

**Outputs:** `originTab`, `tab`, `createdTab`, `pageCapability`, `matchedBy`, state flags such as `pinned`/`muted`/`bookmarked`.

**Retry:** Opening and switching can retry. Closing, pinning, muting, and bookmarking should verify before retrying.

**Tests:** left/right switches, wrap, origin return, background open, duplicate reuse, pin/mute state, protected New Tab, bookmark permission unavailable.

---

## B. Targeting and waiting nodes

### B1. Resolve Element

**Purpose:** Explicitly resolve a known component or dynamically find matching page elements. Most action nodes resolve internally; this node exists for reusable or dynamic targeting.

**Modes:** `resolve_known`, `find_dynamic`, `revalidate_component`.

**Core config:**

- shared target configuration
- `mode`
- `expectedElementType`
- `matchMode`: one, first, all
- `searchScope`
- `visibilityRequirement`
- `mapFreshness`
- `minimumConfidence`
- `ambiguityPolicy`

**Execution:** Primary identifier first; stored resolver fallbacks only if primary fails; validate candidate; produce reusable component reference.

**Outputs:** `resolvedComponentId`, component metadata, match count, target resolution information.

**Retry:** Safe for stale-map or target-not-ready errors.

**Tests:** valid primary, fallback success, ambiguous target, map stale refresh, shadow-DOM-aware target, no target.

---

### B2. Check Element State

**Purpose:** Inspect page state without changing the page.

**Checks:**

- exists/not exists; visible/hidden; in viewport; covered/uncovered
- enabled/disabled; editable/read-only; focused/not; checked/not; selected/not; expanded/collapsed
- text/attribute/value comparisons
- count comparisons
- parent/child/role/type relations

**Core config:**

- shared target configuration
- `checks[]`
- `evaluationMode`: all, any, expression
- shared text matching
- `treatNoMatchAs`: pass false or node error
- `screenshotOnFailedCheck`

**Ports:** `Passed`, `Not Passed`, `Error` plus full data result.

**Outputs:** `passed`, array of check results, `targetResolution`.

**Retry:** Only for resolution/transient state errors, not ordinary failed conditions.

**Tests:** visible but disabled, count bounds, no match returns false, all/any logic, text matching cases.

---

### B3. Wait for Condition

**Purpose:** Wait for a page, element, tab, workflow, or user condition instead of sleeping a fixed interval.

**Condition groups:**

- Element: exists/disappears, visible/hidden, enabled/disabled, text/attribute/value/count changes, stable/interactable.
- Page: URL/title match, navigation start/complete, DOM ready, full load, network idle.
- Tab: created, active, URL changed, loaded, closed.
- Workflow: variable/output condition.
- User: manual resume.

**Core config:**

- `conditionScope`
- `condition`
- target/expected value
- `pollingMode`: automatic, fixed interval, event-first fallback
- `stabilityDuration`
- `timeout`
- `onTimeout`: fail, continue timed-out output, timeout port, ask user
- `protectedPagePolicy`

**Outputs:** `conditionMet`, `waitDurationMs`, final URL/state, timeout reason if relevant.

**Retry:** Usually prefer a longer wait rather than retry. Optional retry after timeout only.

**Tests:** element appears, URL match, stabilization, timeout route, protected page wait-until-navigation.

---

## C. Mouse and pointer nodes

### C1. Click

**Purpose:** Click an element or location.

**Operations:** single, double, right, middle, hold, release.

**Core config:**

- `clickType`
- `targetMode`: target identifier, coordinates, prior resolved target
- `clickPosition`: center/corner/custom offset
- `coordinateType`: viewport, element-relative, browser-window
- `modifierKeys`
- `delayBefore`, `doubleClickDelay`, `clickCount`
- `scrollIntoView`, `requireVisible`, `requireInteractable`
- `verification`
- host fallback config

**Execution:** Resolve target → scroll → browser click → verify → host fallback if allowed and necessary → verify.

**Retry:** Default `0` because clicks can cause side effects. Only retry if verification proves no action occurred.

**Outputs:** click coordinates, execution method, target resolution, verification result.

**Tests:** normal click, modifier click, blocked click with host fallback, failed verification, side-effect retry protection.

---

### C2. Hover / Move Pointer

**Purpose:** Move pointer over an element/location and optionally hold it there.

**Operations:** hover, move to coordinates, move away, pause over target.

**Mandatory visibility behavior:**

- Activate target tab.
- Bring browser window to foreground.
- Ensure window visible and not minimized.
- Bring target into viewport.
- Resolve final screen coordinates.
- Fail if these requirements cannot be met.
- Optionally restore prior tab/window context afterwards.

**Core config:**

- target or coordinates
- position/offset
- movement style: instant/smooth
- movement duration/hold duration
- `restorePreviousTabAfterHover`
- `restorePreviousWindowFocusAfterHover`
- `onVisibilityFailure`
- host fallback
- verification: tooltip/menu/target appearance/custom condition

**Outputs:** foreground/visibility status, execution method, target resolution, restored context flag.

**Retry:** Safe only if no unintended hover effect; default `1` for visibility/transient failures.

**Tests:** inactive tab auto-activation, minimized window failure, tooltip appear, host hover, restore prior tab.

---

### C3. Focus Element

**Purpose:** Put keyboard focus into an element.

**Core config:** target, focus method (browser API/click-to-focus/host), scroll into view, verify focus, host fallback.

**Execution:** Resolve → scroll → browser focus → verify active element → host-assisted click focus only if configured.

**Outputs:** `focused`, execution method, target resolution.

**Retry:** Safe; default `1`.

**Tests:** input focus, content-editable focus, focus blocked by overlay, host fallback.

---

### C4. Select Text

**Purpose:** Select text from a control or page region.

**Operations:** select all, select current input value, character/line range, phrase match, range between markers, clear selection.

**Core config:** selection source, range definition, occurrence, selection method (browser range, keyboard, mouse drag, host), copy selected text, save alias, host fallback.

**Outputs:** `selectedText`, selection length, execution method.

**Retry:** Generally safe; default `1`.

**Tests:** input full selection, phrase selection, rich-text selection, mouse drag host path, no phrase match.

---

### C5. Drag and Drop

**Purpose:** Move an item from a source to a target.

**Operations:** element-to-element, element-to-coordinates, selected-text drag, reorder list, drop files/data where supported.

**Core config:** source, destination, drag path, hold/movement duration, drop position, scroll while dragging, host fallback, verification.

**Outputs:** source/destination resolution, path/method, verification.

**Retry:** Default `0`; movement can reorder/duplicate content. Retry only after verification proves no change.

**Tests:** sortable list, drop zone, source/target missing, host drag visibility requirements, post-drop verification.

---

## D. Keyboard and text nodes

### D1. Enter Text

**Purpose:** Enter text into text input, textarea, content-editable area, rich-text editor, or supported editable control.

**Operations:** replace, append, insert at cursor, clear, type sequentially, paste, set value + events.

**Core config:**

- target, text value, operation, input method
- clear/select-all before input
- typing delay settings for sequential mode:
  - `delayMode`: none, fixed, random range
  - `fixedDelayMs`
  - `randomDelayMinMs`, `randomDelayMaxMs`
  - optional first/last key delay
- preserve existing value
- trigger events: input/change/blur/Enter/custom
- focus/scroll behavior
- secret flag
- multiline handling
- rich-text mode
- host fallback
- verification

**Retry:** Replace/set may retry after reading current value. Append/insert/sequential/paste default `0` to avoid duplication.

**Outputs:** operation, character count, target resolution, verification. Never persist secret text.

**Tests:** replace, append, clear, sequential fixed delay, sequential random range, multiline, secret masking, rich-text, host fallback.

---

### D2. Press Key

**Purpose:** Send one key, shortcut, sequence, modifier hold, or modifier release.

**Core config:** key action, target scope, key(s), focus-before-action, key delay, keep modifiers held, send method, host fallback, verification.

**Retry:** Default `0`. Enter, Delete, and shortcuts may be non-repeatable.

**Outputs:** keys sent, focused target, execution method, verification.

**Tests:** Enter submit, Escape close, Ctrl+A, sequence, host visibility path, retry blocked after observed effect.

---

### D3. Copy to Clipboard

**Purpose:** Copy data to System Clipboard by default and optionally Workflow Clipboard.

**Sources:** static/template text, variable, selected text, element text/value, extracted data, JSON/CSV serialization.

**Core config:**

- source type and source target
- output format: plain text, JSON, CSV, TSV, HTML
- destination: system, workflow, both
- Workflow Clipboard label
- replace/append/version behavior
- clipboard method: browser API, keyboard copy, host
- restore previous system clipboard where host supports it
- mask/exclude sensitive data
- verify write

**Outputs:** formats/destinations, item label/version, character count, execution method.

**Retry:** Safe.

**Tests:** system default, workflow-only, both, structured serialization, sensitive exclusion, browser API denied host fallback.

---

### D4. Paste from Clipboard

**Purpose:** Paste from System Clipboard (default) or a selected Workflow Clipboard entry.

**Core config:** source, Workflow Clipboard entry, target, paste method, focus target, clear before paste, strip formatting, preserve line breaks, restore prior clipboard, host fallback, verification.

**Retry:** Default `0` unless clear-before-paste or verification proves absent content.

**Outputs:** source, target resolution, execution method, verification.

**Tests:** system paste, workflow paste, clear-before-paste retry, rich-text formatting strip, host fallback.

---

## E. Form-control nodes

### E1. Select Dropdown Option

**Purpose:** Set options in native select controls or custom dropdown widgets.

**Operations:** select one, replace selections, add/remove multi-select option, clear selection.

**Core config:** control type, selection method (label/value/index/text pattern/prior value), selection behavior, shared text matching including wildcard/case sensitivity, multi-select policy, option-not-found behavior, event triggers, verify.

**Host fallback:** For custom visible dropdowns only; native select should use browser path first.

**Retry:** Replace selection default `1` after final state verification. Add/remove default `0` if duplicate state matters.

**Outputs:** previous/final selection labels and values, native/custom handling, verification.

**Tests:** native by label/value/index, custom menu, wildcard case-sensitive selection, multi-select, option missing, host fallback.

---

### E2. Set Checkbox / Toggle

**Purpose:** Set checkbox, switch, consent control, or custom toggle to a known state.

**Operations:** check, uncheck, set true/false, toggle.

**Core config:** control type, desired state, read current state, interaction method, verify, if already correct behavior.

**Retry:** Explicit target state is safe after state read. Toggle default `0`.

**Outputs:** previous/requested/final state, skipped-already-correct indicator.

**Tests:** native checkbox, custom switch, already selected, toggle retry protection, host path.

---

### E3. Select Radio Option

**Purpose:** Choose one option in a radio group/custom single-choice group.

**Core config:** target/group, selection by label/value/index/text pattern, shared text match, control type, verify group state, already-selected behavior.

**Retry:** Usually safe; default `1`.

**Outputs:** previous/final selected option, group id, verification.

**Tests:** native group, segmented control, wildcard/case behavior, missing option.

---

### E4. Set Date / Time

**Purpose:** Set date, time, datetime-local, month, week, range, or custom calendar/time picker.

**Operations:** set, clear, set range, set relative date/time, increment/decrement duration.

**Core config:** input type, source value, value format, time zone handling, input method, relative expressions, range behavior, min/max validation, verify.

**Host fallback:** Custom UI/calendar only, foreground required.

**Retry:** Explicit set/clear default `1` after readback.

**Outputs:** previous/requested/final normalized values, parse/format warnings.

**Tests:** native date, custom calendar, timezone conversion, range, invalid min/max, relative date.

---

### E5. Set Slider Value

**Purpose:** Set native/custom slider or dual-handle range.

**Operations:** exact value, percentage, relative increment, lower/upper handle.

**Core config:** slider type, handle, value mode, target value, interaction method, step policy, verify.

**Retry:** Exact/percentage safe after verification; relative default `0`.

**Outputs:** previous/requested/final values, applied rounding, handle.

**Tests:** native range, dual range, custom drag, step rounding, host drag path.

---

### E6. Choose Autocomplete Suggestion

**Purpose:** Composite node that types a query, waits for suggestions, and selects one.

**Core config:** input target, query, clear behavior, typing mode/delay, suggestion selection by label/value/index/text pattern, list/item targets, wait timeout, no-suggestion behavior, selection method, verify.

**Text matching:** full shared matching including wildcard and case mode.

**Retry:** Default `0`; may retry when clear-before-typing and selection verification are enabled.

**Outputs:** query, selected suggestion, suggestion count, final input value, verification.

**Tests:** keyboard select, click select, delayed suggestions, exact/wildcard/case behavior, missing suggestions.

---

### E7. Upload File

**Purpose:** Upload approved local files to web forms.

**File sources:** workflow file input, approved directory, prior file output, downloaded file, host-managed file reference.

**Core config:** upload target, file source, selection rules, approved directory, multiple-file behavior, validation, upload method, completion condition, verify.

**Host status:** Host required for directory resolution; host-assisted when native file picker is required.

**Retry:** Default `0`; repeat upload can duplicate files.

**Outputs:** safe file references/metadata, validation, upload completion.

**Tests:** browser assignment, native picker host path, one/many files, invalid extension, upload completion wait.

---

### E8. Submit Form

**Purpose:** Submit a form by clicking, Enter, native submit, or advanced custom action.

**Core config:** form target, submit target, method, pre-submit validation, required-field check, confirmation policy, expected result, wait after submit, duplicate prevention, host fallback.

**Safety:** Default retry `0`. Warn for send/pay/delete/purchase/confirm signals. Do not retry after acceptance indication.

**Outputs:** method, validation, execution method, expected-result verification, final URL/confirmation.

**Tests:** click submit, Enter, invalid fields, manual confirmation, duplicate prevention, host fallback.

---

### E9. Reset Form

**Purpose:** Reset whole form or selected controls.

**Operations:** native reset, click reset, clear selected fields, restore saved values (advanced).

**Core config:** form/field targets, reset scope, reset method, confirmation, verify, preserve fields, host fallback.

**Retry:** Native reset default `1` after verification.

**Outputs:** controls reset, preserved controls, safe before/after summary.

**Tests:** native reset, custom reset, preserve list, sensitive values excluded.

---

## F. Page-control, dialog, download, and capture nodes

### F1. Open UI / Expand Section

**Purpose:** Open menu, dropdown, accordion, modal, popover, tooltip, tab panel, drawer, or collapsed content.

**Core config:** trigger target, UI type, open method, expected opened target, toggle behavior, scroll, verify, wait timeout, host fallback.

**Retry:** Default `1` when node can verify UI did not open. Avoid retrying uncontrolled toggle.

**Outputs:** trigger/opened target results, UI type, final state, method, verification.

**Tests:** menu, accordion, modal, hover tooltip, force-open versus toggle.

---

### F2. Close Overlay / Dismiss UI

**Purpose:** Dismiss cookie banners, modal/popup/menus/tooltips/notices/overlays/drawers.

**Core config:** UI target/dynamic text, close method, type, close all, if not present behavior, verify, host fallback, text matching.

**Retry:** Default `1`.

**Outputs:** found/dismissed counts, method, remaining visible overlays, verification.

**Tests:** close button, Escape, backdrop, multiple banners, silently no banner, text wildcard.

---

### F3. Handle Browser Dialog

**Purpose:** Handle alert, confirm, prompt, and before-unload dialogs.

**Operations:** accept, dismiss, fill+accept, wait/handle next dialog, fail on dialog, continue if none.

**Core config:** dialog scope, expected type/message (shared matching), action, prompt text, wait timeout, no-dialog behavior.

**Limits:** Does not handle OS permission prompts, secure desktop, CAPTCHA, biometric, or browser-owned security UI.

**Outputs:** type/message safe summary, action, expected-dialog flag.

**Tests:** alert, confirm accept/dismiss, prompt secret value, no-dialog branch.

---

### F4. Handle Download

**Purpose:** Wait for, identify, validate, store, and expose website downloads.

**Operations:** wait next, collect latest, verify named, save, rename, file reference, cancel where supported.

**Core config:** source, expected name/mime/extension, wait timeout, save behavior/destination, filename template, collision policy, verification, output alias.

**Outputs:** controlled file reference, safe metadata, save destination, verification.

**Retry:** Safe for waiting; not for retriggering download.

**Tests:** next download, latest download, name wildcard case, collision behavior, zero-byte file, downloaded input node handoff.

---

### F5. Screen Capture

**Purpose:** Create image artifacts of page state.

**Modes:** visible page, whole page, element, visible browser area.

**Core config:** capture mode, tab source, element target, file format/quality, destination, filename template, metadata, browser chrome inclusion for host mode, protected page behavior, host fallback.

**Rules:** Whole page requires page access. Visible browser area requires active visible foreground browser. Protected pages typically allow only host visible capture.

**Outputs:** file reference, dimensions, URL/title/timestamp if configured, execution method, target resolution for element mode.

**Retry:** Safe.

**Tests:** viewport, whole page, element, protected page host capture, sensitive evidence suppression.

---

## G. Data input and file-processing nodes

### Shared file source contract

All file nodes use controlled file references, not raw unrestricted paths.

**Source types:** workflow file input, ask user, approved directory, prior file reference, download output, Workflow Clipboard.

**Selection options:** exact relative path, filename, wildcard, regex, newest/oldest, all; case-sensitive/insensitive matching; timing at workflow start/node execution/loop iteration; no-match and multiple-match handling; extension/MIME/size/date validation.

### G1. File Input

**Purpose:** Produce one or more controlled file references.

**Config:** source, expected type, one/many policy, output alias.

**Outputs:** file ref(s), metadata, source resolution rationale.

**Tests:** file input, approved-directory selection, prior download, many files, no match.

---

### G2. Find Files

**Purpose:** Search approved directories dynamically.

**Config:** directory, recursion, filename/path match, extension/MIME, modified date, size, sort, return mode, no-match behavior.

**Outputs:** matched file refs, count, sorted metadata summary.

**Tests:** wildcard/case regex, newest selection, recursion, date/size filters.

---

### G3. Wait for File

**Purpose:** Wait for matching file to appear/change/stabilize.

**Conditions:** appears, modified, deleted, count, stops changing, readable, newer than time.

**Config:** matching rules, condition, timeout, watcher/polling, stability duration, timeout behavior.

**Outputs:** file ref(s), duration, condition state, metadata.

**Tests:** appears, size stabilization, timeout, watcher fallback.

---

### G4. Raw File Input

**Purpose:** Read any file without assuming a format.

**Read modes:** text, binary, base64, bytes, line stream, file-reference only.

**Config:** source, mode, encoding, max read size, large-file behavior.

**Outputs:** file ref, content/stream handle, encoding result, warnings.

**Tests:** text encoding, binary, max size fail, streaming lines.

---

### G5. Text Input

**Purpose:** Read plain text, logs, Markdown, and line-based files.

**Config:** encoding, full/lines/paragraphs/chunks, line endings, blank lines, trim, max size, optional text filter.

**Outputs:** text/lines, count, encoding, warnings.

**Tests:** CRLF normalization, UTF-16, blank line policy, large file behavior.

---

### G6. CSV / TSV / Delimited Data Input

**Purpose:** Parse delimited text into structured records.

**Config:** delimiter, header row, row range, quote/escape, empty values, inference, column type overrides, invalid rows, comments, output shape.

**Outputs:** rows, columns, header mapping, invalid-row warnings.

**Tests:** CSV quoted commas, TSV, custom delimiter, missing headers, type inference, malformed rows.

---

### G7. JSON Input

**Purpose:** Parse JSON, array JSON, JSON Lines, or selected path.

**Config:** format, strictness, data path, output shape, large-file behavior, invalid-data policy.

**Outputs:** parsed value/records, path, record count, warnings.

**Tests:** object, array, JSONL, invalid JSON, selected nested path.

---

### G8. XML Input

**Purpose:** Parse XML into structured data.

**Config:** root/XPath selection, namespace mode, output shape, attribute/repeated/text-node handling, invalid XML policy.

**Outputs:** parsed data/nodes, namespace info, warnings.

**Tests:** namespaces, repeated elements, XPath selection, malformed XML.

---

### G9. YAML Input

**Purpose:** Parse YAML documents.

**Config:** document selection, alias/anchor handling, output shape/path, schema validation, invalid policy.

**Outputs:** parsed object/documents, selected value, warnings.

**Tests:** multiple docs, aliases, path selection, invalid line/column error.

---

### G10. Spreadsheet Input

**Purpose:** Read XLSX, XLS, ODS, and supported workbooks.

**Config:** sheet selection with shared text matching, range, header row, row range, formulas, hidden rows/columns, empty rows, cell types, dates, merged cells, output shape.

**Outputs:** workbook metadata, sheets, rows, schema, warnings.

**Tests:** sheet wildcard/case, A1 range, formula/value, merged cells, dates, hidden rows.

---

### G11. Document Input

**Purpose:** Extract text/structure from DOCX, RTF, ODT, Markdown, and supported document types.

**Config:** type, extract mode, heading selection with shared match, content range, tables, formatting, comments/notes, output shape.

**Outputs:** text, sections/headings, tables, metadata, warnings.

**Tests:** headings, table conversion, selected section, unsupported formatting warning.

---

### G12. PDF Input

**Purpose:** Extract PDF text/tables/pages/metadata or render/OCR pages.

**Config:** page selection, extraction mode, table mode, OCR mode/language, headers/footers, output shape, low-confidence policy.

**Outputs:** text/pages/tables, page count, metadata, OCR confidence, warnings.

**Tests:** text PDF, scanned PDF OCR, page range, layout text, table extraction, low-confidence warning.

---

### G13. Image Input

**Purpose:** Read image metadata and optionally OCR image text.

**Config:** source, type, metadata, OCR mode/language, crop, preprocessing, output shape, confidence policy.

**Outputs:** file ref, dimensions/format, OCR blocks/text, confidence, warnings.

**Tests:** PNG/JPEG, crop, rotation, OCR threshold, unsupported format.

---

## H. Data, variables, transforms, and code nodes

### H1. Set Variable

**Purpose:** Create/update a named workflow value.

**Operations:** set, append, increment, decrement, delete, set-if-empty.

**Config:** variable name, operation, value, expected type, scope, existing-value behavior, optional Workflow Clipboard save.

**Outputs:** name, previous/new summary, scope, operation.

**Tests:** set/append/merge, scoped loop var, delete, type validation.

---

### H2. Template Text

**Purpose:** Render text from variables and outputs.

**Config:** template, missing-variable behavior, escape mode, output type, trim.

**Outputs:** rendered text, variables used, missing warnings, length.

**Tests:** nested references, missing default, HTML/URL/JSON escaping, sensitive input exclusion.

---

### H3. Select Data

**Purpose:** Select fields, paths, array items, matching records, columns, or flatten nested values.

**Config:** input, selection method, shared text matching, multiple behavior, missing path behavior, output shape.

**Outputs:** selected values, count, path, warnings.

**Tests:** nested object, record filter, wildcard case match, all/first/last, missing path.

---

### H4. Transform Data

**Purpose:** Perform common data cleaning/reshaping without code.

**Transforms:** trim/case/replace/split/join/regex/whitespace/remove HTML/URL encode/decode/date/number parsing/JSON/object flatten/rename/remove fields/derive fields/list-object/serialize.

**Config:** input, ordered transform steps, step error behavior, coercion, output shape.

**Outputs:** transformed data, applied steps, warnings, type summary.

**Tests:** multi-step pipeline, failed step policy, serializations, type conversions.

---

### H5. Convert Data Type

**Purpose:** Convert values to supported type.

**Types:** text, integer, decimal, boolean, date/time, JSON, array, CSV/TSV text, URL, base64, file reference, null.

**Config:** input, target type, locale/date/number/boolean parsing, failure behavior, case sensitivity for mappings.

**Outputs:** converted value, types, warnings.

**Tests:** decimals/locales, dates, custom boolean, invalid conversion paths.

---

### H6. Map Fields

**Purpose:** Map record arrays into a new schema.

**Config:** input records, source→destination mappings, source values/static/template/default, missing field behavior, keep unmapped, nested destinations, conversion, conditional mapping.

**Outputs:** mapped records, schema, count, warnings.

**Tests:** nested mapping, default values, condition, missing fields, type conversion.

---

### H7. Filter List

**Purpose:** Keep/remove records by conditions.

**Conditions:** equality, contains/wildcard/regex, numeric/date ranges, empty/existence, boolean, advanced expression.

**Config:** list, conditions, all/any/grouped logic, keep/remove action, shared match, empty behavior, output mode.

**Outputs:** matched/rejected records, counts, condition summary.

**Tests:** grouped logic, wildcard case, null behavior, matched/rejected output.

---

### H8. Sort List

**Purpose:** Sort records.

**Config:** input, fields, direction, type, case sensitivity, locale sort, null placement, stable sort.

**Outputs:** sorted list, criteria, count.

**Tests:** multi-field, numeric/date, case-sensitive text, nulls.

---

### H9. Remove Duplicates

**Purpose:** Deduplicate values/records.

**Config:** list, key(s), exact/normalized/case config, keep occurrence, output mode, null behavior.

**Outputs:** unique, duplicates, count, matching rule.

**Tests:** normalized/case dedupe, multi-key, keep last, null policy.

---

### H10. Merge Data

**Purpose:** Merge objects/lists/text/tables.

**Operations:** object merge, list concat, join by key, union, intersect, append row, join text.

**Config:** inputs, merge mode, keys/join type, conflict behavior, array behavior, separator.

**Outputs:** result, match/unmatched counts, conflicts.

**Tests:** object conflict, inner/left/right/full join, union, text join.

---

### H11. Split Data

**Purpose:** Split text/list/object/records.

**Operations:** delimiter/regex text split, chunk list, group by field, object to key/value, table batches.

**Config:** input, method, chunk size, delimiter inclusion, trim/empty behavior, case where relevant.

**Outputs:** parts/chunks/groups, count, group keys.

**Tests:** regex split, chunks, group by, empty part policy.

---

### H12. Aggregate Data

**Purpose:** Summarize records.

**Aggregations:** count, sum, average, min, max, median, distinct count, first, last, concatenate, group/pivot.

**Config:** records, group fields, aggregation fields, numeric parsing, empty values, output shape.

**Outputs:** result, groups, invalid data warnings, metadata.

**Tests:** grouped sum, non-numeric behavior, median, null values.

---

### H13. Calculate Value

**Purpose:** Do simple arithmetic, date, text, and boolean calculations.

**Config:** inputs, operation, number/date format, divide-by-zero policy, precision, output type.

**Outputs:** value, inputs, operation, warnings.

**Tests:** arithmetic, percent, dates, conditionals, divide by zero.

---

### H14. Compare Values

**Purpose:** Compare values and route to true/false.

**Operations:** equals/not, greater/less, contains/not, wildcard/regex, empty, in-list, dates, deep compare.

**Config:** left/right, comparison, shared text match, type interpretation, null behavior.

**Ports:** `True`, `False`, `Error`.

**Outputs:** `passed`, comparison summary, match details.

**Tests:** text case, wildcard, numeric/date coercion, null rules, deep objects.

---

### H15. Validate Data

**Purpose:** Validate values, records, lists, and files.

**Rules:** required, type, regex/wildcard, numeric/date range, allowed list, uniqueness, required columns, schema, list size, file size/extension/MIME, advanced expression.

**Config:** input, rules, logic, invalid-record handling, shared text match, output ports, message template.

**Ports:** `Valid`, `Invalid`, `Error`.

**Outputs:** valid flag, per-rule results, valid/invalid records, errors/warnings.

**Tests:** schema, record split, allowed list case, file validation, message template.

---

### H16. Function Node

**Purpose:** Data-processing code node that receives mapped inputs and **must return output**.

**Execution model:** JavaScript/TypeScript-compatible sandbox; sync or async; Promise automatically awaited.

**Core config:** named inputs, code, timeout, optional output schema, error behavior, test input, alias.

**Rules:**

- Must return a value/object.
- Missing return produces `MISSING_REQUIRED_OUTPUT`.
- Browser/host action APIs are not required for this node; keep it transformation-oriented.

**Outputs:** required returned value, duration, safe console output, schema result.

**Tests:** sync return, async Promise, timeout, thrown error, missing output, schema mismatch, dependent node wait.

---

### H17. Code Node

**Purpose:** Advanced unrestricted custom logic node.

**Capabilities:** browser actions, target resolution, host actions, controlled files, workflow clipboard, variables, outputs, optional no-output execution.

**Core config:** explicit inputs/optional context, code, browser API on/off, host API on/off, file API approved directories only, timeout, permissions summary, output mode, error behavior, test mode.

**Rules:**

- Returned Promise is awaited.
- Browser action calls should use the same resolver/fallback/verification services as visual nodes when possible.
- Sensitive data must still be excluded from persistent run history.
- Host status shown when host APIs enabled.

**Outputs:** optional returned value, action summary, duration, safe console log, permission use summary.

**Tests:** browser action, host action, file API scope denial, async wait, optional output, timeout/cancel, sensitive exclusion.

---

## I. Workflow-control and execution nodes

### I1. If / Else

**Purpose:** Route by one or more conditions.

**Ports:** `True`, `False`, `Error`.

**Config:** conditions, all/any/grouped logic, condition types, shared matching, missing behavior, save evaluation.

**Outputs:** `passed`, per-condition result, evaluated values summary.

**Tests:** grouped logic, text regex/case, missing value behavior, branch routing.

---

### I2. Switch

**Purpose:** Route to named case branches.

**Ports:** case ports, `Default`, `Error`.

**Config:** input value, cases, shared matching, first/all match, no-match behavior, case sensitivity.

**Outputs:** selected case(s), evaluation result.

**Tests:** exact, range, wildcard, default, all matching cases.

---

### I3. Loop Through List

**Purpose:** Execute a branch per list item.

**Ports:** `Each Item`, `Done`, `Error`.

**Config:** input list, item/index names, sequential/controlled parallel, max iterations, start/end, skip condition, item error handling, collect results.

**Rules:** browser actions on same tab remain sequential; host physical actions are globally serialized.

**Outputs:** processed counts, collected results, skipped/failed items.

**Tests:** sequential list, item error skip, max safety limit, same-tab serialization, data-only parallel branch.

---

### I4. Repeat Until

**Purpose:** Repeat branch until condition is true.

**Ports:** `Repeat Body`, `Completed`, `Limit Reached`, `Error`.

**Config:** stop condition, check timing, max iterations, max duration, delay, limit behavior, collect results.

**Outputs:** iterations, final condition, stop reason, results.

**Tests:** completion after N, pre-check, limit, duration, branch failure.

---

### I5. Pagination Loop

**Purpose:** Process next pages, numbered pages, load-more, or URL parameter pagination.

**Ports:** `Page Body`, `Completed`, `No Next Page`, `Error`.

**Config:** mode, next target, end condition, max pages, wait after transition, extract current page, duplicate detection, page error behavior.

**Outputs:** current page index, URL, pages processed, stop reason, aggregate refs.

**Tests:** next disabled, missing next, URL pagination, duplicate detection, load-more.

---

### I6. Break Loop

**Purpose:** Exit nearest/named active loop.

**Config:** optional condition, result message/output, target loop.

**Outputs:** break reason and optional final loop data.

**Tests:** nearest loop, named outer loop, condition false no-op.

---

### I7. Continue Loop

**Purpose:** Skip remaining iteration work.

**Config:** optional condition, target loop, log reason.

**Outputs:** continue reason.

**Tests:** skip item, nested loop target, condition false.

---

### I8. Delay

**Purpose:** Pause a fixed/random duration.

**Config:** fixed/random mode, duration/range, reason, cancellable.

**Outputs:** actual elapsed duration.

**Tests:** fixed, random bounds, cancellation.

---

### I9. Try / Catch Scope

**Purpose:** Catch errors from grouped/connected scope.

**Ports:** `Try Body`, `Success`, `Catch`, `Finally`.

**Config:** caught scope, error types, retry-before-catch policy, error variable name, continue behavior, finally behavior.

**Outputs:** caught error summary, scope status.

**Tests:** caught target error, timeout, unhandled type, finally always, disabled node not error.

---

### I10. Join Branches

**Purpose:** Synchronize parallel branches.

**Ports:** `Completed`, `Timeout`, `Error`.

**Config:** all/any/first successful/first completed, branch inputs, timeout, failure policy, aggregation, cancel remaining.

**Outputs:** branch statuses, aggregated outputs, completion order, reason.

**Tests:** all, first success, timeout, ignored failure, cancel remaining.

---

### I11. Manual Confirmation

**Purpose:** Require approval/rejection before a sensitive step.

**Ports:** `Approved`, `Rejected`, `Timed Out`, `Cancelled`.

**Config:** title/message, non-sensitive data preview, labels, timeout, typed confirmation, notification method.

**Outputs:** decision, timestamp, optional safe note.

**Tests:** approve, reject, timeout, typed phrase, sensitive preview exclusion.

---

### I12. Manual Step Required

**Purpose:** Pause for CAPTCHA, MFA, biometric, review, or external approval.

**Ports:** `Completed`, `Skipped`, `Timed Out`, `Cancelled`.

**Config:** instructions, action type, resume method, optional completion condition, timeout, keep browser active, restore context.

**Outputs:** completion method, wait time, verification.

**Tests:** manual resume, condition auto-resume, timeout, browser context retention.

---

### I13. Stop Workflow

**Purpose:** Intentionally finalize a run.

**Modes:** success, warning, cancelled, failed.

**Config:** final status/message/output, save final output, create report, cancel active tasks.

**Outputs:** terminal run state only; no normal downstream path.

**Tests:** each terminal state, active task cancellation, report hook.

---

## J. Browser extraction and data collection nodes

### Shared extraction contract

Common config: target scope, output format, no-match behavior, multiple-match behavior, visibility filter, output alias/Workflow Clipboard, sensitive handling.

### J1. Extract Text

**Purpose:** Extract visible/raw/inner/direct/normalized text from target/page.

**Config:** target, text mode, first/last/all, line breaks, whitespace, hidden text, output shape/join separator.

**Outputs:** text, match count, length, target resolution.

**Tests:** visible vs raw, multiple matches, whitespace, hidden content.

---

### J2. Extract Attribute

**Purpose:** Read one/more attributes from elements.

**Config:** target, attribute names, resolve relative URLs, missing behavior, shape, include text.

**Outputs:** values, absolute URLs, missing warnings.

**Tests:** href/src URL resolution, multiple attrs, missing attr policies.

---

### J3. Extract Element Value

**Purpose:** Read input/control value and state.

**Config:** target, value type auto/explicit, include display/raw/state, sensitive masking.

**Outputs:** value, label, control state, metadata.

**Tests:** text, checkbox, select, slider, date, contenteditable, sensitive value exclusion.

---

### J4. Extract HTML

**Purpose:** Collect inner/outer/document/sanitized HTML.

**Config:** target, extraction mode, scripts/styles/handlers removal, max output, large output behavior.

**Outputs:** HTML/artifact ref, size, sanitization summary.

**Tests:** sanitization, document HTML, truncation/artifact fallback.

---

### J5. Extract List / Repeating Records

**Purpose:** Turn repeated cards/rows/listings/comments/etc. into structured records.

**Config:** container target, item target, record limit, visibility, optional item filter, index, malformed item policy, field mappings.

**Field mappings:** child text, child attribute, element value/state, static, template, item index, relative URL, nested child list, code/expression.

**Outputs:** records, count, skipped/malformed count, field warnings.

**Tests:** product cards, nested fields, missing child policy, record limits, dynamic visible filter.

---

### J6. Extract Table

**Purpose:** Convert table into rows/columns.

**Config:** table target, header handling, row range, columns, nested content, empty/merged cells, output shape, header matching with shared text match.

**Outputs:** headers, rows, schema, counts, warnings.

**Tests:** headers, row arrays, merged cells, links in cells, selected columns.

---

### J7. Extract Links

**Purpose:** Collect link records.

**Config:** scope, link filters, shared matching, resolve relative URLs, fields, dedupe, output mode.

**Outputs:** links, count, duplicate count, filter summary.

**Tests:** URL/text filters, wildcard/case, relative URLs, duplicates.

---

### J8. Extract Images

**Purpose:** Collect image URLs/metadata.

**Config:** scope, source `src/currentSrc/srcset/background/auto`, fields, URL resolution, filters/shared matching, dedupe, visible only.

**Outputs:** image records, count, URLs, optional missing-alt warning.

**Tests:** lazy-loaded image, srcset, background image, relative URL, visible-only.

---

### J9. Extract Form Data

**Purpose:** Capture form state safely.

**Config:** form target, fields selection, metadata, values, sensitive field exclusion, output shape, empty behavior.

**Outputs:** form data, metadata, validation summary, excluded sensitive count.

**Tests:** text/select/check state, disabled fields, named structure, secret exclusion.

---

### J10. Extract Page Information

**Purpose:** Gather page URL/title/canonical/meta/language/viewport/document dimensions/headings/Open Graph/favicon/dates.

**Config:** selected fields, heading selection, metadata source, date handling, output format.

**Outputs:** metadata object, source info, parsing warnings.

**Tests:** canonical, OG tags, headings, date parse, missing tags.

---

### J11. Extract Structured Page Data

**Purpose:** Read JSON-LD, microdata, RDFa, and explicitly targeted embedded app JSON.

**Config:** source type, schema/type filter with shared matching, output shape, invalid data policy.

**Outputs:** records, source type, count, invalid warnings.

**Tests:** JSON-LD product/article, bad script block, type filter, flatten records.

---

### J12. Extract Visible Messages

**Purpose:** Capture visible success/warning/error/alert/validation/toast/status messages.

**Config:** scope, message type, detection method, shared matching, first/latest/all, include timestamp/source details.

**Outputs:** message records, classification, count, latest message.

**Tests:** ARIA alert, toast, validation list, wildcard case, latest ordering.

---

### J13. Get Element Count

**Purpose:** Count elements matching a target/query.

**Config:** target/query, count scope, optional state/text/attribute filter, shared matching, return samples.

**Outputs:** count and optional samples.

**Tests:** any vs visible, filter, no match, sample cap.

---

### J14. Read Selected Text

**Purpose:** Read selection made by user or Select Text node.

**Config:** selection source, trim/normalize, empty behavior, Workflow Clipboard save.

**Outputs:** selected text, length, source, tab/page ref.

**Tests:** current selection, prior result, empty selection behavior.

---

## K. Output, reporting, and user-feedback nodes

### K1. Save Data

**Purpose:** Persist non-sensitive workflow output to the configured workflow storage/dataset destination.

**Config:** input data, destination/data set name, write mode (replace/append/upsert), key field, schema validation, sensitive exclusion, output alias.

**Outputs:** saved reference, count, write mode, validation warnings.

**Tests:** append/upsert/replace, schema failure, sensitive field exclusion.

---

### K2. Export Data

**Purpose:** Create a local output file from data.

**Formats:** CSV, JSON, TXT, XLSX, HTML/Markdown where supported.

**Config:** input data, format, field selection/order, formatting, approved output directory, file name template, collision policy, sensitive exclusion, host-required status.

**Outputs:** file reference, safe metadata, record count, destination.

**Tests:** CSV/JSON/XLSX, collision handling, selected fields, sensitive exclusion.

---

### K3. Show Notification

**Purpose:** Display extension/browser/companion notification.

**Config:** title, message, severity, notification surface, optional action label, auto-dismiss duration.

**Outputs:** shown status, notification id/surface.

**Tests:** success/warning/error, template interpolation, sensitive text exclusion.

---

### K4. Show Workflow Message

**Purpose:** Display an in-extension workflow message in the run UI.

**Config:** message, severity, data preview, pause/continue behavior optional.

**Outputs:** message id, display timestamp.

**Tests:** info/warn/error, safe preview, no-sensitive output.

---

### K5. Generate Summary

**Purpose:** Produce readable summary from selected node outputs/data.

**Config:** input data, summary template or automatic rules, grouping, maximum length, output format, sensitive exclusion.

**Outputs:** summary text/object, source references.

**Tests:** table summary, empty input, truncation, sensitive exclusion.

---

### K6. Log Message

**Purpose:** Add deliberate debug/info/warning/audit event to workflow run log.

**Config:** level, message/template, selected safe data fields, persist mode.

**Outputs:** log event id/timestamp.

**Tests:** template variables, redaction, verbose-only details.

---

### K7. Create Run Report

**Purpose:** Generate an exportable non-sensitive report for one workflow run.

**Config:** run source, included sections, format (JSON/text/HTML/PDF later), evidence policy, destination, sensitive exclusion fixed.

**Outputs:** report file/reference, included sections, generation status.

**Tests:** success run, failed run, evidence errors-only, no sensitive values.

---

## 10. Node implementation test matrix

Every browser node should have these test classes where relevant:

1. Primary identifier succeeds.
2. Primary identifier fails and resolver fallback succeeds.
3. Ambiguous fallback target fails safely.
4. Target is missing.
5. Protected page behavior.
6. Disabled/bypass result.
7. Retry behavior.
8. Timeout behavior.
9. Sensitive input/output exclusion.
10. Output available to downstream node.
11. Run-log completeness.
12. Host fallback disabled.
13. Host fallback available and successful.
14. Host unavailable behavior.
15. Foreground/visible-window enforcement for system input.

Every data node should have these test classes where relevant:

1. Valid input.
2. Invalid format.
3. Large file/size limit.
4. Encoding/type inference edge case.
5. Case-sensitive/insensitive text matching.
6. Wildcard/regex matching.
7. No match / multiple match policy.
8. Sensitive file/data exclusion.
9. Output binding into later transform node.

Every control node should have:

1. Expected branch routing.
2. Failure/timeout branch.
3. Async dependency wait.
4. Cancellation.
5. Nested-loop/scope correctness where applicable.

---

## 11. Cross-node acceptance workflows

Use these integration workflows as release gates.

### Workflow A — Search and extract

```text
Navigate
→ Enter Text
→ Press Key
→ Wait for Condition
→ Extract List / Repeating Records
→ Export Data
```

Validates navigation, text input, keypress, wait, extraction, data export.

### Workflow B — Login with host fallback

```text
Navigate
→ Enter Text (username)
→ Enter Text (password/secret)
→ Click (browser-first, host fallback on)
→ Wait for URL
→ Extract Page Information
```

Validates secrets exclusion, browser action, host fallback, and output publication.

### Workflow C — Upload from approved directory

```text
Find Files
→ Validate Data / File criteria
→ Upload File
→ Wait for Condition
→ Handle Download
→ Spreadsheet Input
```

Validates companion file access, upload, download, and spreadsheet parsing.

### Workflow D — Paginated extraction

```text
Pagination Loop
  → Extract Table
  → Set Variable / Merge Data
→ Export Data
```

Validates page sequencing, duplicate-page detection, accumulation, and export.

### Workflow E — Asynchronous custom processing

```text
Spreadsheet Input
→ Function Node (async transformation)
→ Validate Data
→ Loop Through List
  → Enter Text
  → Submit Form
```

Validates Function Promise awaiting and downstream dependency wait.

### Workflow F — Manual user gate

```text
Navigate
→ Manual Step Required (MFA)
→ Wait for Condition
→ Manual Confirmation
→ Submit Form
→ Create Run Report
```

Validates user intervention, safe final action, and reporting.

---

## 12. Deferred items / do not block current node implementation

These are compatible with the node contracts but are not required to implement the current node set:

- Advanced internal-map pattern matching for infinite feeds and highly dynamic pages.
- Dedicated manual map-refresh/diagnostics node.
- Deliberate long-running background tasks from Code Node plus future Await Task node.
- Broader network/API access inside Code Node.
- Persistent workflow state beyond explicit approved storage behavior.
- Rich visual element matching beyond the internal map/fingerprint strategy.
- Advanced OCR/image analysis beyond metadata and OCR text extraction.
- Advanced report PDF rendering, if not already supported by the host layer.

---

## 13. Final implementation rule

Keep visual nodes small and auditable. Use the shared resolver, host fallback, logging, text matching, and output-binding adapters instead of reimplementing those behaviors in each executor.

The expected node execution shape is:

```text
validate config
→ resolve dependencies
→ resolve target/file/data where relevant
→ execute browser/file/data/control action
→ verify expected result where configured
→ host fallback only when supported and enabled
→ publish output
→ persist non-sensitive logs
→ route through success/failure ports
```

