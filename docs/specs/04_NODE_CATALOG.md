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
  **Implemented; live acceptance pending.** Content is capped at 10 MB and kept
  out of execution logs. Arbitrary local paths and native dialogs remain deferred
  until native-access permissions are designed.
- Native-dialog upload, download wait, and downloaded-file metadata.
- Screenshot capture and output path/attachment metadata.

Remaining Phase B nodes require explicit permission, secret-handling, and
data-transmission design before implementation.

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
