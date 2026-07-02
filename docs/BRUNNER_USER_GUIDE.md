# BRunner User Guide

## Purpose

This is the living usage guide for BRunner. It explains how workflows,
recording, Studios, nodes, variables, data sources, execution, and the Windows
companion app work together. It must be updated whenever behavior or node
options change.

## System overview

BRunner records browser actions and lets users author them as sequential or
graph workflows. Graph Studio is the primary visual editor. Sequential Studio
supports compatible linear workflows. Both use the same node registry,
workflow files, runtime state, recording session, and global UI preferences.

The browser extension executes workflows, understands tabs and pages, resolves
DOM targets, and performs browser-native actions. The Windows companion app is
the local capability provider for workflow storage, approved folder access,
data-source reading, pairing, diagnostics, and final visible mouse/keyboard
fallback when a node explicitly permits it.

Nodes label the companion relationship as not used, optional fallback, or
required. A disconnected companion app does not prevent a workflow from
starting, but a reached node with a required companion capability fails clearly.
Optional fallback nodes still try browser-native execution first.

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
active tab.

The planned mapper transition replaces per-node target snapshots with
workflow-scoped component maps. A recorded DOM action will store a compact
`componentRef` pointing at a persistent readable Component ID such as
`example_com_checkout_shipping_continue`. The component map owns primary
locators, fallback locators, fingerprints, history, and review status.
See [`specs/08_MAPPER_RELIABILITY_TRANSITION.md`](specs/08_MAPPER_RELIABILITY_TRANSITION.md)
for the implementation contract.

Component IDs are locked when created and do not regenerate when a label, CSS
class, DOM path, or layout position changes. Optional display aliases may be
edited in the Mapper Inspector, but the canonical Component ID remains the
resolver identity.

When resolving a target, BRunner tries the captured primary locator first, then
ordered fallbacks, then historical fingerprint reconciliation. It never chooses
the first matching element or the "best available" close-score candidate. If a
target is ambiguous, missing, stale after retry, or unsupported, the node does
not interact with the page. The workflow follows the node's `unresolved` path
and stores a structured resolver result for diagnostics.

First mapper support is limited to static or bounded pages and open Shadow DOM.
Dynamic-heavy pages, infinite feeds, unsupported frames, and closed Shadow DOM
return an honest unsupported/unresolved result until later phases explicitly add
support.

## Workflow data

- Seed variables are saved defaults available at run start.
- Node outputs are run-scoped variables available to later nodes.
- Expressions use `{{variable}}` and fail clearly when required data is missing.
- Lists and tables can be previewed and will support bounded For Each execution.
- Companion-backed files use approved directory aliases; workflows never gain
  unrestricted filesystem access.
- Graph Studio can declare and preview `.txt`, `.csv`, or `.json` dataset
  sources through the companion app from approved directories. Runtime loading
  makes each parsed source available as a variable by source name. Planned For
  Each support will load `list.txt`, parse one number per line, then run a
  bounded workflow once per number and use that value to fill forms, perform
  lookups, or extract related data.

## Windows companion app

The companion app replaces the old local browser management page. The initial
native Windows desktop shell is implemented with tray behavior, service status,
workflow storage, pairing, and diagnostics tabs. Dedicated approved-folder
management and host-fallback settings remain next.

Default workflow storage is the `Workflows` folder beside `BRunnerHost.exe`.
Users can choose a different workflow folder from the companion app and can
copy, move, or leave existing workflows in place during migration.

Approved folders are shown with user-facing aliases, paths, read/write
permissions, and recursive access. Workflow file nodes should reference an alias
and relative path rather than a raw arbitrary system path.

Visible host fallback is a last resort for compatible browser nodes. The
extension resolves the target and tries browser-native automation first. If
fallback is enabled, the companion app verifies the foreground browser window,
display mapping, and coordinate confidence before issuing visible input. The
extension must still verify the intended page result before the workflow treats
the action as successful.

The companion also includes an opt-in visual-match fallback for cases where
Windows coordinate mapping is unreliable. In that tier, the extension captures
a bounded image of the resolved component and sends it to the companion. The
companion uses PyAutoGUI image matching on the foreground browser window,
clicks the matched center only when confidence is high and unambiguous, and the
extension still requires post-action verification before passing the step.

## Mapper Inspector

The mapper phase adds a dedicated extension window for reviewing maps. It lets a
user browse workflow, site, page, and map versions; search by Component ID,
display name, role, or status; inspect primary/fallback locators, compact
fingerprints, expected capabilities, and history; run a live resolution check;
and highlight the element only after a unique live resolution succeeds.

The Inspector also exposes workflow-scoped mapper settings under
`workflow.settings.mapper`, including mapping mode, explicit or automatic
mapping trigger, exhaustiveness tier, query-parameter allowlists, sensitivity,
and site/page overrides. There are no extension-global mapper policies.

