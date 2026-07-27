# BRunner Master Roadmap

**Status:** Current product scope and implementation sequence
**Updated:** 2026-07-25

## Authority

The root `README.md` owns the confirmed product boundary and documentation
hierarchy. This file owns milestone order and current priority. If an older
plan, specification, checklist, user guide, or handoff conflicts with those
sources, follow the README and this roadmap until the affected document is
updated.

The sole catalog and implementation contract for workflow nodes is the
root-level `workflow_nodes_implementation_blueprint.md`. Earlier node lists in
the roadmap or `docs/specs/04_NODE_CATALOG.md` are historical descriptions of
the provisional runtime, not parallel catalogs.

`NODE_IMPLEMENTATION_STATUS.md` is the authoritative living TODO and evidence
ledger for that program. Root `AGENTS.md` keeps the implementation, testing,
documentation, versioning, and Git handoff rules consistent across sessions.

Detailed specifications remain useful for implementation behavior when they do
not conflict with the decisions recorded here. The current handoff should point
to this roadmap rather than restating a second roadmap.

## Confirmed product boundary

BRunner is a local browser-automation product for:

- Chrome or a compatible Chromium browser;
- a locally installed browser extension;
- a local Windows companion application;
- one cooperating user and one selected browser profile at a time.

The browser extension owns workflow authoring and execution, tab/page context,
browser-native actions, the mapper engine, and post-action checks. The Windows
companion owns local workflow persistence, approved-folder services, process
status, and explicitly requested visible operating-system assistance.

The current product is not a cross-platform desktop product, a remote or
multi-user automation service, a headless/cloud runner, or a security boundary
for hostile local users.

## Trust, credentials, and data handling

The current implementation does **not** promise credential protection,
sensitive-data handling, complete redaction, secret-safe logs, or privacy-safe
map persistence. Existing masking or bounded logging behavior is defensive
implementation detail, not a supported guarantee or release claim.

Development and acceptance workflows must therefore use synthetic, disposable
data. Do not put real passwords, tokens, payment information, private messages,
or other sensitive material into workflows, mapper fixtures, logs, screenshots,
or saved maps.

The companion uses a cooperative one-profile host lock. Each Chrome/Chromium
profile generates a stable non-secret instance ID; the host stores one paired
ID and accepts one active matching connection. There is no pairing key, PIN,
credential exchange, or authentication claim. The lock prevents normal BRunner
profiles from colliding, not deliberate local spoofing.

Security hardening, credential handling, formal redaction guarantees, and a
hostile-local-user threat model are not on the roadmap. They require a new
product decision before they may be added.

## Current baseline

The repository already contains a substantial working foundation:

- sequential recording and execution with shared runtime state and cancellation;
- graph workflow schema, Graph Studio, schema-v3 mapper `success`/`unresolved`
  traversal, and legacy workflow adapters;
- tab/page tracking, variables, expressions, existing browser/data/file nodes,
  and host-backed workflow persistence;
- the Windows companion source with workflow storage, approved folders, the
  cooperative profile-instance lock, live diagnostics, and fail-closed visible
  fallback foundations;
- workflow/page-scoped mapper storage, component identity, reconciliation,
  resolver diagnostics, open-shadow and frame-related source support, test
  fixtures, and an engineering-oriented Mapper Inspector.

This baseline is not a declaration that the node catalog, saved-map experience,
or product release is finished. Existing workflow nodes are provisional
development scaffolding and may be upgraded, rewritten, migrated, or removed by
the active node program.

## Current implementation sequence

### Milestone 0 - Shared and companion foundation closure (accepted 2026-07-20)

The automated source work listed in
`FOUNDATION_TODO_STATUS.md` and `COMPANION_TODO_STATUS.md`: generated-artifact
cleanup, Graph Studio build parity, generic draft/save integrity, node-neutral
MV3 session recovery, the cooperative profile-instance lock, companion storage,
approved-folder semantics, transport readiness, and visible-fallback
correctness is implemented. The extension/host round trip passed with its exact
expected value, and the operator completed the Companion/Chrome/Windows source
acceptance after the reported fallback defects were fixed and rerun.

This work may proceed alongside mapper-engine closure, but it must not repair or
redesign provisional nodes.

**Gate:** both shared and companion status checklists pass from source with
deterministic and focused live tests. Packaged release acceptance is not part of
this gate.

### Milestone 1 - Mapper engine and reliability closure (accepted 2026-07-20)

The mapper engine source and deterministic regression gates are implemented.
The operator fixtures now cover isolated evidence drift, ambiguity/capability
requirements, keyed and unkeyed loaded windows, deterministic mutation and
component overflow, shadow/frame boundaries, platform contexts, and SPA routes.
Stored exact page identity is enforced during tab selection and in-page
resolution. DOM-capture ordering, malformed direct records/tombstones, bounded
whitelisted state, unrelated-legacy preservation, oversized evidence, and
terminal quota rollback are deterministic gates. Complete the live extension
checklist before expanding workflow nodes or polishing the saved-map UI.

Required V1 outcomes:

1. The node-neutral mapper API can scan, look up, resolve, revalidate, refresh,
   and reconcile workflow/page-scoped components without a current node.
2. Resolution is deterministic, primary-first, and uniqueness-gated.
3. Ambiguous, missing, stale, or unsupported targets return structured mapper
   outcomes without guessing a component.
4. ComponentRef results contain the page/frame context and evidence the later
   finalized nodes need to choose their own result route.
5. Reconciliation preserves identity only when evidence is strong enough and
   never chooses a candidate merely because it appears first.
6. Static content remains reliable when bounded dynamic content is present.
7. Open Shadow DOM and extension-accessible frame behavior work only within the
   source and live scenarios that are actually verified. Inaccessible contexts
   fail honestly.
8. Map persistence uses serialized, generation/revision-checked per-workflow
   writes, bounded aggregate retention, and deterministic quota recovery so
   concurrent frames, tabs, and diagnostics cannot lose or resurrect updates.
9. Candidate discovery, fact construction, mutation rescans, frame aggregation,
   and runtime resolution are bounded before content-script CPU/message work;
   overflow defers honestly instead of accepting a truncated map.
10. Deterministic mapper tests pass, followed by focused live extension
    acceptance against the repository fixtures.

The 2026-07-20 live pass initially reopened loaded-window mapping/body ancestry
and off-screen high-zoom fallback. The source fixes, export-versus-DOM
diagnostic, corrected eligibility comparison, and explicit top/frame document
presentation are implemented and automated. The operator reported the affected
live reruns and final export passing. Milestone 1 is accepted.

The existing Mapper Inspector may be used as an engineering diagnostic surface
for these checks. V1 does not require a polished saved-map management product,
complete review workflow, mobile-quality viewer, or final visual design.

**Gate:** the supported mapper scenarios resolve the intended component or
return an accurate structured failure through the node-neutral test harness,
and the focused fixture checklist passes with synthetic data. Current node or
graph-route integration is not part of this gate.

### Milestone 2 - Final workflow-node program (active phase)

The mapper engine gate is accepted. The node program is active, beginning with
the shared base-contract and Graph Studio consolidation gate before Node 1.

Product direction changed on 2026-07-25 after the two-Studio audit found
different workflow preparation, validation, field coercion, entry selection,
route handling, and runtime paths. Graph Studio is now the sole supported
authoring surface. Sequential Studio is deprecated and disabled without
deleting its source. B19 completed that isolation: normal launches open Graph
Studio, the former URL redirects without authoring/run code, and its source
remains dormant until the pre-V2 cleanup milestone.

`workflow_nodes_implementation_blueprint.md` is the only node catalog. At the
start of this phase:

1. Establish one canonical versioned mapper-graph workflow model used by Graph
   Studio, background validation, and the finalized graph runtime. There is one
   supported editor and no Studio-specific workflow conversion.
2. Dispatch node behavior by `(type, version)`, migrate only through explicit
   migrations, and fail closed on unknown versions. Final contracts that reuse
   provisional type IDs begin at version 2.
3. Close shared target, ambiguity, output/routing, retry, stable-port,
   validation, help/example, autocomplete, and identifier-selector contracts.
4. Process every blueprint node in catalog-number order and identify any
   provisional equivalent only as implementation reference.
5. Mark the work as upgrade, rewrite/change, or add; remove every provisional
   node absent from the finalized blueprint.
6. Do not preserve an existing node merely because it already exists. The
   blueprint is authoritative.
7. Implement the blueprint using shared resolver,
   text-matching, output, logging, retry, and companion adapters.
8. Keep graph control flow in graph traversal; never emulate branching or loops
   inside the linear executor.
9. For every node, add its focused workflow under
   `BRunner_Host/Workflows/node_acceptance/`, deterministic tests, focused live
   evidence, and a complete entry in `NODE_USER_CATALOG.md`.
10. Mark the tracker row complete only after the entire node gate passes. The
    user then creates the quick Git commit and its hash is recorded in the
    completed-node ledger.

The milestone has started. The complete 94-node disposition inventory and
living implementation status are recorded in
[`NODE_IMPLEMENTATION_STATUS.md`](NODE_IMPLEMENTATION_STATUS.md). Current
runtime nodes remain provisional until their tracker rows meet the blueprint
definition of done.

**Gate:** the Graph Studio consolidation and base-contract items are complete;
Sequential Studio is inaccessible but retained as dormant source; every
finalized blueprint node meets the blueprint definition of done; every
provisional action absent from the blueprint is removed; each node-specific
acceptance workflow passes; the end-user catalog matches the implementation;
and the cross-node acceptance workflows pass.

### Milestone 3 - Integrated V1 acceptance

After the shared, companion, mapper, and node gates:

- run deterministic JavaScript and Python suites;
- rebuild generated Graph Studio assets when its source changes;
- run focused extension, companion, mapper, and cross-node acceptance with
  synthetic data;
- verify finalized workflow behavior; provisional workflow compatibility is not
  required unless migration is separately approved;
- synchronize the roadmap, handoff, user guide, and affected specifications.

