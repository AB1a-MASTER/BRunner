# BRunner Windows Companion App - Transition Plan

**Status:** Proposed implementation plan  
**Date:** June 30, 2026  
**Purpose:** Move the existing localhost-managed Python host into a purpose-built Windows companion application while preserving the working workflow, file, and WebSocket foundations.

---

## 1. Outcome

BRunner will become a **native Windows companion application** for the browser automation platform.

The browser extension remains the workflow runtime and browser-awareness layer. The companion app provides approved local capabilities that the extension cannot provide reliably on its own:

- Local workflow storage
- Approved directory access
- Data-source reading
- Host-assisted visible mouse and keyboard fallback
- Local service status and diagnostics

The companion application will replace the current browser-based manager UI. It will not become a second workflow editor or a browser automation engine.

### 1.1 Boundary of responsibility

| Component | Owns | Does not own |
|---|---|---|
| Browser extension | Workflow execution, DOM resolution, tab/page context, browser-native actions, post-action checks, node logs | Arbitrary filesystem access or direct operating-system input |
| Windows companion app | Workflow repository, approved directory registry, host availability, foreground-window checks, screen-coordinate conversion, visible input, local diagnostics | DOM parsing, selector resolution, hidden browser actions, or autonomous workflow decisions |
| Workflow node | Node settings, inputs/outputs, retry policy, fallback policy | Direct operating-system access outside the companion-app protocol |

The operating rule is:

> The extension decides what the workflow intends to do. The companion app decides whether it can perform the requested local action and returns a structured result.

---

## 2. Agreed Product Decisions

1. **The management UI must be a Windows desktop UI.** The current local HTTP dashboard on port 8998 will be retired.
2. **Workflows remain stored beside the executable by default.** The default workflow directory is `Workflows` next to `BRunnerHost.exe`.
3. **The workflow save location is user-configurable.** The desktop UI provides a folder picker and clear migration options.
4. **The host remains local and single-system.** The existing loopback WebSocket model and pairing-key mechanism are adequate for the current stage.
5. **Reliability safeguards remain in scope.** Foreground-window validation, coordinate confidence, and post-action verification prevent incorrect local input; they are required for correct operation, not security hardening.
6. **Workflow persistence becomes atomic everywhere.** Normal save, rename, duplicate, upgrade, configuration save, and diagnostic-log save use a common atomic persistence helper.

---

## 3. Current State

The current project already has useful foundation modules:

| Current module | Existing role | Transition direction |
|---|---|---|
| `brunner_host.py` | WebSocket listener, command router, authentication, simple OS keystrokes, workflow operations | Split into transport/router and capability services |
| `host_ui.py` | Local HTTP dashboard and host-process controls | Retire and replace with desktop application views |
| `host_settings.py` | Config creation, normalization, atomic config write | Expand for app settings, storage path, directory aliases, and migration |
| `workflow_storage.py` | Atomic v1-to-v2 upgrade | Replace with a complete workflow repository and shared atomic-write helper |
| `file_access.py` | Read allowlisted local files | Refactor to resolve directory aliases and permissions |
| `data_source.py` | TXT/CSV/JSON parsing | Retain parser and route it through approved directory aliases |
| `execution_log_storage.py` | Bounded, atomic execution-log storage | Retain and align with revised app paths and diagnostics settings |
| `build_host_ui.py` / `BRunnerHost.spec` | Builds one-file host executable | Replace entry point and packaging assumptions for desktop companion app |

### 3.1 Current limitations to address

- The UI is a browser page rather than a Windows app.
- Runtime storage paths are derived from `__file__`, which is unsuitable for a PyInstaller one-file executable because it can resolve to a temporary extraction location.
- Normal `SAVE_WORKFLOW` writes directly to the destination JSON rather than atomically.
- Workflow records are filename-based only and expose limited metadata.
- Local file roots are raw paths rather than user-facing directory aliases.
- Host input currently supports key presses only, not the full visible fallback set.
- The protocol does not yet attach workflow/node/browser-window context to host-assistance requests.

