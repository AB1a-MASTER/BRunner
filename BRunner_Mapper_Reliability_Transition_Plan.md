# BRunner Mapper Reliability Transition Plan

**Purpose:** Replace BRunner’s current per-step locator recorder with a persistent, component-oriented DOM mapper that has the same *behavioral reliability* as the standalone mapper design on its supported scope.

**Authoritative source for scope and sequencing:** the supplied Implementation & Tracking Document. The earlier design note is useful context, but this plan resolves the implementation choices that were left open there.

**Supported-scope parity target:** static or bounded pages and **open Shadow DOM**. Dynamic regions, infinite/repeating feeds, and frame support are intentionally deferred. Closed Shadow DOM and inaccessible cross-origin frames remain hard limits.

---

## 1. Decisions already made

| Topic | Decision |
|---|---|
| Architecture | Extract a shared, environment-agnostic Mapper Core. Use extension-specific adapters for DOM access, Chrome storage, messaging, and UI. This prevents standalone and extension implementations from drifting in scoring or safety behavior. |
| Existing recordings | Do **not** preserve current test workflows. Break the legacy target format cleanly and re-record test workflows against the new format. |
| Canonical naming | Use locked readable Component IDs: `[website]_[page]_[component]`. Names never regenerate when labels drift. Optional aliases may be editable in the Inspector, but never replace the canonical Component ID. |
| Default mapping strategy | **Hybrid**. Reuse a fresh persisted map, preflight/validate where possible, and refresh/reconcile at runtime when the page is reached or a target cannot be resolved. |
| Ambiguity | Never click, type, select, extract, or otherwise interact when identity is ambiguous. Return a structured outcome and route the workflow through an explicit unresolved branch. Do not arbitrarily choose the first DOM match. |
| Workflow continuation | Mapper failures must not crash the entire workflow. DOM nodes must expose an `unresolved` outcome path. The workflow follows that path without performing the requested action. Silent continuation on the success path is prohibited. |
| Configuration | All mapper configuration belongs to the individual workflow under `workflow.settings.mapper`. Site and page overrides remain available, but they are nested inside that workflow’s settings; there is no extension-global mapper policy. |
| Initial persistence | Store compact, workflow-scoped maps in `chrome.storage.local` through a storage adapter. Add filesystem persistence through the existing local host later, behind the same adapter contract. |
| Inspector | Build a dedicated extension window, comparable to the debugger, rather than a side-panel or popup-only view. |
| Required early support | Static/bounded pages and open Shadow DOM. |
| Deferred support | Dynamic regions, infinite/repeating feeds, feed-item pinning, same-origin frame routing, cross-origin frames, and automatic scrolling/pagination. |

---

## 2. Why the current mapper must be replaced rather than patched

The current implementation is a useful recorder and fallback resolver, but it is not a durable mapper:

- It records a target’s candidates and snapshot into each workflow node instead of persisting a conceptual component record.
- It uses an ephemeral `ctrlHash` derived partly from DOM position. That is useful inside one live page session, but it is not a persistent Component ID.
- It scans one flat list of controls, rebuilds it after every relevant mutation, and has no site profile, page profile, map version, or component history.
- Direct locator strategies commonly return the first visible DOM match. Fuzzy recovery selects only the highest score above a threshold and does not require a safe margin over the runner-up.
- It has no formal `Ambiguous`, `Map stale`, or `Protected / unsupported` resolver states.
- It lacks reconciliation, review, bounded version history, workflow-scoped page normalization, an Inspector, and a privacy model for stored fingerprints.
- It does not traverse open Shadow DOM. It cannot reliably operate in closed shadow roots or unsupported frames.

**Do not add more candidate types to `content/targetResolver.js` and call the problem solved.** The architecture must shift from **step-owned locators** to **workflow-owned component maps**.

---

## 3. Reliability contract

Every DOM-dependent node must follow this contract.

