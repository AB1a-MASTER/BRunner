# Specification 08 - Mapper Reliability Transition

## Status

Planning source of truth for the mapper redesign phase. This spec is derived
from `BRunner_Mapper_Reliability_Transition_Plan.md`.

The goal is behavioral parity with the supplied standalone mapper design on the
supported scope, not a patch to the existing per-step locator recorder.

Supported first-release scope:

- static or bounded pages;
- open Shadow DOM.

Deferred scope:

- dynamic regions;
- infinite or repeating feeds;
- feed-item pinning;
- same-origin frame routing;
- cross-origin frames;
- automatic scrolling or pagination for mapping;
- closed Shadow DOM.

Closed Shadow DOM and inaccessible cross-origin frames are hard limits.

## Decisions

| Topic | Decision |
|---|---|
| Architecture | Extract a shared environment-agnostic Mapper Core. Use extension adapters for DOM access, Chrome storage, messaging, and UI. |
| Existing recordings | Do not preserve current test workflows. Break the legacy target format cleanly and re-record test workflows against the new format. |
| Canonical naming | Use locked readable Component IDs: `[website]_[page]_[component]`. IDs never regenerate when labels drift. |
| Aliases | Optional display aliases may be edited in the Inspector, but never replace the canonical Component ID. |
| Default strategy | Use hybrid mapping: reuse a fresh persisted map, preflight/validate where possible, refresh/reconcile when the page is reached or a target cannot be resolved. |
| Ambiguity | Never click, type, select, extract, or otherwise interact when identity is ambiguous. Return a structured outcome and route through an explicit unresolved branch. |
| Continuation | Mapper failures must not crash the workflow or silently continue on success. DOM nodes expose an `unresolved` path. |
| Configuration | All mapper configuration lives in `workflow.settings.mapper`; site/page overrides are nested under that workflow. There is no extension-global mapper policy. |
| Initial persistence | Use compact workflow-scoped maps in `chrome.storage.local` behind a storage adapter. Add filesystem persistence later through the existing local host adapter. |
| Inspector | Build a dedicated extension window, comparable to the debugger, not a side panel or popup-only view. |

## Why Replacement Is Required

The current mapper is a useful recorder and fallback resolver, but it is not a
durable mapper:

- it stores target candidates and snapshots inside each node instead of
  persisting conceptual component records;
- it uses `ctrlHash` partly derived from DOM position, which is session-local
  technical evidence rather than durable identity;
- it scans one flat control list and lacks site profiles, page profiles, map
  versions, component history, review, and reconciliation;
- direct locator strategies can return the first visible DOM match;
- fuzzy recovery uses threshold-only best score without a required winner
  margin over the runner-up;
- it lacks formal `ambiguous`, `map_stale`, and `protected_unsupported` states;
- it lacks workflow-scoped page normalization and a privacy model for stored
  fingerprints;
- it does not traverse open Shadow DOM.

Do not add more candidate types to `content/targetResolver.js` and call the
problem solved. The architecture changes from step-owned locators to
workflow-owned component maps.

## Reliability Contract

Every DOM-dependent node must follow this contract:

1. Reference a persistent `componentId`, not a raw CSS selector or per-step
   snapshot.
2. Try the exact primary locator selected at component capture first.
3. Try stored fallbacks only after the primary fails validation.
4. Compare the historical component fingerprint with the current live map when
   needed.
5. Treat a candidate as usable only when it is unique enough,
   action-compatible, visible, enabled where applicable, and not occluded for
   pointer actions.
6. Return a live element only after fixed confidence and margin rules pass.
7. Return `ambiguous` when two or more candidates are similarly plausible.
8. Refresh/reconcile a stale map once according to policy before the final
   outcome.
9. Log attempts, selected evidence, confidence, runner-up score, and final
   state in structured form.
10. Keep canonical component name and ID stable across selector, layout, and
   label changes when reconciliation establishes the same component.

## Resolver States

Use these exact mapper-boundary states:

```ts
type ResolverState =
  | "resolved"
  | "resolved_with_fallback"
  | "ambiguous"
  | "not_found"
  | "map_stale"
  | "protected_unsupported";
```

