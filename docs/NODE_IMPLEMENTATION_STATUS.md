# Finalized Node Program Tracker

Updated: 2026-07-22

This is the single authoritative work tracker for the finalized node program
and the implementation-status companion to
`workflow_nodes_implementation_blueprint.md`. The blueprint remains the sole
authority for node behavior, configuration, ports, outputs, tests, and
definition of done. `BRunner/nodes/catalog.js` is the matching machine-readable
inventory. `AGENTS.md` defines the repeatable working instructions and
`NODE_USER_CATALOG.md` documents only behavior accepted for end users.

Update this file in the same change that closes a base task or node. A node row
may be marked **Complete** only after its acceptance workflow, both-Studio
round-trip, user documentation, and automated/live evidence pass. Add the user
commit hash to the completion ledger after the accepted slice is committed.

## Current status

| Workstream | Status | Meaning |
|---|---|---|
| Finalized catalog inventory | **Complete** | All 94 blueprint nodes have a stable type, phase, disposition, and provisional-code reference inventory. |
| Base contract hardening | **Active** | Close versioning, ambiguity, routing, errors, canonical workflow, and both-Studio parity before accepting Node 1. |
| Finalized node implementations | **Queued** | No finalized node is production-integrated and accepted yet. Provisional behavior and isolated scaffolds do not count. |
| Phase 1 shared adapters | **Integration pending** | Adapter source/tests exist, but the ambiguity contract must be corrected and all adapters must enter the canonical runtime and both Studios. |
| Provisional removals | **Queued** | `browser.search` and `http.request` are absent from the finalized catalog and must be removed during runtime integration. |

## Status and disposition legend

- **Queued**: inventoried but not implemented to the finalized contract.
- **Blocked by base**: implementation must not start until applicable base
  contract items pass.
- **In progress**: active implementation work; not yet accepted.
- **Integration pending**: isolated source/tests exist but production and both
  Studios do not consume the contract yet.
- **Complete**: definition, editor, executor, outputs, logging, tests, and
  applicable live acceptance meet the blueprint definition of done, the user
  catalogue is current, and a node acceptance workflow exists.
- **Upgrade**: one provisional action is a useful direct implementation
  reference, but is not accepted as final.
- **Rewrite**: provisional behavior is consolidated, split, or materially
  different and must be replaced by the finalized contract.
- **Add**: no provisional action implements the finalized node.

## Base Contract and Studio Unification

Complete B01-B15 before accepting Node 1. B16-B18 are phase prerequisites and
must close before their listed phase begins.

| ID | Required work | Due | Status | Evidence / notes |
|---|---|---|---|---|
| B01 | Make catalog number the only node implementation order: Navigate, Scroll, Tab Control, then 4–94. | Before Node 1 | Complete | Blueprint, tracker, roadmap, and instructions use catalog order. |
| B02 | Dispatch node definitions and execution by `(type, version)` rather than `type` alone. | Before Node 1 | Queued | Prevent finalized/provisional contract collisions. |
| B03 | Define deterministic migration or fail-closed unsupported-version handling; never reinterpret old config silently. | Before Node 1 | Queued | Reused type IDs require special coverage. |
| B04 | Fix text matching so fail-on-multiple observes all matches before occurrence selection. | Before Node 1 | Queued | Current `occurrence: first` can hide ambiguity. |
| B05 | Support stable node-specific errors mapped to common routing/retry categories. | Before Node 1 | Queued | Translate adapter errors such as `MULTIPLE_MATCHES`. |
| B06 | Define stable machine port IDs, display labels, selected-route result, and `onError` precedence. | Before Node 1 | Queued | Shared by both Studios and runtime. |
| B07 | Rename Resolve Element cardinality from `matchMode` to `resultCardinality`. | Before Node 1 | Complete | Blueprint terminology corrected. |
| B08 | Define coordinate-only targets as explicit non-component targets; never fabricate a durable ComponentRef. | Before Node 1 | Complete | Blueprint target contract corrected. |
| B09 | Align package rules with JavaScript and shared schema-driven UI. | Before Node 1 | Complete | Separate `ui.js` only for a shared editor extension. |
| B10 | Build one finalized node registry/field renderer/validator/autocomplete source for both Studios. | Before Node 1 | Queued | No Studio-private definitions. |
| B11 | Make one canonical workflow schema support ordered, nested, and graph routes without lossy adapters. | Before Node 1 | Queued | Sequential is a simpler view, not a separate model. |
| B12 | Add Graph→Sequential→Graph and Sequential→Graph→Sequential semantic round-trip gates. | Before Node 1 | Queued | Preserve Studio layout metadata and unknown supported fields. |
| B13 | Standardize field help, valid examples, expression modes, autocomplete, and identifier/matching selectors. | Before Node 1 | Queued | Applies to every finalized definition. |
| B14 | Add schema/source validation for `Workflows/node_acceptance/NNN_<slug>_acceptance.json`. | Before Node 1 | Queued | One focused workflow per completed node. |
| B15 | Establish the living end-user catalogue and require an accepted entry per node. | Before Node 1 | Complete | `docs/NODE_USER_CATALOG.md`. |
| B16 | Define controlled file-reference schema, lifecycle, size limits, parser dependencies, and host capability matrix. | Before Phase 4 | Queued | Required for catalog 31–43 and later file outputs. |
| B17 | Define feasible Function/Code execution environments, MV3 constraints, async/cancel limits, and available APIs. | Before Phase 5 | Queued | Required for catalog 59–60. |
| B18 | Implement canonical graph traversal, scopes, multi-port routing, limits, joins, cancellation, and deadlock rules. | Before Phase 6 | Queued | Never emulate these inside the legacy linear executor. |

