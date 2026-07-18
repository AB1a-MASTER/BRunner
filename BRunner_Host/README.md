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

The service is loopback-only on fixed port `8999`, matching the extension
endpoint. The companion displays this port for status and pairing diagnostics;
it is not configurable. Existing custom values in older config files are
normalized to `8999` when the config is loaded.

## Pairing Model

Pairing is cooperative selection of one Chrome/Chromium profile. It is not
authentication, a credential system, or a defense against malicious local
software.

The implemented pairing flow is:

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

The former pairing-key and browser-runtime-ID path has been removed. Source
contract tests cover explicit pairing, one active matching connection, refusal
of other profiles, disconnect release, and reconnect.

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
The source app now shows an actionable folder-choice/configuration-recovery flow
when its config or workflow location is not writable. Packaged-path behavior
still requires release-phase acceptance.

Workflow Storage supports a default folder and a user-selected folder with
use-new, copy, move, and restore-default choices. A location change is complete
only when the running host and companion use the same repository and a failed
transition remains recoverable.

Approved Folders provide an alias, path, read/write permissions, and a recursive
policy. Workflow file operations should use the alias plus a relative path.
These checks are correctness boundaries: path escape, read/write denial,
non-recursive child access, final-alias removal, and unavailable folders must
all behave consistently.

## Extension/Host Round-Trip Verification

Use `Workflows/extension_host_roundtrip_verification.json` to verify the live
extension-to-host request path and the correlated host-to-extension response
path. This is a foundation acceptance workflow for the current provisional
actions; it is not a final node contract. The host does not initiate browser
automation, so “host to extension” here means the host's correlated command
response reaches the extension and is consumed by the next workflow step.

Prerequisites:

1. Run the companion, pair the intended Chrome/Chromium profile, and confirm
   the extension reports the host ready.
2. Ensure the approved folder alias `allowedfiles` exists with read and write
   enabled. The repository development config points it at `AllowedFiles/`.
3. In a separate PowerShell window, run `..\start_acceptance_server.ps1` from
   this folder, or run `start_acceptance_server.ps1` from the repository root.
   This is the canonical server setup; tracked host-served workflows use
   `http://127.0.0.1:8765/BRunner_Host/test.html`.
4. Reload the unpacked extension, open Graph Studio, load **Extension/Host
   Round-Trip Verification**, and run it. If custom workflow storage is active,
   copy the verification JSON into that active workflow directory first.

Successful completion produces
`AllowedFiles/extension-host-roundtrip.txt` and leaves this exact value in the
fixture page's Account name field:

```text
extension-host-roundtrip.txt | extension-host-roundtrip.txt | 1
```

The first filename comes from the host's write response. That returned value is
used as the pattern for the find request; the second filename and count come
from the host's find response. Any missing, rejected, mismatched, or uncorrelated
reply therefore fails before the visible PASS value can be verified.

## Visible Host Fallback

Visible host fallback is an explicitly enabled last resort for compatible
browser-first nodes. The extension resolves the target and attempts the
browser-native action first. The companion may issue visible input only after it
has established the intended foreground Chrome/Chromium window and valid
display/coordinate context. Pointer coordinates additionally require a
per-monitor-DPI-aware host and exactly one visible Chrome renderer viewport
whose physical bounds match the focused page's CSS viewport and device-pixel
ratio. Missing, stale, or multiple matching renderer geometry refuses the
coordinate tier; ordinary page zoom remains valid when that exact renderer
transform is unique. The extension must verify the resulting page state before
the workflow treats the action as successful.

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
  on loopback port 8999 and that the profile is explicitly paired by instance
  ID.
- If startup reports that port 8999 is already in use, stop the existing BRunner
  host. BRunner intentionally runs only one local host on its fixed port.
- A companion-managed host restarts automatically after a workflow-location
  change. If the host was started externally, the companion warns you to
  restart that external process before running workflows.
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