This milestone validates the working source product. It is not permission to
publish, install, sign, or distribute a release.

### Milestone 4 - Pre-V2 repository cleanup

Run this only after integrated V1 source acceptance and before V2 or release
work:

- remove the already disabled `BRunner/studio/` Sequential Studio source;
- remove Sequential-only tests, navigation/session glue, manifest resources,
  documentation, and dead compatibility adapters after proving no supported
  path imports them;
- retain the legacy linear executor only if a separately tracked supported
  runtime path still requires it; otherwise remove it with focused regression
  evidence;
- remove generated release/build artifacts according to the policy below;
- run the complete JavaScript/Python suites, rebuild Graph Studio, and verify
  the unpacked extension from source.

This cleanup is not permission to redesign the product, start the V2 saved-map
experience, or perform release packaging.

## Deferred V2 saved-map experience

V2 may productize the saved-map viewer: final Mapper Inspector information
architecture, Tree/Graph navigation, review workflows, live highlighting,
responsive/accessibility behavior, and operator-oriented visual polish. V2
scope must be approved before implementation and must not displace mapper-engine
reliability or the finalized node program.

## Not current product targets

The following are not roadmap commitments. They require a new product-boundary
decision before they may be added:

- cross-platform companion applications;
- remote, multi-user, headless, container, cloud, or unattended deployment;
- hostile-local-user security, credential management, or redaction guarantees;
- enterprise compliance or security claims;
- generalized secure-desktop, CAPTCHA/MFA bypass, or hidden background input;
- learned resolver tuning, unbounded feed traversal, or broad telemetry.

## Release-artifact policy

Files currently present under `release/`, including extension archives and host
executables, are disposable test artifacts. They are not an accepted release,
must not be treated as current product output, and may be rebuilt or discarded
later.

Delete tracked generated release, `BRunner_Host/build/`, and
`BRunner_Host/dist/` output and ignore those paths. This is repository cleanup,
not release engineering.

Do not spend current work on release rebuilding, packaging cleanup, installer
behavior, artifact validation, or packaged GUI acceptance. Release work resumes
only after the mapper, node, and integrated-source gates are complete and the
user explicitly starts a release milestone.

## Current TODO order

Use `FOUNDATION_TODO_STATUS.md`, `COMPANION_TODO_STATUS.md`, and
`MAPPER_TODO_STATUS.md` as the accepted foundation records.

1. **Complete:** create
   [`NODE_IMPLEMENTATION_STATUS.md`](NODE_IMPLEMENTATION_STATUS.md) from the
   finalized 94-node blueprint and inventory every provisional type with an
   upgrade, rewrite/change, add, or remove disposition.
2. **Complete:** tracker base items B10-B12 now enforce one Graph Studio,
   canonical mapper-graph preparation, and editor/save/runtime semantic parity.
   B19 remains complete: Sequential Studio is disabled without deleting its
   source.
3. **Accepted — user commit pending:** Node 1, Navigate, passed the exact
   version-2 source, Graph Studio, cache-safe success, and stopped-server red
   error-route gates. Record the user-controlled commit hash and mark the
   tracker row Complete before starting Node 2.
4. After the Navigate commit is recorded, continue Scroll, Tab Control, Resolve
   Element, Check Element State, and Wait for Condition strictly one at a time,
   then close the Phase 1 gate.
5. Continue node Phases 2-7 one node at a time. For each node: add automated
   tests, its focused acceptance workflow and live evidence, update the end-user
   catalog and tracker, then hand off for a quick user-controlled commit.
6. Complete the six cross-node acceptance workflows and integrated V1 source
   acceptance.
7. Run the pre-V2 cleanup milestone, including physical removal of the dormant
   Sequential Studio.
8. Keep the saved-map viewer and dedicated map-view windows deferred to V2.
9. Ask the user before beginning any V2 viewer, product-boundary change, or
   release work.

## Development rules

1. Preserve unrelated user work. Provisional nodes and workflows have no
   compatibility guarantee; migration must be separately approved.
2. Prefer isolated changes over unrelated rewrites.
3. Keep mapper identity and ambiguity decisions deterministic and testable.
4. Never interact with an unresolved or ambiguous target.
5. Keep graph branching, loops, joins, and error routes in graph traversal.
6. Use synthetic data for development and acceptance; make no credential,
   redaction, or sensitive-data guarantee.
7. Treat companion pairing as a cooperative profile lock, not security auth.
8. During the node milestone, treat provisional nodes only as source material;
   the finalized blueprint controls upgrades, rewrites, additions, and removals.
9. Do not perform release work during the current mapper or node milestones.
10. When scope or status changes, update this roadmap and the current handoff in
    the same change.
11. Graph Studio is the sole supported authoring surface. Its editor state,
    saved canonical JSON, validation, and finalized graph execution plan must
    remain semantically identical.
12. B19 is complete; Sequential Studio remains disabled-but-present until
    Milestone 4. Do not repair or expand it during the node program.
13. Never mark a node complete without its versioned contract,
    editor/save/runtime round trip, focused acceptance workflow, automated/live
    evidence, end-user documentation, and tracker entry.
