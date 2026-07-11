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
- platform-specific app profiles for chat and social media products;
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
| Review policy | Manual review is exceptional. Strong unique reconciliation is accepted automatically. Weak or close historical matches become new components while unmatched prior records become bounded tombstones. Runtime ambiguity still blocks interaction. |
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

## Autonomous Reconciliation and Review Budget

The map exists primarily for runtime automation. Inspector review is a recovery
tool, not a required maintenance loop. Normal page drift must therefore converge
without a person opening the Inspector.

Reconciliation uses these tiers:

1. Exact persisted component UID or strong unique historical evidence preserves
   the locked Component ID automatically and records the decision, score, and
   winner margin.
2. Weak evidence, inadequate winner margin, or close historical candidates do
   not preserve an old identity. The live fact becomes a new component and each
   unmatched prior component becomes a bounded removed tombstone.
3. Removed tombstones remain available for retained-version diagnostics and old
   workflow references, but do not require review by default.
4. Runtime resolution remains stricter than reconciliation. Duplicate direct
   locators or close live candidates return `ambiguous`; no event is dispatched.
5. A strong unique historical rebind preserves the old Component ID
   automatically, but is marked `pending` until a later settled capture confirms
   the same live UID. Confirmation is deterministic, counted, and logged; it
   must never mean "choose the first candidate".

`reviewRequired` is reserved for genuine identity conflicts that cannot be
represented safely as new plus removed records, policy violations, or explicit
operator requests. Changed/new/removed status is useful history and does not by
itself imply human work.

Required reliability metrics per page profile:

- automatic strong-match count and rate;
- uncertain-as-new count;
- automatic rebind pending/confirmed count;
- runtime fallback recovery count;
- runtime ambiguous/not-found count;
- incorrect-action count, which must remain zero in deterministic fixtures;
- stale-to-resolved convergence attempts;
- Component ID survival rate across controlled DOM drift.

Static map reconciliation stores `mapper.reliability.v1` metrics as counts and
rates only. It records redaction flags proving that raw visible text and raw
locator values are not copied into the metrics payload. Runtime DOM resolution
now feeds the same metrics shape with fallback recovery, ambiguous, not-found,
incorrect-action, attempt count, and last-attempt timestamp counters. Bounded
`mapper.runtime_resolution.v1` attempts keep counts, scores, evidence labels,
and hashed candidate identities only.

The product target of 99.99% cannot be established from a scoring constant. It
requires a large adversarial fixture corpus, replay telemetry with redacted
evidence, measured false-positive and false-negative rates, and release gates.

## Platform-Specific App Profiles

Some websites are application products with domain-specific DOM behavior rather
than ordinary document pages. Chat and social media products such as WhatsApp
Web, Facebook, Instagram, and Reddit must not be treated as generic static
sites once live evidence shows poor grouping, unstable identity, virtualized
feeds, route shells, or component reuse.

Add a mapper profile track for these product classes before claiming reliable
automation coverage:

- chat apps: conversation list, active thread, message composer, attachment
  controls, message rows, reactions, unread markers, pinned/archived state, and
  virtualized message history need semantic grouping rules;
- social media apps: home feed, post/card boundaries, comment composer, action
  bars, story/reel/media viewers, profile tabs, infinite scroll, and virtualized
  rows need feed-aware grouping and tracking rules;
- repeated cards must preserve card/container scope and should avoid naming
  every repeated child as a flat page-level component;
- dynamic counters, unread badges, timestamps, ephemeral notifications, typing
  indicators, and loaded/unloaded feed windows should be classified separately
  from durable action targets;
- platform profile detection should be workflow-scoped, explainable in the
  Inspector, and fall back to conservative `dynamic_deferred` or unresolved
  states when the profile cannot prove safe identity.

The platform profile layer must be data-driven and redacted. It may recognize
known product patterns, ARIA roles, stable app containers, and repeated content
structures, but it must not hard-code secret-bearing user content or click by
visual order alone. WhatsApp Web grouping/tracking needs a dedicated acceptance
fixture or live checklist before it is considered supported.

