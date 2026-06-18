# Specification 01 — Multi-Tab Recording and Runtime State

## Goal

Finish the reliability foundation by recording intentional tab transitions and exposing one authoritative recording/execution state to every UI.

## Recording session contract

Recording state contains:

```json
{
  "sessionId": "recording-id",
  "isRecording": true,
  "tabPolicy": "openerDescendants",
  "boundDomain": "example.com",
  "activeTabRef": "tab_1",
  "trackedTabs": {},
  "recordedSteps": []
}
```

Supported `tabPolicy` values:

- `openerDescendants` (default): follow the starting tab and tabs whose opener belongs to the session.
- `activeTab`: follow valid HTTP(S) tabs as the user activates them; unrelated tabs are included only in this explicit mode.

Each tracked browser tab receives a stable session-local `tabRef`. Recorded action steps include `tabRef`.

## Tab transitions

Add `browser.tab.switch`:

```json
{
  "action": "browser.tab.switch",
  "tabRef": "tab_2",
  "openerTabRef": "tab_1",
  "url": "https://example.com/result",
  "createIfMissing": true,
  "page": {}
}
```

During replay, switch waits briefly for a matching tab opened by the preceding action. If none appears and `createIfMissing` is true, create a tab at the recovery URL. Closing a child tab returns execution to its tracked opener when available.

Use `tabs.onCreated`, `onActivated`, `onUpdated`, and `onRemoved`. Deduplicate rapid redirect/update events per tab.

## Restricted pages

Classify `chrome://`, `edge://`, `about:`, `devtools://`, extension pages, and other non-HTTP(S) pages as restricted. Record tab/navigation context but never content actions. A content action targeting a restricted page fails with structured diagnostics.

Studio is always excluded from recording.

## Runtime state

Add messages:

- `GET_RUNTIME_STATE`
- `RUNTIME_STATE_CHANGED`

Runtime state includes recording status plus execution status: `runId`, workflow identity, `status`, current step/index, total steps, and last error/diagnostics.

Studio and sidebar query state on initialization and subscribe to changes. Workflow execution and recording are mutually exclusive; concurrent runs are rejected.

## Acceptance tests

1. Same-tab recording remains unchanged.
2. Descendant mode follows a popup/new tab but ignores unrelated tabs.
3. Active-tab mode records deliberate switches between unrelated HTTP(S) tabs.
4. Replay reuses a tab created by a click and does not create a duplicate.
5. Missing child tabs are recreated from the recovery URL.
6. Restricted pages never receive content messages.
7. Closing a child restores its opener context.
8. Studio/sidebar state stays synchronized through start, progress, completion, failure, and reload.
9. Stopping a sidebar recording autosaves one valid workflow.

