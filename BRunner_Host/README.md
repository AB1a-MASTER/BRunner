# BRunner Host Companion

## Setup

Install the host dependencies from this folder:

```powershell
python -m pip install -r requirements.txt
```

Run from source:

```powershell
python app.py
```

Build the Windows companion executable:

```powershell
python build_host_ui.py
```

Stage an archive-ready release folder after the executable exists:

```powershell
python release_packager.py --version 0.1.0
```

For the final user-facing release, run this from the repository root instead:

```powershell
python release_builder.py
```

That top-level command emits exactly two deliverables:
`release\BRunner-extension.zip` and `release\BRunnerHost.exe`.

The PyInstaller entry point is `app.py`, which opens the PySide6 companion UI.
The same executable can start the embedded websocket service with
`--serve-host`.
Run a non-GUI packaged-path check with:

```powershell
.\BRunnerHost.exe --self-check
```

Exit code `0` confirms that configuration and the active workflow directory
can be created and written beside the installed executable.
The host-only staging helper copies `BRunnerHost.exe`, companion docs, and a
manifest for internal inspection. Runtime folders such as `Workflows`,
`AllowedFiles`, `Logs`, local configuration, build caches, and obsolete source
copies are excluded from release output.

## First Run

On first launch, the companion creates `brunner_config.json`, `Workflows`, and
`Logs` beside the application directory. In a packaged build, that means beside
`BRunnerHost.exe`, not inside PyInstaller's temporary extraction folder.

Use the Workflow Storage tab to choose a different workflow directory. Use the
Approved Folders tab to add aliases for files or data sources the extension may
read or write.

Use the Pairing tab to match the host with the intended extension instance. In
the extension sidebar, generate or enter a pairing key, copy it, paste it into
the host Pairing tab, confirm the WebSocket port, and save. The extension must
authenticate before workflow storage or host capability requests are accepted.
After a successful auth, the host remembers that extension instance internally;
use Unpair or Generate Host Key when switching browser profiles.
Pairing keys retain 128 bits of entropy and are displayed in readable groups;
hyphens are optional when pasting. Changing, regenerating, or revoking pairing
restarts a host managed by the companion so an authenticated old session cannot
remain active.

The Status tab controls whether the host starts with the companion. Closing the
window keeps the app in the tray. Tray **Exit** stops the managed host and exits
the application, including the packaged one-file child process.

## Troubleshooting

- If the extension cannot connect, confirm the companion is running and the port
  in `brunner_config.json` matches the extension.
- If startup reports that port 8999 is already in use, another BRunner host is
  already running. Stop the existing host from the companion app or change the
  configured port before starting a second copy.
- If visible host fallback is refused, keep Chrome foregrounded and check the
  Host Fallback tab for the expected window title and confidence threshold.
- Visual matching searches only the clipped foreground browser window and logs
  its search region and duration. Keep it opt-in for workflows that need
  OS-level fallback.
- If packaging misses a module, add it once to `packaging_config.py`; both the
  `.spec` file and `build_host_ui.py` read from that shared list.
- If release staging fails, build the executable first and confirm
  `dist\BRunnerHost.exe` exists.
