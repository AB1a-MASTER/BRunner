# Finalized Node Implementation Status

Updated: 2026-07-20

This is the authoritative implementation-status companion to
`workflow_nodes_implementation_blueprint.md`. The blueprint remains the sole
authority for node behavior, configuration, ports, outputs, tests, and
definition of done. `BRunner/nodes/catalog.js` is the matching machine-readable
inventory.

## Current status

| Workstream | Status | Meaning |
|---|---|---|
| Finalized catalog inventory | **Complete** | All 94 blueprint nodes have a stable type, phase, disposition, and provisional-code reference inventory. |
| Finalized node implementations | **Queued** | No row is complete merely because provisional behavior exists. Each node still has to pass the blueprint definition of done. |
| Phase 1 shared adapters | **In progress** | Shared target, text matching, output/logging, and retry/host-fallback contracts are the active implementation slice. |
| Provisional removals | **Queued** | `browser.search` and `http.request` are absent from the finalized catalog and must be removed during runtime integration. |

## Status and disposition legend

- **Queued**: inventoried but not implemented to the finalized contract.
- **In progress**: active implementation work; not yet accepted.
- **Complete**: definition, editor, executor, outputs, logging, tests, and
  applicable live acceptance meet the blueprint definition of done.
- **Upgrade**: one provisional action is a useful direct implementation
  reference, but is not accepted as final.
- **Rewrite**: provisional behavior is consolidated, split, or materially
  different and must be replaced by the finalized contract.
- **Add**: no provisional action implements the finalized node.

## Phase 1 shared adapters

| Adapter | Status | Required result |
|---|---|---|
| Shared target configuration | **In progress** | One normalized Component-ID-first target contract with ordered fallback, ambiguity handling, map refresh, and structured resolution output. |
| Shared text matching | **In progress** | One exact/contains/starts/ends/wildcard/regex matcher with explicit case, normalization, and no/multiple-match behavior. |
| Standard output and logging | **In progress** | Stable result envelope, output binding, warnings/errors, timing, execution method, and configured local log publication. |
| Retry safety and host fallback | **In progress** | Central retry classification and browser-first, visible-host-last policy with verification and stable failure codes. |

## Known architecture gaps

1. `BRunner/core/constants.js` and `BRunner/core/nodeRegistry.js` still expose
   the provisional action set. This catalog does not switch runtime behavior.
2. Most execution remains centralized in `BRunner/background.js` and related
   content-script switches instead of finalized per-node definition, executor,
   validator, output, UI, and test packages.
3. The four shared Phase 1 adapters are fragmented across existing resolver,
   execution-log, native-host, and action-specific code and do not yet expose
   the finalized common contracts.
4. Graph Studio and sequential Studio still render and serialize provisional
   definitions. Stable finalized IDs must be integrated one accepted slice at a
   time.
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

## Next acceptance boundary

Complete and test the four shared Phase 1 adapters, then implement Navigate, Tab
Control, Scroll, Resolve Element, Check Element State, and Wait for Condition.
Phase 1 closes only when the blueprint gate workflow navigates, selects a tab,
resolves a Component-ID-first target with deterministic fallback, checks state,
and waits reliably.
