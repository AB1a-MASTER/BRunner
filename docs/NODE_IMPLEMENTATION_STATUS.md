# Finalized Node Program Tracker

Updated: 2026-07-25

This is the single authoritative work tracker for the finalized node program
and the implementation-status companion to
`workflow_nodes_implementation_blueprint.md`. The blueprint remains the sole
authority for node behavior, configuration, ports, outputs, tests, and
definition of done. `BRunner/nodes/catalog.js` is the matching machine-readable
inventory. `AGENTS.md` defines the repeatable working instructions and
`NODE_USER_CATALOG.md` documents only behavior accepted for end users.

Update this file in the same change that closes a base task or node. A node row
may be marked **Complete** only after its acceptance workflow,
Graph-editor/save/runtime round-trip, user documentation, and automated/live
evidence pass. Add the user commit hash to the completion ledger after the
accepted slice is committed.

## Current status

| Workstream | Status | Meaning |
|---|---|---|
| Finalized catalog inventory | **Complete** | All 94 blueprint nodes have a stable type, phase, disposition, and provisional-code reference inventory. |
| Base contract hardening | **Complete** | B01-B15 and B19 are closed for Node 1; phase-specific B16-B18 remain due only before their listed phases. |
| Sequential Studio retirement | **Complete; source dormant** | B19 evidence is recorded in [`work_items/B19_DISABLE_SEQUENTIAL_STUDIO.md`](work_items/B19_DISABLE_SEQUENTIAL_STUDIO.md). Every normal launch opens Graph Studio, the former URL is fail-closed, and physical source removal remains C12. |
| Finalized node implementations | **Node 1 accepted; commit pending** | Navigate v2 passed its complete automated and unpacked-extension acceptance gates. The user-controlled commit hash is the only remaining Node 1 closeout item. |
| Phase 1 shared adapters | **Navigate integrated** | Standard runtime/output/logging/retry plus the Chrome tab adapter are production-integrated for Navigate only; later nodes remain pending. |
| Provisional removals | **Queued** | `browser.search` and `http.request` are absent from the finalized catalog and must be removed during runtime integration. |

Base closeout verification on 2026-07-25: Graph Studio production build passed
from source (191 modules), all 441 JavaScript tests passed, all 181 Python tests
passed, ten affected JavaScript sources passed syntax checks, the production
build fingerprint matched, and `git diff --check` reported no whitespace
errors. This closes the Node 1 base gate; it does not replace Navigate's
focused live acceptance.

## Status and disposition legend

- **Queued**: inventoried but not implemented to the finalized contract.
- **Blocked by base**: implementation must not start until applicable base
  contract items pass.
- **In progress**: active implementation work; not yet accepted.
- **Integration pending**: isolated source/tests exist but Graph Studio and the
  production runtime do not yet consume the same contract.
- **Complete**: definition, editor, executor, outputs, logging, tests, and
  applicable live acceptance meet the blueprint definition of done, the user
  catalogue is current, and a node acceptance workflow exists.
- **Upgrade**: one provisional action is a useful direct implementation
  reference, but is not accepted as final.
- **Rewrite**: provisional behavior is consolidated, split, or materially
  different and must be replaced by the finalized contract.
- **Add**: no provisional action implements the finalized node.

## Base Contract and Graph Studio Consolidation

Complete B01-B15 and B19 before accepting Node 1. B16-B18 are phase
prerequisites and must close before their listed phase begins.