1. A node references a persistent `componentId`, not a raw CSS selector or per-step snapshot.
2. The exact primary locator selected when the component was captured is tried first.
3. Stored fallbacks are tried only after the primary fails validation.
4. If needed, the resolver compares the historical component fingerprint with the current live map.
5. A candidate is usable only when it is unique enough, action-compatible, visible, enabled when applicable, and not occluded for pointer actions.
6. The resolver may return a live element only after satisfying the fixed confidence and margin rules.
7. If two or more candidates are similarly plausible, return `ambiguous`; do not interact.
8. If the map is stale, refresh/reconcile once according to policy before producing a final outcome.
9. All resolution attempts, selected evidence, confidence, runner-up score, and final state are logged in structured form.
10. A component’s canonical name and ID stay stable across selector, layout, and label changes when reconciliation still establishes that it is the same component.

### 3.1 Resolver states

Use these exact states at the mapper boundary:

```ts
type ResolverState =
  | "resolved"
  | "resolved_with_fallback"
  | "ambiguous"
  | "not_found"
  | "map_stale"
  | "protected_unsupported";
```

Required behavior:

| State | Interaction allowed? | Workflow route |
|---|---:|---|
| `resolved` | Yes | `success` |
| `resolved_with_fallback` | Yes, with a warning log | `success` |
| `ambiguous` | No | `unresolved` |
| `not_found` | No after configured refresh/retry | `unresolved` |
| `map_stale` | No until one refresh/reconcile has been attempted | Retry internally, then `success` or `unresolved` |
| `protected_unsupported` | No | `unresolved` |

`ambiguous` is an expected, handled workflow outcome. It is not an exception and must not terminate the run by itself.

---

## 4. Target architecture

### 4.1 Shared Mapper Core

Create a single pure Mapper Core that has **no references** to `chrome`, `window`, `document`, `Element`, or extension UI APIs.

Recommended source layout:

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

The core receives serializable fingerprints and candidate facts. The DOM adapter is the only layer allowed to hold live `Element` references.

### 4.2 Build and module boundary

The project currently uses classic content scripts and an ESM background worker. To avoid duplicating reliability logic:

1. Author the Mapper Core as ESM source.
2. Add a minimal build step that emits:
   - an IIFE bundle loaded before the content mapper, and
   - an ESM bundle imported by the background service worker.
3. Make both bundles originate from the same Mapper Core source and version.
4. Add a build-time version string to persisted maps and resolver logs.

A small build step is justified here because separate hand-maintained content/background resolver implementations would create reliability drift.

### 4.3 Extension roles

| Layer | Responsibility |
|---|---|
| Content mapper session | Scan the live DOM, including open shadow roots; build compact candidate facts; resolve live targets; validate action readiness; render highlights. |
| Background coordinator | Load workflow settings and historical maps; persist map versions; coordinate reconciliation; attach mapper context to nodes; receive resolution results; route graph outcomes. |
| Mapper Core | Naming, fingerprint comparison, candidate scoring, ambiguity rules, reconciliation outcomes, serialization, and policy merging. |
| Map store adapter | Store/retrieve compact workflow-scoped site/page maps. Chrome storage first; filesystem adapter later. |
| Inspector window | Browse maps, validate/highlight live targets, review changed or ambiguous components, and edit workflow-scoped mapper settings/overrides. |

---

## 5. Data model

### 5.1 Identity hierarchy

```text
Workflow
  └── SiteProfile
        └── PageProfile
              └── PageMapVersion
                    └── ComponentRecord
```

### 5.2 Site profile

```ts
type SiteProfile = {
  siteKey: string;                 // normalized origin/host key
  displayName: string;
  queryParamAllowlist: string[];   // workflow-local override
  sensitive: boolean;
  classification: "static" | "dynamic_deferred" | "unsupported";
  createdAt: string;
  updatedAt: string;
};
```

### 5.3 Page profile

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

**Default page normalization:** origin/host plus path. Ignore URL hash and all query parameters unless the workflow’s site override explicitly allows a parameter. Sort allowed query values before building the page key.

When two pages normalized to the same path produce materially incompatible component signatures, mark `inconsistentProfile: true`. Do not silently merge them. Surface the issue in the Inspector and require the workflow author to add a query parameter to the allowlist or create a page override.

### 5.4 Page-map version

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

Retain only a bounded number of versions per page profile. Default: `3` versions plus compact diff summaries.

### 5.5 Component record