| State | Interaction allowed? | Workflow route |
|---|---:|---|
| `resolved` | Yes | `success` |
| `resolved_with_fallback` | Yes, with warning log | `success` |
| `ambiguous` | No | `unresolved` |
| `not_found` | No after configured refresh/retry | `unresolved` |
| `map_stale` | No until one refresh/reconcile attempt | Retry internally, then `success` or `unresolved` |
| `protected_unsupported` | No | `unresolved` |

`ambiguous` is an expected handled workflow outcome, not an exception.

## Target Architecture

### Shared Mapper Core

Create one pure Mapper Core with no references to `chrome`, `window`,
`document`, `Element`, or extension UI APIs.

Recommended layout:

```text
mapper/
  core/
    types.js
    policy.js
    normalizePage.js
    naming.js
    fingerprint.js
    scoring.js
    reconcile.js
    resolve.js
    serialize.js
    validation.js
  adapters/
    dom/
      domTraversal.js
      shadowDomTraversal.js
      domFingerprintAdapter.js
      domResolverAdapter.js
    extension/
      chromeMapStore.js
      backgroundMapperCoordinator.js
      contentMapperSession.js
      inspectorBridge.js
```

The core receives serializable fingerprints and candidate facts. Only the DOM
adapter may hold live `Element` references.

### Build Boundary

The project currently uses classic content scripts and an ESM background worker.
To avoid duplicated resolver logic:

1. Author Mapper Core as ESM source.
2. Add a minimal build step that emits an IIFE bundle for content scripts and an
   ESM bundle for the background service worker.
3. Make both bundles originate from the same Mapper Core source and version.
4. Add a build-time version string to persisted maps and resolver logs.

### Extension Roles

| Layer | Responsibility |
|---|---|
| Content mapper session | Scan live DOM including open shadow roots, build compact facts, resolve live targets, validate action readiness, render highlights. |
| Background coordinator | Load workflow settings and maps, persist map versions, coordinate reconciliation, attach mapper context to nodes, consume results, route graph outcomes. |
| Mapper Core | Naming, fingerprint comparison, scoring, ambiguity rules, reconciliation, serialization, policy merging. |
| Map store adapter | Store/retrieve compact workflow-scoped site/page maps. Chrome storage first, filesystem later. |
| Inspector window | Browse maps, validate/highlight live targets, review changed or ambiguous components, edit workflow-scoped settings and overrides. |

## Data Model

### Identity Hierarchy

```text
Workflow
  SiteProfile
    PageProfile
      PageMapVersion
        ComponentRecord
```

### Site Profile

```ts
type SiteProfile = {
  siteKey: string;
  displayName: string;
  queryParamAllowlist: string[];
  sensitive: boolean;
  classification: "static" | "dynamic_deferred" | "unsupported";
  createdAt: string;
  updatedAt: string;
};
```

### Page Profile

```ts
type PageProfile = {
  pageProfileKey: string;
  siteKey: string;
  normalizedPath: string;
  includedQuery: Record<string, string[]>;
  identityOptions: {
    includeLocale: boolean;
    includeViewportClass: boolean;
    includeAuthenticatedState: boolean;
  };
  profileSignature?: string;
  inconsistentProfile: boolean;
  createdAt: string;
  updatedAt: string;
};
```

Default normalization is origin/host plus path. Ignore URL hash and all query
parameters unless the workflow's site override explicitly allowlists a
parameter. Sort allowed query values before building the page key.

When two pages normalized to the same path produce materially incompatible
component signatures, set `inconsistentProfile: true`. Do not silently merge
them. Surface the issue in the Inspector and require a query allowlist or page
override.

### Page Map Version

```ts
type PageMapVersion = {
  schemaVersion: 1;
  mapVersionId: string;
  siteKey: string;
  pageProfileKey: string;
  createdAt: string;
  status: "ready" | "stale" | "refreshed" | "unsupported" | "invalidated";
  classification: "static" | "dynamic_deferred" | "unsupported";
  componentCount: number;
  fingerprintDigest: string;
  components: ComponentRecord[];
  reconciliation: ReconciliationSummary;
};
```

