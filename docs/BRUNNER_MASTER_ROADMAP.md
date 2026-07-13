# BRunner Master Roadmap

**Status:** Current product scope and implementation sequence
**Updated:** 2026-07-13

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
- the Windows companion source with workflow storage, approved folders,
  transitional key-based pairing code, diagnostics, and visible fallback
  foundations; the target cooperative profile-instance lock remains open;
- workflow/page-scoped mapper storage, component identity, reconciliation,
  resolver diagnostics, open-shadow and frame-related source support, test
  fixtures, and an engineering-oriented Mapper Inspector.

This baseline is not a declaration that the mapper engine, node catalog, saved-map
experience, or product release is finished. Existing workflow nodes are
provisional development scaffolding. They remain untouched until the dedicated node
phase begins.

## Current implementation sequence

### Milestone 0 - Shared and companion foundation closure (current supporting work)

Complete the non-node infrastructure listed in
`FOUNDATION_TODO_STATUS.md` and `COMPANION_TODO_STATUS.md`: generated-artifact
cleanup, Graph Studio build parity, generic draft/save integrity, node-neutral
MV3 session recovery, the cooperative profile-instance lock, companion storage,
approved-folder semantics, transport readiness, and visible-fallback
correctness.

This work may proceed alongside mapper-engine closure, but it must not repair or
redesign provisional nodes.

**Gate:** both shared and companion status checklists pass from source with
deterministic and focused live tests. Packaged release acceptance is not part of
this gate.

### Milestone 1 - Mapper engine and reliability closure (current)

The mapper engine is the current product priority. Finish and verify the engine
before expanding workflow nodes or polishing the saved-map UI.

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
8. Map persistence uses serialized or revision-checked per-workflow/page writes
   so concurrent frames, tabs, and diagnostics cannot lose updates.
9. Deterministic mapper tests pass, followed by focused live extension
   acceptance against the repository fixtures.

The existing Mapper Inspector may be used as an engineering diagnostic surface
for these checks. V1 does not require a polished saved-map management product,
complete review workflow, mobile-quality viewer, or final visual design.

**Gate:** the supported mapper scenarios resolve the intended component or
return an accurate structured failure through the node-neutral test harness,
and the focused fixture checklist passes with synthetic data. Current node or
graph-route integration is not part of this gate.

### Milestone 2 - Final workflow-node program

Begin only after the mapper engine gate is accepted.

`workflow_nodes_implementation_blueprint.md` is the only node catalog. At the
start of this phase:

1. Process every blueprint node in its documented order and identify any
   provisional equivalent only as implementation reference.
2. Mark the work as upgrade, rewrite/change, or add; remove every provisional
   node absent from the finalized blueprint.
3. Do not preserve an existing node merely because it already exists. The
   blueprint is authoritative.
4. Implement the blueprint using shared resolver,
   text-matching, output, logging, retry, and companion adapters.
5. Keep graph control flow in graph traversal; never emulate branching or loops
   inside the linear executor.
6. Add deterministic tests and focused live acceptance for each completed slice.
7. Update the living user guide as node contracts become real.

Until this milestone starts, current nodes are provisional and should receive
only fixes required to unblock mapper reliability. General node additions,
renames, UX redesigns, and blueprint conformance work are out of sequence.

**Gate:** every finalized blueprint node meets the blueprint definition of done,
every provisional action absent from the blueprint is removed, and the
cross-node acceptance workflows pass.

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
`MAPPER_TODO_STATUS.md` as the detailed current checklists.

1. Remove disposable generated package/build output, add the corresponding
   ignore rules, restore Graph Studio source/bundle parity, and add a build
   freshness gate.
2. Replace transitional pairing keys with the cooperative profile-instance
   lock and close the other companion foundation TODOs.
3. Remove mapper redaction/sensitive-site policy code. Remove provisional
   node-specific masking later when each finalized node is implemented rather
   than repairing the current node catalog.
4. Close mapper-engine reliability gaps and run focused source/live fixture
   acceptance.
5. Record any mapper failure as an engine issue; defer nonessential saved-map
   viewer polish to V2.
6. Close generic Studio save/draft integrity and node-neutral MV3
   restart/rehydration work from `FOUNDATION_TODO_STATUS.md`.
7. After all shared, companion, and mapper foundation gates pass, start the
   finalized node program from `workflow_nodes_implementation_blueprint.md` and
   track upgrade, rewrite/change, add, and removal status for every catalog
   item.
8. Complete integrated V1 source acceptance.
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
8. Do not modify provisional nodes outside mapper-unblocking fixes before the
   node milestone.
9. Do not perform release work during the current mapper or node milestones.
10. When scope or status changes, update this roadmap and the current handoff in
    the same change.
