# Specification 07 - Windows Companion App Transition

## Status

Active implementation spec for the Windows companion transition. A July 2026
source audit reopened pairing, storage-transition, approved-folder,
visible-fallback, and packaging claims that were present in source but not
correct or sufficiently verified. The automated source work is now complete;
hands-on source acceptance and release packaging remain open. Current ZIP/EXE
outputs are development test artifacts, not releases.

This spec is derived from:

- `BRunner_Windows_Companion_Transition_Plan.md`
- `windows_companion_app_design_notes.docx`

## Goal

Replace the current localhost browser manager UI with a native Windows-local
companion application for the BRunner Chrome/Chromium extension while
preserving the useful workflow storage, file access, data-source parsing,
WebSocket transport, cooperative profile selection, and execution-log
foundations.

The browser extension remains the workflow runtime, tab/page awareness layer,
DOM resolver, and browser-native action executor. The companion app provides
approved local capabilities only:

- workflow repository and metadata;
- configurable workflow storage location;
- approved directory aliases for file and data nodes;
- local service status, cooperative profile pairing, and diagnostics;
- visible foreground mouse and keyboard fallback when a browser-first node
  explicitly allows it.

The companion app is not a second workflow editor, not a DOM automation engine,
and not a hidden browser-control service.

## Operating Boundary

| Component | Owns | Does not own |
|---|---|---|
| Browser extension | Workflow execution, DOM resolution, tab/page context, browser-native actions, node outputs, post-action verification | Arbitrary filesystem access or direct operating-system input |
| Windows companion app | Workflow repository, approved directory registry, host availability, foreground-window checks, coordinate conversion, visible input, diagnostics | DOM parsing, selector resolution, hidden browser actions, autonomous workflow decisions |
| Workflow node | Settings, inputs/outputs, retry policy, fallback policy, host requirement metadata | Direct operating-system access outside the companion protocol |

Rule: the extension decides what the workflow intends to do. The companion app
decides whether it can perform the requested local action and returns a
structured result.

## Product Decisions

- Desktop framework: PySide6 is the recommended target.
- Supported browser family for this transition: Chrome/Chromium on Windows.
- The browser manager UI on port 8998 is retired from production use.
- The WebSocket host remains loopback-only on fixed port 8999, matching the
  extension endpoint. The port is displayed for diagnostics but is not
  user-configurable.
- Existing v1 WebSocket commands remain during transition.
- A versioned protocol v2 is introduced for structured capabilities.
- Workflows remain beside the executable by default:
  `<directory containing BRunnerHost.exe>\Workflows`.
- Users can choose a different workflow folder through the desktop UI.
- If the default executable directory is unwritable, the app must show the
  issue and ask the user to choose a writable folder instead of silently
  relocating data.
- Every user-visible local write uses shared atomic persistence.
- Host input is visible foreground fallback only, after browser-first attempt
  and before extension-side verification.
- Pairing is cooperative one-profile exclusivity, not authentication or a
  security boundary. Each Chrome/Chromium profile generates a stable,
  non-secret instance ID. An explicit Pair action stores one ID in the host,
  Unpair clears it, and the host permits one active paired-extension connection.
- Deliberate spoofing by malicious local software is out of scope. Pairing exists
  to prevent accidental cross-profile use, not to protect local capabilities
  from an adversarial process running as the same Windows user.
- Code Node design and broader workflow-code security are outside this companion
  transition.

## Target Desktop Experience

The companion app launches as a normal Windows application, starts the local
host service when configured to do so, and remains available from the system
tray when the main window is closed.

Required main-window sections:

- Status: running/stopped state, WebSocket port, extension connection, version,
  start/stop/restart.
- Workflow Storage: active folder, open folder, change location, use default,
  top-level/recursive discovery toggle, workflow count, storage health,
  migration options.
- Approved Folders: alias, path, read/write permissions, recursive access,
  add/edit/remove.
- Host Fallback: enabled state, coordinate confidence threshold, diagnostics
  screenshot setting, supported action status.
- Pairing: current paired instance ID, explicit Pair and Unpair controls, live
  connection state, one-active-connection status, and read-only fixed WebSocket
  port display. The instance ID may be displayed or copied; it is not a
  credential.