Retain a bounded number of versions per page profile. Default retention is
three versions plus compact diff summaries.

### Component Record

```ts
type ComponentRecord = {
  componentId: string;
  componentUid: string;
  displayName: string;
  siteKey: string;
  pageProfileKey: string;
  createdAt: string;
  updatedAt: string;
  status: "same" | "changed" | "new" | "removed" | "ambiguous";
  reviewRequired: boolean;
  primaryLocator: LocatorCandidate;
  fallbackLocators: LocatorCandidate[];
  fingerprint: ComponentFingerprint;
  expectedCapabilities: ComponentCapabilities;
  historicalLinks: ComponentHistory[];
};

type LocatorCandidate = {
  strategy: string;
  value: string;
  scope?: LocatorScope;
  reliability: number;
  selectedAtCapture?: boolean;
};
```

### Component Fingerprint

Persist compact fingerprints only. Do not persist raw HTML or raw DOM snapshots.

Allowed categories:

- selection: capture method and primary strategy;
- semantic: role, accessible name, label text, stable text, placeholder, title,
  alt text, name, input type, stable data attributes;
- structural: form, at most two meaningful ancestor containers,
  sibling/card/row signature, relative index, nearby label;
- technical: stable ID, CSS candidates, XPath candidate, DOM path, shadow path,
  future frame path evidence;
- behavioral: capabilities, href, control state;
- visual: landmark and relative bounds as a final tiebreaker only.

Visual facts cannot establish identity by themselves.

### ComponentRef

Replace legacy node-owned target fields with:

```ts
type ComponentRef = {
  mapperSchemaVersion: 1;
  componentId: string;
  componentUid: string;
  siteKey: string;
  pageProfileKey: string;
  capturedMapVersionId: string;
};
```

DOM nodes store `componentRef` plus ordinary action config. The component record
owns locators and fingerprints.

Remove these fields from newly saved workflows:

```text
targetFallbacks
targetSnapshot
ctrlHash as canonical identity
friendlyName as identity
raw CSS selector as normal recorder output
```

A future manual advanced locator may exist only as an explicit override and must
still pass action validation and ambiguity rules.

## Component Naming

Canonical format:

```text
[website]_[page]_[component]
```

Examples:

```text
example_com_account_settings_save
example_com_checkout_shipping_continue
example_com_search_search_input
```

Normalize to lowercase ASCII-safe tokens separated by underscores. Preserve
readability over compression.

Naming algorithm:

1. `website`: normalized hostname, such as `example_com`.
2. `page`: normalized page-profile path, such as `account_settings`; use `home`
   for `/`.
3. `component`: choose the most meaningful stable semantic seed:
   explicit user alias, stable testing/data attribute, accessible name plus
   role/type, associated label plus role/type, stable text plus role, name,
   placeholder, title, stable ID, or generic semantic role.
4. If duplicated, climb up to two meaningful ancestor containers and prefix
   context, such as `billing_save` versus `profile_save`.
5. If still duplicated, append `_2`, `_3`, and so on.
6. Lock `componentId` at creation and never regenerate it after label, copy, or
   position drift.
7. Optional `displayName` aliases are editable but not resolver identity.

`ctrlHash` or another ephemeral handle may still exist inside one content-script
session for speed. It is technical recovery evidence only and must never be the
canonical Component ID, main user-facing name, sole persisted recovery
mechanism, or ordinary log identity.

## Workflow-Scoped Mapper Settings

All settings live under `workflow.settings.mapper`.

Precedence:

```text
workflow default < workflow site override < workflow page override
```

Do not introduce extension-global mapper settings. Do not put mapper behavior in
individual node config unless a future design explicitly adds a node-level
exception.

Settings schema:

