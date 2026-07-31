# Phase 1-2 Node Batch Program

**Status:** In progress - Step 3  
**Updated:** 2026-07-27  
**Main tracker:** `../NODE_IMPLEMENTATION_STATUS.md`  
**Current resume checkpoint:** Steps 1-2 are complete. Step 3 is active with
Nodes 3 and 4 closed and no node source item currently active. Nodes 2, 3, and 4
are batch-queued and unaccepted. The next source item is Node 5, Check Element
State: read `N005_CHECK_ELEMENT_STATE_FINALIZATION.md`, and note that it needs
the generic repeatable structured-check editor in
`BRunner/shared/nodeAuthoring.js` plus a Graph Studio rebuild, which Nodes 3 and
4 did not require. Finish Node 5's focused source gate before assigning Node 6.

## Deferred batch checks owed by queued nodes

Every node below is source-complete and explicitly **not accepted**. These are
the exact checks Steps 6-7 must run before any of them may become Complete.

| Node | Deferred checks |
|---|---|
| 2 - Scroll `browser.scroll@2` | Consolidated full JavaScript/Python suites, Graph Studio rebuild with fingerprint/integrity, whitespace gate, and the focused unpacked-extension run of `002_scroll_acceptance.json` covering bounded container scrolling to verified scroll end plus the wrong-page/removed-target safe route. |
| 3 - Tab Control `browser.tab.control@1` | The same consolidated suites/build/gates plus the focused unpacked-extension run of `003_tab_control_acceptance.json` covering background open, saved-reference switch, reversible pin/mute, close to opener, explicit origin return, and the deliberate not-found skip whose output is `tab: null` with a `TAB_NOT_FOUND` warning. Bookmark permission absence stays covered by deterministic tests because a live probe would create persistent browser data. |
| 4 - Resolve Element `element.resolve@1` | The same consolidated suites/build/gates plus the focused unpacked-extension run of `004_resolve_element_acceptance.json` covering the single-match visible table, the four-row bounded enumeration with `matchCount` 4, an unchanged page afterward, and the `#absent-element` node taking the `unresolved` route to Needs Attention. |

## Objective

Finish the remaining Phase 1 and Phase 2 finalized node source in catalog order
while consolidating repetitive full-suite, Graph-build, and unpacked-extension
acceptance work into one explicit batch. Prepare all remaining node
documentation before delegation, use focused automated verification for each
source slice, then run one complete regression/build gate and the focused live
workflows as a batch before accepting any batch-queued node.

The bounded source scope is:

| # | Node | Final contract | Phase |
|---:|---|---|---:|
| 3 | Tab Control | `browser.tab.control@1` | 1 |
| 4 | Resolve Element | `element.resolve@1` | 1 |
| 5 | Check Element State | `element.check_state@1` | 1 |
| 6 | Wait for Condition | `wait.condition@1` | 1 |
| 7 | Click | `element.click@2` | 2 |
| 8 | Hover / Move Pointer | `element.hover@2` | 2 |
| 9 | Focus Element | `element.focus@2` | 2 |
| 10 | Select Text | `element.select_text@1` | 2 |
| 11 | Drag and Drop | `element.drag_drop@1` | 2 |
| 12 | Enter Text | `element.enter_text@1` | 2 |
| 13 | Press Key | `keyboard.press_key@1` | 2 |
| 14 | Copy to Clipboard | `clipboard.copy@1` | 2 |
| 15 | Paste from Clipboard | `clipboard.paste@1` | 2 |

Scroll's source-complete `browser.scroll@2` live gate is also included in the
batch. Navigate remains accepted and is a regression dependency, not a
reopened implementation item.

## Explicit non-goals

- Do not implement Node 16 or any Phase 3-7 node.
- Do not implement Loop Through List, extraction, export, or other later
  catalog behavior merely to shorten the requested fruit workflow.
- Do not preserve provisional configuration or execution semantics as a
  compatibility contract.
- Do not repair or expose Sequential Studio.
- Do not begin release packaging, V2 saved-map work, or final cleanup.
- Do not call an external Google/Wikipedia run deterministic acceptance
  evidence; network, consent, anti-bot, and third-party DOM changes make it a
  manual live smoke workflow only.
- Do not mark a batch-queued node Complete before focused live evidence and the
  consolidated full-suite/build gate pass.

## Authority and constraints confirmed

- `README.md` keeps the local Windows/Chrome, Graph-only, canonical
  mapper-graph, and synthetic-data boundary.
- `docs/BRUNNER_MASTER_ROADMAP.md` keeps Milestone 2 active and release/V2
  deferred.
- `workflow_nodes_implementation_blueprint.md` Sections 1-11 define the catalog,
  exact version rule, shared target/text/output/retry/host behavior, node
  cards, test matrix, and cross-node acceptance.
