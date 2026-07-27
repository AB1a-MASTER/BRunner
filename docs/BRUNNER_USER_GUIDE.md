# BRunner User Guide

**Status:** Development guide. BRunner has not reached its first supported
release. Provisional node behavior and generated packages are not product
contracts.

## Product scope

BRunner is a local browser-automation system for Windows and Chrome/Chromium.

- The extension owns page mapping, workflow authoring, browser context, and
  browser execution.
- Graph Studio is the only supported workflow-authoring surface. It uses one
  canonical mapper-graph workflow and the finalized graph runtime.
- Sequential Studio is deprecated and disabled. Normal Studio launches open
  Graph Studio, and the former Sequential URL redirects there without loading
  its authoring/run code. Retained source is removed only during final cleanup
  after V1 source acceptance and before V2.
- The Windows companion owns local workflow storage, approved-folder services,
  companion status, and opt-in visible operating-system fallback.
- The mapper engine is a primary reliability foundation. Its job is to discover
  and track page components well enough that finalized nodes can resolve the
  intended element after ordinary page changes.
- A polished saved-map explorer/Mapper Inspector is a secondary feature deferred
  to V2.

BRunner is not currently a cross-platform, headless, cloud, multi-user, or
enterprise-security product.

## Local-data responsibility

BRunner treats workflows, maps, variables, logs, clipboard values, screenshots,
typed values, extracted values, and Code Node content as ordinary local user
data. They may contain passwords, personal information, or any other content
the user chooses to process.

BRunner does not promise:

- sensitive-field detection or masking;
- secret storage or credential management;
- mapper or log redaction;
- protection from a malicious local user or process; or
- sandboxing of Code Node.

The user is responsible for the workflows they run, the data they store, and
access to the Windows account and project folders.

Approved-folder settings and foreground-window checks still have to behave as
configured. They are correctness and predictability features, not a security
boundary against the local user.

## Current development phases

### Accepted foundation

The accepted reusable systems that the final nodes consume include:

- mapper discovery, identity, tracking, persistence, and reconciliation;
- node-neutral ComponentRef scan/resolve/revalidate/refresh APIs;
- Chrome extension and companion transport;
- the cooperative one-profile companion lock;
- workflow and map storage correctness;
- Studio shell/build/save behavior; and
- MV3 service-worker lifecycle and session-state foundations.

These accepted systems must be preserved while the active node program replaces
or upgrades provisional node behavior.

### Node phase

[`../workflow_nodes_implementation_blueprint.md`](../workflow_nodes_implementation_blueprint.md)
is the sole finalized node list and node contract. The current registry and
executors are development scaffolding.

During the node phase, every finalized node is handled one by one:

1. Close the shared base-contract and Graph Studio consolidation requirements
   before the first node.
2. Find any provisional equivalent and explicitly upgrade, rewrite, add, or
   remove it according to the final node card.
3. Implement its versioned schema, stable ports, editor controls, runtime,
   mapper/host adapters, outputs, failures, retries, and tests.
4. Add a focused workflow under `BRunner_Host/Workflows/node_acceptance/` and
   pass it with synthetic data.
5. Document purpose, requirements, every field, practical examples,
   autocomplete, identifier choices, outputs, errors, and Graph Studio usage in
   [`NODE_USER_CATALOG.md`](NODE_USER_CATALOG.md).
6. Mark the tracker complete only after the entire gate passes; the user then
   creates the quick Git commit.

No compatibility guarantee exists for provisional workflows or node types.
Workflow migration, if later required, will be a separate feature.

## Graph Studio and workflow files

Graph Studio loads and saves the canonical mapper-graph workflow format. Its
node definitions, versions, fields, validation, outputs, ports/routes,
autocomplete providers, saved JSON, and background execution preparation must
remain one semantic contract. Until the node phase finishes, provisional node
contracts may change.

Sequential Studio is not a supported fallback editor. During the transition its
source may still be present, but users must author and run current workflows
from Graph Studio or use the sidebar only for supported saved-workflow
execution. Do not rely on a Sequential Studio link, draft, editor, or run path.

Studio source and the runtime bundle are separate:

- React/Vite source: `BRunner/studio-graph-src/`
- Extension-loaded assets: `BRunner/studio-graph/`

After changing Graph Studio source, run `npm run studio:build` and verify that
the built assets are current before loading the extension.

Workflow files are local JSON documents. The companion workflow directory is
configurable. Moving that directory must complete atomically and update the
running host before the new location is reported as active.

The companion's **Workflow Storage** tab also has an **Include workflows in
subfolders** toggle. It is off by default. When off, the companion and Graph
Studio list only JSON workflows directly inside the active workflow folder.
When on, they recursively discover JSON workflows and display nested entries by
repository-relative name, such as
`node_acceptance/001_navigate_acceptance.json`. Changing the toggle is persisted
and applies to the next workflow-list refresh; it does not grant access outside
the active workflow folder.

For the currently accepted node list and detailed usage, consult
[`NODE_USER_CATALOG.md`](NODE_USER_CATALOG.md). It describes only nodes whose
full implementation and acceptance gate has passed; planned entries are clearly
identified as unavailable.

## Mapper engine

### Purpose

The mapper should track every actionable or semantic page component plus the
labels, containers, hierarchy, state, and page/frame context required to
distinguish it reliably. It should not collect every decorative DOM node merely
to maximize element count; excess noise makes identity and reconciliation less
reliable.

Examples of mapped components include:

- links, buttons, menus, tabs, dialogs, and custom controls;
- inputs, textareas, editable regions, selects, checkboxes, radios, switches,
  sliders, date/time controls, and upload inputs;