```json
{
  "mapper": {
    "version": 1,
    "enabled": true,
    "mappingMode": "hybrid",
    "mappingTrigger": "automatic",
    "exhaustivenessTier": 1,
    "pageIdentity": {
      "ignoreHash": true,
      "includeLocale": false,
      "includeViewportClass": false,
      "includeAuthenticatedState": false
    },
    "resolution": {
      "refreshAttempts": 1,
      "refreshDelayMs": 250,
      "unresolvedRoute": "unresolved"
    },
    "limits": {
      "maxComponentsPerVersion": 500,
      "maxMapBytes": 750000,
      "maxVersionsPerPage": 3,
      "mutationDebounceMs": 300,
      "mutationSampleWindowMs": 1500,
      "materialMutationLimit": 50
    },
    "privacy": {
      "redactVisibleTextWhenSensitive": true,
      "redactLogsWhenSensitive": true
    },
    "siteOverrides": {
      "https://example.com": {
        "queryParamAllowlist": ["tab"],
        "sensitive": false
      }
    },
    "pageOverrides": {
      "https://example.com::/account/settings?tab=security": {
        "mappingTrigger": "explicit",
        "exhaustivenessTier": 2
      }
    }
  }
}
```

Validate numeric limits against safe ranges. Expose configuration in workflow
settings and show effective policy in the Inspector.

Mapping modes:

| Mode | Behavior |
|---|---|
| `runtime` | Build/refresh the map when a DOM node reaches a page. |
| `preflight` | Map only pages the user explicitly opens or selects for non-action validation. Do not secretly replay actions or navigate automatically. |
| `hybrid` | Default. Reuse fresh map, validate when eligible page is reached, refresh/reconcile once on stale map or target failure. |

`mappingTrigger` can be `automatic` or `explicit`. Page overrides can require a
manual **Map this page** action.

Exhaustiveness tiers:

| Tier | Scope | Intended use |
|---|---|---|
| 1 | Visible actionable controls: buttons, links, form controls, supported ARIA controls, contenteditable controls. | Default |
| 2 | Tier 1 plus extractable semantic roots: tables, lists, labelled regions, dialogs, stable content containers. | Extraction workflows |
| 3 | Tier 2 plus stable structural entities: cards, rows, tabs, menus, navigation groups, landmark containers. | Advanced structured pages |
| 4 | All meaningful non-decorative semantic elements under strict caps, never raw DOM. | Explicit troubleshooting only |

Tier 4 still obeys component and serialized-size limits.

## Scoring Profile

Use one documented, versioned scoring profile in the first release. Do not add
learned or self-tuning weights.

Suggested `SCORING_PROFILE_V1` maximum points:

| Evidence family | Maximum |
|---|---:|
| Semantic identity | 45 |
| Structural context | 30 |
| Technical selectors | 15 |
| Behavioral compatibility | 8 |
| Visual tiebreaker | 2 |

Fixed rules:

- Primary locator must produce exactly one compatible candidate.
- Fallback candidate score must be at least `75` and exceed runner-up by at
  least `15` points.
- Historical reconciliation is `same` at `80+` with `15+` margin.
- Historical reconciliation is `changed` at `65-79` with `15+` margin.
- Otherwise produce `ambiguous` or `new` as appropriate.
- Contradictory high-confidence semantic evidence is disqualifying.
- Visual evidence cannot repair weak semantic or structural evidence.

Log the scoring profile version and cover it with unit tests. Do not expose
free-form threshold tuning in the first workflow UI.

## Mapping and Resolution Behavior

### Capture

When recording an element:

1. Resolve the event target through `event.composedPath()`.
2. Ensure a current map exists for effective workflow/site/page policy.
3. Build a fingerprint for the selected live element.
4. Reconcile with the current page map or create a component.
5. Assign/return the locked readable Component ID.
6. Store only `componentRef` in the node.
7. Display Component ID and readable display name in recorder highlight and
   Studio.

The recorder may propose a primary locator, but must retain that selected
primary locator instead of recomputing it later from current label scores.

### Resolution Algorithm

Implement this order exactly:

1. Validate current page profile.
2. Ensure map freshness under effective hybrid policy.
3. Resolve the component's primary locator.
4. Resolve stored fallback locators in hierarchy order:
   semantic, structural, technical, behavioral, visual.
5. If still unresolved, reconcile historical fingerprint against current live
   map.
6. Validate target action readiness.
7. Return resolver state and full structured diagnostics.

For every locator strategy:

- collect all candidate elements, never only `document.querySelector()` or the
  first visible match;