Detailed profile requirements are tracked in
`11_MAPPER_PLATFORM_APP_PROFILES.md`.

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
They may establish display order: saved component records, Inspector Structure,
Regions, Types, Review Queue, and Graph views should use document bounds as a
top-to-bottom then left-to-right ordering hint, with DOM path/capture index as
fallbacks. Resolver identity and ambiguity decisions must still avoid choosing
an action target solely by visual order.

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

**Initial source pass complete:** mapper schema v3 workflows now run through a
narrow graph traversal path in `background.js` that follows `success` or
`unresolved` handles. Mapper unresolved content outcomes are logged as handled
`unresolved` node results, update shared runtime state, and route to the
`unresolved` edge without dispatching browser or visible-host fallback actions.
The generated **Needs attention** node is treated as a safe no-op terminal node.
This is not general graph control flow; conditions, loops, merges, and broader
branching remain deferred.

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

### Host Filesystem Store

After Chrome storage is stable, add a filesystem `MapStore` adapter through the
existing local-host bridge.

**Initial source pass complete:** the Windows host now exposes a mapper
repository and native `LIST_MAPPER_STATES`, `GET_MAPPER_STATE`,
`SAVE_MAPPER_STATE`, and `DELETE_MAPPER_STATE` commands. The extension core has
a `NativeMapStore` adapter behind the existing `MapStore` contract. Native
mapper calls now have bounded timeouts, the adapter exposes
unavailable/timeout status, host writes enforce a 1 MB normal payload cap
instead of chunking, and host-saved states retain revision plus bounded
last-write-wins conflict metadata. The background still defaults to Chrome
storage until filesystem-backed persistence is explicitly accepted as the
default.

Required behavior:

- site-keyed JSON files;
- schema-version field and forward-compatibility check;
- atomic write/rename;
- bounded version retention;
- request timeout and unreachable-host result states;
- a normal payload cap, with chunking deferred until real maps exceed it;
- multi-tab conflict rule: last-write-wins plus retained diff record.

Do not add a second native-messaging transport merely to match a tracking
document. BRunner already has a WebSocket local host. Use it behind the
`MapStore` contract unless a separate product decision changes transport.

## Dedicated Mapper Inspector

Create an extension-owned dedicated window, for example
`mapper-inspector/index.html` opened through `chrome.windows.create`.

Required features:

- open from a clear mapper/maps button in the extension or Studio;
- list saved maps grouped as a website list, then site profile, page profile,
  and map version;
- select workflow, site profile, page profile, and map version;
- search by Component ID, display name, role, and status;
- visual tree/list of mapped components with semantic and structural context;
- bounded image and visible leaf-text components where they are user-visible and
  have stable text, media, or structural signals. These components are tracked
  for extraction, click where compatible, and later screenshot/crop workflows;
- badges for `same`, `changed`, `new`, `removed`, `ambiguous`,
  `dynamic_deferred`, and `unsupported`;
- two map views:
  - **Tree view:** explorer-style hierarchy grouped by website, page,
    containers, forms/regions, and components, with per-type icons,
    indentation, lock affordances, compact element labels, and canonical
    Component IDs as secondary detail. It must support page-structure, region,
    and component-type grouping modes. Structure mode should use saved DOM-path
    facts to follow the captured page hierarchy as closely as the map data
    allows;
  - **Graph view:** hierarchy graph similar to Graph Studio, showing site,
    page, region/container, component, and relationship edges. It must use the
    same interaction model as Graph Studio where possible: top-down pannable
    canvas, zoom controls, connector ports, right-angle parent/child edges,
    selected node state, and right-side details. Component nodes should be titled by compact
    element-type/name labels such as `button_save`, `input_email`, or
    `link_pricing`, with the canonical Component ID shown as secondary detail.
- show primary locator, fallback hierarchy, compact fingerprint, expected
  capabilities, and historical links;
- run live resolution before showing a highlight;
- highlight only after successful unique live resolution;
- scroll the resolved element into view before highlighting;
- optionally preview the same safe highlight on component-row hover or keyboard
  focus without dispatching page actions;