---

## 4. Target Application Experience

### 4.1 Application form

Use a desktop Python UI framework with mature Windows support, system-tray support, native folder dialogs, and a maintainable layout. **PySide6** is the recommended implementation choice.

The application should launch as a standard Windows application, start the local host service automatically, and remain available from the system tray when its main window is closed.

The main window should use plain Windows terminology and describe the product as a companion app, not as a web server.

### 4.2 Main window sections

| Section | User purpose | Essential controls |
|---|---|---|
| **Status** | Confirm that the companion app and host are ready | Host running/stopped indicator, WebSocket port, extension connection status, version, start/stop/restart actions |
| **Workflow Storage** | See and choose where workflows are stored | Current folder, “Open Folder”, “Change Location”, migration choice, workflow count, storage health |
| **Approved Folders** | Manage directory aliases used by workflows | Alias name, folder path, read/write permissions, recursive access, add/edit/remove controls |
| **Host Fallback** | Configure visible input fallback behavior | Enabled/disabled state, coordinate confidence threshold, screenshot diagnostics setting, supported action status |
| **Pairing** | See or reset the current extension-pairing value | Display/copy pairing key, regenerate key, paired-extension identifier field |
| **Diagnostics** | Investigate failures without leaving the app | Host log view, recent capability requests, open logs folder, export diagnostics |

### 4.3 System tray behavior

- Tray icon communicates **running**, **stopped**, or **attention required** state.
- Left-click opens the main window.
- Context menu offers Open BRunner, Start/Stop Host, Open Workflows Folder, and Exit.
- Closing the window hides it to the tray. Explicit Exit stops the local service cleanly.

---

## 5. Storage and Application Paths

### 5.1 Workflow-storage policy

The workflow directory defaults to the directory containing the installed executable:

```text
<directory containing BRunnerHost.exe>\Workflows
```

Examples:

```text
C:\BRunner\BRunnerHost.exe
C:\BRunner\Workflows\
```

```text
C:\Users\Name\Desktop\BRunner\BRunnerHost.exe
C:\Users\Name\Desktop\BRunner\Workflows\
```

This default is intentional. It keeps the executable and its local workflow library together for the current single-system deployment model.

### 5.2 Correct executable-directory resolution

The application must not use `Path(__file__)` as the runtime storage root in a frozen one-file build.

Use an application-path helper:

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

In source/development mode, the equivalent directory is the project/application directory. In a packaged build, it is the directory containing `BRunnerHost.exe`, not PyInstaller's temporary extraction directory.

### 5.3 User-selected workflow location

The Workflow Storage section must provide **Change Location**.

When a user selects a folder, the companion app stores that absolute path in settings and uses it as the active workflow root. It must show the active path clearly in the UI.

On change, present three explicit choices:

1. **Use new folder only** - leave existing workflows in the old folder.
2. **Copy existing workflows** - retain the original folder and copy valid workflow files into the new root.
3. **Move existing workflows** - transfer valid workflow files into the new root after confirmation.

The default workflow location can be restored with **Use Default Location**.

### 5.4 Unwritable executable directory

If the executable directory cannot be written to, the application must not silently choose a different workflow directory. Instead, show a clear storage-status message and prompt the user to select a writable save folder.

### 5.5 Other local folders

Unless a later decision changes this, configuration and diagnostics can remain beside the executable as well:

```text
<app directory>\brunner_config.json
<app directory>\Logs\
<app directory>\AllowedFiles\
```

The settings model should allow those locations to be separated later without changing workflow protocol behavior.

---

## 6. Configuration Model and Migration

### 6.1 Proposed configuration shape

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

### 6.2 Migration from current configuration

At first launch after the upgrade:

1. Load the existing `brunner_config.json` if present.
2. Preserve the pairing key, paired extension ID, host port, and file-access enabled state.
3. Convert existing `local_file_access.allowed_roots` into provisional approved-directory aliases.
4. Set `workflowStorage.mode` to `default`, pointing to `<exe directory>\Workflows`.
5. Write the migrated configuration atomically.
6. Preserve a one-time backup such as `brunner_config.json.v1.bak` before replacing an older configuration format.