- `docs/NODE_IMPLEMENTATION_STATUS.md` confirms Nodes 3-15 are the remaining
  Phase 1-2 catalog rows and identifies their provisional references.
- `BRunner/nodes/catalog.js` agrees that only Click, Hover, and Focus among
  Nodes 3-15 reuse a stable provisional type and therefore start at version 2.
  All other remaining Phase 1-2 finalized types start at version 1.
- Existing Navigate and Scroll packages are the implementation pattern. Shared
  target, text matching, result/logging, retry/host policy, exact-version
  registry, canonical preparation, and Graph round-trip foundations already
  exist.
- Graph Studio currently supports one shared target editor and scalar/value
  fields. Check Element State needs a repeatable structured-check editor, and
  Drag and Drop needs named source/destination target slots. Those extensions
  must stay generic, canonical, validated, and round-trip tested rather than
  becoming private node conversions.
- Chrome automation cannot control the `chrome-extension://` Graph Studio page
  under the browser security policy. The final unpacked-extension batch
  therefore remains a user-run manual gate with repository-authored exact
  steps and expected evidence.

## Batch execution policy

1. Documentation for all Nodes 3-15 is frozen and cross-checked before any
   agent receives an implementation task.
2. Source implementation remains strictly catalog ordered. Only one node
   source record and one implementation step may be active at a time.
3. A delegated builder receives only the already-frozen node record and the
   applicable shared surfaces. It must not broaden the contract or start the
   next node.
4. The primary agent reviews every diff against the blueprint, record, exact
   version, provisional isolation, safety boundary, and existing user work.
5. Each node must pass its focused definition/validator/executor/adapter,
   failure/disabled/retry/timeout/logging/output, Graph semantic round-trip,
   and acceptance-schema tests before it can be labelled
   **Source complete - batch acceptance queued**.
6. Repetitive complete JavaScript/Python suites, the final Graph Studio
   production build, build fingerprint/integrity, syntax sweep, whitespace
   gate, and unpacked-extension live workflows run after Node 15.
7. A batch-queued node remains incomplete. Any consolidated regression or live
   failure reopens the owning node record and is fixed in catalog order before
   acceptance resumes.

## Shared design work that must remain canonical

- Add repeatable structured field rendering/validation only where the
  `checks[]` contract requires it; retain dropdowns for check kind, comparison,
  and behavior rather than asking users to guess JSON tokens.
- Add named target slots for multi-target nodes so Drag and Drop stores source
  and destination through the same shared target schema, mapper resolver, Graph
  save/reload, and runtime preparation. Do not introduce a second resolver.
- Reuse shared condition, verification, text-matching, tab-selector, clipboard,
  host-fallback, and output/logging helpers across the node packages when the
  contracts genuinely match.
- Keep physical mouse/keyboard input opt-in, visible, foreground-verified,
  browser-first, and last-resort. Never retry an uncertain side effect.
- Keep protected pages tab-control-only; DOM interaction nodes must fail, skip,
  ask, or wait only according to their frozen policy.
- Keep exact `(type, version)` dispatch and provisional handlers isolated until
  the owning finalized slice proves replacement coverage.

## Combined live workflow design

The requested Google/Wikipedia workflow will be checked in after Nodes 3-15 are
source-complete. Because Loop Through List is catalog Node 63 and outside this
batch, the workflow will statically unroll the same sequence for `apple`,
`mango`, and `orange`:

```text
Navigate Google
-> Wait for page readiness
-> Enter Text fruit
-> Press Key Enter
-> Wait for results
-> Click the matching Wikipedia result in a new tab
-> Tab Control switch to the new tab
-> Wait for Wikipedia readiness
-> Select Text for the first non-empty article paragraph
-> Copy to Clipboard under a fruit-specific Workflow Clipboard entry
-> Scroll to bottom
-> Tab Control close and return to the Google origin tab
```

The sequence repeats three times. A repository-owned synthetic cross-node
fixture/workflow will provide deterministic acceptance for the same interaction
classes. The external Google/Wikipedia workflow remains a manual live smoke
file and may stop honestly for consent, CAPTCHA, unavailable network, or a
changed unresolvable target.

## Affected surfaces

- `BRunner/nodes/navigation/`, `targeting/`, `interaction/`, `keyboard/`, and
  `clipboard/` finalized packages for Nodes 3-15.
- `BRunner/core/nodeRegistry.js`, exact-version background dispatch, content
  runtime handlers, and only the shared adapters required by the frozen cards.
- `BRunner/shared/nodeAuthoring.js` and
  `BRunner/studio-graph-src/` for canonical structured fields or target slots.
- Provisional registry/background/content paths referenced by each tracker row,
  isolated or removed only in the owning node slice.
