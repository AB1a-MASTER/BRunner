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

Recorded interaction targets prioritize user perspective. Dropdown selection
stores visible option text before stable value and index fallbacks. Click-like
interactions prioritize accessible name, label, visible text, role, and stable
attributes before structural position. Both Studios consume one authoritative
recorded-step stream so an action appears exactly once in the active editor.

## Runtime state

Add messages:

- `GET_RUNTIME_STATE`
- `RUNTIME_STATE_CHANGED`

Runtime state includes recording status plus execution status: `runId`, workflow identity, `status`, current step/index, total steps, and last error/diagnostics.

Studio and sidebar query state on initialization and subscribe to changes. Workflow execution and recording are mutually exclusive; concurrent runs are rejected.

Running workflows must support cooperative cancellation from both UIs. Cancellation propagates into page-level conditional waits, prevents later steps from starting, produces `cancelled` runtime state, and remains distinct from execution failure.

## Deferred interaction visibility requirements

The canonical node registry must eventually declare execution preconditions for
nodes that depend on actual on-screen browser state. This must be capability
metadata rather than action-name checks. Candidate requirements include:

- active/foreground browser tab;
- focused browser window;
- target visible in the viewport;
- target scrolled into view and unobscured;
- pointer-capable or hardware-level interaction.

Before executing a node with these requirements, the orchestrator must activate
the correct logical tab, focus its window when needed, scroll/verify the target,
wait for stable visibility, and return distinct precondition diagnostics if the
browser cannot satisfy the requirement. Hover Mouse is the primary example:
executing it against a background tab or off-screen element must not fail merely
because the runtime did not first present the target on screen.

Background-safe nodes such as HTTP Request and pure data transforms must not force
tab activation or window focus. Screenshot, hardware pointer/keyboard, hover,
drag, and similar future nodes require an explicit capability review.

## Workflow startup policy

- A bound domain is always honored before the first step executes.
- By default, BRunner navigates the current usable tab to the bound domain; it never replaces the Studio tab.
- `settings.reuseExistingTabs` is `false` by default. When explicitly enabled, BRunner may activate an already-open matching tab instead of navigating the current tab.
- Browser New Tab pages may be navigated to the bound domain. Other restricted/internal pages cause a new target tab to be created.

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