### 6.3 Directory aliases

Workflows must reference an approved directory by stable alias ID, not a raw absolute path.

Example:

```json
{
  "directoryAlias": "customer-imports",
  "relativePath": "June\\orders.csv"
}
```

The companion app resolves the alias to a canonical path and applies the configured read/write permissions.

---

## 7. Atomic Persistence Standard

### 7.1 Rule

Every local data write that changes a user-visible record must use one shared atomic-write implementation.

Applies to:

- Workflow save
- Workflow rename with edited content
- Workflow duplication
- Workflow schema upgrade
- Configuration save and migration
- Directory-registry change
- Execution-log save
- Workflow import

### 7.2 Shared helper behavior

The helper should:

1. Serialize the complete target content before altering the original file.
2. Create a uniquely named temporary file in the target directory.
3. Write UTF-8 content with normalized newlines.
4. Flush and `fsync` the file handle.
5. Replace the destination with `os.replace`.
6. Remove any remaining temporary file in a `finally` block.

Illustrative interface:

```python
def atomic_write_json(destination: Path, content: object, *, indent: int = 2) -> None:
    ...
```

### 7.3 Workflow revision behavior

Keep this simple for the first release:

- Save replaces the active workflow file atomically.
- Before a schema upgrade, preserve a named v1 backup as the current implementation already does.
- For normal saves, optionally retain one previous revision under a predictable `.history` folder or as `<name>.previous.json`.
- Do not build full source-control semantics in this phase.

### 7.4 Atomic operation notes

- **Duplicate:** read/validate source, then atomically write the new destination. Never use a direct `copyfile` into the final name.
- **Rename:** when content changes, atomically write the target and remove/rename the original only after the target is safely present. Preserve the original if the target operation fails.
- **Import:** validate package/workflow content before any destination write.
- **Delete:** keep the current direct deletion behavior unless a recycle/archive feature is intentionally added later.

---

## 8. Workflow Repository Service

### 8.1 Service responsibilities

Create a `workflow_repository.py` service responsible for all workflow disk access.

It should expose operations such as:

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

### 8.2 Workflow record metadata

The repository should return a record summary alongside workflow content:

```json
{
  "id": "workflow-id-or-stable-filename",
  "filename": "customer-import.json",
  "displayName": "Customer Import",
  "schemaVersion": 2,
  "createdAt": "2026-06-30T10:15:00Z",
  "updatedAt": "2026-06-30T10:25:00Z",
  "revision": 4,
  "tags": ["imports"],
  "enabled": true
}
```

The first version may derive most metadata from the workflow JSON and filesystem timestamps. A separate index database is not required at this stage.

### 8.3 Compatibility strategy

The repository should continue to load existing filename-based JSON workflows. New metadata fields must be additive so old workflows remain usable.

---

## 9. Approved Directory Service

### 9.1 Purpose

Replace raw `allowed_roots` with an approved-directory registry managed through the Windows UI.

Each entry contains:

- Stable alias ID
- Display name
- Canonical directory path
- Read permission
- Write/export permission
- Recursive-access option

### 9.2 Minimum operations

| Operation | Expected behavior |
|---|---|
| Add folder | User selects a folder; app assigns or accepts an alias and validates accessibility |
| Edit folder | Change display name, path, permissions, or recursive policy |
| Remove folder | Remove the alias; workflows using it return a clear unavailable-directory result |
| Read file | Resolve alias + relative path and read only inside the approved folder |
| Find files | Search within an approved alias using supported filters |
| Write/export file | Allow only where explicit write permission is set |

### 9.3 Existing parser reuse

`data_source.py` remains the parser for TXT, CSV, and JSON. It should receive a canonical, approved file path from the directory service rather than resolving raw paths itself.

---

## 10. Host-Assisted UI Fallback