- Diagnostics: host log view, recent capability requests, logs folder, export
  diagnostics.

Tray behavior:

- indicator states for running, stopped, and attention required;
- left-click opens the main window;
- context menu includes Open BRunner, Start/Stop Host, Open Workflows Folder,
  and Exit;
- closing the window hides it to tray, while explicit Exit stops the service
  cleanly.

## Storage and Paths

Add an application-path helper and route all storage through it.

```python
from pathlib import Path
import sys


def application_directory() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def default_workflows_directory() -> Path:
    return application_directory() / "Workflows"
```

In a packaged one-file build, do not derive persistent storage from
`Path(__file__)`, because PyInstaller can resolve that to a temporary extraction
directory.

Configuration and diagnostics may remain beside the executable for this phase:

```text
<app directory>\brunner_config.json
<app directory>\Logs\
<app directory>\AllowedFiles\
```

The settings model should allow these locations to be separated later without
changing workflow protocol behavior.

## Configuration Model

Use a schema-versioned settings file. The target schema stores one non-secret
extension-profile instance ID. Transitional pairing keys and browser runtime IDs
are migration inputs only and must not survive as credentials or trusted
fingerprints in the accepted model.

```json
{
  "schemaVersion": 3,
  "pairedInstanceId": null,
  "host": {
    "port": 8999,
    "startWithApp": true
  },
  "workflowStorage": {
    "mode": "default",
    "directory": null
  },
  "workflowDiscovery": {
    "recursive": false
  },
  "approvedDirectories": [
    {
      "id": "customer-imports",
      "displayName": "Customer Imports",
      "path": "C:\\BRunner\\Imports",
      "read": true,
      "write": false,
      "recursive": true
    }
  ],
  "hostFallback": {
    "enabled": true,
    "minimumCoordinateConfidence": 0.9
  }
}
```

Migration from the current schema-2 config:

1. Load `brunner_config.json` if present.
2. Normalize any legacy custom host-port value to the fixed loopback port 8999;
   preserve workflow location, approved-directory state, and fallback
   preferences.
3. Remove the transitional pairing key and runtime extension ID. Start the new
   cooperative pairing state as unpaired so the user explicitly selects one
   Chrome/Chromium profile.
4. Convert `local_file_access.allowed_roots` into provisional approved
   directory aliases.
5. Preserve the existing workflow-storage selection when valid; otherwise use
   `default`.
6. Preserve a one-time backup before replacing the older config.
7. Write the migrated config atomically.

## Pairing UX and Cooperative Profile Model

Pairing selects one intended BRunner Chrome/Chromium profile for ordinary local
use. It is not authentication, a credential exchange, or a security boundary.
The host and extension are both local, and resistance to deliberate spoofing by
malicious local software is a non-goal.

Target procedure:

1. On first use, each extension profile generates a random, stable, non-secret
   instance ID and stores it in that profile's `chrome.storage.local`.
2. The extension shows host status, its instance ID where useful for
   diagnostics, and an explicit Pair action.
3. Pair records that instance ID in the host after a deliberate user action.
   The host stores exactly one paired instance ID.
4. The host accepts one active extension connection whose announced instance ID
   matches the stored ID. A second profile or second active connection is
   declined with a clear cooperative-use diagnostic.
5. Unpair clears the stored ID and closes the active extension connection. The
   user may then explicitly pair another profile.
6. The companion reports paired/unpaired plus live connected/disconnected state
   separately. A stored ID must not be presented as proof of a live connection.

The ID may be displayed, copied, logged for local diagnostics, or regenerated
when the user intentionally creates a new profile identity. It must not be
called a password, key, token, credential, authentication secret, or trusted
fingerprint.

Current implementation status:

- Each extension profile has a stable non-secret instance ID and explicit
  Pair/Unpair controls.
- The host stores one paired ID, accepts one active matching connection, and
  reports stored pairing separately from live connection state. Live state is
  backed by a short-lived completed-handshake heartbeat and is accepted only
  when its profile, fixed port 8999, and live host process match. For an
  externally started host, the reported process must also own the loopback
  listener.
