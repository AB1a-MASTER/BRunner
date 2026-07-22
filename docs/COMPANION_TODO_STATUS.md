# Companion Completion Status

This checklist is the consolidated status for the Windows companion app. It is
an implementation checklist, not a shipping claim. The July 2026 audit reopened
items that existed in source but were not verified or did not match the product
contract. Automated source closure and source-checkout acceptance are recorded
below; packaged acceptance remains a separate deferred gate.

## Confirmed Product Boundary

- [x] The companion is a Windows-local helper for the BRunner Chrome/Chromium
  extension.
- [x] Pairing is cooperative one-profile selection, not authentication or a
  security boundary.
- [x] Each extension profile generates a stable, non-secret instance ID. An
  explicit Pair action stores one ID in the host; Unpair clears it.
- [x] The host permits one active paired-extension connection at a time.
- [x] The extension and companion use the fixed loopback WebSocket port 8999;
  legacy custom values normalize to 8999 and the UI exposes no port editor.
- [x] Deliberate spoofing by malicious local software is out of scope.
- [x] Approved-folder permissions and foreground visible-fallback checks remain
  correctness requirements.
- [x] Code Node design and broader workflow-code security are outside this
  companion checklist.
- [x] Existing ZIP/EXE outputs are development test artifacts. User-facing
  release packaging is deferred.

## Implemented Foundations

These items describe source that exists; they do not override the open
correctness and acceptance work below.

- [x] Executable-aware path helpers and shared atomic text/JSON writers.
- [x] PySide6 companion shell with Status, Workflow Storage, Approved Folders,
  Host Fallback, Pairing, and Diagnostics tabs.
- [x] Workflow, approved-directory, data-source, execution-log, and visible-input
  service modules. An inactive mapper compatibility module also exists but is
  not part of the product path.
- [x] Configured host autostart, tray hide/restore, and managed child-process
  controls.
- [x] Browser-first fallback plumbing and opt-in visual-match plumbing.
- [x] PyInstaller and archive-building scripts for internal test artifacts.

## Automated Source Work

- [x] Replace the transitional pairing-key UI/protocol with a generated
  per-profile non-secret instance ID and explicit Pair/Unpair flow.
- [x] Enforce one active connection for the paired instance and report live
  connected/disconnected state in the companion. A connected result requires a
  fresh completed-handshake heartbeat whose profile, fixed port 8999, and live
  host process match; external hosts also require the heartbeat PID to own the
  local listening port.
- [x] Remove authentication, credential, trusted-fingerprint, and secret-key
  language from implementation messages and tests.
- [x] Make workflow-location changes update or restart the live host repository;
  make move/copy/default transitions recoverable if config persistence fails.
- [x] Preserve an explicitly empty approved-directory list and enforce each
  alias's read/write/recursive policy on legacy as well as alias-shaped paths.
- [x] Add the alias-plus-relative local-file transport for future node
  integration. Keep the existing upload node provisional until the node phase.
- [x] Require a verified foreground Chrome/Chromium window for visible input,
  require an exact per-monitor-DPI renderer-viewport transform for coordinate
  input, keep coordinates/matches inside that window, and fail closed when
  window, renderer, or display context is unavailable or ambiguous.
- [x] Refuse visual matching when a bounded foreground-window search region
  cannot be established.
- [x] Complete multi-monitor, locked-session, and stale-display correctness
  checks for visible fallback.
- [x] Add a visible recovery flow when config/workflow paths beside the
  executable are not writable.
- [x] Align WebSocket payload limits with file/image limits and bound image/data
  decoding work.
- [x] Update and lock image-processing dependencies before relying on component
  image handling in acceptance tests.
- [x] Make process-tree shutdown observe `taskkill` failure and use a reliable
  fallback.
- [x] Implement every advertised protocol-v2 capability or stop advertising it.
- [x] Complete live status/version reporting, dynamic tray states, Open Logs,
  Export Diagnostics, and either implement or remove screenshot diagnostics.
- [x] Add real loopback WebSocket contracts for protocol hello, pairing,
  connection exclusivity, approved-file round trips, permission denial, and
  traversal refusal; cover visible-fallback refusal in deterministic service and
  router contracts.
- [x] Normalize every host-served acceptance workflow to the repository-root
  fixture URL and verify each referenced local URL exists.
- [x] Cover the real write-response-to-find-request chain plus exact read,
  write, recursive, traversal, missing-alias, unavailable-folder, and empty-list
  failures over the loopback protocol.
- [x] Cover the complete use-new/default/copy/move/default transition with a
  recreated repository at each returned active path.
- [x] Cover unavailable-folder rendering, final-alias persistence, simulated
  close-to-tray/tray-exit behavior, and a Chrome side-panel renderer inset.
- [x] Stabilize off-screen target geometry across browser paints before visible
  fallback, retry only verified renderer-geometry refusals with a fresh
  preparation, derive visual crops from actual captured-image scale, and cover
  fractional renderer rounding at high Chrome zoom.
- [x] Flush successful fallback log records before replying, remove the obsolete
  tracked root log snapshot, show the active `Logs\brunner_host.log` path in
  Diagnostics, and refresh that panel automatically.

## Manual Source Acceptance