## Contract version policy

- New finalized stable type IDs begin at contract version `1`.
- The five finalized nodes that reuse a provisional type ID begin at version
  `2`: Navigate, Scroll, Click, Hover / Move Pointer, and Focus Element.
- Later incompatible schema, port, output, service, or execution changes bump
  the version and require migration or an unsupported-version result.
- The current Navigate version-1 package is scaffold and must move to the
  finalized version-2 contract before acceptance.

## Per-node completion checklist

For each catalog row, complete these items in one isolated slice:

- [ ] Contract definition and correct version.
- [ ] Shared field schema with help, examples, selectors, and autocomplete.
- [ ] Graph Studio and Sequential Studio editing/parity.
- [ ] Validator, executor, output builder, stable errors, logging, cancellation,
      timeout, retry/side-effect, resolver, and host behavior as applicable.
- [ ] Deterministic unit/integration/failure tests.
- [ ] Cross-Studio semantic round-trip tests.
- [ ] Focused synthetic node acceptance workflow and schema test.
- [ ] Focused live source acceptance where applicable.
- [ ] Replaced provisional paths removed or explicitly isolated.
- [ ] End-user catalogue entry completed.
- [ ] Tracker row marked Complete and completion ledger filled after user commit.

## Phase 1 shared adapters

| Adapter | Status | Required result |
|---|---|---|
| Shared target configuration | **Integration pending** | One normalized Component-ID-first target contract with ordered fallback, ambiguity handling, map refresh, explicit coordinate targets, and structured resolution output. |
| Shared text matching | **In progress** | Correct ambiguity-before-occurrence semantics, exact/contains/starts/ends/wildcard/regex behavior, case/whitespace control, and stable error mapping. |
| Standard output and logging | **Integration pending** | Stable result envelope, selected route, output binding, warnings/errors, timing, execution method, and configured local log publication. |
| Retry safety and host fallback | **Integration pending** | Central retry classification and browser-first, visible-host-last policy with verification and stable failure codes. |

## Known architecture gaps

1. `BRunner/core/constants.js` and `BRunner/core/nodeRegistry.js` still expose
   the provisional action set. This catalog does not switch runtime behavior.
2. Most execution remains centralized in `BRunner/background.js` and related
   content-script switches instead of finalized per-node definition, executor,
   validator, output, UI, and test packages.
3. The shared adapters now have isolated packages and deterministic tests but
   require contract corrections and production/both-Studio integration.
4. Graph Studio and Sequential Studio still render and serialize provisional
   definitions through different presentation paths. They must share one
   canonical workflow and node contract without lossy adapters.
5. Finalized multi-port control behavior, nested scope semantics, cancellation,
   and output schemas are not yet implemented for Phases 5-7.
