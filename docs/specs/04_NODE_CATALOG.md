# Specification 04 — Phased Node Catalogue

## Purpose

Define the supported automation vocabulary before implementation. Nodes must be added through the canonical registry and must not introduce one-off Studio forms.

## Implemented foundation

- Browser: Navigate URL, recorded tab switch.
- Element: Click, type, focus, select, toggle.
- Keyboard: Native keystroke.
- Data: Legacy extract, text, attribute, list, table, page metadata, set variable, template.
- Logic: Fixed or randomized wait with expressions.

## Phase A — Sequential nodes (implemented; live acceptance pending)

These do not require graph branching and are the next implementation target.

- Browser: Back, forward, reload, default-provider search, open tab, close current tab. **Implemented.**
- Element: Double-click, hover, clear input, scroll element into view, scroll page. **Implemented.**
- Wait: Element visible, hidden, enabled, text present, URL match. **Implemented.**
- Data transforms: JSON parse/stringify, regular-expression match/replace, number conversion, date formatting. **Implemented.**

All wait nodes require timeout and polling configuration and must return timeout diagnostics. Browser tab actions use logical `tabRef` where applicable.

Open Tab explicitly chooses whether execution continues in the current or new tab and may assign the new tab a logical reference. Every Studio node can optionally select its execution tab by logical reference. Close Tab never creates an empty fallback tab; it either continues in an available opener/tab or returns no active workflow tab.

## Phase B — External and file operations

- HTTP request with method, headers, body, response type, timeout, non-2xx policy,
  and output variable. **Implemented and live accepted.** Requests run in
  the background with credentials omitted, redact headers/body from logs, and
  support workflow cancellation through `AbortController`.

HTTP Request live acceptance:

1. Serve the repository root locally, for example with
   `python -m http.server 8765`.
2. Add an HTTP Request node using `GET`, response type `json`, output variable
   `http_result`, and URL
   `http://127.0.0.1:8765/tests/fixtures/http-response.json`.
3. Run the workflow and confirm `http_result.status` is `200`,
   `http_result.ok` is `true`, and `http_result.data.ok` is `true`.
4. Add a later node using `{{http_result.data.source}}` to verify response data
   remains available through the run variable registry.
- Clipboard read/write through an offscreen extension document with manifest
  permissions. **Implemented and live accepted.** Read nodes default to
  denied and require explicit node-level approval. Clipboard values stay out of
  execution logs.
- Web file-input upload from expression-enabled text/base64 content.
  **Implemented and live accepted.** Content is capped at 10 MB and kept
  out of execution logs. Arbitrary local paths and native dialogs remain deferred
  until native-access permissions are designed.
- Download wait with recent-download recovery, filename/URL matching, timeout,
  cancellation, danger/interruption diagnostics, and safe metadata output.
  **Implemented and live accepted.** Full local paths and URL query
  strings are excluded from workflow output and execution logs.
- Allowlisted local-file upload through the authenticated native host.
  **Implemented and live accepted.** Access requires both node-level
  approval and an enabled host allowlist. Resolved paths and file content are
  excluded from logs; files are capped at 10 MB. Native OS dialogs remain
  deferred because direct allowlisted injection is safer and deterministic.
- Visible-tab screenshot capture to in-memory data or explicit Downloads output.
  **Implemented and live accepted.** Restricted/internal pages are
  rejected. Download output omits image data from the workflow variable; memory
  output remains run-scoped and is never logged.

Phase B is complete. Native OS dialog automation remains deferred to Milestone 4.

## Deferred node execution preconditions

Add registry-level interaction metadata identifying nodes that require a visible
foreground tab, focused window, in-viewport target, or physical pointer path.
The runtime must enforce these preconditions before dispatch and produce clear
diagnostics when activation, focus, scrolling, visibility, or obstruction checks
cannot be satisfied.

Initial audit candidates:

- Hover Mouse and future pointer movement/drag nodes;
- hardware keyboard or mouse simulation;
- visible-tab screenshots and other viewport-dependent capture;
- element interactions whose browser behavior requires an unobscured target.

