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

The shared View setting changes the Studio UI density across command bars,
panels, cards, node dimensions, canvas tools, logs, and form controls. In
Sequential Studio, the Actions and Details panels can be hidden or restored
from their panel headers or command-bar controls, and that panel state is
remembered with the shared Studio preferences.

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
Static and dynamic map records are isolated internally: stable page controls
keep the primary Component IDs, while loaded-window or ephemeral records are
tracked in a separate dynamic lane and cannot take over a static control's
identity.

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

Pairing chooses exactly which installed BRunner extension instance may use the
local host. This matters when several browser profiles or browser instances
have the extension installed. The UX is key/PIN based rather than manual
extension-ID based: the extension shows host auth status plus a pairing key,
and the companion Pairing tab accepts that key, verifies the extension when it
authenticates, manages the active pairing, and exposes port configuration.
Users should not need to look up or paste browser extension IDs.

Current source flow:

1. In the extension sidebar, use **Generate** or enter a pairing key.
2. Copy that key.
3. In the companion Pairing tab, paste the key, confirm the WebSocket port, and
   save.
4. Reload/reconnect the extension. The extension authenticates before sending
   workflow requests.
5. The host stores the successful extension instance internally. Other
   extension instances are rejected until the host is unpaired or regenerated.

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
user open a saved-map browser, view maps grouped by website, select site/page
profiles and versions, search by Component ID, display name, role, or status,
inspect primary/fallback locators, compact fingerprints, expected capabilities,
and history, run a live resolution check, and highlight the element only after
a unique live resolution succeeds.

The Inspector must provide two views for a selected map:

- **Tree view:** an explorer-style hierarchy of website, page, region/container,
  and component records, with type icons, indentation, lock affordances, compact
  labels, and canonical Component IDs shown as secondary details. The Tree can
  switch between captured page structure, region grouping, and component-type
  grouping. Structure mode uses saved DOM-path facts so it follows the captured
  page hierarchy as closely as the map data allows.
- **Graph view:** a hierarchy graph similar to Graph Studio, showing map
  relationships in a top-down canvas with connector ports, right-angle edges,
  pan/zoom controls, selected-node state, and unresolved/review states.

When the Inspector and mapped website are open together, **Highlight on
website** mode lets the user select a component in Tree or Graph view
and see a color-coded overlay on the live page, similar to selecting an element
in DevTools. Resolved, fallback-resolved, ambiguous, missing, review-required,
dynamic-deferred, and unsupported components must be visually distinct.
The optional **Highlight on hover** setting previews the same safe overlay when
the user hovers or keyboard-focuses a mapped component row.
Highlighting is inspection-only; it must never click or type into an ambiguous
or unresolved target.

The Inspector also exposes workflow-scoped mapper settings under
`workflow.settings.mapper`, including mapping mode, explicit or automatic
mapping trigger, exhaustiveness tier, query-parameter allowlists, sensitivity,
and site/page overrides. There are no extension-global mapper policies.

Current source foundation: new graph workflows default to mapper-capable graph
schema v3, target-element nodes can carry placeholder `ComponentRef` records,
recorded DOM steps persist workflow-scoped page maps, and action execution can
resolve stored Component IDs before falling back to legacy target packages.
The first Mapper Inspector source pass is available at
`mapper-inspector/index.html`. It lists saved maps as one card per base
website, keeps only the latest bounded retained versions, lets the selected
site's saved pages be chosen from a toolbar Page selector, scopes the Version
selector to the selected page, shows Tree and Graph views, includes a Review
Queue, can
map the active page without the recorder, and can highlight a selected
component on the live website through the mapper resolver. Highlighting scrolls
the resolved live element into view before drawing the overlay.
**Refresh Map** rescans the selected saved page's currently open website tab,
so component-only DOM changes such as appended feed cards, graph/tree updates,
or controlled dynamic drift create a fresh retained version for that page
without mutating other saved pages on the same site.
The current mapper source also includes bounded image and visible leaf-text
components so user-visible images and copyable text can be tracked for later
click, extraction, or screenshot/crop workflows.
Website view has been removed from scope; live website highlighting remains.
Tree, Graph, and Review Queue share component search/status filters so large
stress-page maps can be narrowed by Component ID, alias, display name,
role/type, capability, status, or review state.
The Inspector can also save display aliases without changing Component IDs,
accept a review-required current mapping, link a review-required component to a
selected live resolver candidate while preserving the Component ID, show
persisted live resolver attempts and structured resolver logs, edit basic
workflow mapper policy values, and mark a site as sensitive so details are
redacted in the Inspector.
The Component panel has an explicit **Check live resolution** action so review
workflows can fetch resolver attempts before linking a live candidate, even when
automatic selection highlighting is disabled.
The Websites rail, full Details rail, and right-side Policy, Review Queue, and
Component sections can be collapsed to recover working space. Policy and Review
Queue heights can also be resized with their dividers when a review needs more
vertical space, and the Inspector shell uses compact toolbars and aligned
checkbox controls for repeated review work.
Mapper-bound DOM nodes require an explicit `unresolved` route. Mapper graph
workflows now have an initial source traversal path for `success` and
`unresolved` handles. Existing v2 workflows remain compatible with the current
linear runtime. General graph control flow such as conditions, loops, and merge
paths remains deferred.

