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

- HTTP request with method, headers, body, response type, and output variable.
- Clipboard read/write through an approved browser/native path.
- File input upload, native-dialog upload, download wait, and downloaded-file metadata.
- Screenshot capture and output path/attachment metadata.

These nodes require explicit permission, secret-handling, and data-transmission design before implementation.

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