- Real loopback WebSocket tests cover pairing, other-profile and duplicate
  refusal, disconnect release, reconnect, and protocol-v2 hello reporting.

## Atomic Persistence

All user-visible writes must use one shared atomic I/O implementation.

Applies to:

- workflow save, rename, duplicate, upgrade, import, and export;
- configuration save and migration;
- approved-directory registry changes;
- execution-log and diagnostics writes.

Helper behavior:

1. Serialize complete target content before altering the original file.
2. Write a uniquely named temporary file in the target directory.
3. Use UTF-8 and normalized newlines.
4. Flush and fsync.
5. Replace with `os.replace`.
6. Remove leftover temporary files in `finally`.

Normal save replaces the active workflow atomically. Schema upgrades still keep
the existing `.v1.bak` behavior. Full version-control semantics are out of
scope for this transition.

## Workflow Repository

Create `workflow_repository.py` as the single service responsible for workflow
disk access.

Minimum operations:

```text
list_workflows()
load_workflow(workflow_ref)
save_workflow(workflow)
delete_workflow(workflow_ref)
duplicate_workflow(workflow_ref, new_name)
rename_workflow(workflow_ref, new_name, content=None)
upgrade_workflow(workflow_ref, v2_content)
import_workflows(package_path)
export_workflows(workflow_refs, destination_path)
```

Repository results should include workflow summaries with filename, display
name, schema version, created/updated timestamps where available, revision,
tags, and enabled state. A separate index database is not required for the
first version.

The repository may enumerate and transport provisional v1/v2 JSON during
foundation development, but that does not create a workflow-schema compatibility
guarantee. The finalized node phase may rewrite or remove those schemas.
Migration, if later required, is a separately approved feature.

## Approved Directory Service

Replace raw allowed roots with user-facing directory aliases.

Each alias has:

- stable alias ID;
- display name;
- canonical path;
- read permission;
- write/export permission;
- recursive access policy.

Workflow file references use alias plus relative path:

```json
{
  "directoryAlias": "customer-imports",
  "relativePath": "June\\orders.csv"
}
```

The companion app resolves the alias, enforces permissions, prevents path
escape, and returns explicit unavailable/denied errors. `data_source.py` remains
the parser for TXT, CSV, and JSON after the directory service provides an
approved canonical path.

## Host-Assisted Fallback

Host-assisted input is the final fallback for visible user-style actions on a
verified foreground Chrome/Chromium window. It does not create DOM access and
does not replace browser-native automation.

First implementation action families:

- window readiness: activate expected browser window and verify identity;
- pointer: move, click, double-click, right-click, scroll;
- keyboard: type text, press key, shortcut, paste.

Follow-up action families:

- hover, drag and drop;
- supported visible file-picker workflows using approved file references.

Required flow:

1. Extension resolves the user-provided identifier first.
2. Extension attempts browser-native automation.
3. On allowed fallback, extension focuses and activates the target tab, then
   scrolls the target into view and captures one coordinate snapshot.
4. Extension sends run, node, attempt, browser-window, URL, target bounds,
   CSS viewport/client data, device-pixel ratio, and confidence.
5. Companion app verifies foreground window, per-monitor DPI mode, coordinate
   confidence, policy, and exactly one visible Chrome renderer viewport whose
   physical dimensions match that CSS viewport and device-pixel ratio. It
   refuses missing, stale, or multiple matching renderer geometry. Page zoom
   and side UI remain valid when the renderer transform is uniquely verified;
   no browser-chrome offset is estimated.
6. Companion app performs the visible input.
7. Extension verifies the intended page-state change.
8. If coordinate fallback was performed but verification still fails and the
   node opts into visual matching, the extension captures a bounded
   screenshot/crop of the resolved component and sends it to the companion; the
   companion uses PyAutoGUI image matching against the foreground browser
   window to locate the visible component and click its matched center.
9. Extension verifies the intended page-state change again after any visual
   fallback attempt.
10. Logs record browser versus companion-host execution method, including
    whether coordinate or visual matching was used.