```ts
type ComponentRecord = {
  componentId: string;             // locked readable canonical ID
  componentUid: string;            // opaque durable internal UUID
  displayName: string;             // optional human alias; may change
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

### 5.6 Fingerprint

A compact fingerprint may include only the following categories. Do not persist raw HTML or a raw DOM snapshot.

```ts
type ComponentFingerprint = {
  selection: {
    method: "recorder" | "inspector" | "manual";
    primaryStrategy: string;
  };
  semantic: {
    role?: string;
    accessibleName?: string;
    labelText?: string;
    stableText?: string;
    placeholder?: string;
    title?: string;
    altText?: string;
    name?: string;
    inputType?: string;
    stableDataAttributes?: Record<string, string>;
  };
  structural: {
    form?: ContextSignature;
    ancestors: ContextSignature[]; // maximum two meaningful containers
    siblingSignature?: string;
    rowOrCardSignature?: string;
    relativeIndex?: number;
    nearbyLabel?: string;
  };
  technical: {
    stableId?: string;
    cssCandidates: string[];
    xpathCandidate?: string;
    domPath?: string;
    shadowPath?: ShadowPath;
    framePath?: string[];
  };
  behavioral: {
    capabilities: string[];
    href?: string;
    controlState?: string;
  };
  visual?: {
    landmark?: string;
    relativeBounds?: { x: number; y: number; width: number; height: number };
  };
};
```

Visual facts are a final tiebreaker only. They cannot establish component identity by themselves.

### 5.7 Node target reference

Replace legacy node fields such as `targetFallbacks`, `targetSnapshot`, `ctrlHash`, and generated `friendlyName` with a compact reference:

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

A DOM node stores `componentRef` and its ordinary action configuration. The component record owns locators and fingerprints.

No automatic migration of old recordings is required. New test workflows must be recorded after this change.

---

## 6. Component naming

### 6.1 Canonical format

Use:

```text
[website]_[page]_[component]
```

Examples:

```text
example_com_account_settings_save
example_com_checkout_shipping_continue
example_com_search_search_input
```

Normalize names to lowercase ASCII-safe tokens separated by underscores. Preserve readability over compression.

### 6.2 Naming algorithm

1. `website`: normalized hostname, such as `example_com`.
2. `page`: normalized page-profile path, such as `account_settings`; use `home` for `/`.
3. `component`: choose the most meaningful stable semantic seed in this order:
   - explicit user alias, if supplied during creation;
   - stable testing/data attribute;
   - accessible name plus role/type;
   - associated label plus role/type;
   - stable text plus role;
   - name, placeholder, title, or stable ID;
   - generic semantic role such as `button`, `textbox`, or `link`.
4. If the base component token is duplicated, climb up to **two** meaningful ancestor containers and prefix context, for example `billing_save` versus `profile_save`.
5. If it remains duplicated, append a numeric suffix: `_2`, `_3`, and so on.
6. Lock the resulting `componentId` at creation. Never regenerate it after label, copy, or position drift.
7. An optional `displayName` may be edited in the Inspector, but it is not used as the resolver identity.

### 6.3 Hash policy

An ephemeral control handle may still be calculated inside one content-script session for speed. It is technical recovery evidence only:

- never use it as the canonical Component ID;
- never show it as the main user-facing name;
- never use it as the sole persisted recovery mechanism;
- log it only in diagnostic detail when required.

---

## 7. Workflow-scoped mapper settings

All settings live under `workflow.settings.mapper`. A workflow owns its own defaults and its own site/page overrides.

### 7.1 Precedence

```text
workflow default < workflow site override < workflow page override
```

Do not introduce extension-global mapper settings. Do not put mapper behavior in individual node configuration unless a future design explicitly adds a node-level exception.

### 7.2 Settings schema

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

Validate all numeric limits against safe ranges. Expose the configuration in workflow settings and show the **effective policy** in the Inspector for the selected site/page.

### 7.3 Mapping modes

| Mode | Behavior |
|---|---|
| `runtime` | Build/refresh the map when a DOM node reaches a page. |
| `preflight` | Map only pages that the user explicitly opens or selects for non-action validation. Do not secretly replay workflow actions or automatic navigation. |
| `hybrid` | Default. Reuse a fresh map; validate it when an eligible page is reached; refresh/reconcile once on a stale map or target failure. |

`mappingTrigger` can be `automatic` or `explicit`. A page override can require a manual **Map this page** action even when the workflow default is automatic.

### 7.4 Exhaustiveness tiers

| Tier | Map scope | Intended use |
|---|---|---|
| 1 | Visible actionable controls: buttons, links, form controls, supported ARIA controls, contenteditable controls. | Default; fastest and safest. |
| 2 | Tier 1 plus extractable semantic roots: tables, lists, labelled regions, dialogs, and stable content containers. | Workflows using extraction nodes. |
| 3 | Tier 2 plus stable structural entities: cards, rows, tabs, menus, navigation groups, and landmark containers. | Advanced structured pages. |
| 4 | All meaningful non-decorative semantic elements under strict caps. Never all raw DOM nodes. | Explicit troubleshooting only. |

Tier 4 must still obey component and serialized-size limits.

### 7.5 Fixed scoring profile

Use one documented, versioned scoring profile in the first release. Do not add learned or self-tuning weights.

Suggested initial reconciliation weights:

| Evidence family | Maximum points |
|---|---:|
| Semantic identity | 45 |
| Structural context | 30 |
| Technical selectors | 15 |
| Behavioral compatibility | 8 |
| Visual tiebreaker | 2 |

Suggested fixed rules:

- Primary locator: must produce exactly one compatible candidate.
- Fallback locator: candidate score must be at least `75` and exceed runner-up by at least `15` points.
- Historical reconciliation: `same` at `80+` with a `15+` point margin; `changed` at `65–79` with a `15+` point margin; otherwise `ambiguous` or `new` as appropriate.
- Any contradictory high-confidence semantic evidence is disqualifying even if a total score is high.
- Visual evidence cannot repair a weak semantic/structural match.

Put these values in `SCORING_PROFILE_V1`, log its version, and cover it with unit tests. Do not expose free-form threshold tuning in the first workflow UI.

---

## 8. Mapping and resolution behavior

### 8.1 Capture behavior

When the recorder captures an element:

1. Resolve the event target through `event.composedPath()` so a control inside an open shadow root is identified correctly.
2. Ensure a current map exists for the effective workflow/site/page policy.
3. Build a fingerprint for the selected live element.
4. Reconcile it against the current page map or create a new component.
5. Assign/return the locked readable Component ID.
6. Store only `componentRef` in the recorded node.
7. Display the canonical Component ID and readable display name in the recorder highlight and Studio.

The recorder may propose a primary locator, but must retain that chosen primary locator rather than later recomputing it from current label scores.

### 8.2 Resolution algorithm

Implement this order exactly:

```text
1. Validate current page profile.
2. Ensure map freshness under the effective hybrid policy.
3. Resolve the component’s primary locator.
4. Resolve stored fallback locators in hierarchy order:
   semantic → structural → technical → behavioral → visual.