| ID | Required work | Due | Status | Evidence / notes |
|---|---|---|---|---|
| B01 | Make catalog number the only node implementation order: Navigate, Scroll, Tab Control, then 4–94. | Before Node 1 | Complete | Blueprint, tracker, roadmap, and instructions use catalog order. |
| B02 | Dispatch node definitions and execution by `(type, version)` rather than `type` alone. | Before Node 1 | Complete | Immutable exact-contract registry, Studio definition maps, background dispatch, and finalized runtime reject missing/mismatched versions. |
| B03 | Define deterministic migration or fail-closed unsupported-version handling; never reinterpret old config silently. | Before Node 1 | Complete | Legacy missing versions migrate only to v1; all other migrations require an explicit reviewed entry, and unsupported Graph contracts are read-only/unsavable. |
| B04 | Fix text matching so fail-on-multiple observes all matches before occurrence selection. | Before Node 1 | Complete | Ambiguity policy evaluates the complete candidate set before occurrence selection; adapter errors translate to `AMBIGUOUS_TARGET`. |
| B05 | Support stable node-specific errors mapped to common routing/retry categories. | Before Node 1 | Complete | Namespaced errors, common categories, normalized results, and category-aware retry policy have deterministic coverage. |
| B06 | Define stable machine port IDs, display labels, selected-route result, and `onError` precedence. | Before Node 1 | Complete | Definitions serialize labeled typed ports; Graph handles consume them; runtime returns `selectedRoute` and fails closed when an error port is absent. |
| B07 | Rename Resolve Element cardinality from `matchMode` to `resultCardinality`. | Before Node 1 | Complete | Blueprint terminology corrected. |
| B08 | Define coordinate-only targets as explicit non-component targets; never fabricate a durable ComponentRef. | Before Node 1 | Complete | Blueprint target contract corrected. |
| B09 | Align package rules with JavaScript and shared schema-driven UI. | Before Node 1 | Complete | Separate `ui.js` only for a shared editor extension. |
| B10 | Consolidate one finalized node registry, Graph field renderer, validator, value coercion, and reachability-aware autocomplete path. | Before Node 1 | Complete | [`work_items/B10_GRAPH_AUTHORING_SEMANTICS.md`](work_items/B10_GRAPH_AUTHORING_SEMANTICS.md): exact registry-backed preparation now governs Graph create/edit/load/save and finalized runtime input; autocomplete is reachability-aware. Focused passed 87/87, Graph gates 7/7, JavaScript 425/425, Python 181/181, syntax and whitespace passed. |
| B11 | Make canonical mapper-graph v3 the only finalized workflow preparation and runtime path. | Before Node 1 | Complete | [`work_items/B11_CANONICAL_WORKFLOW_PREPARATION.md`](work_items/B11_CANONICAL_WORKFLOW_PREPARATION.md): all Graph/finalized runs prepare as canonical v3 before side effects, including preserved Navigate error-to-attention routing; Graph rebuilt, JavaScript passed 436/436, Python 181/181, syntax/fingerprint/whitespace gates passed. |
| B12 | Add Graph editor→save→reload→execution-plan semantic round-trip gates. | Before Node 1 | Complete | [`work_items/B12_GRAPH_RUNTIME_ROUND_TRIP.md`](work_items/B12_GRAPH_RUNTIME_ROUND_TRIP.md): canonical Graph/save/reload/background-plan parity and the checked-in Navigate route pass 60/60 focused checks; Graph rebuilt from 191 modules, JavaScript passed 441/441, Python 181/181, and syntax/fingerprint/whitespace gates passed. |
| B13 | Standardize field help, valid examples, expression modes, autocomplete, and identifier/matching selectors. | Before Node 1 | Complete | Shared metadata guarantees help, valid examples/placeholders, expression modes, autocomplete sources, checkboxes/dropdowns, and explicit target/matching controls. |
| B14 | Add schema/source validation for `Workflows/node_acceptance/NNN_<slug>_acceptance.json`. | Before Node 1 | Complete | Directory scanner binds filename/order/type/version to the catalog, validates canonical graph and synthetic metadata, and verifies referenced fixtures exist. |
| B15 | Establish the living end-user catalogue and require an accepted entry per node. | Before Node 1 | Complete | `docs/NODE_USER_CATALOG.md`. |
| B16 | Define controlled file-reference schema, lifecycle, size limits, parser dependencies, and host capability matrix. | Before Phase 4 | Queued | Required for catalog 31–43 and later file outputs. |
| B17 | Define feasible Function/Code execution environments, MV3 constraints, async/cancel limits, and available APIs. | Before Phase 5 | Queued | Required for catalog 59–60. |
| B18 | Implement canonical graph traversal, scopes, multi-port routing, limits, joins, cancellation, and deadlock rules. | Before Phase 6 | Queued | Never emulate these inside the legacy linear executor. |
| B19 | Disable Sequential Studio entry points and authoring/run access without deleting its source. | Before Node 1 | Complete | [`work_items/B19_DISABLE_SEQUENTIAL_STUDIO.md`](work_items/B19_DISABLE_SEQUENTIAL_STUDIO.md): sidebar and former URL route to Graph; Graph has no switch/session listener; former scripts/styles are not web-accessible; source is dormant for C12. Graph build fingerprint passed, 15 syntax checks passed, JavaScript passed 416/416, Python passed 181/181, and `git diff --check` reported no errors. |

