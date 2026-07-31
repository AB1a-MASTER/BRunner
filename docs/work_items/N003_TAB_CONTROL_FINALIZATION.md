# Node 3 - Tab Control Finalization

**Status:** Source complete - batch acceptance queued  
**Updated:** 2026-07-30  
**Main tracker:** `../NODE_IMPLEMENTATION_STATUS.md`  
**Batch program:** `P12_PHASE_1_2_BATCH_PROGRAM.md`  
**Current resume checkpoint:** Steps 1-6 are complete and Node 3 is **not
accepted**. Only Step 7 remains and it belongs to the batch program, not to this
record: the consolidated Graph Studio rebuild, complete JavaScript/Python
regression, fingerprint/integrity and whitespace gates, and the focused
unpacked-extension run of `003_tab_control_acceptance.json`. Do not reopen the
source unless one of those consolidated checks fails. If a batch check does
fail, reopen this record at the failing surface and fix it before any later node
resumes. The next source item is Node 4, Resolve Element.

## Objective

Implement catalog Node 3, `browser.tab.control@1`, as the single finalized
tab-level contract for opening, selecting, switching, returning, closing,
focusing, pinning, muting, and bookmarking through Graph Studio and the
canonical graph runtime.

## Non-goals

- Do not perform DOM automation on protected or browser-controlled pages.
- Do not preserve the three provisional tab actions as compatibility aliases.
- Do not add window management beyond what is required to focus the selected
  tab/window.
- Do not implement a general manual-control node; close confirmation is local
  to this action and must fail clearly when an interactive confirmation service
  is unavailable.

## Frozen contract decisions

- **Identity:** `browser.tab.control@1`; the finalized type is new even though
  provisional `browser.tab.switch`, `browser.tab.open`, and
  `browser.tab.close` are implementation references.
- **Operations:** `open_browser_new_tab`, `open_url_in_new_tab`, `switch_tab`,
  `switch_relative_tab`, `return_to_origin_tab`, `close_tab`, `focus_tab`,
  `pin_tab`, `unpin_tab`, `mute_tab`, `unmute_tab`, `toggle_mute`,
  `bookmark_page`, and `remove_bookmark`.
- **Selector controls:** `tabSelectorKind` is an explicit dropdown with
  `current`, `saved_reference`, `id`, `index`, `title`, `url`,
  `most_recently_opened`, `first`, and `last`. `tabMatchMode` is conditionally
  shown for title/URL and is `exact`, `contains`, or `wildcard`; wildcard uses
  the shared `*` and `?` grammar and is the blueprint's URL-pattern behavior.
  `multipleMatchBehavior` is `fail`, `first_matching`, or
  `most_recently_opened`, so first-matching is an explicit ambiguity behavior
  over the complete title/URL match set rather than an undefined selector
  domain. `tabSelectorValue` is conditionally required. Relative switching uses
  `relativeDirection` (`left`, `right`, `next`, `previous`),
  `relativeOffset`, and `wrapAround`. Origin return uses the run's immutable
  origin-tab reference.
- **Other fields:** `url`, `openInBackground`, `reuseMatchingTab`,
  `closeBehavior` (`opener`, `left`, `right`, `most_recent`, `none`),
  `ifNotFound` (`fail`, `skip`, `error_port`), `waitUntil`,
  `saveTabReferenceAs`, `confirmBeforeClose`, `bookmarkFolderMode`
  (`default_bar`, `folder_id`), conditional `bookmarkFolderId`,
  `bookmarkSelectorKind` (`current_page_url`, `bookmark_id`), conditional
  `bookmarkId`, and `removeAllBookmarkMatches`, plus the common node fields.
- **Ports:** `success` and `error`. A deliberate not-found skip completes on
  `success` with a warning and an output describing no selected tab.
- **Outputs:** `operation`, `originTab`, `tab`, `createdTab`,
  `pageCapability`, `matchedBy`, `pinned`, `muted`, and `bookmarked`. Tab
  objects use the same bounded tab-reference shape as Navigate.
- **Protected pages:** all tab API operations remain allowed where Chrome
  permits them. A browser New Tab publishes
  `pageCapability: "tab_control_only"` until a supported document loads.
- **Services/capabilities:** `browser-tab`, `side-effect`, `async`; Chrome tabs
  and windows are required. Bookmark operations use an optional `bookmarks`
  permission requested only through a visible user gesture and otherwise fail
  with a stable permission-unavailable result.
- **Recency:** `most_recently_opened` uses run-tracked tab creation sequence
  only. Chrome does not expose a reliable creation timestamp for arbitrary
  pre-existing tabs, so unavailable creation metadata follows `ifNotFound`
  rather than guessing from tab ID, array order, or last-accessed time.
- **Bookmarks:** `bookmark_page` is idempotent for the exact current URL within
  the selected folder. `remove_bookmark` selects an explicit bookmark ID or
  exact current-page URL; duplicate URL matches fail unless
  `removeAllBookmarkMatches` is checked. Runtime checks permission only. A
  visible Graph Studio control may request the optional permission from a user
  gesture.