- when the Inspector and the mapped website are open at the same time, support
  a **Highlight on website** mode. Selecting a component in Tree or Graph view
  sends a safe highlight request to the content mapper session,
  scrolls the resolved live element into view, and overlays a color-coded box
  on the real page, similar to the DevTools Elements panel. Color codes must
  distinguish resolved, resolved-with-fallback, ambiguous, not-found,
  changed/review-required, dynamic-deferred, and unsupported states. Ambiguous
  and not-found items may show candidate/area hints but must not dispatch page
  actions.
- Review Queue for changed and ambiguous components;
- workflow-local page/site override editing for mapping trigger, query
  allowlist, sensitivity, and allowed static/dynamic-deferred override;
- display-name alias editing without changing Component ID;
- current effective mapper settings and profile-normalization rationale.

Current source status: `BRunner/mapper-inspector/index.html` implements the
first Inspector pass with saved-map listing, Tree/Graph views, a Review
Queue, active-page mapping without the recorder, component detail inspection,
and inspection-only live highlighting through the content mapper resolver.
Live highlighting now scrolls the resolved page element into view before
drawing the overlay. Alias save, current-mapping review acceptance, live-candidate
linking while preserving Component ID, basic policy editing, sensitive
badges/redaction, and persisted live resolver attempts are now present in
source. Review acceptance and live-candidate linking now produce a fresh review
map version, preserving the previous map for inspection. Live resolution now
returns a structured `mapper.resolver.log.v1` record with thresholds, selected
candidate, runner-up, margin, ranked candidates, and attempts. Saved runtime
resolver attempts and page reliability counters are now surfaced in compact
redacted Inspector panels without raw selector/text payloads. A Graph
view hierarchy canvas now exists in source with top-down Site -> Page -> Region
-> Component nodes, connector ports, right-angle edges, pan/zoom controls,
selected-node state, and live-highlight selection wiring. Tree view now uses a
reference-aligned dark explorer layout with type icons, lock affordances, and
grouping modes for captured page structure, regions, and component type. Final
graph/tree UX polish remains follow-up after manual stress-page testing.
The Inspector also exposes optional highlight-on-hover preview, and content
mapping now includes bounded image plus visible leaf-text candidates for
user-visible media/text tracking. Tree, Graph, and Review Queue now share
component search/status filters for Component IDs, aliases, names, role/type,
capabilities, status, and review state. The Component panel now has an explicit
live-resolution check for review workflows, making resolver logs and candidate
link attempts available without relying on automatic selection highlighting.
The website browser now consolidates repeated maps to one card per base site,
keeps only the latest three retained versions per page profile, exposes those
pages from the selected site's toolbar Page picker, scopes the Version picker
to the selected page, and uses compact collapsible side sections for repeated
map review. The full right Details rail is also
collapsible, and Policy/Review Queue section dividers are resizable. Same-site
page profiles remain isolated by page key; the coordinator test suite covers a
login/home scenario where login changes are tracked without mutating the home
map. Inspector **Refresh Map** now targets the selected saved page, rescans the
open website tab, and writes a fresh retained map version for component-only
DOM changes such as appended tree/graph/feed items.
Known stress-page UX issues to keep closing: hover and click highlights must
not clash, Tree/Graph switching must avoid stale visual artifacts, component
search must match visible text reliably, and the compact Inspector UI must pass
manual acceptance across smaller desktop/tablet widths.
Initial hardening now covers broader visible-text/locator search indexing,
stale hover cancellation on selection/view switches, top-layer Inspector
highlighting over recorder hover state, and stronger contrast/responsive
breakpoints. A monotonic highlight request id now lets the content mapper ignore
stale hover overlays, and the Inspector shell uses flex height to reduce
sub-fullscreen layout artifacts. The Inspector UI now also uses compact
icon/tooltip controls for common map, clear, graph, collapse, and destructive
actions; Tree and Graph expose a visible map color legend; website rows include
direct delete-site actions; the Page selector has an adjacent delete-page action;
and responsive rules wrap the header, Page/Version controls, filters, Tree,
Graph, and side rails instead of assuming full-screen desktop width.
Saved map records, Inspector Tree/Graph/Review Queue lists, and live content
capture now use visual page reading order top-to-bottom then left-to-right while
preserving resolver safety. Content-side mapper refresh responses now include
bounded material mutation counts collected after mapper initialization.
Inspector refresh passes those counts into static map creation, so
mutation-heavy pages can honestly classify as `dynamic_deferred` under the
configured policy instead of showing stale static component records.
The Inspector also has a read-only live-status path that builds a temporary map
for the selected saved page and compares component count, fingerprint,
classification, and mutation state without saving. The badge can recommend
refresh or show `dynamic_deferred`; only explicit **Refresh Map** writes a new
retained version.
Explicit Map/Refresh requests use a settled-current-DOM snapshot so a page does
not remain permanently stuck in `dynamic_deferred` after a previous burst of
mutations. The content script still reports lifetime mutation counts for
read-only live checks, while saved maps can refresh once the DOM is settled.
Retained page-map lists prefer usable versions over already-saved unsupported
zero-component versions for the same page.
The Page/Version toolbar includes delete-page and delete-version actions beside
their matching selectors. Delete-page removes all retained versions for the
selected saved page while preserving other site pages; delete-version removes
only the selected saved map version, clears live overlays, and falls back to the
nearest remaining version.
Highlight/live-resolution now includes hidden candidates for diagnostic
purposes. If a stored component resolves to an element that is present but not
visible, the Inspector reports `hidden`, does not draw a misleading overlay, and
marks the Tree, Graph, Review Queue, and Component detail rows with a hidden
badge.
Inspector live-resolution state is scoped to the exact workflow, retained map
version, and Component ID. Page/version switches clear the old website overlay,
hover exit restores the selected component overlay, and content-side highlight
requests re-check freshness after scroll/paint so late responses cannot redraw
stale highlights.
Tree rows now use real expandable/collapsible branches for site, page,
structure, region, and type groups. Component rows keep selection/highlight
behavior while type coloring and status styling distinguish component category,
selection, review-required, hidden, changed, ambiguous, and removed states.
Current Tree and Graph views hide removed historical component records by
default so appended feed/list items stay in live page order. Removed components
remain available through the Review Queue and explicit Removed/Review filters,
and core component ordering places removed history after live components.