Element wait conditions and extraction actions use the same mapper-aware target
resolution as interaction actions. If a mapped wait/extraction target is
ambiguous, missing, or safely deferred, the workflow receives a handled mapper
diagnostic instead of silently choosing a candidate.

Mapper acceptance pages are served from the repo root. The current fixtures are
`http://127.0.0.1:8765/BRunner_Host/mapper_test.html` and
`http://127.0.0.1:8765/BRunner_Host/mapper_stress_test.html`. The platform
profile fixture is
`http://127.0.0.1:8765/BRunner_Host/mapper_platform_profiles_test.html`.
Together they exercise duplicate Save buttons, Component ID drift, static
controls, controlled dynamic drift, mutation-heavy safe decline, infinite-scroll
boundaries, open Shadow DOM controls, chat-thread shells, message composers,
social feed cards, repeated action bars, virtualized loaded windows, and
visible counters/logs. The manual test should map each section, mutate the
page, verify honest unresolved/deferred outcomes, and later, after the
Inspector exists, switch through Tree/Graph views and verify live page
highlighting from selected map elements.
The source manual checklist is in
[`MAPPER_MANUAL_ACCEPTANCE.md`](MAPPER_MANUAL_ACCEPTANCE.md).

Mapper maps live in extension Chrome storage. They are intentionally disposable:
if mapper state is lost, remap the page rather than restoring a filesystem
copy. A hardened native filesystem adapter exists behind the same store contract
for compatibility, but it is inactive and periodic native snapshots are not
part of the product.

Ambiguous components go to a Review Queue. The Inspector must not offer a
"choose first candidate" action. A reviewer can explicitly link a historical
component to a selected candidate, and that decision is recorded in the next map
version. Review acceptance and live-candidate linking create a fresh review map
version so the previous map remains inspectable. The Inspector also explains
bounded dynamic regions, platform and frame scope, and uses a selectable Graph
hierarchy list at phone widths. Remaining Inspector work is live extension
acceptance from `MAPPER_MANUAL_ACCEPTANCE.md`.

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
have passed manual testing. Visual-match fallback also passed manual testing
with Chrome side UI open. Searches are now clipped to the foreground browser
window and diagnostics report the bounded search region and duration.

## Companion setup and packaging

The companion source lives in `BRunner_Host`. Install dependencies with
`python -m pip install -r requirements.txt`, run from source with
`python app.py`, and build a Windows executable with `python build_host_ui.py`.
For a packaged-path check, run `BRunnerHost.exe --self-check`; exit code `0`
confirms that configuration and the active workflow directory are writable.
Pairing keys are 128-bit hexadecimal secrets shown in grouped form for
readability. Changing or revoking pairing restarts a companion-managed host to
invalidate existing sessions. The Status tab controls host autostart, closing
the window keeps the companion in the tray, and tray Exit stops the managed
host.
Packaging uses `app.py` as the PyInstaller entry point and shares hidden-import
and exclude settings through `packaging_config.py`.

Build the final release artifacts from the repository root with
`python release_builder.py`. The output directory contains exactly two
user-facing files: `release/BRunner-extension.zip` and
`release/BRunnerHost.exe`.

On first launch, the companion creates `brunner_config.json`, `Workflows`, and
`Logs` beside the application directory. In a packaged build, that means beside
`BRunnerHost.exe`.

If the host reports that port 8999 is already in use, another BRunner host is
already running on the configured port. Stop the existing host from the
companion app, or change the port in the companion configuration before
starting a second copy.

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