Ambiguous components go to a Review Queue. The Inspector must not offer a
"choose first candidate" action. A reviewer can explicitly link a historical
component to a selected candidate, and that decision is recorded in the next map
version.

## Companion capability states

- **Not used:** node runs entirely in the extension.
- **Optional fallback:** node has browser-first behavior and may use the
  companion app as a documented fallback.
- **Required:** node cannot perform its primary behavior without the named
  companion capability. If reached while unavailable, the node fails with a
  stable error. Current required-host nodes are **Send Keystroke** (`os.keystroke`) and
  **Upload Allowed Local File** (`local_file.read`).

The companion now reports structured visible-fallback capabilities:
`host.hello`, `host.window`, `host.action`, and `host.visual_match`. These
cover foreground-window validation, visible pointer/keyboard dispatch, and the
opt-in visual recovery tier. The desktop companion includes a Host Fallback tab
for enabling the feature, setting the confidence threshold, checking
foreground-window status, and seeing supported actions. Click, Double-Click,
and Type nodes expose an opt-in `allowVisibleHostFallback` setting; Click and
Double-Click can additionally enable `allowVisualMatchFallback`. When enabled,
the extension still tries browser-native action first, then visible host
fallback after target preparation, and finally visual matching only if
post-action verification fails. Use `verificationSelector` and
`verificationText` when a workflow needs to prove that the visible action
changed page state. The refreshed host-served coordinate fallback workflows
have passed manual testing; manual visual-match acceptance remains next.

## Node reference format

Every node entry in this guide must contain:

- purpose and when to use it;
- usage example;
- target behavior, when applicable;
- every option, default, and expression support;
- inputs and outputs;
- companion capability requirements;
- errors, safety limits, and secret-handling notes.

The current implemented node inventory lives in
[`specs/04_NODE_CATALOG.md`](specs/04_NODE_CATALOG.md). The finalized future
node inventory and implementation order live in the root-level
`workflow_nodes_implementation_blueprint.md`. Detailed entries will be expanded
category by category from the canonical registry as implementation proceeds.
Until an entry is expanded here, Inspector and the registry definition remain
authoritative.

## Node categories

### Browser

Navigation, history, reload, search, and logical tab management. Browser nodes
control where later steps execute and may create or select logical tab
references.

### Element

Click, type, focus, select, toggle, hover, clear, and scroll controls. Recorded
components resolve through the mapper by Component ID. Ambiguous or unsupported
components route to `unresolved` without dispatching the action.

### Wait

Wait for time, visibility, hidden state, enabled state, text, or URL conditions.
Waits are bounded by timeout and return structured timeout diagnostics.

### Data and transforms

Extract page values, set/template variables, parse/stringify JSON, use regular
expressions, convert numbers, and format dates. Output fields name the variables
available to later nodes.

### HTTP, clipboard, files, downloads, and screenshots

External operations use explicit permissions, size/time limits, safe outputs,
and secret-safe logs. Local-file operations require node approval, a connected
companion app, and an approved directory alias.

Approved-directory operations are host-backed workflow nodes:

- **Find Approved Files** lists safe metadata for files under an approved folder
  alias. It returns filenames, relative paths, MIME types, sizes, and modified
  timestamps without exposing unrestricted absolute paths.
- **Write Approved File** writes text/base64 content under an approved folder
  alias that has write permission. Content is redacted from execution logs.
- **Export Data File** serializes workflow data as JSON, CSV, or TXT under an
  approved folder alias that has write permission. Export data is redacted from
  execution logs.

The companion app must be connected, the selected alias must allow the required
read/write permission, and output paths must remain relative to the approved
folder.

### Logic and reusable workflows

Fixed/random waits are available. Mapper-backed DOM nodes add an `unresolved`
route in graph schema v3 so workflows can handle ambiguous, missing, stale, or
unsupported targets without pretending the action succeeded. Conditions,
Workflow Call, and bounded For Each over list/table records are planned in
[`specs/06_RUNTIME_AUTHORING_AND_DATA_FOLLOWUP.md`](specs/06_RUNTIME_AUTHORING_AND_DATA_FOLLOWUP.md).

## Maintenance checklist

When adding or changing a node:

1. Update its canonical registry definition and version.
2. Add or revise its detailed entry in this guide.
3. Show the same description and example in Inspector.
4. Document companion requirements, safety limits, inputs, outputs, and diagnostics.
5. Prefer friendly controls over raw text when valid values are knowable:
   variable-name autocomplete, safe output-name validation, selects/comboboxes,
   and guided key/shortcut pickers for keyboard nodes.
6. Add deterministic tests and a live acceptance scenario.