- **Confirmation:** `confirmBeforeClose` defaults off. When on, execution must
  await an explicit user response through the interactive confirmation adapter;
  it never assumes consent or closes when that adapter is unavailable.
- **Retry:** open and switch default to one retry for a verified transient
  tab-not-ready/not-found race. Close, pin, mute, and bookmark use
  verify-before-retry and never repeat when the resulting state is uncertain.
- **Stable failures:** common `TAB_NOT_FOUND`, `TIMEOUT`, `CANCELLED`, and
  configuration errors plus namespaced tab-operation, bookmark-permission, and
  close-confirmation errors.

## Affected surfaces and expected files

- `BRunner/nodes/navigation/tab-control/` definition, validators, outputs,
  Chrome adapter, executor, and index.
- Exact-version registry and background finalized dispatch.
- Shared tab selection/reference normalization only where reusable.
- Manifest/Graph permission UI only for optional bookmarks capability.
- Provisional tab switch/open/close registry and runtime isolation.
- Focused Node 003 tests, fixture if needed, acceptance workflow, user
  catalogue, tracker, roadmap, handoff, and this record.

## Ordered implementation steps

| Step | Work | Verification | Status |
|---|---|---|---|
| 1 | Freeze identity, operations, selector controls, ports, output, permissions, protected-page behavior, retry safety, and provisional disposition. | Blueprint A3, catalog, tracker, version policy, current tab utilities, and Graph/runtime constraints agree with this record. | Complete |
| 2 | Implement the isolated package and reusable tab selector/reference adapter. | Definition/validator/output/adapter/executor unit tests cover every operation class and stable failure. | Complete - 2026-07-27: 26 focused tests pass across `tabControlNode.test.mjs` and `tabControlChromeAdapter.test.mjs`; all 14 operation classes, complete-set matching, run-only recency, bounded outputs, permission absence, confirmation, and retry verification are covered. |
| 3 | Register exact v1 and integrate canonical Graph/background execution; isolate provisional tab actions. | Graph field rendering, save/reload/preparation, exact dispatch, and unsupported-version tests pass. | Complete - 2026-07-27: 60 focused tests pass across Node 3 package/Chrome/Graph plus registry, authoring, workflow preparation, and recorder recovery. Exact v1 dispatch, generic conditional fields, optional click-to-grant bookmarks permission, immutable origin, run-only creation recency, generalized timeout text, finalized recorder switch output, and provisional type rejection are covered. |
| 4 | Add deterministic integration coverage for relative/wrap/origin switching, background open, duplicate reuse, close fallback/confirmation, pin/mute, protected New Tab, permission absence, disabled, retry, timeout, cancellation, output, and logs. | Focused runtime and Graph semantic tests pass with Navigate/Scroll regressions. | Complete - 2026-07-27: 89 focused tests pass across Node 3 package/Chrome/Graph/runtime, shared finalized runtime, and Navigate/Scroll regressions. |
| 5 | Add `003_tab_control_acceptance.json` and the complete user-catalog entry. | Schema guard and synthetic success plus safe not-found/permission alternate validate. | Complete - 2026-07-30: the canonical acceptance workflow validates against the catalog row and graph schema, and its dedicated guard "Tab Control acceptance is reversible, origin-safe, and ends with a deliberate skip" passes with the full acceptance suite at 6/6. The complete Node 3 user-catalog entry was added to `docs/NODE_USER_CATALOG.md` with purpose, requirements, operation table, every field and default, safe selection rules, Graph Studio usage, execution/retry/side-effect behavior, output shape, downstream expressions, stable failures, and the acceptance procedure; the availability table now lists `browser.tab.control@1` as Acceptance pending. Filename is `003_tab_control_acceptance.json` because `expectedNodeAcceptanceFilename` derives the slug with underscores. |
| 6 | Run focused source checks and mark Source complete - batch acceptance queued. | Node-specific tests, affected shared tests, syntax, acceptance JSON, and diff check pass. | Complete - 2026-07-30: 170 focused tests pass across the Node 3 package/Chrome/Graph/runtime suites, the shared finalized runtime, Navigate and Scroll regressions, the acceptance-schema guard, exact-version registry, node authoring, catalog, node contracts, canonical workflow preparation, and recorder recovery. All seven Node 3 sources pass `node --check`, the acceptance workflow parses as JSON, and `git diff --check` reports no whitespace errors. |
| 7 | Run consolidated build/full-suite/live acceptance and synchronize completion evidence. | Batch gate passes; tab outputs and alternate route are confirmed in the unpacked extension. | Pending |

## Completion gates

- Every operation and selector is explicit, deterministic, and ambiguity-safe.
- Saved references and origin return survive canonical Graph preparation.
- Protected pages never gain DOM capability through this node.
- Optional bookmarks and close confirmation fail clearly without permission or
  an interactive service.
- Side-effect verification prevents duplicate closes, bookmarks, pin, or mute
  changes.
- Focused workflow, user documentation, batch regression, and live evidence
  pass before the row becomes Complete.

## Recovery procedure

Read the batch program and tracker, then this file. Recheck the active step and
its focused evidence. Do not edit Resolve Element or later nodes until Node 3
is source-complete and batch-queued.
