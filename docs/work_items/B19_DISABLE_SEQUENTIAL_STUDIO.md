# B19 - Disable Sequential Studio Without Deleting Source

**Status:** Complete  
**Updated:** 2026-07-25  
**Main tracker:** `../NODE_IMPLEMENTATION_STATUS.md`  
**Current resume checkpoint:** Item complete. On audit, re-run the Step 7 gates
and confirm the former URL still redirects without scripts before relying on
this evidence.

## Objective

Make Graph Studio the only supported workflow-authoring surface. Every normal
Studio launch must open Graph Studio, Graph Studio must not link to Sequential
Studio, and direct access to the former Sequential URL must fail closed into
Graph Studio. Retain the former implementation as dormant source until cleanup
item C12.

## Non-goals

- Do not delete `BRunner/studio/` or its retained implementation source.
- Do not delete legacy workflow-schema adapters or the legacy linear executor.
- Do not implement B10-B12 canonical graph preparation in this item.
- Do not change finalized node contracts, workflow semantics, or sidebar
  saved-workflow execution.
- Do not start Node 1 acceptance or Node 2.

## Affected surfaces

- `BRunner/core/studioSession.js`
- `BRunner/core/workflowUtils.js`
- `BRunner/sidebar/sidebar.js`
- `BRunner/sidebar/sidebar.html`
- `BRunner/studio-graph-src/src/GraphStudio.jsx`
- generated `BRunner/studio-graph/`
- `BRunner/studio/index.html` plus a dormant copy of its former shell
- `BRunner/manifest.json`
- focused Studio/session/runtime source tests
- main tracker, handoff, and user-facing Studio documentation

## Ordered implementation steps

| Step | Work | Focused verification | Status | Evidence |
|---|---|---|---|---|
| 1 | Confirm tracker scope, inventory every launch/navigation/session/manifest path, and register this record. | Source inventory names every active entry point and deletion non-goal. | Complete | Active paths found in sidebar, Graph command bar, Sequential index, manifest resources, Studio session, and Studio URL classification. |
| 2 | Make shared Studio identity and URL classification Graph-only while treating the former Sequential identity as a migration/control-page alias. | Session tests and workflow utility tests cover migration plus Graph/retired URL exclusion. | Complete | `node --test tests\studioSession.test.mjs tests\studioRetirement.test.mjs` passed 3/3; both changed modules passed `node --check`. |
| 3 | Make the sidebar open/focus Graph Studio exclusively and recognize both Graph and retired redirect pages as control surfaces. | Sidebar source test and JavaScript syntax check. | Complete | Sidebar syntax passed; focused retirement/runtime/bridge set passed 12/12. |
| 4 | Remove Graph Studio's Sequential switch and cross-Studio session listener, update Graph-only wording, then rebuild generated Graph assets. | Graph source/build tests and build fingerprint parity. | Complete | Graph built successfully (190 modules); focused Graph build/retirement/session set passed 11/11 with source fingerprint parity. |
| 5 | Replace the old Sequential entry page with a fail-closed Graph redirect, retain its former shell as a non-runnable source artifact, and remove Sequential assets from web-accessible resources. | Retirement/manifest tests prove no executable authoring or run entry remains. | Complete | Retirement tests passed 4/4; manifest parsed and exposes Graph assets but no `studio/` resources. |
| 6 | Retire obsolete cross-Studio/parity assertions while retaining tests for transitional runtime adapters that are still used outside the deprecated UI. | Focused Studio/session/runtime test set passes. | Complete | Obsolete supported-Sequential and parity assertions were retired; transitional adapter/dormant-source checks remain. Rebuilt Graph and focused set passed 58/58. |
| 7 | Run syntax, whitespace, full JavaScript, and full Python gates; synchronize tracker, handoff, user guide, and this record. | All automated gates pass and B19 is marked Complete with evidence. | Complete | 15 syntax checks, Graph fingerprint, 416 JavaScript tests, 181 Python tests, and `git diff --check` passed; active documentation synchronized. |

## Item completion gates

- Sidebar Studio action opens or focuses `studio-graph/index.html`.
- Graph Studio contains no Sequential Studio navigation or session-switching
  behavior.
- `studio/index.html` cannot author, save, record, or run a workflow and
  redirects users to Graph Studio.
- Former Sequential scripts/styles are not web-accessible resources.
- Retained Sequential source is clearly dormant and remains available for C12.
- Graph and retired Studio control pages are never selected as automation tabs.
- Persisted `activeStudio: "sequential"` state migrates safely to Graph.
- Graph generated assets match source.
- Focused and full automated gates pass.
- Main tracker and current handoff identify B10-B12 as the next base work.

## Recovery procedure

On resume, read the main tracker and this file first. For the step named in
**Current resume checkpoint**, inspect its affected files and run its focused
verification. Classify it as not started, partial, or complete; repair or finish
it before advancing. Do not use the presence of retained Sequential source as
evidence that the deprecated UI is still supported.

## Evidence log

- 2026-07-25: Step 1 completed. Documentation already established the Graph-only
  decision and B19 scope. Source inventory confirmed that implementation had
  not begun: sidebar, Graph command bar, former index page, manifest exposure,
  and cross-Studio session state were still active.
- 2026-07-25: Step 2 completed. Stored `activeStudio: "sequential"` now
  normalizes to Graph, and `isStudioUrl` rejects both Graph and retired Studio
  URL families as automation targets. Focused tests passed 3/3 and both modules
  passed syntax checks.
- 2026-07-25: Step 3 completed. The sidebar now opens/focuses Graph Studio,
  avoids duplicate Graph tabs, labels the supported surface explicitly, and
  hides controls on Graph or retired redirect pages. Syntax passed and the
  focused retirement/runtime/bridge set passed 12/12.
- 2026-07-25: Step 4 completed. Graph Studio no longer renders or handles a
  Sequential switch and no longer watches cross-Studio session changes.
  Graph-only display wording is in place, the 190-module production build
  completed, and the focused build/retirement/session set passed 11/11 with
  exact build fingerprint parity.
- 2026-07-25: Step 5 completed. The former entry URL is now a script-free
  fail-closed redirect to Graph Studio. Its prior shell is retained as
  `legacy-index.html.disabled`, former Sequential assets are no longer
  web-accessible, retirement tests passed 4/4, and the manifest parsed.
- 2026-07-25: Step 6 completed. Supported-UI tests now cover Graph Studio and
  sidebar only; former Sequential tests assert dormancy/isolation rather than
  parity. Legacy graph-to-linear adapters retain deterministic coverage because
  transitional runtime code still uses them. Graph was rebuilt and the focused
  58-test set passed.
- 2026-07-25: Step 7 completed. Fifteen affected JavaScript files passed syntax
  checks, Graph build fingerprint parity passed, the full JavaScript suite
  passed 416/416, the full Python suite passed 181/181, and
  `git diff --check` reported no whitespace errors. Main tracker, roadmap,
  handoff, user guide, catalogue, blueprint, instructions, and historical-spec
  direction banners now record B19 as complete. A final literal source scan
  found no active Sequential launch or Graph-switch references, and the final
  retirement/build/session set passed 12/12.