### 10.1 Purpose

Host-assisted input is the final fallback when a browser-native operation cannot complete an interaction. It performs only **visible user-style actions** on the foreground browser window.

It is not a substitute for DOM automation and does not create hidden browser access.

### 10.2 Supported actions, phased

| Phase | Action family | Actions |
|---|---|---|
| First implementation | Window readiness | Activate expected browser window; verify foreground/window identity |
| First implementation | Pointer | Move, click, double-click, right-click, scroll |
| First implementation | Keyboard | Type text, press key, shortcut, paste |
| Follow-up | Pointer | Hover, drag and drop |
| Follow-up | Native dialogs | Supported visible file-picker workflows using approved file references |

### 10.3 Required execution flow

1. Extension resolves the target and attempts browser-native automation.
2. On allowed fallback, extension scrolls the target into view and computes candidate coordinates.
3. Extension sends host context: workflow run, node, attempt, expected browser window, browser URL, display data, target bounds, and coordinate confidence.
4. Companion app verifies host availability, foreground window, display mapping, and confidence threshold.
5. Companion app performs the visible mouse or keyboard input.
6. Extension verifies the expected page-state change.
7. The run records whether browser or companion-host execution was used.

### 10.4 Reliability checks

Before host input:

- Expected browser window must be foregrounded.
- Monitor/window mapping must be current.
- Coordinate conversion must account for browser position, device-pixel ratio, browser zoom, Windows display scaling, and multi-monitor offsets.
- Request confidence must meet the configured minimum.
- Secure desktop, locked session, unknown display context, or missing foreground window must return an explicit failure.

Host success means only that the input was issued. The extension must still verify the intended browser result.

---

## 11. Protocol Transition

### 11.1 Keep the current protocol temporarily

The existing commands should remain available during the extension transition:

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

This prevents the Windows UI and repository work from requiring an immediate extension rewrite.

### 11.2 Introduce protocol version 2

New requests should use a versioned envelope:

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

### 11.3 New capability families

| Capability family | Examples |
|---|---|
| `host.hello` | Version/capability handshake, host status |
| `workflow.*` | List, load, save, delete, duplicate, rename, import, export |
| `directory.*` | List aliases, find files, read file, write/export file |
| `data.read` | Parse a TXT/CSV/JSON data source through an approved alias |
| `host.window` | Locate/activate/validate expected browser window |
| `host.action` | Click, type, press, paste, scroll, drag, supported native-dialog actions |
| `diagnostics.*` | Save run logs, query host status, retrieve diagnostic metadata |

### 11.4 Host action request example

```json
{
  "protocolVersion": 2,
  "requestId": "req_123",
  "capability": "host.action",
  "workflowRunId": "run_456",
  "nodeId": "click_checkout",
  "attempt": 1,
  "payload": {
    "action": "click",
    "browserContext": {
      "windowId": "expected-window-id",
      "tabId": "tab-id",
      "expectedUrl": "https://example.com/checkout"
    },
    "target": {
      "viewportBounds": {
        "x": 720,
        "y": 418,
        "width": 130,
        "height": 44
      },
      "coordinateConfidence": 0.97
    },
    "policy": {
      "requireForeground": true,
      "verifyAfterAction": true
    }
  }
}
```

### 11.5 Result example

```json
{
  "requestId": "req_123",
  "status": "success",
  "executionMethod": "companion_host",
  "actionPerformed": "click",
  "windowValidated": true,
  "coordinateConfidence": 0.97,
  "durationMs": 146,
  "warning": null
}
```

---

## 12. Proposed Code Structure