## Contract version policy

- New finalized stable type IDs begin at contract version `1`.
- The five finalized nodes that reuse a provisional type ID begin at version
  `2`: Navigate, Scroll, Click, Hover / Move Pointer, and Focus Element.
- Later incompatible schema, port, output, service, or execution changes bump
  the version and require migration or an unsupported-version result.
- Navigate v2 is the finalized source candidate. Provisional
  `browser.navigate@1` remains exact-version isolated with no silent migration;
  the v2 candidate is not accepted until its unpacked-extension run passes.

## Per-node completion checklist

For each catalog row, complete these items in one isolated slice:

- [ ] Contract definition and correct version.
- [ ] Shared field schema with help, examples, selectors, and autocomplete.
- [ ] Graph Studio authoring and canonical save/reload/runtime parity.
- [ ] Validator, executor, output builder, stable errors, logging, cancellation,
      timeout, retry/side-effect, resolver, and host behavior as applicable.
- [ ] Deterministic unit/integration/failure tests.
- [ ] Graph editor/save/reload/execution-plan semantic round-trip tests.
- [ ] Focused synthetic node acceptance workflow and schema test.
- [ ] Focused live source acceptance where applicable.
- [ ] Replaced provisional paths removed or explicitly isolated.
- [ ] End-user catalogue entry completed.
- [ ] Tracker row marked Complete and completion ledger filled after user commit.

## Phase 1 shared adapters

| Adapter | Status | Required result |
|---|---|---|
| Shared target configuration | **Integration pending** | One normalized Component-ID-first target contract with ordered fallback, ambiguity handling, map refresh, explicit coordinate targets, and structured resolution output. |
| Shared text matching | **Integration pending** | Ambiguity-before-occurrence, matching modes, case/whitespace control, and stable error mapping are complete; finalized node packages must adopt the adapter. |
| Standard output and logging | **Navigate integrated** | Navigate publishes the stable envelope, aliases, Workflow Clipboard values, selected routes, timing, warnings/errors, and standard local log events. |
| Retry safety and host fallback | **Navigate integrated** | Navigate uses verify-before-retry with stable navigation categories and no host fallback; later node policies remain pending. |

## Known architecture gaps

1. `BRunner/core/constants.js` and the version-aware registry still expose the
   provisional action set. Finalized definitions replace or isolate those
   entries only in their catalog-numbered node slices.
2. Apart from Navigate v2, most execution remains centralized in
   `BRunner/background.js` and related content-script switches instead of
   finalized per-node definition, executor, validator, output, UI, and test
   packages.
3. Shared adapter contracts and deterministic tests are ready; Navigate now
   uses them in production and remaining integration proceeds per node.
4. The two-Studio audit disproved full authoring parity. Graph Studio is now the
   sole supported editor, but B10-B12 must still consolidate its value coercion,
   higher-level validation, reachability-aware autocomplete, canonical entry
   and routes, saved JSON, and background execution preparation.
5. Finalized multi-port control behavior, nested scope semantics, cancellation,
   and output schemas are not yet implemented for Phases 5-7.
6. Existing tests protect provisional runtime behavior. Navigate v2 has its
   blueprint automated and canonical Graph round-trip coverage plus live
   fixture proof, but still needs the freshly rebuilt unpacked-extension
   workflow run; Nodes 2-94 need their full coverage.
7. Removing `browser.search` and `http.request` from runtime code is deferred
   until their affected registry, editor, executor, workflow, and test paths
   can be removed together.
8. Sequential Studio is disabled but retained as dormant source. B19 blocks
   authoring/run access and routes users to Graph; C12 removes its code only
   after integrated V1 acceptance.

## Node 1 — Navigate acceptance evidence

Power-loss-safe ordered work and the current live checkpoint are recorded in
[`work_items/N001_NAVIGATE_FINALIZATION.md`](work_items/N001_NAVIGATE_FINALIZATION.md).

Current source verification on 2026-07-27: all 445 JavaScript tests and all
183 Python tests passed; the cache-safe fixture server and focused
Navigate/workflow checks passed 21/21; Graph Studio remains the verified
191-module build; the new Python sources passed syntax checks; the production
fingerprint remains covered by the full suite; and the affected
`git diff --check` reported no whitespace errors. The live success run
returned the expected title, heading, marker, ready state, completed node, and
populated runtime namespace summaries. Its unavailable-fixture attempts exposed
and drove repairs for Chromium's internal network-error document and browser
cache reuse. The canonical workflow now uses a fresh stable URL served with a
strict no-store policy. The cache-safe success rerun passed. The verified
fixture server was then stopped, and the user confirmed the same workflow
failed Navigate and followed the red route to Needs Attention as intended.