- Focused JavaScript tests, repository fixtures, and
  `BRunner_Host/Workflows/node_acceptance/003_...` through `015_...`.
- One deterministic Phase 1-2 cross-node workflow plus the requested external
  Google/Wikipedia smoke workflow.
- `docs/NODE_USER_CATALOG.md`, `docs/NODE_IMPLEMENTATION_STATUS.md`,
  `docs/BRUNNER_MASTER_ROADMAP.md`, `latest handoff document.txt`, and the
  individual node recovery records.

## Ordered program steps

| Step | Work | Verification | Status | Evidence |
|---|---|---|---|---|
| 1 | Audit authority, current Scroll checkpoint, versions, provisional references, shared adapters, Graph field/target limitations, runtime dispatch, and test boundary. | README, roadmap, blueprint shared sections/cards/test matrix, tracker, catalog, current packages, registry, authoring renderer, runtime, background/content handlers, and relevant tests agree on scope and constraints. | Complete | Audit completed 2026-07-27. Exact contracts are listed above; structured-check and multi-target editor gaps were identified; browser security prevents automated Graph Studio clicks; user explicitly approved deferred batch live acceptance. |
| 2 | Freeze and cross-check the contract and recovery record for every remaining Phase 1-2 node. | Records N003-N015 contain objective/non-goals, exact identity, fields, ports, outputs, services, retry/host/protected-page behavior, provisional disposition, ordered steps, focused tests, acceptance workflow, and batch gate; tracker links and statuses agree. | Complete | All 13 records exist with frozen Step 1 and queued source steps. Automated documentation audit confirmed required headings/statuses/contracts; catalog cross-check confirmed 13 exact identities, phases, dispositions, and provisional references; `git diff --check` passed. |
| 3 | Delegate and review Nodes 3-6 in catalog order with focused source verification, marking each source-complete/batch-queued only after its record is satisfied. | Per-node focused tests and acceptance-schema/Graph round-trip checks pass; primary review finds no contract drift or unsafe fallback. | In progress | Node 3 closed Steps 1-6 on 2026-07-30 with a 170/170 focused source gate. Node 4 closed Steps 1-6 on 2026-07-31 with a 382/382 focused source gate, `004_resolve_element_acceptance.json` validated by the acceptance-schema guard and a Graph round-trip, and a complete user-catalog entry; its two contract-visible decisions are recorded in N004 for user confirmation. Both are batch-queued and not accepted. Nodes 5 and 6 remain. |
| 4 | Delegate and review Nodes 7-15 in catalog order with focused source verification and exact provisional isolation. | Per-node focused tests and acceptance-schema/Graph round-trip checks pass; side-effect retry and foreground/host rules are proven. | Pending | — |
| 5 | Create the deterministic Phase 1-2 integration workflow/fixture and requested statically unrolled Google/Wikipedia smoke workflow. | Canonical v3 schema, exact node versions, routes, output references, tab references, clipboard labels, and acceptance metadata validate. | Pending | — |
| 6 | Rebuild Graph Studio once from the final source state and run the consolidated JavaScript/Python, syntax, fingerprint/integrity, and whitespace gates. | All complete source gates pass against the same final tree; failures reopen the owning record. | Pending | — |
| 7 | Run focused unpacked-extension workflows 002-015 plus deterministic Phase 1-2 integration, then the external smoke workflow where the live site permits it. | Required outputs/routes and safe failures pass; any CAPTCHA or third-party change is reported honestly and is not bypassed. | Pending | — |
| 8 | Synchronize all records, tracker, roadmap, catalogue, handoff, and detailed user-controlled Conventional Commit message. | No node remains active or ambiguously accepted; batch-queued rows become Complete only with evidence; hashes remain untracked unless requested. | Pending | — |

## Program completion gates

- Individual N003-N015 records were complete and frozen before delegation.
- Nodes were implemented and reviewed strictly in catalog order.
- Every node passed focused automated verification before the next source slice.
- Final Graph Studio build and complete JavaScript/Python regression suites pass
  against one final source tree.
- Acceptance workflows 002-015 and the deterministic cross-node workflow pass
  through the unpacked source extension.
- The external Google/Wikipedia smoke workflow is present, canonical, uses only
  available finalized Phase 1-2 nodes plus static repetition, and reports live
  environmental blockers honestly.
- User catalogue, tracker, roadmap, handoff, and recovery records agree.
- No release, V2, later catalog node, Sequential Studio repair, or unapproved
  Git operation was introduced.

## Recovery procedure

Read the tracker and this file first. If Step 2 is active, verify the authority
matrix and inspect every existing N003-N015 draft before changing source. If a
later step is active, read the one node record marked In progress, rerun its
recorded completed focused checks, classify the active step as not started,
partial, or complete, and finish it before assigning another node. Treat every
batch-queued node as incomplete until Steps 6-8 close.
