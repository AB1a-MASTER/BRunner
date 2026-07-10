# Specification 07 - Windows Companion App Transition

## Status

Active implementation spec for the Windows companion transition. This spec is
derived from:

- `BRunner_Windows_Companion_Transition_Plan.md`
- `windows_companion_app_design_notes.docx`

## Goal

Replace the current localhost browser manager UI with a native Windows
companion application while preserving the working workflow storage, file
access, data-source parsing, WebSocket transport, pairing, and execution-log
foundations.

The browser extension remains the workflow runtime, tab/page awareness layer,
DOM resolver, and browser-native action executor. The companion app provides
approved local capabilities only:

- workflow repository and metadata;
- future mapper map persistence through the same approved local-service bridge;
- configurable workflow storage location;
- approved directory aliases for file and data nodes;
- local service status, pairing, and diagnostics;
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
- The browser manager UI on port 8998 is retired from production use.
- The WebSocket host remains loopback-only and keeps default port 8999.
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
- Pairing must move away from manual extension-ID entry. The product goal is a
  clean key/PIN pairing flow so one host trusts one selected extension instance
  even when several browser profiles or browsers have BRunner installed.

## Target Desktop Experience

The companion app launches as a normal Windows application, starts the local
host service when configured to do so, and remains available from the system
tray when the main window is closed.

Required main-window sections:

- Status: running/stopped state, WebSocket port, extension connection, version,
  start/stop/restart.
- Workflow Storage: active folder, open folder, change location, use default,
  workflow count, storage health, migration options.
- Approved Folders: alias, path, read/write permissions, recursive access,
  add/edit/remove.
- Host Fallback: enabled state, coordinate confidence threshold, diagnostics
  screenshot setting, supported action status.
- Pairing: current pairing state, generated key/PIN acceptance, verification,
  unpair/regenerate controls, paired extension fingerprint where useful, and
  WebSocket port configuration.
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

Use a schema-versioned settings file. Preserve the current pairing key,
temporary paired extension ID where present, host port, and file-access state
during migration. The extension ID should be treated as an implementation
detail, not as the long-term user-facing pairing mechanism.

```json
{
  "schemaVersion": 2,
  "pairingKey": "...",
  "pairedExtensionId": null,
  "host": {
    "port": 8999,
    "startWithApp": true
  },
  "workflowStorage": {
    "mode": "default",
    "directory": null
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
    "minimumCoordinateConfidence": 0.9,
    "captureDiagnosticsScreenshots": false
  }
}
```

Migration from the current config:

1. Load `brunner_config.json` if present.
2. Preserve pairing, paired extension ID if present, port, and file-access
   enabled state.
3. Convert `local_file_access.allowed_roots` into provisional approved
   directory aliases.
4. Set workflow storage mode to `default`.
5. Preserve a one-time v1 backup before replacing the older config.
6. Write the migrated config atomically.

## Pairing UX and Trust Model

Pairing exists to bind the local companion host to one intended BRunner
extension instance. If multiple Chrome/Edge profiles, browser instances, or
compatible browsers have the extension installed, only the paired instance may
authenticate and use host capabilities.

Manual extension-ID entry is too fragile for normal users and should be
replaced by a key/PIN procedure. Initial source implementation uses a copyable
pairing key; later UX can shorten this into a numeric PIN if desired:

1. The extension shows host status and a clear pairing action near that status.
2. The extension generates a short-lived pairing PIN or key and displays it in
   the extension UI.
3. The host Pairing tab accepts the PIN/key, verifies it against the extension
   over the loopback WebSocket channel, and stores the resulting trust record.
4. After pairing, host commands require both the host pairing secret and the
   verified extension trust record. Other installed BRunner extension instances
   must be refused with a clear "not paired with this host" diagnostic.
5. The Pairing tab exposes Pair, Verify, Unpair, Regenerate, and Copy controls,
   plus the active WebSocket port and port-edit validation.
6. The extension status area shows whether it is paired, unpaired, or rejected
   by the current host, and shows the current PIN/key only during pairing.

The exact token shape can be a human-entered PIN or a longer copyable key. The
procedure should prefer the easiest UX that still prevents accidental
cross-profile/cross-browser host access. Tokens must be short-lived, generated
fresh for pairing, and never require users to find or paste browser extension
IDs.

Initial implementation status:

- Extension stores the host pairing key in `chrome.storage.local` instead of
  relying on a source-embedded default.
- Extension commands wait for `AUTH` to succeed before sending workflow or
  host-capability requests.
- Sidebar exposes host auth status plus pairing-key Save, Generate, and Copy
  controls.
- Companion Pairing tab exposes pairing key, WebSocket port, Save, Generate,
  Copy, and Unpair controls.