The later two-Studio audit found that those passing tests did not exercise the
real acceptance workflow through both payload builders: Sequential conversion
discarded its explicit error route while Graph preserved it. Sequential Studio
is now deprecated instead of being repaired. Existing cross-Studio evidence is
retired and does not satisfy the replacement B10-B12 Graph-only gates.

- [x] Frozen `browser.navigate@2` definition, typed ports, capabilities,
      services, host policy, protected-page policies, and output schema.
- [x] Shared field schema with defaults, help, valid examples, selectors,
      advanced controls, expression modes, and applicable autocomplete.
- [x] Strict validator, output builder, stable namespaced errors, Chrome tabs
      adapter, cancellation, bounded readiness, logging, error routing,
      output aliases, Workflow Clipboard, and verify-before-retry behavior.
- [x] Provisional `browser.navigate@1` remains exact-version isolated; v1 is
      never migrated or dispatched as v2.
- [x] Studio startup permits a tabless entry only for enabled
      `browser.navigate@2` `goto_url` with current source and `new_tab`;
      current-tab and history operations still fail closed without a target.
- [x] Graph Studio renders the complete shared v2 configuration.
- [x] Graph editor/save/reload/execution-plan round trips preserve v2
      configuration and value types, routes, entry, positions, metadata, and
      node data through the canonical background preparation path.
- [x] Focused deterministic unit/integration/failure/source tests pass.
- [x] Acceptance workflow schema passes for
      `001_navigate_acceptance.json` and its repository fixture; the workflow
      opens a new destination tab so Studio execution exercises tabless startup.
- [x] Companion workflow discovery and extension load/save references preserve
      the nested `node_acceptance/001_navigate_acceptance.json` path when the
      persisted recursive-discovery toggle is enabled, retain top-level-only
      behavior when disabled, and reject absolute and traversal paths.
- [x] The fixture was served from the source checkout and verified live in
      Chrome at `127.0.0.1:8765` (title, heading, marker, and ready state).
- [x] End-user catalogue entry covers requirements, every field, examples,
      Graph Studio usage, readiness/retry behavior, outputs, and
      troubleshooting.
- [x] Load `BRunner/` unpacked and run the focused workflow from Graph Studio;
      verify the six output keys, saved tab reference, and bounded error route.
- [x] Mark the live acceptance result Accepted only after that live run.
- [ ] Add the user commit hash, mark Node 1 Complete, and only then begin
      Node 2.

## Full finalized node tracker

| # | Finalized node | Stable type | Phase | Disposition | Provisional action reference(s) | Status |
|---:|---|---|---:|---|---|---|
| 1 | Navigate | `browser.navigate` | 1 | Rewrite | `browser.navigate`, `browser.back`, `browser.forward`, `browser.reload` | Accepted — user commit pending |
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
| C12 | Run pre-V2 cleanup and physically remove the dormant Sequential Studio. | Queued | Only after C11: remove `BRunner/studio/`, Sequential-only tests/session/navigation/manifest/docs paths, and dead adapters after proving supported Graph/sidebar/runtime paths remain intact. |

## Next acceptance boundary

B10-B12 and B19 are complete; dormant Sequential Studio source remains deferred
to C12. **Node 1: Navigate** passed its full source and live acceptance gate.
The immediate boundary is its user-controlled quick commit and ledger hash.
After the hash is recorded and Navigate is marked Complete, create the Node 2
work record and begin **Scroll**. Phase 1 closes only after Nodes 1-6 and the
combined blueprint workflow succeed through Graph Studio and the canonical
graph runtime.

## Completed-node ledger

Add one row only after the full per-node completion checklist passes. The Git
commit is created by the user after reviewing the completed slice.

| # | Node | Final contract | Acceptance workflow | Automated evidence | Live evidence | Commit |
|---:|---|---|---|---|---|---|
| 1 | Navigate | `browser.navigate@2` | `node_acceptance/001_navigate_acceptance.json` | JavaScript 445/445; Python 183/183; cache-safe focused checks 21/21; verified 191-module Graph build | Cache-safe success and stopped-server red error route passed 2026-07-27 | Pending user commit |