6. Existing tests protect provisional runtime behavior. Every finalized node
   still needs its blueprint unit, integration, failure-path, logging, and
   focused live acceptance coverage.
7. Removing `browser.search` and `http.request` from runtime code is deferred
   until their affected registry, editor, executor, workflow, and test paths
   can be removed together.

## Full finalized node tracker

| # | Finalized node | Stable type | Phase | Disposition | Provisional action reference(s) | Status |
|---:|---|---|---:|---|---|---|
| 1 | Navigate | `browser.navigate` | 1 | Rewrite | `browser.navigate`, `browser.back`, `browser.forward`, `browser.reload` | Queued |
| 2 | Scroll | `browser.scroll` | 1 | Rewrite | `browser.scroll`, `element.scroll_into_view` | Queued |
| 3 | Tab Control | `browser.tab.control` | 1 | Rewrite | `browser.tab.switch`, `browser.tab.open`, `browser.tab.close` | Queued |
| 4 | Resolve Element | `element.resolve` | 1 | Add | — | Queued |
| 5 | Check Element State | `element.check_state` | 1 | Add | — | Queued |
| 6 | Wait for Condition | `wait.condition` | 1 | Rewrite | `wait.element.visible`, `wait.element.hidden`, `wait.element.enabled`, `wait.element.text`, `wait.url` | Queued |
| 7 | Click | `element.click` | 2 | Rewrite | `element.click`, `element.double_click` | Queued |
| 8 | Hover / Move Pointer | `element.hover` | 2 | Rewrite | `element.hover` | Queued |
| 9 | Focus Element | `element.focus` | 2 | Upgrade | `element.focus` | Queued |
| 10 | Select Text | `element.select_text` | 2 | Add | — | Queued |
| 11 | Drag and Drop | `element.drag_drop` | 2 | Add | — | Queued |
| 12 | Enter Text | `element.enter_text` | 2 | Rewrite | `element.type`, `element.clear` | Queued |
| 13 | Press Key | `keyboard.press_key` | 2 | Rewrite | `keyboard.send_keys` | Queued |
| 14 | Copy to Clipboard | `clipboard.copy` | 2 | Rewrite | `clipboard.write` | Queued |
| 15 | Paste from Clipboard | `clipboard.paste` | 2 | Rewrite | `clipboard.read` | Queued |
| 16 | Select Dropdown Option | `form.select_option` | 3 | Upgrade | `element.select` | Queued |
| 17 | Set Checkbox / Toggle | `form.set_toggle` | 3 | Rewrite | `element.toggle` | Queued |
| 18 | Select Radio Option | `form.select_radio` | 3 | Rewrite | `element.toggle` | Queued |
| 19 | Set Date / Time | `form.set_date_time` | 3 | Add | — | Queued |
| 20 | Set Slider Value | `form.set_slider` | 3 | Add | — | Queued |
| 21 | Choose Autocomplete Suggestion | `form.choose_autocomplete` | 3 | Add | — | Queued |
| 22 | Upload File | `form.upload_file` | 3 | Rewrite | `file.input.upload`, `file.local.upload` | Queued |
| 23 | Submit Form | `form.submit` | 3 | Add | — | Queued |
| 24 | Reset Form | `form.reset` | 3 | Add | — | Queued |
| 25 | Fill Form from Data | `form.fill_from_data` | 3 | Add | — | Queued |
| 26 | Open UI / Expand Section | `page.open_ui` | 3 | Add | — | Queued |
| 27 | Close Overlay / Dismiss UI | `page.dismiss_ui` | 3 | Add | — | Queued |
| 28 | Handle Browser Dialog | `browser.dialog.handle` | 3 | Add | — | Queued |
| 29 | Handle Download | `download.handle` | 3 | Rewrite | `download.wait` | Queued |
| 30 | Screen Capture | `capture.screen` | 3 | Rewrite | `screenshot.capture` | Queued |
| 31 | File Input | `file.input` | 4 | Add | — | Queued |
| 32 | Find Files | `file.find` | 4 | Upgrade | `approved.files.find` | Queued |
| 33 | Wait for File | `file.wait` | 4 | Add | — | Queued |
| 34 | Raw File Input | `file.read_raw` | 4 | Add | — | Queued |
| 35 | Text Input | `input.text` | 4 | Add | — | Queued |
| 36 | CSV / TSV / Delimited Data Input | `input.delimited` | 4 | Add | — | Queued |
| 37 | JSON Input | `input.json` | 4 | Add | — | Queued |
| 38 | XML Input | `input.xml` | 4 | Add | — | Queued |
| 39 | YAML Input | `input.yaml` | 4 | Add | — | Queued |
| 40 | Spreadsheet Input | `input.spreadsheet` | 4 | Add | — | Queued |
| 41 | Document Input | `input.document` | 4 | Add | — | Queued |
| 42 | PDF Input | `input.pdf` | 4 | Add | — | Queued |
| 43 | Image Input | `input.image` | 4 | Add | — | Queued |
| 44 | Set Variable | `data.set_variable` | 5 | Upgrade | `data.set` | Queued |
| 45 | Template Text | `data.template_text` | 5 | Upgrade | `data.template` | Queued |
| 46 | Select Data | `data.select` | 5 | Add | — | Queued |
| 47 | Transform Data | `data.transform` | 5 | Rewrite | `data.regex.match`, `data.regex.replace`, `data.date.format` | Queued |
| 48 | Convert Data Type | `data.convert_type` | 5 | Rewrite | `data.number.convert`, `data.json.parse`, `data.json.stringify` | Queued |
| 49 | Map Fields | `data.map_fields` | 5 | Add | — | Queued |
| 50 | Filter List | `data.filter_list` | 5 | Add | — | Queued |
| 51 | Sort List | `data.sort_list` | 5 | Add | — | Queued |
| 52 | Remove Duplicates | `data.remove_duplicates` | 5 | Add | — | Queued |
| 53 | Merge Data | `data.merge` | 5 | Add | — | Queued |
| 54 | Split Data | `data.split` | 5 | Add | — | Queued |
| 55 | Aggregate Data | `data.aggregate` | 5 | Add | — | Queued |
| 56 | Calculate Value | `data.calculate` | 5 | Add | — | Queued |
| 57 | Compare Values | `data.compare` | 5 | Add | — | Queued |
| 58 | Validate Data | `data.validate` | 5 | Add | — | Queued |
| 59 | Function Node | `code.function` | 5 | Add | — | Queued |
| 60 | Code Node | `code.execute` | 5 | Add | — | Queued |
| 61 | If / Else | `control.if_else` | 6 | Add | — | Queued |
| 62 | Switch | `control.switch` | 6 | Add | — | Queued |
| 63 | Loop Through List | `control.loop_list` | 6 | Add | — | Queued |
| 64 | Repeat Until | `control.repeat_until` | 6 | Add | — | Queued |
| 65 | Pagination Loop | `control.pagination` | 6 | Add | — | Queued |
| 66 | Break Loop | `control.break` | 6 | Add | — | Queued |
| 67 | Continue Loop | `control.continue` | 6 | Add | — | Queued |
| 68 | Delay | `control.delay` | 6 | Upgrade | `logic.wait` | Queued |
| 69 | Try / Catch Scope | `control.try_catch` | 6 | Add | — | Queued |
| 70 | Join Branches | `control.join` | 6 | Add | — | Queued |
| 71 | Manual Confirmation | `manual.confirmation` | 6 | Add | — | Queued |
| 72 | Manual Step Required | `manual.step_required` | 6 | Add | — | Queued |
| 73 | Stop Workflow | `control.stop` | 6 | Add | — | Queued |
| 74 | Extract Text | `extract.text` | 6 | Upgrade | `data.extract.text` | Queued |
| 75 | Extract Attribute | `extract.attribute` | 6 | Upgrade | `data.extract.attribute` | Queued |
| 76 | Extract Element Value | `extract.element_value` | 6 | Rewrite | `element.extract` | Queued |
| 77 | Extract HTML | `extract.html` | 6 | Add | — | Queued |
| 78 | Extract List / Repeating Records | `extract.list` | 6 | Rewrite | `data.extract.list` | Queued |
| 79 | Extract Table | `extract.table` | 6 | Upgrade | `data.extract.table` | Queued |
| 80 | Extract Links | `extract.links` | 6 | Add | — | Queued |
| 81 | Extract Images | `extract.images` | 6 | Add | — | Queued |
| 82 | Extract Form Data | `extract.form` | 6 | Add | — | Queued |
| 83 | Extract Page Information | `extract.page_info` | 6 | Upgrade | `data.extract.page` | Queued |
| 84 | Extract Structured Page Data | `extract.structured_page` | 6 | Add | — | Queued |
| 85 | Extract Visible Messages | `extract.visible_messages` | 6 | Add | — | Queued |
| 86 | Get Element Count | `extract.element_count` | 6 | Add | — | Queued |
| 87 | Read Selected Text | `extract.selected_text` | 6 | Add | — | Queued |
| 88 | Save Data | `output.save_data` | 7 | Add | — | Queued |
| 89 | Export Data | `output.export_data` | 7 | Rewrite | `approved.file.write`, `data.file.export` | Queued |
| 90 | Show Notification | `output.notification` | 7 | Add | — | Queued |
| 91 | Show Workflow Message | `output.workflow_message` | 7 | Add | — | Queued |
| 92 | Generate Summary | `output.summary` | 7 | Add | — | Queued |
| 93 | Log Message | `output.log` | 7 | Add | — | Queued |
| 94 | Create Run Report | `output.run_report` | 7 | Add | — | Queued |