As a correctness rule, refuse host input when the intended Chrome/Chromium
window cannot be identified as foreground, the coordinate or match is outside
that window, monitor mapping is stale or unavailable, confidence is below the
configured threshold, or Windows is not on the interactive unlocked desktop.
These checks prevent accidental input to the wrong visible target; they are not
a security guarantee against malicious local software.

Visual-match fallback constraints:

- Component images sent to the companion are bounded crops, not full workflow
  screenshots unless explicitly required for matching context.
- The companion must apply a confidence threshold and refuse ambiguous,
  off-window, off-screen, or multi-match results.
- Screenshot-diagnostics persistence is deferred and the inactive setting has
  been removed from the accepted source configuration and UI.
- Visual matching remains a fallback tier, never a replacement for semantic DOM
  resolution or browser-native execution.

## Protocol Transition

The cooperative profile transition is implemented. The key-based `AUTH`
command has been removed. Each connection starts with `PROFILE_HELLO`; explicit
`PAIR_PROFILE` and `UNPAIR_PROFILE` requests change the stored selection. The
existing non-pairing v1 commands remain available after a profile session is
accepted:

```text
PROFILE_HELLO
PAIR_PROFILE
UNPAIR_PROFILE
OS_KEYSTROKE
READ_FILE
READ_DATA_SOURCE
LIST_WORKFLOWS
SAVE_WORKFLOW
LOAD_WORKFLOW
DELETE_WORKFLOW
DUPLICATE_WORKFLOW
RENAME_WORKFLOW
UPGRADE_WORKFLOW
SAVE_EXECUTION_LOG
```

Introduce protocol v2 with a structured envelope. Before ordinary capability
requests, the client announces its generated profile instance ID; this is a
cooperative identity assertion, not authentication:

```json
{
  "protocolVersion": 2,
  "requestId": "req_123",
  "capability": "host.action",
  "workflowRunId": "run_456",
  "nodeId": "click_checkout",
  "attempt": 1,
  "payload": {}
}
```

Capability families:

- `companion.instance`
- `companion.pair`
- `companion.unpair`
- `host.hello`
- `workflow.*`
- `directory.*`
- `data.read`
- `host.window`
- `host.action`
- `diagnostics.*`

The host must advertise only capability names it actually routes. Each
advertised v2 capability requires an executable transport-level contract test.

## Proposed Code Structure

```text
BRunner_Host/
  app.py
  app_paths.py
  desktop/
    main_window.py
    tray_controller.py
    status_view.py
    storage_view.py
    folders_view.py
    fallback_view.py
    diagnostics_view.py
  host/
    service.py
    router.py
    protocol_v1.py
    protocol_v2.py
  services/
    workflow_repository.py
    directory_registry.py
    data_source_service.py
    fallback_input.py
    window_validation.py
    diagnostics.py
  storage/
    atomic_io.py
    settings_store.py
```

The existing modules may migrate progressively. Avoid a wholesale rewrite that
breaks current extension behavior.

## Implementation Roadmap

### Phase 0 - Baseline and Safety Net

- Add dependency manifest. **Implemented.**
- Add tests for current workflow CRUD, config load/save, allowed-file
  resolution, data parsing, execution-log save, and protocol behavior.
  **Implemented, including real loopback WebSocket pairing, exclusivity,
  approved-file, permission-denial, and traversal contracts. Hands-on Windows
  visible-input acceptance remains separate.**
- Remove or isolate obsolete production-build files such as copied host source.
  **Obsolete copied host source was removed after user approval; defensive
  packaging exclusions remain.**

Exit: existing operations are testable without launching the UI.

### Phase 1 - Application Paths and Atomic I/O

- Add `app_paths.py`. **Implemented.**
- Add shared `atomic_write_json` and `atomic_write_text`. **Implemented.**
- Route config, workflow upgrade, normal workflow save, duplicate, rename, and
  logs through atomic I/O. **Implemented.**
- Introduce settings schema versioning and migration. **Implemented with schema
  3 cooperative pairing, legacy compatibility inputs, and explicit-empty
  approved-directory preservation.**

Exit: workflow saves are atomic and source-mode storage resolves through the
shared application-path helper. Packaged-path acceptance remains deferred to
Phase 7.

### Phase 2 - Workflow Repository