- On successful auth, the host records the extension runtime ID internally as
  the trusted extension fingerprint. This ID is no longer a manual user input.
- A different extension instance with the right port but the wrong trust record
  is refused with a clear not-paired diagnostic.

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

Compatibility requirement: existing filename-based v1/v2 JSON workflows must
continue to load. New metadata is additive.

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
foreground browser window. It does not create DOM access and does not replace
browser-native automation.

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
3. On allowed fallback, extension scrolls target into view and computes
   candidate coordinates.
4. Extension sends run, node, attempt, browser-window, URL, target bounds,
   display data, and confidence.
5. Companion app verifies foreground window, display mapping, coordinate
   confidence, and policy.
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

Refuse host input when the browser window is not foregrounded, monitor mapping
is stale, confidence is below threshold, secure desktop is active, the session
is locked, or user presence is required.

Visual-match fallback constraints:

- Component images sent to the companion are bounded crops, not full workflow
  screenshots unless explicitly required for matching context.
- The companion must apply a confidence threshold and refuse ambiguous,
  off-window, off-screen, or multi-match results.
- The host must not persist component screenshots by default; diagnostics should
  store only bounded metadata unless the user enables screenshot diagnostics.
- Visual matching remains a fallback tier, never a replacement for semantic DOM
  resolution or browser-native execution.

## Protocol Transition

Keep these v1 commands available while the extension migrates:

