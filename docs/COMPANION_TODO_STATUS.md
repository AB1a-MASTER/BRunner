# Companion Completion Status

This checklist is the consolidated status for the Windows companion app. It is
an implementation checklist, not a shipping claim. The July 2026 audit reopened
items that existed in source but were not verified or did not match the product
contract.

## Confirmed Product Boundary

- [x] The companion is a Windows-local helper for the BRunner Chrome/Chromium
  extension.
- [x] Pairing is cooperative one-profile selection, not authentication or a
  security boundary.
- [x] Each extension profile generates a stable, non-secret instance ID. An
  explicit Pair action stores one ID in the host; Unpair clears it.
- [x] The host permits one active paired-extension connection at a time.
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

## Source Work Reopened

- [ ] Replace the transitional pairing-key UI/protocol with a generated
  per-profile non-secret instance ID and explicit Pair/Unpair flow.
- [ ] Enforce one active connection for the paired instance and report live
  connected/disconnected state in the companion.
- [ ] Remove authentication, credential, trusted-fingerprint, and secret-key
  language from implementation messages and tests.
- [ ] Make workflow-location changes update or restart the live host repository;
  make move/copy/default transitions recoverable if config persistence fails.
- [ ] Preserve an explicitly empty approved-directory list and enforce each
  alias's read/write/recursive policy on legacy as well as alias-shaped paths.
- [ ] Migrate ordinary local-file upload to alias plus relative path.
- [ ] Require a verified foreground Chrome/Chromium window for visible input,
  keep coordinates/matches inside that window, and fail closed when window or
  display context is unavailable.
- [ ] Refuse visual matching when a bounded foreground-window search region
  cannot be established.
- [ ] Complete multi-monitor, locked-session, and stale-display correctness
  checks for visible fallback.
- [ ] Add a visible recovery flow when config/workflow paths beside the
  executable are not writable.
- [ ] Align WebSocket payload limits with file/image limits and bound image/data
  decoding work.
- [ ] Update and lock image-processing dependencies before relying on component
  image handling in acceptance tests.
- [ ] Make process-tree shutdown observe `taskkill` failure and use a reliable
  fallback.
- [ ] Implement every advertised protocol-v2 capability or stop advertising it.
- [ ] Complete live status/version reporting, dynamic tray states, Open Logs,
  Export Diagnostics, and either implement or remove screenshot diagnostics.
- [ ] Add live WebSocket contract tests for pairing, connection exclusivity,
  storage changes, approved-folder denial, and visible-fallback refusal.

## Manual Source Acceptance

Run these only after the reopened source work above is complete.

- [ ] Start the companion and confirm exactly one managed host is started and
  stopped with the app.
- [ ] Pair one Chrome/Chromium profile by instance ID, reject a second active
  profile cooperatively, then Unpair and pair the other profile.
- [ ] Exercise use-new/copy/move/default workflow storage while the host is
  running and confirm extension and companion show the same library.
- [ ] Exercise approved-folder read, write, recursive denial, final-alias
  removal, path escape, and unavailable-folder states.
- [ ] Exercise coordinate and visual-match fallback with Chrome side UI and
  multiple monitors; confirm all actions remain inside the verified foreground
  Chrome/Chromium window.
- [ ] Confirm unwritable-path startup produces actionable UI instead of a silent
  exit.

## Deferred Packaging and Release

- [ ] Define the supported Windows installation/distribution form.
- [ ] Rebuild artifacts only after source and source acceptance are complete.
- [ ] Add release provenance, dependency/version recording, executable
  validation, and an isolated `--self-check` gate.
- [ ] Decide and implement Windows signing and user-facing installation
  guidance.
- [ ] Run packaged GUI, tray, storage, pairing, approved-folder, and fallback
  acceptance outside the source checkout.

## Intentional Decisions

- [x] Pairing remains a simple cooperative local UX; it does not claim to defend
  against malicious local clients or spoofed instance IDs.
- [x] Keep visual matching opt-in and subordinate to semantic/browser paths.
- [x] Keep mapper persistence out of the companion filesystem.