The Inspector must never offer a "choose first candidate" action for ambiguous
results. A reviewer may explicitly link a historical component to a selected
candidate, recording the decision in the next map version.
Accepting the current mapping clears review state in the new review map version;
changed and ambiguous accepted records normalize to `same`, while accepted
removed records remain historical removals without staying in the Review Queue.

## Mapper Stress Test Page

After core mapper execution and Inspector basics are complete, add a dedicated
manual mapper stress page served with the existing acceptance fixtures. The page
must contain:

- a static section with stable controls, duplicate labels in separate
  containers, form fields, links, and extractable content;
- a dynamic section whose IDs, text, order, and container structure can change
  through explicit buttons while preserving enough independent evidence for
  valid reconciliation;
- a mutation-heavy dynamic section that should be classified honestly as
  `dynamic_deferred` when policy limits are exceeded;
- an infinite-scroll section that appends repeated cards/items under strict
  test controls. Initial mapper support must not claim full infinite-feed
  support; it should classify or scope the loaded portion honestly until the
  deferred dynamic/feed milestone exists;
- open Shadow DOM controls for capture, resolution, and highlighting;
- visible counters/logs proving whether clicks, typing, selection, and
  unresolved states did or did not execute.

The manual acceptance instructions must explain exactly how to:

1. serve the page from the repo root;
2. map the static section and verify locked Component IDs;
3. mutate the dynamic section and verify reconciliation or handled
   unresolved outcomes;
4. trigger mutation-heavy and infinite-scroll scenarios and verify honest
   `dynamic_deferred` or unsupported behavior;
5. open the Mapper Inspector, select the saved website map, switch between Tree
   and Graph views, and use highlight-on-website mode to verify live
   element overlays.

