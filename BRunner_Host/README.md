# BRunner Windows Companion

BRunner Host is a Windows-local companion for the BRunner Chrome/Chromium
extension. The extension owns workflow execution, DOM resolution, page/tab
context, and browser-native actions. The companion owns approved local storage,
approved-folder operations, service diagnostics, and explicitly enabled visible
foreground input.

The companion is under active source development. Current ZIP and EXE outputs
are test artifacts, not supported user releases. Release packaging and
distribution are deferred until the open items in
`docs/COMPANION_TODO_STATUS.md` are complete.

## Development Setup

Install dependencies from this folder:

```powershell
python -m pip install -r requirements.txt
```

Run the companion from source:

```powershell
python app.py
```

The PySide6 entry point is `app.py`. It can start the local WebSocket service as
a managed child process, and the same entry point supports the internal
`--serve-host` mode.

## Pairing Model

Pairing is cooperative selection of one Chrome/Chromium profile. It is not
authentication, a credential system, or a defense against malicious local
software.

The target pairing flow is:

1. Each extension profile generates and stores a stable, non-secret instance
   ID in that profile's local extension storage.
2. The user explicitly pairs the current profile in the extension/companion UI.
3. The host stores one paired instance ID and permits one active paired
   extension connection at a time.
4. Unpair clears the stored ID. The user can then explicitly pair another
   profile.

The instance ID may be displayed or copied for diagnostics; it is not a secret.
Accidental use by a second profile should be declined clearly. Deliberate local
spoofing is outside the product boundary.

The current source still contains transitional pairing-key controls and must not
be treated as the accepted implementation. Replacing those controls and their
protocol path is an open source task.

## Storage and Approved Folders

The intended first-run layout is beside the application directory:

```text
brunner_config.json
Workflows\
Logs\
AllowedFiles\
```

In a future packaged build, persistent paths must resolve from the directory
containing `BRunnerHost.exe`, not PyInstaller's temporary extraction directory.
If that location is not writable, the app must show an actionable folder-choice
or configuration-recovery flow rather than exit silently.

Workflow Storage supports a default folder and a user-selected folder with
use-new, copy, move, and restore-default choices. A location change is complete
only when the running host and companion use the same repository and a failed
transition remains recoverable.

Approved Folders provide an alias, path, read/write permissions, and a recursive
policy. Workflow file operations should use the alias plus a relative path.
These checks are correctness boundaries: path escape, read/write denial,
non-recursive child access, final-alias removal, and unavailable folders must
all behave consistently.

## Visible Host Fallback

Visible host fallback is an explicitly enabled last resort for compatible
browser-first nodes. The extension resolves the target and attempts the
browser-native action first. The companion may issue visible input only after it
has established the intended foreground Chrome/Chromium window and valid
display/coordinate context. The extension must verify the resulting page state
before the workflow treats the action as successful.

Visual matching is an additional opt-in recovery tier. It must search only a
bounded region inside the verified foreground Chrome/Chromium window, refuse
missing or ambiguous matches, and never fall back to a whole-desktop search when
window context is unavailable.

Approved-folder enforcement and visible-fallback checks are product correctness
requirements. They are not claims that the local companion protects against
malicious software running as the same Windows user.

## Internal Test Artifacts

The repository currently contains development helpers:

```powershell
python build_host_ui.py
python release_packager.py --version 0.1.0
python ..\release_builder.py
```

These commands may produce `BRunnerHost.exe` and `BRunner-extension.zip` for
internal testing. They do not constitute a release process, installer,
provenance check, signature check, or shipping approval. Do not distribute an
artifact merely because the current validation script accepts it.

`BRunnerHost.exe --self-check` is an internal packaged-path diagnostic. Before
release work resumes it must be part of an isolated validation gate together
with dependency/version recording and full packaged integration acceptance.

## Development Troubleshooting

- If the extension cannot connect, confirm that the companion host is running
  on the configured loopback port and that the profile is explicitly paired by
  instance ID.
- If startup reports that port 8999 is already in use, stop the existing BRunner
  host or choose another configured port before starting another instance.
- If a workflow-location change appears only in the companion or only in the
  extension, restart the host while the live repository-rebind work remains
  open.
- If an approved file is unexpectedly allowed or denied, check the alias's
  read/write/recursive settings and report the case against the companion TODO.
- If visible fallback is refused, keep Chrome/Chromium foregrounded and inspect
  the Host Fallback diagnostics. A missing window/search region must be treated
  as refusal.
- Packaging configuration remains centralized in `packaging_config.py`, but
  packaging correctness and release validation are deferred work.

## Scope

The companion does not own a workflow editor, DOM automation, hidden browser
control, or general native-dialog automation. Code Node design and broader
workflow-code security are separate project topics and are not part of this
companion document.