- filter by frame/shadow scope, visibility, enabled state, action capability,
  and contextual compatibility;
- score all remaining candidates;
- require a unique winner and required margin;
- return `ambiguous` instead of using document order as a tiebreaker.

### Action Validation

The selected target must be compatible with the requested action.

| Action class | Required checks |
|---|---|
| Click, double-click, hover | visible, connected, actionable/clickable, not disabled, pointer target not occluded after scroll-into-view |
| Type, clear | editable input/textarea/contenteditable, not readonly/disabled, visible |
| Select/toggle | expected native or accessible control capability, enabled, visible |
| Upload | native file input only; do not fake upload on another control |
| Extraction | target exists, visible when required, and matches expected extraction capability |

Keep the existing just-in-time occlusion check, but run it after identity
resolution succeeds and before dispatch.

### Freshness and Static Safety

Replace full rebuilds on every mutation with a bounded lifecycle:

- invalidate/revalidate on navigation, history route changes, major URL changes,
  and material candidate-relevant DOM changes;
- debounce material mutations using workflow policy;
- observe only while recording, actively resolving, preflighting, or inspecting;
- mark maps potentially stale during idle/background use;
- rebuild incrementally where possible, otherwise build one bounded version and
  reconcile once;
- stop early when a unique verified target has already been found.

The first production mapper supports static/bounded pages only. During initial
mapping, sample relevant mutations for the configured window. If mutation volume
exceeds policy, classify the page as `dynamic_deferred`.

For `dynamic_deferred` pages:

- do not claim persistent map reliability;
- do not use fuzzy historical reconciliation as an action basis;
- return `protected_unsupported` for mapped interactions unless a later phase
  explicitly enables dynamic support;
- show the reason in Inspector and logs.

This is a safe decline, not partial dynamic-site support.

## Open Shadow DOM

Open Shadow DOM is in initial supported scope.

Traversal requirements:

- recursively scan `document` and every reachable open `element.shadowRoot`;
- apply exhaustiveness tiers inside each root;
- attach mutation observers to discovered open roots and newly discovered hosts
  while mapper is active;
- use composed event paths during recording/highlighting.

Persist `shadowPath` instead of a single document selector:

```ts
type ShadowPath = {
  hosts: Array<{
    locator: LocatorCandidate;
    fingerprint: ContextSignature;
  }>;
  targetLocator: LocatorCandidate;
};
```

Resolve host-by-host. Each host must be unique and compatible before querying
the next open shadow root. Apply ambiguity rules at every boundary.

Closed shadow roots are inaccessible. Return `protected_unsupported` with reason
`closed_shadow_root`; never pretend CSS fallback can see into one.

## Workflow Execution and Graph Schema v3

The current graph schema v2 supports one linear success path. That is
incompatible with handled unresolved mapper outcomes.

Introduce graph workflow schema v3. DOM-dependent nodes add source handles:

```text
success
unresolved
```

`unresolved` covers `ambiguous`, `not_found`, exhausted `map_stale`, and
`protected_unsupported`.

Rules:

1. On `resolved` or `resolved_with_fallback`, execute action and follow
   `success`.
2. On unresolved states, do not execute action. Store structured result in node
   output, log it, and follow `unresolved`.
3. Workflows containing DOM nodes must supply an `unresolved` edge, or the
   validator rejects before run.
4. Do not silently skip an unresolved node onto `success`.
5. Add a terminal **Needs attention** node for authors who want a controlled
   visible end state.

Existing test workflows are disposable and should be re-recorded after this
change.

Structured output example:

```json
{
  "state": "ambiguous",
  "componentId": "example_com_settings_save",
  "pageProfileKey": "https://example.com::/settings",
  "mapVersionId": "map_...",
  "usedStrategy": null,
  "confidence": 79,
  "runnerUpConfidence": 77,
  "reason": "two_semantically_equivalent_candidates",
  "attempts": []
}
```

Redact protected text fields before output is retained or exported on sensitive
sites.

Refactor the background executor from a `for` loop over linear steps into graph
traversal that chooses the outgoing edge from node outcome. This is a
prerequisite for the new mapper. Do not fake unresolved branching by swallowing
errors inside `executeContentStep`.