- Move all workflow path validation and CRUD into `workflow_repository.py`.
  **Implemented.**
- Return workflow summaries. **Implemented for the companion UI. The v1
  WebSocket list command intentionally retains its filename-list contract.**
- Persist a top-level/recursive discovery choice and apply it to both the
  companion table and WebSocket filename list. **Implemented; recursive entries
  use safe repository-relative names.**
- Preserve v1 command compatibility. **Implemented for existing workflow
  commands.**
- Add import/export foundations if package format is settled.

Exit: WebSocket handlers no longer write workflow files directly.

### Phase 3 - Native Windows Companion Shell

- Add PySide6 app entry point and service lifecycle controller. **Implemented.**
- Implement Status, Workflow Storage, Pairing, and Diagnostics first.
  **Implemented with cooperative Pair/Unpair, live connection/version state,
  Open Logs, and Export Diagnostics. The inactive screenshot option was
  removed.**
- Add tray behavior and clean shutdown. **Implemented with dynamic status, Open
  Workflows Folder, and process-tree fallback when `taskkill` fails.**
- Remove HTTP manager UI from the desktop source path. **Implemented; release
  packaging is deferred.**
- Keep `app.py` as the internal test-artifact entry point. **Implemented.**

Exit: the source app opens a Windows companion and accurately starts, stops, and
reports one managed WebSocket host. **Implemented; hands-on acceptance remains
open.**

### Phase 4 - User-Selectable Workflow Directory

- Add current path, open folder, change location, and use default controls.
  **Controls exist.**
- Implement use-new, copy, and move migration options. **Implemented in
  `workflow_location.py` with transactional rollback and live managed-host
  restart. External-host use produces an explicit restart warning.**
- Verify target-folder write access before applying changes. **Implemented.**

Exit: a user can move the active workflow library without hand-editing JSON,
and the running extension and companion immediately use the same recoverable
location. **Implemented in source; hands-on acceptance remains open.**

### Phase 5 - Approved Directory Registry

- Implement alias registry in settings and UI. **Settings model implemented;
  dedicated Approved Folders UI implemented.**
- Migrate allowed roots to provisional aliases. **Implemented.**
- Update file and data-source call paths to use alias plus relative path.
  **Implemented for companion services and future node integration. The current
  local-upload node remains provisional and keeps its legacy input until the
  node phase.**
- Add find/read/write behavior under configured permissions. **Implemented for
  alias-shaped and legacy-compatible inputs; empty registries, recursion,
  read/write flags, unavailable folders, and path escape are covered.**

Exit: normal file operations use alias plus relative path, and every legacy path
honors the same alias permission and recursive rules. **Implemented in source;
hands-on acceptance remains open.**

### Phase 6 - Structured Host Fallback

- Add `host.hello` and v2 capability reporting. **Implemented. The hello payload
  separates the complete host capability set from the four routed v2 envelope
  capabilities.**
- Add cooperative profile pairing. **Implemented with a generated per-profile
  non-secret instance ID, explicit Pair/Unpair, one active connection, and live
  connection state.**
- Implement `host.window` and `host.action`. **Initial service and extension
  bridge foundations implemented.**
- Add foreground-window validation and coordinate conversion. **Implemented
  with foreground Chrome/Chromium identity, exact renderer-viewport mapping,
  explicit CSS-viewport-to-physical conversion, per-monitor DPI awareness,
  window-bounded coordinates, interactive-session, mixed-DPI multi-monitor,
  and stale-display/window/renderer checks.**
- Implement click, double-click, scroll, typing, key press, shortcut, and paste.
  **Implemented; hands-on acceptance still validates the fail-closed checks.**
- Add Host Fallback companion UI and diagnostics. **Implemented with
  enable/threshold controls, visible refusal/context state, supported actions,
  and diagnostics export. The inactive screenshot setting was removed.**
- Integrate browser-runtime fallback only where a node explicitly allows it.
  **Initial opt-in integration implemented for click, double-click, and type,
  with content-side target preparation, post-action verification, and a live
  acceptance workflow. Final per-node fallback decisions remain provisional
  until the node phase; hands-on host acceptance is still required.**