The current manual source checklist lives in
[`../MAPPER_MANUAL_ACCEPTANCE.md`](../MAPPER_MANUAL_ACCEPTANCE.md).

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
  **Initial source foundation complete: pure `BRunner/mapper/core.js` exposes
  mapper schema/version constants, workflow-scoped policy normalization,
  page-profile normalization, placeholder `ComponentRef` creation, and
  mapper-state serialization. Bundled build-output integration remains later.**
- Add `workflow.settings.mapper` schema and validation.
  **Implemented in source defaults and workflow setting normalization.**
- Upgrade new workflows to graph schema v3 with `success` and `unresolved`
  routing.
  **Implemented in source: v2 remains the current linear runtime graph; v3
  accepts `success` and `unresolved` handles, rejects DOM-dependent mapper nodes
  without unresolved routing, and refuses to run unresolved v3 graphs through the
  linear executor.**
- Define MapStore adapter and Chrome storage skeleton.
  **Implemented as `ChromeMapStore` over `chrome.storage.local`.**
- Remove requirement to support old test recordings.

Exit: new blank workflow saves mapper settings, DOM node can carry placeholder
`ComponentRef`, and graph validation requires unresolved routing.
**Source exit covered by deterministic tests. Live/bundled Graph Studio
acceptance remains because no build was requested for this source pass.**

### Milestone 1 - Static Page Map, Naming, and Safe Resolution

- Implement page normalization, workflow-local site/page overrides, and profile
  conflict detection.
- Implement tiers 1-4 and enforce component/size caps.
- Implement compact semantic, structural, technical, behavioral, and visual
  fingerprints.
- Implement canonical naming, two-ancestor disambiguation, numeric suffixes,
  name locking, and optional aliases.
  **Initial Mapper Core source slice complete: deterministic static page maps,
  page/site keys, canonical readable Component IDs with duplicate context,
  compact serializable fingerprints, component caps, mutation-heavy
  `dynamic_deferred` safe decline, and locked component records are covered by
  unit tests. DOM adapter/build-output wiring remains next.**
- Implement recorder capture into `ComponentRef`.
  **Initial content-adapter source pass complete: the recorder now enumerates
  static candidates through document plus reachable open Shadow DOM roots,
  uses composed event paths, derives compact mapper facts from existing target
  evidence, and emits `componentRef` plus `mapperFact` on recorded DOM steps.
  Persistence through MapStore and full Core bundle reuse remain next.**
  **Initial coordinator persistence complete: background reconciles recorded
  mapper facts through Chrome `MapStore`, persists workflow-scoped page maps,
  and returns Core-locked `ComponentRef` records before Studio receives the
  recorded step.**
- Implement primary-first resolution, ordered fallback hierarchy, full candidate
  enumeration, scoring, action validation, and `ambiguous` state.
  **Initial pure resolver complete: unique primary locators resolve first,
  duplicate primary locators return `ambiguous`, fallback scoring uses fixed
  `mapper.scoring.v1` thresholds/margins, and incompatible actions are rejected
  before resolution. Live DOM candidate enumeration remains next.**
  **Initial execution integration complete: background attaches stored
  workflow/page map context from `ChromeMapStore` before content execution, and
  content action execution plus visible-host fallback preparation/verification
  resolve through stored Component IDs before legacy target packages. The source
  pass returns handled `resolved`, `resolved_with_fallback`, `ambiguous`,
  `not_found`, and `dynamic_deferred` states before page actions fire.
  Wait-condition routing now also uses the same mapper-aware resolver and
  returns handled mapper diagnostics before falling back to generic timeouts.
  Extraction actions already resolve through the shared execution path.**
- Carry forward visibility, enablement, scroll, and occlusion safety checks.
- Add static-only mutation sampling gate and `dynamic_deferred` safe decline.

Exit: static-page components survive ID/class/CSS-path/layout-order drift only
when enough independent evidence remains. Duplicate Save controls produce
`ambiguous`, never a click.
Dedicated manual fixture: `BRunner_Host/mapper_test.html` covers duplicate
labels, drift, open Shadow DOM, and mutation-heavy regions for mapper acceptance.

### Milestone 2 - Open Shadow DOM, History, and Reconciliation