- repeated cards, table/grid cells, list/tree items, and virtualized records;
- actionable images and meaningful visible text; and
- contextual headings, labels, descriptions, forms, regions, rows, and
  containers needed to identify the actionable component.

### Component identity

Maps are workflow-scoped and stored locally through the mapper store. A mapped
component receives a persistent Component ID and a ComponentRef. Identity
evidence may include locators, accessible role/name, labels, attributes,
hierarchy, nearby semantic text, component state, frame/page context, and
bounded history. Page maps persist normalized origin, path, and allowlisted
query-route identity so same-looking controls on different SPA routes remain
separate.

Component IDs remain stable when reconciliation shows that the logical
component survived an ordinary label, class, position, or layout change. Static,
dynamic, frame, shadow, and platform-specific records remain isolated where
mixing them would corrupt identity.

Mapper storage contains the raw local evidence needed for resolution. There is
no sensitive-site or redacted-map mode.

### Resolution contract

The mapper exposes a node-neutral contract:

- scan a page or affected region;
- return saved components and their hierarchy;
- resolve a ComponentRef in the current page context;
- revalidate a saved component;
- refresh/reconcile stale evidence;
- report ambiguity or failure with structured evidence; and
- update component history after relevant page changes.

Resolution must use current page, origin, allowlisted SPA route, tab, and frame
context. Inspector target selection and the final in-page resolver both reject a
page-profile mismatch so a route change cannot race into a cross-route match. It
must not
silently choose the first candidate when multiple components remain materially
ambiguous. A targeted refresh/reconciliation may run before returning a final
unresolved result.

The engine must cover ordinary static pages, SPAs, bounded mutation-heavy
regions, repeated controls, virtualized loaded windows, open Shadow DOM, and
extension-accessible frames. Closed shadow roots and browser-protected pages
remain platform limits unless a later design explicitly changes that boundary.

### Mapper acceptance

Mapper acceptance focuses on engine behavior, not a polished visualization
window. It should verify:

- stable IDs across repeated scans and ordinary mutations;
- accurate static/dynamic lane separation;
- page, origin, tab, frame, and SPA-route tracking;
- repeated-row/card identity;
- open Shadow DOM and frame handling;
- bounded reconciliation without false matches;
- persistence under concurrent frames/tabs;
- large-page performance and map-size bounds; and
- replay against controlled DOM changes.

Use [`MAPPER_TODO_STATUS.md`](MAPPER_TODO_STATUS.md) and
[`MAPPER_MANUAL_ACCEPTANCE.md`](MAPPER_MANUAL_ACCEPTANCE.md) for the current
acceptance sequence.

### Deferred V2 map experience

The dedicated Mapper Inspector, polished Tree/Graph navigation, saved-site
explorer, cross-workflow browsing, responsive map UI, and associated
accessibility work are V2. A minimal developer diagnostic/map dump may remain
available while the engine is developed, but it is not a V1 product surface or
release gate.

## Windows companion

The companion is a local Windows capability provider. It supplies:

- workflow storage;
- approved-folder aliases and local data access;
- service and connection status; and
- opt-in visible pointer/keyboard or visual fallback where the finalized node
  explicitly supports it.

The extension remains responsible for page intent and target resolution. The
companion must not independently decide which DOM component a workflow meant.
For visible fallback it must act only in the intended foreground Chrome window
and return a structured result to the extension.

### Cooperative profile lock

Pairing exists only to stop normal BRunner installations in different browser
profiles from using the same companion at the same time. It is not
authentication.

1. Each Chrome profile generates and stores a non-secret `profileInstanceId`.
2. The user puts the companion into Pair mode.
3. The first profile claims the host atomically.
4. The host stores that ID and rejects other BRunner profile IDs.
5. Only one active extension session is accepted.
6. The user explicitly unpairs before switching profiles.

There is no pairing key, PIN, credential, secret rotation, or protection against
a local program deliberately impersonating an instance ID. Companion transport
is fixed at `ws://127.0.0.1:8999` to match the extension; legacy custom port
values normalize back to `8999` and are not user-configurable.

### Approved folders

Approved folders use a user-facing alias plus a relative path. If the UI exposes
read, write, or recursive controls, the host must honor those settings exactly.
Raw legacy paths must not produce behavior different from the visible alias
configuration.

### Visible fallback

Visible operating-system fallback is a correctness-sensitive last resort. It
must verify the intended foreground Chrome window, use valid virtual-screen and
client coordinates, remain within that window, and refuse to act when the
browser region cannot be established. Coordinate input requires one exact,
visible Chrome renderer viewport matching the focused page's CSS viewport and
device-pixel ratio. Zero or multiple matching renderer viewports, or stale
renderer geometry, is a refusal; ordinary page zoom remains valid when one
exact transform matches. A missing region must never expand a visual search to
the whole desktop.

## Generated packages

Current `release/`, `BRunner_Host/build/`, and `BRunner_Host/dist/` content was
created only to exercise the build process. It may be deleted and must not be
treated as a supported release. Final packaging, signing policy, and release
validation are deferred until the actual release phase.

## Current limitations

- Final nodes have not yet been implemented from the finalized blueprint.
- Provisional workflows may stop working during the node phase.
- Node palettes and workflow compatibility remain provisional until the
  Graph-only canonical authoring/runtime contract and node migrations are
  complete.
- Sequential Studio is disabled; its retained dormant source is not supported
  behavior.
- The polished map viewer is deferred to V2.
- Cross-platform, headless, cloud, and multi-user operation are out of scope.
- Live companion and mapper acceptance remains required before a release can be
  considered.
