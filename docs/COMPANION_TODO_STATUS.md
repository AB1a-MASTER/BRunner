# Companion Completion Status

This checklist is the consolidated status for the Windows companion app.

## Source Complete

- [x] Executable-aware runtime paths and atomic configuration/workflow writes.
- [x] Workflow repository and safe use-new/copy/move/default location changes.
- [x] Approved-folder aliases with read/write/recursive permission enforcement.
- [x] Native PySide6 Status, Workflow Storage, Approved Folders, Host Fallback,
  Pairing, and Diagnostics tabs.
- [x] Tray lifecycle, configured host autostart, hidden Windows child-host
  launch, idempotent shutdown, and packaged PyInstaller process-tree cleanup.
- [x] Strong 128-bit pairing keys with readable grouping, canonical validation,
  extension authentication, trusted extension fingerprints, and immediate
  managed-host restart when pairing changes or is revoked.
- [x] Browser-first coordinate fallback with foreground-window validation,
  post-action verification, and opt-in visual-match recovery.
- [x] Visual matching scoped to the clipped foreground browser window with
  ambiguity protection plus bounded region/timing diagnostics.
- [x] Centralized PyInstaller configuration and exactly two release artifacts.
- [x] Non-GUI packaged `--self-check` for writable config/workflow path
  verification and strict release archive/executable validation.
- [x] Setup, first-run, pairing, storage, fallback, packaging, and
  troubleshooting documentation.

## Manual Acceptance

- [ ] Launch `BRunnerHost.exe` outside the source checkout and run
  `BRunnerHost.exe --self-check`; confirm exit code 0.
- [ ] Confirm first launch creates configuration, Workflows, and Logs beside
  the executable.
- [ ] Confirm configured autostart starts one managed host and Exit stops it.
- [ ] Confirm window close hides to tray, tray Open restores it, and tray Exit
  shuts down cleanly.
- [ ] Pair the packaged extension and companion, then regenerate/unpair and
  confirm the old session is rejected immediately.
- [ ] Exercise use-new/copy/move/default workflow storage options.
- [ ] Exercise approved-folder read, write, recursive denial, and unavailable
  folder states in the packaged app.
- [ ] Run coordinate and visual-match fallback with Chrome side UI open and
  confirm visual diagnostics report a foreground-window search region.
- [ ] Load `BRunner-extension.zip` and complete packaged host/extension
  integration acceptance.

## Intentional Decisions

- [x] Keep the full 128-bit pairing secret; improve readability with grouped
  display instead of weakening it to a short PIN.
- [x] Keep visual matching opt-in and subordinate to semantic/browser paths.
- [x] Keep mapper persistence out of the companion filesystem.