5. If still unresolved, reconcile historical component fingerprint against the current live map.
6. Validate target action readiness.
7. Return a resolver state and full structured diagnostics.
```

For every locator strategy:

- collect **all** candidate elements, never just `document.querySelector()` or the first visible match;
- filter by frame/shadow scope, visibility, enabled state, action capability, and contextual compatibility;
- score all remaining candidates;
- require a unique winner and the required margin;
- return `ambiguous` instead of taking document order as a tiebreaker.

### 8.3 Action validation

The selected target must be compatible with the requested action:

| Action class | Required checks |
|---|---|
| Click, double-click, hover | visible, connected, actionable/clickable, not disabled, pointer target not occluded after scroll-into-view |
| Type, clear | editable input/textarea/contenteditable, not readonly/disabled, visible |
| Select/toggle | expected native or accessible control capability, enabled, visible |
| Upload | native file input only; do not fake upload on another control |
| Extraction | target exists, visible when the node requires visible content, and matches expected extraction capability |

Keep the existing just-in-time occlusion check, but run it after resolver identity succeeds and before the action is dispatched.

### 8.4 Map freshness and invalidation

Replace full control-map rebuilds on every mutation with a bounded lifecycle:

- Invalidate/revalidate on navigation, history route changes, major URL changes, and material candidate-relevant DOM changes.
- Debounce material mutations using the workflow policy.
- Observe only while a workflow is recording, actively resolving, preflighting, or inspecting the page.
- During idle/background use, mark maps potentially stale instead of continuously rebuilding.
- Rebuild incrementally when possible; otherwise build one bounded version and reconcile once.
- Stop early when a unique verified target has already been found.

### 8.5 Static-only safety gate for the first release

The first production mapper supports static/bounded pages only.

During initial mapping, sample relevant mutations for the configured window. When mutation volume exceeds the policy limit, classify the page as `dynamic_deferred` rather than pretending it is static.

For `dynamic_deferred` pages in this release:

- do not claim persistent map reliability;
- do not use fuzzy historical reconciliation as an action basis;
- return `protected_unsupported` for mapped interactions unless a later phase explicitly enables dynamic support;
- show the reason in the Inspector and logs.

This is a safe decline, not partial dynamic-site support.

---

## 9. Open Shadow DOM support

Open Shadow DOM is in the initial supported scope.

### 9.1 Traversal

- Recursively scan `document` and every reachable `element.shadowRoot` where the root is open.
- Apply exhaustiveness tiers inside each root.
- Attach mutation observers to discovered open roots and newly discovered hosts while the mapper is active.
- Use composed event paths during recording/highlighting to locate the actual inner control.

### 9.2 Shadow locator format

Persist a `shadowPath` instead of a single document CSS selector:

```ts
type ShadowPath = {
  hosts: Array<{
    locator: LocatorCandidate;
    fingerprint: ContextSignature;
  }>;
  targetLocator: LocatorCandidate;
};
```

Resolve host-by-host, requiring each host to be unique and compatible before querying the next open shadow root. Apply the same ambiguity rules at every boundary.

### 9.3 Hard limit

Closed shadow roots are permanently inaccessible to ordinary DOM mapping. Return `protected_unsupported` with reason `closed_shadow_root`; never pretend a CSS fallback can see into one.

---

## 10. Workflow execution and graph changes

The current graph schema supports only a linear success path. That is incompatible with the requirement that ambiguity must not stop the whole workflow.

### 10.1 Introduce graph workflow schema v3

For DOM-dependent nodes, add source handles:

```text
success
unresolved
```

`unresolved` covers `ambiguous`, `not_found`, `map_stale` after retry exhaustion, and `protected_unsupported`.

Rules:

1. On `resolved` or `resolved_with_fallback`, execute the action and follow `success`.
2. On all unresolved states, do not execute the action. Store the structured result in node output, log it, and follow `unresolved`.
3. Workflows containing DOM nodes must supply an `unresolved` edge, or the validator rejects them before run.
4. Do not silently skip an unresolved node onto `success`.
5. Add a terminal “Needs attention” node for authors who want a controlled, visible end state.

This change is safe because existing workflows are disposable test workflows.

### 10.2 Node output

Expose a serializable result for downstream logic:

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

Redact protected text fields before this output is retained or exported on sensitive sites.

### 10.3 Runtime routing

Refactor the background executor from a `for` loop over linear steps into graph traversal that chooses an outgoing edge from the node outcome. This work is a prerequisite for the new mapper; do not fake an unresolved branch by swallowing errors inside `executeContentStep`.

---

## 11. Persistence and privacy

### 11.1 Initial Chrome storage implementation

Implement a `MapStore` interface and use `chrome.storage.local` first.

```ts
interface MapStore {
  getWorkflowMapperState(workflowId: string): Promise<WorkflowMapperState | null>;
  getPageMap(workflowId: string, siteKey: string, pageProfileKey: string): Promise<PageMapVersion[]>;
  putPageMap(workflowId: string, map: PageMapVersion): Promise<void>;
  deletePageMap(workflowId: string, siteKey: string, pageProfileKey: string): Promise<void>;
  listPageMaps(workflowId: string): Promise<PageMapIndexEntry[]>;
}
```

Store page maps separately from the workflow JSON, keyed by stable workflow ID. Keep only compact fingerprints, map metadata, component records, versions, and diff summaries.

Never store:

- complete raw DOM/HTML snapshots;
- passwords, typed text-input values, cookies, auth tokens, or session data;
- arbitrary page body text;
- unbounded CSS class lists or unbounded nearby text.

### 11.2 Sensitive sites/pages

A sensitive flag is maintained in the active workflow’s site/page override.

When sensitive:

- omit visible text, nearby text, labels, placeholders, titles, and extracted free-text fields from persisted maps and exported logs;
- retain only redacted/hardened structural and behavioral signals needed for safe resolution;
- show a visible sensitivity badge in the Inspector;
- do not lower resolver safety thresholds because evidence is redacted.

### 11.3 Future filesystem persistence

After the Chrome storage version is stable, add a filesystem `MapStore` adapter through the project’s existing local-host bridge.

Required behavior:

- site-keyed JSON files;
- schema-version field and forward-compatibility check;
- atomic write/rename;
- bounded version retention;
- request timeout and unreachable-host result states;
- payload chunking for oversized data, although normal maps should remain below the configured cap;
- multi-tab conflict rule: last-write-wins plus a retained diff record.

The supplied tracking document describes a native messaging host. BRunner already has a WebSocket-based local host. Do **not** add a second transport merely to reach parity. Use the existing host behind the `MapStore` contract unless a separate product decision requires native messaging. The observable persistence behavior—not transport duplication—is the parity requirement.

---

## 12. Dedicated Mapper Inspector

Create an extension-owned dedicated window, for example through `chrome.windows.create`, at `mapper-inspector/index.html`.

### Required Inspector features

- Select workflow, site profile, page profile, and map version.
- Search by canonical Component ID, display name, role, and status.
- Visual tree/list of mapped components with semantic and structural context.
- State badges: `same`, `changed`, `new`, `removed`, `ambiguous`, `dynamic_deferred`, `unsupported`.
- Show primary locator, fallback hierarchy, compact fingerprint, expected capabilities, and historical links.
- Run a live resolution check **before** showing a highlight.
- Highlight the resolved element only after a successful, unique live resolution.
- Scroll the resolved element into view before highlighting.
- Provide a Review Queue for changed and ambiguous components.
- Allow workflow-local page/site override changes: mapping trigger, query allowlist, sensitivity, and static/dynamic-deferred override where allowed.
- Allow optional display-name alias editing without changing canonical Component ID.
- Show current effective workflow mapper settings and profile-normalization rationale.

The Inspector must never offer a “choose first candidate” action for an ambiguous result. A reviewer may explicitly link a historical component to a selected candidate, recording that decision in the next map version.

---

## 13. Concrete code migration

| Current area | Required change |
|---|---|
| `content/targetResolver.js` | Retire as the authoritative resolver. Its useful candidate extraction can be ported into the DOM adapter, but replace first-match and threshold-only fuzzy logic with Mapper Core scoring/margin behavior. |
| `content/mapper.js` | Convert from flat `controls` map to a per-tab `ContentMapperSession` that builds/reconciles page maps, supports open shadow roots, handles map messages, and delegates identity decisions to Mapper Core. |
| `background.js` | Add mapper coordinator and MapStore integration; send component references/context to content scripts; consume resolver results; dispatch graph outcome handles. |
| `core/workflowSchema.js` | Add schema v3 graph validation with `success` and `unresolved` handles; reject DOM nodes without unresolved routing. |
| `core/workflowUtils.js` | Replace domain-only compatibility with page-profile normalization from Mapper Core. |
| `core/constants.js` | Add mapper message names, resolver states, mapping actions, and schema/version constants. |
| `studio/app.js` and graph editor | Replace target text/friendly-name editing for mapped nodes with ComponentRef display and Inspector launch; add workflow mapper settings section. |
| `studio-graph-src` | Render/validate `unresolved` output handles for DOM-dependent nodes and provide the controlled “Needs attention” end node. |
| `manifest.json` | Load the Mapper Core content bundle before the DOM adapter/session. Add Inspector resources. Do not enable `all_frames` in the first scope. |
| `test.html` | Replace the old fallback-only smoke harness with mapper fixtures covering naming, ambiguity, reconciliation, page normalization, storage, and open shadow roots. |

### Legacy fields to remove from newly saved workflows

```text
targetFallbacks
targetSnapshot
ctrlHash as canonical identity
friendlyName as identity
raw CSS selector as normal recorder output
```

A manual advanced locator can exist later, but it must be labelled as an explicit override and still pass action validation and ambiguity rules.

---

## 14. Implementation milestones

### Milestone 0 — Foundation and break-point

**Goal:** Establish one source of truth before changing behavior.

- Add Mapper Core source, build step, policy types, schema version constants, and unit-test harness.
- Add `workflow.settings.mapper` schema and validation.
- Upgrade new workflows to graph schema v3 with `success`/`unresolved` routing.
- Define MapStore adapter and Chrome storage implementation skeleton.
- Remove the requirement to support old test recordings.

**Exit criteria:** A new blank workflow can save mapper settings and a DOM node can carry a placeholder `ComponentRef`; graph validation requires unresolved routing.

### Milestone 1 — Static page map, naming, and safe resolution

**Goal:** Replace per-step locator persistence with a bounded static page map.

- Implement page normalization, workflow-local site/page overrides, and profile conflict detection.
- Implement tiers 1–4 and enforce map component/size caps.
- Implement compact semantic/structural/technical/behavioral/visual fingerprints.
- Implement canonical naming, two-ancestor disambiguation, numeric suffixes, name locking, and optional aliases.
- Implement recorder capture into ComponentRef.
- Implement primary-first resolution, ordered fallback hierarchy, full candidate enumeration, scoring, action validation, and `ambiguous` state.
- Carry forward the existing visibility, enablement, scroll, and occlusion safety checks.
- Add static-only mutation sampling gate and `dynamic_deferred` safe decline.

**Exit criteria:** A recorded static-page component survives an ID, class, CSS-path, or layout-order change only when enough independent evidence remains. Duplicate “Save” controls produce `ambiguous`, never a click.

### Milestone 2 — Open Shadow DOM, map history, and reconciliation

**Goal:** Deliver resilience across page-map versions on the supported scope.

- Add recursive open-shadow traversal, composed-path capture, shadow paths, and shadow-root mutation observation.
- Add bounded page-map version history and reconciliation outcomes: same, changed, new, removed, ambiguous.
- Preserve historical Component IDs on strong semantic/structural matches.
- Mark changed/ambiguous associations for review.
- Implement stale/invalidation lifecycle and hybrid runtime refresh behavior.
- Add structured resolver/reconciliation logging and node output.

**Exit criteria:** A component moved within a page retains its Component ID; labels may drift without ID regeneration; close-score alternatives are not auto-linked or interacted with.

### Milestone 3 — Dedicated Inspector and workflow configuration UX

**Goal:** Make mapper behavior visible, reviewable, and controllable.

- Create dedicated Inspector window.
- Add map browsing, search, live resolution check, highlight, scroll, Review Queue, aliases, and effective-policy view.
- Add workflow settings UI for defaults and nested site/page overrides.
- Add manual Map This Page and explicit-trigger mode.
- Add sensitive flag and redacted display behavior.

**Exit criteria:** A reviewer can locate a component by canonical ID, see why it resolved or failed, safely inspect it live, and resolve a changed/ambiguous mapping without changing its canonical name.

### Milestone 4 — Filesystem map persistence

**Goal:** Make maps durable and portable without changing resolver behavior.

- Add local-host MapStore adapter, commands, file format, schema checks, atomic writes, timeouts, and host-unavailable state.
- Add optional periodic snapshot persistence for active tracking.
- Implement bounded multi-tab last-write-wins merge with retained diff metadata.

**Exit criteria:** Chrome storage and filesystem adapters produce identical map schema and equivalent resolution behavior.

### Milestone 5 — Deferred dynamic, feed, and frame support

**Goal:** Expand scope without weakening static-page guarantees.

- Region-level static/dynamic/infinite/unsupported classification.
- Dynamic-region identity rules that exclude volatile text/position.
- Repeatable feed-template component IDs and pattern + condition resolution.
- Explicit feed-item pinning, loaded-content-only policy, no automatic scroll/pagination.
- Same-origin frame routing and cross-frame Inspector messaging where permissions permit.

Do not begin this milestone until static/open-shadow reliability tests are stable.

---

## 15. Required test suite

### 15.1 Unit tests for Mapper Core

Add deterministic tests for:

- page normalization and query allowlists;
- profile conflict detection;
- canonical naming, ancestor context, numeric suffixes, and locked-name behavior;
- candidate scoring, exact primary resolution, runner-up margin, and contradiction rejection;
- reconciliation outcomes: same, changed, new, removed, ambiguous;
- size/component/version caps;
- sensitive-data redaction;
- serialization/deserialization compatibility;
- policy precedence: workflow default < workflow site override < workflow page override.

### 15.2 Browser integration fixtures

Create dedicated fixtures for:

1. **Primary drift:** ID changes while the selected semantic primary/fingerprint remains valid; outcome is `resolved_with_fallback`.
2. **Moved control:** Same button moves between containers; canonical Component ID remains unchanged after reconciliation.
3. **Duplicate labels:** Two equally plausible Save controls; outcome is `ambiguous`, click count remains zero, unresolved branch runs.
4. **Context disambiguation:** Two Save controls in different forms/cards create meaningful unique canonical IDs.
5. **Name lock:** Text changes after map creation; canonical ID stays unchanged while status becomes `changed` where appropriate.
6. **Wrong page:** Same-domain but incompatible page profile; the resolver does not treat it as compatible.
7. **Query allowlist:** Same path with an allowed query parameter creates distinct profiles; ignored parameters do not.
8. **Stale map:** Material DOM change marks map stale, causes one refresh/reconcile, then resolves or returns a handled unresolved state.
9. **Open Shadow DOM:** Record, resolve, click, type, and highlight controls inside nested open roots.
10. **Closed Shadow DOM:** Return `protected_unsupported`; no selector workaround is attempted.
11. **Mutation-heavy page:** Page becomes `dynamic_deferred`; no persistent-mapper interaction claim is made.
12. **Storage restart:** Close/reopen extension context, reload map, and resolve the same static component.
13. **Sensitive page:** Persisted data/logs contain no visible/free text fields.
14. **Inspector:** Live highlight refuses ambiguous components and succeeds only after a unique live resolution.

### 15.3 Regression rule

A test is incomplete unless it asserts both:

1. **what state the resolver returned**, and
2. **whether the underlying browser action did or did not execute**.

The old test harness’s “invalidate primary ID” test is insufficient because it changes an ID while an earlier `aria-label` candidate can still remain valid. Replace it with fixtures that invalidate the actual recorded primary locator and separately verify fallback and ambiguity behavior.

---

## 16. Acceptance criteria for supported-scope parity

Do not claim mapper parity until all statements below are true for static/bounded pages and open Shadow DOM:

- Every recorded DOM node references a persistent readable Component ID, not a hash or raw step snapshot.
- Component IDs follow the locked naming rules and are searchable in the Inspector and logs.
- The resolver uses primary-first, then ordered fallback, then historical reconciliation.
- A direct or fuzzy locator never wins solely because it appears first in document order.
- The resolver returns an explicit ambiguity result when the winner margin is inadequate.
- Ambiguous and not-found targets never receive an interaction event.
- Workflows follow explicit unresolved branches instead of crashing or silently continuing on success.
- Maps are site/page scoped with workflow-local path/query normalization and conflict detection.
- Version history records same/changed/new/removed/ambiguous component outcomes.
- Hybrid mapping and stale-map refresh behavior work under bounded limits.
- Open-shadow controls can be captured, named, resolved, and interacted with safely.
- Closed shadow roots and deferred dynamic pages produce an honest unsupported state.
- Map persistence is compact, bounded, and redacted for sensitive pages.
- The Inspector can show why a component resolved, changed, or failed without allowing unsafe auto-selection.

---

## 17. Explicit non-goals for this conversion

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
- “best available candidate” clicks when scores are close.

---

## 18. Implementation guardrails for Codex

1. Treat the tracking document’s task list as desired capability coverage, but follow this plan’s resolved decisions where the original design left options open.
2. Do not retain `ctrlHash` as the durable identity model.
3. Do not use `querySelector()` or first visible element as a terminal resolution decision.
4. Do not add a generic catch block that turns mapper failures into success-path skips.
5. Do not ship a UI switch that allows automatic selection of ambiguous targets.
6. Do not store raw DOM, input values, passwords, cookies, tokens, or unbounded page text.
7. Do not enable dynamic/infinite behavior merely because a MutationObserver exists.
8. Keep scoring constants deterministic and tested; defer automatic tuning.
9. Ensure component naming and resolver logs use locked readable IDs.
10. Keep the pure Mapper Core portable so a future standalone implementation can use the same scoring, naming, result states, and serialized map schema.