## Persistence and Privacy

### Chrome Storage First

Implement `MapStore` and use `chrome.storage.local` first.

```ts
interface MapStore {
  getWorkflowMapperState(workflowId: string): Promise<WorkflowMapperState | null>;
  getPageMap(workflowId: string, siteKey: string, pageProfileKey: string): Promise<PageMapVersion[]>;
  putPageMap(workflowId: string, map: PageMapVersion): Promise<void>;
  deletePageMap(workflowId: string, siteKey: string, pageProfileKey: string): Promise<void>;
  listPageMaps(workflowId: string): Promise<PageMapIndexEntry[]>;
}
```

Store page maps separately from workflow JSON, keyed by stable workflow ID. Keep
only compact fingerprints, map metadata, component records, versions, and diff
summaries.

Never store:

- complete raw DOM or HTML snapshots;
- passwords;
- typed text-input values;
- cookies;
- auth tokens;
- session data;
- arbitrary page body text;
- unbounded CSS class lists;
- unbounded nearby text.

### Sensitive Sites and Pages

Sensitivity lives in the active workflow's site/page override.

When sensitive:

- omit visible text, nearby text, labels, placeholders, titles, and extracted
  free-text fields from persisted maps and exported logs;
- retain only redacted/hardened structural and behavioral signals needed for
  safe resolution;
- show a visible sensitivity badge in the Inspector;
- do not lower safety thresholds because evidence is redacted.

### Future Filesystem Store

After Chrome storage is stable, add a filesystem `MapStore` adapter through the
existing local-host bridge.

Required behavior:

- site-keyed JSON files;
- schema-version field and forward-compatibility check;
- atomic write/rename;
- bounded version retention;
- request timeout and unreachable-host result states;
- payload chunking for oversized data, while normal maps stay below cap;
- multi-tab conflict rule: last-write-wins plus retained diff record.

Do not add a second native-messaging transport merely to match a tracking
document. BRunner already has a WebSocket local host. Use it behind the
`MapStore` contract unless a separate product decision changes transport.

## Dedicated Mapper Inspector

Create an extension-owned dedicated window, for example
`mapper-inspector/index.html` opened through `chrome.windows.create`.

Required features:

- select workflow, site profile, page profile, and map version;
- search by Component ID, display name, role, and status;
- visual tree/list of mapped components with semantic and structural context;
- badges for `same`, `changed`, `new`, `removed`, `ambiguous`,
  `dynamic_deferred`, and `unsupported`;
- show primary locator, fallback hierarchy, compact fingerprint, expected
  capabilities, and historical links;
- run live resolution before showing a highlight;
- highlight only after successful unique live resolution;
- scroll the resolved element into view before highlighting;
- Review Queue for changed and ambiguous components;
- workflow-local page/site override editing for mapping trigger, query
  allowlist, sensitivity, and allowed static/dynamic-deferred override;
- display-name alias editing without changing Component ID;
- current effective mapper settings and profile-normalization rationale.

The Inspector must never offer a "choose first candidate" action for ambiguous
results. A reviewer may explicitly link a historical component to a selected
candidate, recording the decision in the next map version.

## Concrete Code Migration

| Current area | Required change |
|---|---|
| `content/targetResolver.js` | Retire as authoritative resolver. Port useful extraction to DOM adapter, but replace first-match and threshold-only fuzzy logic. |
| `content/mapper.js` | Convert flat `controls` map to per-tab `ContentMapperSession` with page maps, open shadow roots, map messages, and Mapper Core delegation. |
| `background.js` | Add mapper coordinator and MapStore integration, send component context to content scripts, consume resolver results, dispatch graph outcome handles. |
| `core/workflowSchema.js` | Add schema v3 graph validation with `success` and `unresolved` handles; reject DOM nodes without unresolved routing. |
| `core/workflowUtils.js` | Replace domain-only compatibility with Mapper Core page-profile normalization. |
| `core/constants.js` | Add mapper message names, resolver states, mapping actions, and schema/version constants. |
| `studio/app.js` and graph editor | Replace target text/friendly-name editing for mapped nodes with ComponentRef display and Inspector launch; add workflow mapper settings. |
| `studio-graph-src` | Render and validate `unresolved` output handles for DOM nodes; add **Needs attention** end node. |
| `manifest.json` | Load Mapper Core content bundle before DOM adapter/session; add Inspector resources; do not enable `all_frames` in first scope. |
| `test.html` | Replace old fallback-only smoke harness with mapper fixtures for naming, ambiguity, reconciliation, page normalization, storage, and open shadow roots. |