This audit must avoid foregrounding tabs for background-safe network, clipboard,
file, wait, or data-transformation nodes unless their individual contract requires
it.

Clipboard live acceptance:

1. Reload the extension and approve its clipboard permissions.
2. Load and run `Clipboard Acceptance` while the local fixture server is active.
3. Confirm the Account name field becomes `BRunner clipboard acceptance`.
4. Confirm disabling `Allow Clipboard Read` makes the workflow fail with
   `clipboard_read_not_approved` and does not expose clipboard text in logs.

File Input Upload live acceptance:

1. Reload the extension while the local fixture server is active.
2. Load and run `File Input Acceptance`.
3. Confirm the upload result reads
   `brunner-acceptance.txt | text/plain | 31 bytes | BRunner virtual upload accepted`.
4. Confirm workflow output variable `uploaded_file` contains name, MIME type,
   and size metadata but not file content.

Download Wait live acceptance:

1. Reload the extension and approve its Downloads permission.
2. Keep the local fixture server active, then load and run
   `Download Wait Acceptance`.
3. Confirm Chrome downloads `download-acceptance.txt` and the Account name field
   becomes `download-acceptance.txt`.
4. Confirm `download_result` contains safe metadata without a full local path or
   URL query string.

Screenshot Capture live acceptance:

1. Reload the extension while the local fixture server is active.
2. Load and run `Screenshot Capture Acceptance`.
3. Confirm Chrome saves `brunner-acceptance.png` and the Account name field
   becomes `brunner-acceptance.png`.
4. Confirm `screenshot_result` contains format, MIME type, byte size, timestamp,
   filename, and download id without embedded image data.

Local File Upload live acceptance:

1. Restart the native host so it loads the `READ_FILE` command and updated
   allowlist configuration.
2. Reload the extension, keep the local fixture server active, and run
   `Local File Upload Acceptance`.
3. Confirm the upload result reads
   `local-upload-acceptance.txt | text/plain | 35 bytes | BRunner local file upload accepted`.
4. Change the node path outside `BRunner_Host/AllowedFiles` and confirm it fails
   without exposing the rejected path in logs or workflow diagnostics.

## Phase C — Graph-dependent control flow

- If/else, switch, merge, stop/fail, retry boundary.
- Repeat count, while, and for-each over list/table data.
- Workflow call with mapped inputs/outputs.
- Error branches and reusable sub-workflows.

Implement only after graph schema v2 defines handles, branch traversal, loop limits, and cycle validation.

## Shared node requirements

- Serializable registry definition and version.
- Expression-aware configuration where meaningful.
- Typed output contract and named output variables.
- Structured diagnostics with action, inputs, timeout/retry state, and final reason.
- Legacy compatibility or explicit migration.
- Deterministic unit tests plus one live extension acceptance scenario.
- Native-host requirement metadata: unused, optional fallback, or required,
  including named capabilities and a stable unavailable diagnostic.
- User guidance metadata: description, when-to-use guidance, usage example,
  input/output summary, and safety/failure notes for Inspector and the living
  user guide.

## Recording semantics requirement

Recorded controls must prefer user-facing identity over order or DOM position.
Select nodes resolve visible option text first, option value second, and index
only as a last fallback. Click-like nodes prefer accessible name, label, visible
text, role, and stable attributes before structural selectors or ordinal
position. Ambiguity must produce target diagnostics rather than arbitrary
selection.

## Planned data-driven nodes

- Data Source: load bounded JSON/CSV from an approved host-managed source.
- Workflow Call: run a referenced workflow with mapped inputs and outputs.
- For Each: iterate a list/table, bind row/item/index variables, call a workflow
  or bounded sub-workflow, and collect ordered outputs.

These nodes follow the contracts and implementation order in
[06_RUNTIME_AUTHORING_AND_DATA_FOLLOWUP.md](06_RUNTIME_AUTHORING_AND_DATA_FOLLOWUP.md).