```text
BRunnerHost/
  app.py                       # Desktop application entry point
  app_paths.py                 # Executable/source directory resolution
  desktop/
    main_window.py             # Windows UI composition
    tray_controller.py         # System-tray behavior
    status_view.py
    storage_view.py
    folders_view.py
    fallback_view.py
    diagnostics_view.py
  host/
    service.py                 # Async WebSocket service lifecycle
    router.py                  # Protocol routing and responses
    protocol_v1.py             # Compatibility handlers
    protocol_v2.py             # Structured capability handlers
  services/
    workflow_repository.py     # Workflow CRUD, metadata, import/export
    directory_registry.py      # Alias/permission resolution
    data_source_service.py     # Approved-file parser integration
    fallback_input.py          # Mouse/keyboard actions
    window_validation.py       # Foreground and display checks
    diagnostics.py             # Logs and diagnostics events
  storage/
    atomic_io.py               # Atomic JSON/text file operations
    settings_store.py          # Config load/save/migration
  tests/
    ...
```

The existing modules can be migrated progressively rather than rewritten wholesale.

---

## 13. Phased Implementation Plan

### Phase 0 - Baseline and safety net

**Goal:** Preserve current behavior before restructuring.

- Add a dependency manifest (`pyproject.toml` or `requirements.txt`).
- Add automated tests for current workflow CRUD, config save/load, allowed-file resolution, data parsing, and execution-log save.
- Capture the current command behavior in protocol tests.
- Remove or isolate obsolete files such as `brunner_host copy.py` from the production build.

**Exit criteria:** Existing operations can be exercised from tests without launching the UI.

### Phase 1 - Application paths and atomic I/O

**Goal:** Make storage deterministic in source and packaged builds.

- Add `app_paths.py` based on `sys.executable` when frozen.
- Implement shared `atomic_write_json` and `atomic_write_text` utilities.
- Route config, workflow upgrade, normal workflow save, duplicate, rename, and logs through atomic I/O.
- Introduce settings schema versioning and migration.
- Resolve the default workflow folder to `<exe directory>\Workflows`.

**Exit criteria:** Saving a workflow no longer writes directly to the final file; packaged builds resolve the workflow directory next to the executable.

### Phase 2 - Workflow repository

**Goal:** Centralize workflow persistence.

- Move workflow path validation and CRUD into `workflow_repository.py`.
- Return workflow summaries with filename, display name, schema version, modified date, and optional tags.
- Preserve compatibility with current `LIST_WORKFLOWS`, `LOAD_WORKFLOW`, `SAVE_WORKFLOW`, rename, duplicate, delete, and upgrade commands.
- Add export/import foundations if a stable package format is agreed.

**Exit criteria:** No WebSocket handler writes workflow files directly.

### Phase 3 - Native Windows companion shell

**Goal:** Replace the local HTTP manager.

- Add the PySide6 application entry point and service lifecycle controller.
- Implement Status, Workflow Storage, Pairing, and Diagnostics views first.
- Add tray icon behavior and clean shutdown.
- Remove the HTTP server and manager port 8998 from production use.
- Replace `build_host_ui.py` and update the PyInstaller specification to package the desktop entry point.

**Exit criteria:** The executable opens a Windows companion app and the WebSocket host can be started/stopped from that app.

### Phase 4 - User-selectable workflow directory

**Goal:** Make workflow location visible and controllable.

- Add current-path display, Open Folder, Change Location, and Use Default Location controls.
- Implement copy/move/use-new-folder migration options.
- Verify target-folder write access before applying it.
- Preserve existing workflow files when an operation fails.

**Exit criteria:** A user can move the active workflow library without editing JSON configuration manually.

### Phase 5 - Approved directory registry

**Goal:** Convert file access into an understandable local capability.

- Implement approved-directory aliases in settings and UI.
- Migrate existing allowed roots into provisional aliases.
- Update `file_access.py` and `data_source.py` call paths to accept alias + relative path.
- Add find/read/write behavior according to configured permissions.

**Exit criteria:** Workflows no longer need arbitrary raw filesystem paths for normal file operations.

### Phase 6 - Structured host fallback

**Goal:** Deliver reliable, visible input fallback.

- Add `host.hello` and version/capability reporting.
- Introduce structured v2 `host.action` requests and result payloads.
- Add foreground-window validation and coordinate conversion.
- Implement click, double-click, scroll, typing, key press, shortcut, and paste.
- Add extension-side result verification requirements.
- Keep v1 `OS_KEYSTROKE` compatibility until extension migration is complete.