- Add recursive open-shadow traversal, composed-path capture, shadow paths, and
  shadow-root mutation observation.
  **Open-shadow capture/traversal, bounded composed-path persistence, and
  mutation observation for discovered open roots are implemented in source.**
- Add bounded map version history and reconciliation outcomes.
  **Initial source pass complete: Chrome `MapStore` retains bounded page-map
  history per workflow/page, and static map reconciliation now records
  `same`, `changed`, `new`, `removed`, and `ambiguous` summaries.**
- Preserve historical Component IDs on strong semantic/structural matches.
  **Source pass complete for static reconciliation: exact UID drift and strong
  historical matches keep locked Component IDs without manual review, weak or
  close history becomes new plus removed tombstones, and strong automatic
  rebinds carry pending/confirmed identity confirmation metadata.**
- Mark changed/ambiguous associations for review.
  **Policy revised and implemented in source: changed/new/removed status is
  informational by default, while `reviewRequired` is reserved for genuine
  conflicts, policy violations, or explicit operator requests. Runtime
  ambiguity still blocks interaction.**
- Implement stale/invalidation lifecycle and hybrid runtime refresh.
  **Initial source pass complete: changed map fingerprints create `refreshed`
  page-map versions and unbounded dynamic/mutation-heavy pages safely decline
  with `dynamic_deferred`; bounded identified regions use `hybrid_dynamic` and
  retain currently loaded components while observer rescans update facts.**
- Add structured resolver/reconciliation logs and node output.
  **Partially complete: reconciliation summaries are stored on map versions and
  mapper unresolved execution produces structured node diagnostics/output.
  Static reconciliation stores redacted count-only reliability metrics, and
  runtime mapper resolution now persists redacted fallback/ambiguous/not-found
  counters plus bounded attempts on the page map. The Inspector now surfaces
  those saved counters and attempts using compact redacted labels.**

Exit: moved components retain Component IDs, labels may drift without ID
regeneration, and close-score alternatives are not auto-linked or interacted
with.
**Initial source exit covered by deterministic tests for bounded history,
changed/removed/ambiguous reconciliation, unresolved graph routing, and
mapper-aware wait diagnostics. Live acceptance remains manual.**

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
  **Initial source pass complete for host repository, native commands, atomic
  writes, and extension `NativeMapStore` adapter. Hardening source pass
  complete for bounded mapper request timeouts, native unavailable/timeout
  status, 1 MB normal payload cap, native revision stamps, and retained
  last-write-wins conflict metadata.**
- Add optional periodic snapshot persistence for active tracking.
- Switch the default from Chrome storage only after live/manual acceptance of
  the filesystem-backed adapter.

Exit: Chrome storage and filesystem adapters produce identical map schema and
equivalent resolution behavior.

### Milestone 5 - Deferred Dynamic, Feed, and Frame Support

- Region-level static/dynamic/infinite/unsupported classification.
  **Implemented for bounded `hybrid_dynamic`, loaded-window, ephemeral-context,
  and unbounded `dynamic_deferred` behavior.**
- Dynamic-region identity rules excluding volatile text/position.
  **Implemented for platform badges/timestamps and loaded-window position.**
- Repeatable feed-template Component IDs and pattern plus condition resolution.
  **Stable generic/platform item keys are pinned; unkeyed repeated patterns
  return `repeat_condition_required` until a future workflow supplies a
  condition.**
- Explicit feed-item pinning, loaded-content-only policy, no automatic
  scroll/pagination. **Implemented in source.**
- Same-origin frame routing and cross-frame Inspector messaging where permitted.
  **Implemented by stable frame path; cross-origin frames stay protected.**

Source implementation is complete; live extension acceptance remains.

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
- Inspector highlight/live resolution tries stored primary and fallback locators
  as direct unique matches before fuzzy fingerprint scoring, while duplicate
  stored-locator matches remain ambiguous;
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
- routine reconciliation does not create manual review work for changed, new,
  or removed records when a safe automatic outcome exists;
- uncertain history is represented as new plus removed rather than an
  ambiguous identity assignment;
- every automatic identity decision records reason, score, margin, and policy.

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