The automated source work above is complete. The operator completed the checks
below with the real Companion, unpacked extension, Windows shell behavior,
Chrome window state, and physical monitor configuration. The initially failing
fallback cases were fixed and rerun before acceptance.

### Extension/Host Round Trip

- [x] Run `Workflows/extension_host_roundtrip_verification.json` and confirm the
  host write response drives the find request. Accepted on 2026-07-17 with
  `extension-host-roundtrip.txt | extension-host-roundtrip.txt | 1`.

### Managed Process and Tray

- [x] Enable **Start host with companion**, save, exit by tray **Exit**, and
  relaunch the Companion.
- [x] Confirm the UI shows one running host on port `8999` and the paired
  extension connected.
- [x] Verify exactly one owning PID with `Get-NetTCPConnection -LocalPort 8999 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique` and record it.
- [x] Click **Start Host** again and confirm no second process/listener appears.
- [x] Click **Stop Host** and confirm the extension disconnects; start again and
  confirm one listener plus automatic reconnection.
- [x] Close the window with X and confirm it hides to the tray without stopping
  the host.
- [x] Use tray **Exit** and confirm the managed listener stops with no orphan.

### Two Real Browser Profiles

- [x] With the unpacked extension in profiles A and B, pair A by its displayed
  instance ID and confirm A reports `Host: ready (paired and connected)`.
- [x] Attempt to pair B while A is active and confirm B reports
  `Host: paired to another Chrome profile; unpair it first` while A remains
  usable.
- [x] Unpair A, pair B, confirm the ownership switches, then restore the
  preferred profile.

### Visible Workflow Storage

- [x] With the host running, exercise **Use new folder only**, **Use Default**,
  **Copy existing workflows**, **Move existing workflows**, and **Use Default**
  using disposable folders.
- [x] At every transition confirm Companion and extension display the same
  workflow library, the host reconnects, copied sources remain, moved sources
  are removed, and the final default library is restored.

### Approved Folders Through the Real Extension

- [x] In Companion configure disposable alias `allowedfiles` with
  Read/Write/Recursive enabled and run **Approved Directory Acceptance**.
- [x] Confirm the visible value is
  `generated-write.txt exported-data.json 1` and both output files exist.
- [x] Change the UI permissions one at a time and confirm the real workflow
  reports the exact read, write, and recursive refusal instead of succeeding.
- [x] Run **Approved Directory Escape Refusal Acceptance** and confirm the
  expected `Output file is outside approved directory.` failure with no parent
  file created.
- [x] Point the alias at a nonexistent folder and confirm `(Unavailable)` plus
  the unavailable-directory failure.
- [x] Remove the final alias, refresh/restart, and confirm the UI stays empty and
  execution reports the missing-alias failure; then restore the normal alias.

### Foreground Visible Fallback

- [x] With fallback enabled at `0.90`, run **Visible Host Fallback Acceptance**
  at 100%, 125%, 175%, and 200% zoom, with Chrome side UI closed and open, on
  each physical monitor. At 175%/200%, scroll the target out of view before
  starting and confirm preparation brings it into view and clicks it.
- [x] Confirm success text is
  `Trusted Submit accepted via visible host fallback.`, diagnostics show
  `[Fallback] host.action performed`, the displayed active log path ends in
  `BRunner_Host\Logs\brunner_host.log`, and the pointer remains inside Chrome.
- [x] Set threshold `1.00` to force visual recovery and confirm coordinate
  refusal followed by `[Fallback] host.visual_match performed` inside the
  foreground Chrome search region.
- [x] Disable fallback and confirm the workflow fails without an untrusted page
  click, then restore enabled/`0.90`.

Two physical monitors are required to close the documented multi-monitor gate;
without them record this item as blocked, not passed.

The initial 2026-07-20 run exposed the off-screen high-zoom failure and stale
Diagnostics display. After the source fixes, the operator reported the affected
real-Chrome fallback and logging reruns passing.

### Visible Unwritable-Path Recovery

- [x] Select a disposable workflow folder, exit, deny the current Windows user
  write access, and relaunch Companion.
- [x] Confirm **Workflow Storage Unavailable** names the path/reason and lets you
  select a writable replacement that becomes active.
- [x] Run a disposable copied Companion directory whose config path is
  unwritable and confirm a visible **BRunner Startup** error names the config
  problem instead of silently exiting.
- [x] Restore default storage, permissions, preferred pairing, approved-folder
  permissions, and fallback `0.90`; remove all disposable artifacts.

The complete source-checkout Companion acceptance sequence passed on 2026-07-20
after the reported fallback defects were fixed and rerun. Packaged release
acceptance remains intentionally deferred.

## Deferred Packaging and Release

- Define the supported Windows installation/distribution form.
- Rebuild artifacts only after source and source acceptance are complete.
- Add release provenance, dependency/version recording, executable
  validation, and an isolated `--self-check` gate.
- Decide and implement Windows signing and user-facing installation
  guidance.
- Run packaged GUI, tray, storage, pairing, approved-folder, and fallback
  acceptance outside the source checkout.

## Intentional Decisions

- [x] Pairing remains a simple cooperative local UX; it does not claim to defend
  against malicious local clients or spoofed instance IDs.
- [x] Keep visual matching opt-in and subordinate to semantic/browser paths.
- [x] Keep mapper persistence out of the companion filesystem.