**Exit criteria:** A browser-first node can request a correctly validated visible fallback and clearly report its result.

### Phase 7 - Packaging and release cleanup

**Goal:** Ship a predictable Windows companion app.

- Update PyInstaller entry point and hidden imports.
- Ensure no app data is read from PyInstaller temporary extraction paths.
- Exclude development caches, prior builds, sample logs, test recordings, and obsolete source copies from release archives.
- Add README setup instructions, first-run instructions, and troubleshooting notes.
- Verify installation and workflow persistence from a folder different from the source checkout.

**Exit criteria:** The packaged executable behaves like the source build and keeps its default workflows next to the executable.

---

## 14. Acceptance Criteria

### Desktop companion experience

- No local browser management page is required.
- Launching BRunner opens a Windows desktop application.
- The host can run in the tray and be managed from the Windows UI.
- The app exposes status, workflow storage, approved folders, fallback settings, pairing, and diagnostics.

### Workflow storage

- The default active workflow folder is `<directory containing BRunnerHost.exe>\Workflows`.
- The user can change the workflow folder from the Windows UI.
- The user can restore the default location.
- Existing workflows can be copied or moved during location change.
- Every workflow save is atomic.
- A failed save leaves the prior workflow file intact.
- Existing v1/v2 workflow files continue to load.

### Directory access

- Workflows reference directory aliases rather than raw arbitrary paths for normal file operations.
- The UI shows alias, path, read/write permission, and recursive policy.
- Reads and writes are rejected when the requested alias/permission is unavailable.

### Host fallback

- Browser-first action is attempted before host input.
- Host requests include run, node, attempt, browser-window, target, and confidence context.
- The host refuses visible input when the expected browser window is not foregrounded or the coordinate context is unreliable.
- Extension confirmation is required to treat a fallback action as workflow success.

### Compatibility

- Existing v1 WebSocket commands continue to work during migration.
- The extension can detect v2 host capabilities through a handshake.
- The host remains loopback-only and usable on one local Windows system.

---

## 15. Explicit Non-Goals for This Transition

The following are not required for the initial companion-app conversion:

- A second workflow editor inside the Windows app
- A database-backed workflow catalog
- Multi-user or network-host deployment
- Comprehensive security hardening beyond the existing local pairing and approved-directory model
- Encryption at rest
- Background/hidden browser automation
- CAPTCHA, MFA, secure-desktop, or lock-screen bypasses
- Full general-purpose native-dialog automation
- Full version-control history for workflows

---

## 16. First Implementation Slice

The smallest useful implementation slice is:

1. Add `app_paths.py` and resolve the default workflow folder next to the executable.
2. Add shared atomic I/O and route normal workflow saves through it.
3. Extract a `workflow_repository.py` service.
4. Build a PySide6 shell with **Status** and **Workflow Storage** pages.
5. Add system-tray behavior.
6. Remove the HTTP manager UI from the packaged app, while retaining the existing WebSocket commands.

This slice solves the two immediate product problems - an inappropriate web UI and non-atomic workflow saves - without forcing host-input protocol work before the app foundation is ready.

---

## 17. Implementation Decisions to Keep Visible

| Decision | Current direction |
|---|---|
| Desktop framework | PySide6 recommended |
| Workflow default directory | `Workflows` beside `BRunnerHost.exe` |
| Change workflow directory | User-controlled through native folder picker |
| When default directory is unwritable | Show issue and ask user to choose a folder; do not silently relocate |
| Web manager on port 8998 | Retire |
| WebSocket host port | Keep configurable; default 8999 |
| Pairing mechanism | Keep local pairing key for single-system use |
| Workflow storage integrity | Universal atomic writes; simple backup/revision behavior |
| Host input | Visible foreground-window fallback only, after browser-first attempt |
| Extension protocol | Preserve v1 while introducing versioned v2 capabilities |