```text
AUTH
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

Introduce protocol v2 with a structured envelope:

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

- `host.hello`
- `workflow.*`
- `directory.*`
- `data.read`
- `host.window`
- `host.action`
- `diagnostics.*`

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
  **Implemented for current host services.**
- Remove or isolate obsolete production-build files such as copied host source.
  **Isolated from final release packaging; ask the user before removing source
  copies.**

Exit: existing operations are testable without launching the UI.

### Phase 1 - Application Paths and Atomic I/O

- Add `app_paths.py`. **Implemented.**
- Add shared `atomic_write_json` and `atomic_write_text`. **Implemented.**
- Route config, workflow upgrade, normal workflow save, duplicate, rename, and
  logs through atomic I/O. **Implemented.**
- Introduce settings schema versioning and migration. **Implemented with
  schema v2 plus legacy compatibility aliases.**

Exit: workflow saves are atomic and packaged builds resolve storage next to the
executable.

### Phase 2 - Workflow Repository

- Move all workflow path validation and CRUD into `workflow_repository.py`.
  **Implemented.**
- Return workflow summaries. **Implemented.**
- Preserve v1 command compatibility. **Implemented for existing workflow
  commands.**
- Add import/export foundations if package format is settled.

Exit: WebSocket handlers no longer write workflow files directly.

### Phase 3 - Native Windows Companion Shell

- Add PySide6 app entry point and service lifecycle controller. **Implemented.**
- Implement Status, Workflow Storage, Pairing, and Diagnostics first.
  **Initial implementation complete; Pairing tab now has key, port, save,
  regenerate, copy, and unpair controls.**
- Add tray behavior and clean shutdown. **Initial implementation complete.**
- Remove HTTP manager UI from production packaging. **Packaging now targets
  `app.py`; old `host_ui.py` remains as a transitional artifact.**
- Update PyInstaller entry point. **Implemented.**

Exit: packaged app opens a Windows companion app and can start/stop the
WebSocket host.

### Phase 4 - User-Selectable Workflow Directory

- Add current path, open folder, change location, and use default controls.
  **Initial implementation complete.**
- Implement use-new, copy, and move migration options. **Implemented in
  `workflow_location.py`.**
- Verify target-folder write access before applying changes. **Implemented.**

Exit: a user can move the active workflow library without hand-editing JSON.

### Phase 5 - Approved Directory Registry

- Implement alias registry in settings and UI. **Settings model implemented;
  dedicated Approved Folders UI implemented.**
- Migrate allowed roots to provisional aliases. **Implemented.**
- Update file and data-source call paths to use alias plus relative path.
  **Implemented for read/data-source paths.**
- Add find/read/write behavior under configured permissions. **Implemented for
  service behavior; read/local upload acceptance passed manually. Extension
  workflow actions and `Approved Directory Acceptance` now cover find, write,
  and export; manual acceptance passed.**

Exit: normal file operations no longer require arbitrary raw filesystem paths.

### Phase 6 - Structured Host Fallback

- Add `host.hello` and v2 capability reporting. **Initial implementation
  complete; legacy command compatibility preserved.**
- Add clean pairing/auth flow. **Initial source implementation complete:
  extension-side key storage, auth gating before host commands, and host-side
  trusted extension fingerprinting after key verification.**
- Implement `host.window` and `host.action`. **Initial service and extension
  bridge foundations implemented.**
- Add foreground-window validation and coordinate conversion. **Initial
  foreground title, confidence, screen-bound checks, and viewport-to-screen
  conversion implemented; visible host fallback acceptance passed manually.**
- Implement click, double-click, scroll, typing, key press, shortcut, and paste.
  **Initial visible dispatch helpers implemented behind validation.**
- Add Host Fallback companion UI and diagnostics. **Initial tab implemented
  with enable/threshold/screenshot settings, foreground status, supported
  actions, and filtered capability activity.**
- Integrate browser-runtime fallback only where a node explicitly allows it.
  **Initial opt-in integration implemented for click, double-click, and type,
  with content-side target preparation, post-action verification, and a live
  acceptance workflow that passed manually.**
- Add PyAutoGUI visual-match fallback after coordinate fallback: extension
  captures the resolved component image, companion matches it on the foreground
  browser window, clicks the matched center, and reports match confidence and
  bounded diagnostics. **Initial opt-in implementation complete; manual
  visual-match acceptance passed with Chrome side UI open. Matching is
  functional but slow in side-UI cases, so crop/search performance remains a
  follow-up.**
- Keep v1 `OS_KEYSTROKE` until migration is complete.

Exit: browser-first nodes can request validated visible fallback and report the
result clearly.

### Phase 7 - Packaging and Release Cleanup

- Complete pre-shipping Sequential Studio UI and error-channel fixes before
  packaging/install acceptance:
  - display/view options scale the whole Sequential Studio UI, not only sidebar
    widths;
  - node/action and property panels collapse and restore main workspace room;
  - Sequential Studio layout is cleaned up so the UI is not visually jumbled;
  - extension panel errors are extension-level only, while node/workflow errors
    stay in run diagnostics/logs.
- Update PyInstaller entry point and hidden imports.
  **Implemented: entry point remains `app.py`; hidden imports and packaging
  excludes are centralized in `packaging_config.py`.**
- Exclude caches, prior builds, sample logs, test recordings, and obsolete
  copies from release archives. **Implemented for final release artifacts:
  `release_builder.py` emits only `BRunner-extension.zip` and `BRunnerHost.exe`
  at the top level. Extension dev/old files are excluded from the zip.**
- Add setup, first-run, and troubleshooting docs. **Implemented for current
  packaging flow.**
- Verify install behavior outside the source checkout. **Packaged host service
  smoke passed from `release/BRunnerHost.exe`; final manual GUI/extension
  install acceptance remains.**

Exit: packaged app behaves like source build and stores default workflows next
to the executable.

## Documentation Rule

When a phase or milestone is completed, accepted, or materially re-scoped, the
implementing change must update this spec, the master roadmap, current handoff
notes, and any affected user-facing guide before the next phase begins.

### Mapper MapStore Adapter

After the mapper's initial Chrome-storage implementation is stable, the
companion app may provide filesystem persistence for workflow-scoped page maps
behind the same `MapStore` contract. This must use the existing local service
transport unless a separate product decision changes transport. Required
behavior includes site-keyed JSON files, schema-version checks, atomic
write/rename, bounded version retention, request timeouts, host-unavailable
states, oversized-payload chunking where needed, and a multi-tab last-write-wins
conflict rule with retained diff metadata.

Initial source pass is present: the host has a workflow-root mapper repository
and native mapper-state list/get/save/delete commands, and the extension has a
`NativeMapStore` adapter. The hardening source pass is also present: mapper
native requests use bounded timeouts, the native adapter exposes
unavailable/timeout status, normal mapper state payloads are capped at 1 MB
instead of chunked, and host-saved states carry revision plus bounded
last-write-wins conflict metadata. Default persistence remains Chrome storage
until switching to the filesystem-backed adapter is explicitly accepted.

## Acceptance Gates

- No local browser management page is required for ordinary host management.
- Launching BRunner opens a Windows desktop companion app.
- Host service can run in tray and be managed from the app.
- Default workflows live beside `BRunnerHost.exe`.
- Users can change and restore workflow storage.
- Every workflow save is atomic and failed saves preserve the prior file.
- Existing v1/v2 workflows continue to load.
- Workflows use approved directory aliases for ordinary local file operations.
- Host fallback refuses unsafe foreground/window/coordinate contexts.
- Visual-match fallback refuses unsafe foreground/window, low-confidence,
  ambiguous, off-screen, or multi-match contexts.
- Extension verification is required before fallback action counts as workflow
  success.
- Existing v1 WebSocket commands continue during migration.

## Non-Goals

- A second workflow editor inside the Windows app.
- Database-backed workflow catalog.
- Multi-user or network host deployment.
- Encryption at rest.
- Hidden/background browser automation.
- CAPTCHA, MFA, secure-desktop, or lock-screen bypasses.
- Full general-purpose native-dialog automation.
- Full version-control history for workflows.