- Add PyAutoGUI visual-match fallback after coordinate fallback: extension
  captures the resolved component image, companion matches it on the foreground
  browser window, clicks the matched center, and reports match confidence and
  bounded diagnostics. **Implemented with bounded image decoding and mandatory
  verified foreground-window search regions.**
- Keep v1 `OS_KEYSTROKE` until migration is complete.

Exit: browser-first nodes can request validated visible fallback, every action
or match stays inside the verified foreground Chrome/Chromium window, and the
extension reports and verifies the result. **Implemented in source; hands-on
Windows acceptance remains open.**

### Phase 7 - Packaging and Release (Deferred)

Current PyInstaller/archive scripts and generated ZIP/EXE files are internal
test helpers and artifacts only. They are not a release pipeline and must not be
described as final deliverables.

When release work resumes:

- complete source correctness and manual source acceptance first;
- define the supported Windows installation/distribution form;
- update and lock dependencies, record provenance and dependency versions, and
  validate bounded image handling;
- stage artifacts in a temporary location and publish only after complete
  validation;
- validate executable structure and version rather than only an `MZ` prefix;
- run `--self-check` from an isolated location and complete packaged GUI,
  lifecycle, storage, pairing, approved-folder, and fallback acceptance;
- decide and implement Windows signing and user-facing installation guidance;
- ensure generated extension artifacts match the current source tree.

Exit: a separately approved release plan produces current, attributable,
validated, signed-as-decided artifacts that behave like the accepted source
build. **Deferred.**

## Documentation Rule

When a phase or milestone is completed, accepted, or materially re-scoped, the
implementing change must update this spec, the master roadmap, current handoff
notes, and any affected user-facing guide before the next phase begins.

### Inactive Mapper Compatibility Adapter

The repository contains a host mapper repository and `NativeMapStore` adapter
from an earlier transition experiment. They are not part of the product path,
and the companion does not advertise or route `mapper.state.*` capabilities.
Mapper persistence remains in Chrome storage; maps are disposable and recreated
after loss. Do not harden, package, or reactivate the filesystem adapter unless
a later product decision explicitly changes mapper storage.

## Acceptance Gates

- No local browser management page is required for ordinary host management.
- Launching BRunner opens a Windows desktop companion app.
- Host service can run in tray and be managed from the app.
- The companion targets the BRunner Chrome/Chromium extension on Windows.
- Each extension profile has a generated non-secret instance ID; explicit Pair
  stores one ID, Unpair clears it, and only one matching extension connection is
  active at a time.
- Pairing is described and tested as cooperative exclusivity, not
  authentication, credential validation, or protection from malicious local
  software.
- Default workflows use the application directory when it is writable; an
  unwritable location produces actionable UI.
- Users can change and restore workflow storage while the running host and UI
  remain on the same repository.
- Every workflow save is atomic and failed saves preserve the prior file.
- Workflow repository operations remain atomic and schema-neutral; provisional
  v1/v2 compatibility is not an acceptance requirement.
- Workflows use approved directory aliases for ordinary local file operations.
- Approved-folder read, write, recursive, escape, unavailable, and final-removal
  behavior is consistent on every compatibility path.
- Host fallback refuses missing, stale, off-window, or otherwise invalid
  foreground/window/coordinate contexts.
- Visual-match fallback refuses missing foreground regions, low-confidence,
  ambiguous, off-window, off-screen, or multi-match contexts and never expands
  to the whole desktop.
- Extension verification is required before fallback action counts as workflow
  success.
- Existing v1 WebSocket commands continue during migration.
- Release packaging is not an acceptance gate until deferred Phase 7 resumes.

## Non-Goals

- A second workflow editor inside the Windows app.
- Database-backed workflow catalog.
- Multi-user or network host deployment.
- Authentication or authorization against malicious local clients.
- Preventing deliberate local instance-ID spoofing.
- Code Node design or broader workflow-code security.
- Edge, Firefox, Safari, or non-Chromium browser support in this transition.
- Hidden/background browser automation.
- Full general-purpose native-dialog automation.
- Full version-control history for workflows.
- User-facing release packaging, installation, signing, or distribution until
  Phase 7 is explicitly resumed.