## Provisional types absent from the finalized catalog

| Provisional type | Required disposition | Reason |
|---|---|---|
| `browser.search` | Remove | Search is composed from Navigate, Enter Text, Press Key, Wait for Condition, and extraction nodes; it is not a finalized standalone node. |
| `http.request` | Remove | The finalized 94-node catalog does not include a network-request node. Adding one requires an explicit catalog amendment. |

`approved.file.write` is not removed: it is an implementation reference for
finalized **Export Data**, together with `data.file.export`.

## Program acceptance and closeout

These gates follow the individual node rows. They do not permit skipping a
node-specific acceptance workflow.

| ID | Required work | Status | Evidence / notes |
|---|---|---|---|
| C01 | Cross-node Workflow A: Search and extract. | Queued | Blueprint Section 11. |
| C02 | Cross-node Workflow B: Login-form data with browser-first host fallback. | Queued | Use synthetic credentials only. |
| C03 | Cross-node Workflow C: Approved-directory upload/download and spreadsheet input. | Queued | Requires B16 and Phase 4. |
| C04 | Cross-node Workflow D: Paginated extraction and export. | Queued | Requires B18 and Phases 6-7. |
| C05 | Cross-node Workflow E: Asynchronous custom processing. | Queued | Requires B17-B18 and Phases 5-6. |
| C06 | Cross-node Workflow F: Manual user gate and run report. | Queued | Requires B18 and Phases 6-7. |
| C07 | Remove `browser.search` and `http.request` from registry, editor, executor, workflows, and tests. | Queued | Remove affected paths together after replacement coverage exists. |
| C08 | Confirm all 94 rows and completed-node ledger entries meet the per-node gate. | Queued | No provisional scaffold counts as completion. |
| C09 | Pass full JavaScript/Python suites and current Graph Studio build parity. | Queued | Run after the final integrated source slice. |
| C10 | Synchronize README, roadmap, handoff, user guide, user catalogue, and affected specifications. | Queued | No conflicting current instructions. |
| C11 | Complete integrated V1 source acceptance with synthetic data. | Queued | Source and unpacked extension; release artifacts are not evidence. |

## Next acceptance boundary

Close base-contract items B02-B06 and B10-B14, then correct and integrate the
four shared Phase 1 adapters. Implement nodes in catalog-number order:
Navigate, Scroll, Tab Control, Resolve Element, Check Element State, and Wait
for Condition. Phase 1 closes only when the blueprint gate workflow navigates,
scrolls, selects a tab, resolves a Component-ID-first target with deterministic
fallback, checks state, and waits reliably in both Studios.

## Completed-node ledger

Add one row only after the full per-node completion checklist passes. The Git
commit is created by the user after reviewing the completed slice.

| # | Node | Final contract | Acceptance workflow | Automated evidence | Live evidence | Commit |
|---:|---|---|---|---|---|---|
| — | No finalized nodes accepted yet | — | — | — | — | — |