## Implementation Milestones

### Milestone 0 - Foundation and Break-Point

- Add Mapper Core source, build step, policy types, schema version constants,
  and unit-test harness.
- Add `workflow.settings.mapper` schema and validation.
- Upgrade new workflows to graph schema v3 with `success` and `unresolved`
  routing.
- Define MapStore adapter and Chrome storage skeleton.
- Remove requirement to support old test recordings.

Exit: new blank workflow saves mapper settings, DOM node can carry placeholder
`ComponentRef`, and graph validation requires unresolved routing.

### Milestone 1 - Static Page Map, Naming, and Safe Resolution

- Implement page normalization, workflow-local site/page overrides, and profile
  conflict detection.
- Implement tiers 1-4 and enforce component/size caps.
- Implement compact semantic, structural, technical, behavioral, and visual
  fingerprints.
- Implement canonical naming, two-ancestor disambiguation, numeric suffixes,
  name locking, and optional aliases.
- Implement recorder capture into `ComponentRef`.
- Implement primary-first resolution, ordered fallback hierarchy, full candidate
  enumeration, scoring, action validation, and `ambiguous` state.
- Carry forward visibility, enablement, scroll, and occlusion safety checks.
- Add static-only mutation sampling gate and `dynamic_deferred` safe decline.

Exit: static-page components survive ID/class/CSS-path/layout-order drift only
when enough independent evidence remains. Duplicate Save controls produce
`ambiguous`, never a click.

### Milestone 2 - Open Shadow DOM, History, and Reconciliation

- Add recursive open-shadow traversal, composed-path capture, shadow paths, and
  shadow-root mutation observation.
- Add bounded map version history and reconciliation outcomes.
- Preserve historical Component IDs on strong semantic/structural matches.
- Mark changed/ambiguous associations for review.
- Implement stale/invalidation lifecycle and hybrid runtime refresh.
- Add structured resolver/reconciliation logs and node output.

Exit: moved components retain Component IDs, labels may drift without ID
regeneration, and close-score alternatives are not auto-linked or interacted
with.

### Milestone 3 - Dedicated Inspector and Workflow Configuration UX

- Create dedicated Inspector window.
- Add map browsing, search, live resolution check, highlight, scroll, Review
  Queue, aliases, and effective-policy view.
- Add workflow settings UI for defaults and site/page overrides.
- Add manual **Map This Page** and explicit-trigger mode.
- Add sensitive flag and redacted display behavior.

Exit: reviewer can locate a component by Component ID, see why it resolved or
failed, inspect it live safely, and resolve changed/ambiguous mapping without
changing canonical name.

### Milestone 4 - Filesystem Map Persistence

- Add local-host MapStore adapter, commands, file format, schema checks, atomic
  writes, timeouts, and host-unavailable state.
- Add optional periodic snapshot persistence for active tracking.
- Implement bounded multi-tab last-write-wins merge with retained diff metadata.

Exit: Chrome storage and filesystem adapters produce identical map schema and
equivalent resolution behavior.

### Milestone 5 - Deferred Dynamic, Feed, and Frame Support

- Region-level static/dynamic/infinite/unsupported classification.
- Dynamic-region identity rules excluding volatile text/position.
- Repeatable feed-template Component IDs and pattern plus condition resolution.
- Explicit feed-item pinning, loaded-content-only policy, no automatic
  scroll/pagination.
- Same-origin frame routing and cross-frame Inspector messaging where permitted.

Do not begin until static/open-shadow reliability tests are stable.

## Required Tests

Mapper Core unit tests:

- page normalization and query allowlists;
- profile conflict detection;
- canonical naming, ancestor context, numeric suffixes, locked-name behavior;
- candidate scoring, exact primary resolution, runner-up margin, contradiction
  rejection;
- reconciliation outcomes: same, changed, new, removed, ambiguous;
- size, component, and version caps;
- sensitive-data redaction;
- serialization/deserialization compatibility;
- policy precedence.

Browser integration fixtures:

1. Primary drift: actual recorded primary locator invalidates and outcome is
   `resolved_with_fallback`.
2. Moved control: same button moves containers and Component ID remains.
3. Duplicate labels: two plausible Save controls produce `ambiguous`, click
   count remains zero, unresolved branch runs.
4. Context disambiguation: same labels in different forms/cards create unique
   Component IDs.
5. Name lock: text changes after map creation; Component ID stays unchanged and
   status becomes `changed` where appropriate.
6. Wrong page: same-domain incompatible profile is not treated as compatible.
7. Query allowlist: allowed query creates distinct profiles; ignored parameters
   do not.
8. Stale map: material DOM change marks stale, refresh/reconcile once, then
   resolves or returns handled unresolved.
9. Open Shadow DOM: record, resolve, click, type, and highlight nested open-root
   controls.
10. Closed Shadow DOM: return `protected_unsupported`; no selector workaround.
11. Mutation-heavy page: classify as `dynamic_deferred`; no persistent-mapper
   interaction claim.
12. Storage restart: close/reopen extension context, reload map, resolve same
   static component.
13. Sensitive page: persisted data/logs contain no visible/free text fields.
14. Inspector: highlight refuses ambiguous components and succeeds only after
   unique live resolution.

Regression rule: every test must assert both resolver state and whether the
underlying browser action did or did not execute.

The old "invalidate primary ID" test is insufficient when another earlier
candidate such as `aria-label` remains valid. Replace it with fixtures that
invalidate the actual recorded primary locator and separately verify fallback
and ambiguity.

## Acceptance Criteria

Do not claim mapper parity until all are true for static/bounded pages and open
Shadow DOM:

- every recorded DOM node references a persistent readable Component ID;
- Component IDs follow locked naming and are searchable in Inspector/logs;
- resolver uses primary-first, ordered fallback, then historical reconciliation;
- direct/fuzzy locator never wins solely by first document order;
- inadequate winner margin returns ambiguity;
- ambiguous/not-found targets never receive interaction events;
- workflows follow explicit unresolved branches;
- maps are site/page scoped with workflow-local path/query normalization and
  conflict detection;
- version history records same/changed/new/removed/ambiguous outcomes;
- hybrid mapping and stale-map refresh work under limits;
- open-shadow controls can be captured, named, resolved, and interacted with;
- closed roots and deferred dynamic pages produce honest unsupported states;
- map persistence is compact, bounded, and redacted for sensitive pages;
- Inspector explains resolution/change/failure without unsafe auto-selection.

## Non-Goals

Do not add these until the deferred milestone:

- full dynamic-region support;
- infinite-scroll traversal or unbounded map growth;
- automatic feed scrolling/pagination;
- feed-item pinning without a genuine unique signal;
- cross-origin iframe DOM mapping;
- closed Shadow DOM access;
- learned confidence weighting;
- global extension-wide mapper settings;
- automatic migration of current test recordings;
- raw DOM snapshot persistence;
- "best available candidate" clicks when scores are close.

## Implementation Guardrails

1. Follow this plan's resolved decisions where earlier tracking/design notes left
   options open.
2. Do not retain `ctrlHash` as durable identity.
3. Do not use `querySelector()` or first visible element as a terminal decision.
4. Do not turn mapper failures into success-path skips with a generic catch.
5. Do not ship UI that automatically selects ambiguous targets.
6. Do not store raw DOM, input values, passwords, cookies, tokens, or unbounded
   page text.
7. Do not enable dynamic/infinite behavior merely because MutationObserver
   exists.
8. Keep scoring constants deterministic and tested; defer automatic tuning.
9. Use locked readable IDs in component names and resolver logs.
10. Keep Mapper Core portable so future standalone implementations can use the
    same scoring, naming, result states, and serialized map schema.

