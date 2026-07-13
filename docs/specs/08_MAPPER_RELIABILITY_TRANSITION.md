# Specification 08 - Mapper Reliability Foundation

## Status

This specification defines the mapper engine that the final node system will
consume. The source foundation is substantially implemented; deterministic and
live engine acceptance remain the completion gate.

The current node catalogue and Studio integrations are provisional. This phase
does not retrofit current nodes, require graph-schema authoring changes, or use
current-node execution as its product boundary. It exposes node-neutral mapping
APIs and stable data contracts so final nodes can integrate later.

The saved-map explorer/Mapper Inspector is likewise not the mapper deliverable.
Existing viewer code is a developer prototype. Polished windows, navigation,
Tree/Graph presentation, review workflows, responsive behavior, and
accessibility are deferred to V2.

## Goal

Reliably map and track actionable and semantic page elements together with the
context needed to find the intended element again. The mapper must let a future
node:

1. scan a page without naming a current node type;
2. retain a stable `ComponentRef`;
3. resolve that reference against the current live page;
4. revalidate it without performing an action;
5. explicitly refresh and reconcile its page map;
6. receive deterministic resolved, ambiguous, missing, stale, deferred, or
   protected outcomes.

## Phase Boundary

In scope:

- page/site normalization and workflow-local maps;
- actionable and semantic element discovery;
- actual contextual hierarchy and container scope;
- locked readable Component IDs and `ComponentRef`;
- fixed resolver rules, compatibility checks, and diagnostics;
- revalidation, refresh, reconciliation, and bounded history;
- bounded dynamic regions, open Shadow DOM, and extension-accessible frames;
- conservative repeated-record and contextual profile evidence;
- portable engine APIs and deterministic/live acceptance.

Deferred:

- retrofitting the current provisional nodes or their authoring controls;
- current Graph Studio outcome-handle requirements;
- polished saved-map explorer/Inspector windows and navigation;
- viewer aliases, review queues, policy editors, hierarchy graphs, legends,
  highlighting UX, responsive behavior, and accessibility acceptance;
- final-node-specific branching, retries, waits, form fill, extraction, or
  interaction behavior;
- product-specific UI/support claims for chat and social applications.

## Reliability Contract

The mapper engine must:

1. create a stable reference only from bounded evidence;
2. try a saved primary locator as a direct unique match;
3. try ordered saved fallbacks as direct unique matches;
4. enumerate all remaining compatible candidates before scoring;
5. require a fixed minimum score and winner margin;
6. reject incompatible, ambiguous, stale, deferred, or protected candidates;
7. never choose the first document-order match as a tie-breaker;
8. preserve identity across drift only when evidence is strong and unique;
9. keep static and dynamic identity lanes separate;
10. return structured evidence without performing a browser action.

Final nodes decide what to do with the mapper result during the later node phase.

## Node-Neutral API

The portable mapper contract must expose equivalents of:

```text
scanPage(context, options?) -> PageMapResult
getPageMap(workflowId, pageRef) -> PageMap | null
createComponentRef(pageMap, componentId) -> ComponentRef
resolveComponent(context, componentRef, requirements?) -> ResolverResult
revalidateComponent(context, componentRef, requirements?) -> ResolverResult
refreshPageMap(context, options?) -> RefreshResult
```

Names may differ in code, but the behavior must be callable without a current
node definition or Studio form. `requirements` may describe capabilities such
as click, input, selection, extraction, visibility, or enabled state without
binding the mapper to a particular final node.

### Scan

`scanPage` enumerates eligible actionable and semantic elements, captures
bounded evidence, builds contextual hierarchy, creates locked identities, and
returns a page-map version. It does not click, type, scroll feeds, or execute a
node.

### Resolve

`resolveComponent` resolves a saved reference against live candidates. It is
read-only apart from bounded diagnostics/telemetry needed by the local map.

### Revalidate

`revalidateComponent` checks whether a saved reference is still unique,
compatible, visible when required, and contextually correct. It does not persist
a new map version unless explicitly documented by the caller contract.

### Refresh

`refreshPageMap` rescans a selected page after it settles, reconciles against
the applicable static/dynamic history, writes one bounded retained version, and
does not mutate unrelated page profiles.

## Resolver States

| State | Meaning |
|---|---|
| `resolved` | Saved primary locator produced one compatible candidate. |
| `resolved_with_fallback` | Ordered fallback or scored recovery produced one strong unique candidate. |
| `ambiguous` | Multiple direct matches, inadequate score, or inadequate winner margin. |
| `not_found` | No compatible candidate remained after bounded attempts. |
| `hidden` | The saved target exists but is not currently visible when visibility is required. |
| `map_stale` | Page/map identity changed and requires explicit revalidation or refresh. |
| `dynamic_deferred` | Mutation/loaded-window behavior exceeds the supported bounded policy. |
| `protected_unsupported` | The target is behind an unsupported boundary such as closed Shadow DOM or a frame where the extension cannot establish a usable context. |

No unresolved state may be converted to success merely because a candidate
exists.

## Discovery Model

### Actionable Elements

At normal tiers, discovery includes visible/enabled semantic controls such as:

- buttons and button-like controls;
- links and navigation controls;
- text inputs, textareas, selects, comboboxes, checkboxes, and radios;
- focusable or explicitly interactive custom controls;
- media/file controls where their semantic role is available.

### Semantic Elements

Under bounded policy, discovery may also include meaningful headings, labels,
images, visible leaf text, status/output containers, table/list records, and
other content that future wait, extraction, screenshot, or context-aware nodes
may need.

The engine is node-neutral: inclusion is based on semantic usefulness and
bounds, not the current node catalogue.

### Contextual Hierarchy

Every component should retain enough actual hierarchy to distinguish similar
elements. Context may include:

```text
site
  page profile
    top document or same-origin frame document
      open shadow host chain
        landmark/container/form
          repeated record or bounded dynamic region
            component
```

The saved hierarchy follows the real DOM/container relationship. Semantic
profile facts may supplement it but must not flatten or replace it.

## Identity Model

### Page Identity

Page maps are scoped by workflow plus normalized site/page identity. Query
parameters are ignored unless workflow-local policy explicitly includes them.
Different page profiles for the same site remain isolated.

### Component ID

Component IDs are readable, deterministic at creation, and locked afterward.
Names use stable semantic evidence plus bounded ancestor/container context and a
deterministic suffix only when necessary. A later label, class, DOM path, or
layout change does not regenerate the ID.

### ComponentRef

```json
{
  "schema": "mapper.component_ref.v1",
  "workflowId": "workflow-id",
  "siteKey": "example_com",
  "pageProfileKey": "example_com::checkout",
  "componentId": "example_com_checkout_shipping_continue"
}
```

A ComponentRef is independent of any current node. Locator packages,
fingerprints, history, and hierarchy remain owned by the page map.

## Evidence and Fingerprints

Evidence may include bounded:

- accessible name, label, visible text, value, placeholder, and title;
- role, tag, type, stable attributes, and primary/fallback locators;
- form, landmark, container, nearby-label, and ancestor context;
- frame path and open-shadow host path;
- repeated-record, card/thread, dynamic-region, and loaded-window scope;
- visibility, enablement, document bounds, and capture order;
- prior component UID, version links, and reconciliation decisions.

Local page maps and diagnostics are user-managed. They may contain raw page
content or values required for local reliability and debugging. Runtime
redaction, sensitive-site modes, and content-hiding policy are outside this
mapper phase. Data must still be bounded and schema-valid.

## Resolution Algorithm

1. Validate workflow/site/page/frame context.
2. Load the referenced component and applicable map version.
3. Enumerate live candidates inside the permitted document/shadow/container
   scope.
4. Remove candidates incompatible with requested capabilities.
5. Try the saved primary locator; accept only exactly one compatible match.
6. Try ordered fallbacks with the same uniqueness rule.
7. Score every remaining compatible candidate.
8. Require score at least `75` and winner margin at least `15` unless a later
   versioned scoring profile changes both deterministically.
9. Return a structured state, selected candidate when safe, runner-up, evidence,
   attempts, and reason.

No first-match shortcut is allowed at any stage.

## Reconciliation

Reconciliation compares a fresh scan with the correct historical lane:

- exact/strong unique evidence preserves the locked Component ID;
- changed facts are recorded without regenerating identity;
- new components receive new identities;
- unmatched historical components become removed records;
- weak or close history becomes new plus removed, not a guessed rebind;
- genuine conflicts remain ambiguous;
- static records reconcile only with static history;
- dynamic/loaded-window records reconcile only with dynamic history.

Automatic decisions record their reason, score, runner-up margin, and policy.

## Dynamic Regions and Repeated Records

- Stable page controls remain in the static lane.
- Bounded changing regions may use `hybrid_dynamic` and retain only the loaded
  window under configured caps.
- Excessive mutation returns `dynamic_deferred` without erasing the usable
  static map.
- Explicit refresh uses a settled-current-DOM snapshot.
- The mapper does not auto-scroll, paginate, or claim unloaded feed history.
- Repeated records require a durable key or independently verified container
  scope. Indistinguishable siblings remain unresolved.

## Shadow DOM and Frames

Open Shadow DOM is traversed host-by-host. Every host boundary must resolve
uniquely before entering the next root, and the composed path is retained.
Closed roots are protected unsupported.

Every extension-accessible frame has a distinct document root and stable frame
context. Its hierarchy must not merge with the top document or a sibling frame.
Cross-origin alone is not a reason to refuse mapping when the extension has host
permission and a running content script in that frame. Frames where the
extension cannot inject or establish a stable context return
`protected_unsupported`.

## Context Profiles

Chat/social context inference may provide application-shell, pane, thread/card,
repeat, composer/action-area, and loaded-window boundaries. These facts constrain
candidate eligibility before locator scoring. They remain engine evidence, not a
requirement for product-specific viewer presentation. See
`11_MAPPER_PLATFORM_APP_PROFILES.md`.

## Persistence

Chrome storage remains the active MapStore. Maps are local, user-managed,
disposable artifacts and may be recreated from the page. Persistence must:

- validate schema versions;
- retain a bounded number of versions per workflow/page;
- cap component/evidence/diagnostic sizes;
- isolate workflow and page updates;
- serialize writes or use revisions so concurrent frames, tabs, refreshes, and
  diagnostics cannot overwrite newer map state;
- avoid rewriting the complete map corpus for an unrelated page update;
- reject malformed or unsupported records safely;
- preserve deterministic ordering and identity history.

The native filesystem MapStore adapter remains inactive and is not a product
dependency.

## Engine Diagnostics

Each scan/resolve/revalidate/refresh result should expose enough bounded evidence
to reproduce a decision:

- page and map identity;
- component and context identity;
- requested capabilities;
- primary/fallback attempts;
- selected candidate and runner-up when present;
- score, margin, thresholds, and evidence;
- reconciliation lane and decision;
- final state and reason.

Diagnostics are an engine contract. A future viewer may present them differently.

## Required Deterministic Tests

1. Page normalization and query policy.
2. Locked Component ID naming and duplicate contextual disambiguation.
3. Primary unique match, duplicate primary ambiguity, and ordered fallbacks.
4. Candidate compatibility filtering.
5. Fixed score threshold and winner margin.
6. No document-order tie-breaking.
7. Strong reconciliation, weak new-plus-removed, and genuine ambiguity.
8. Static/dynamic lane isolation.
9. Bounded history and unrelated-page isolation.
10. Hybrid dynamic refresh and `dynamic_deferred` recovery after settling.
11. Open-shadow composed paths and closed-root protection.
12. Same-origin and extension-accessible cross-origin frame isolation, plus
    honest refusal for inaccessible frames.
13. Repeated container/thread/card scope contradictions.
14. Schema rejection and component/diagnostic caps.
15. Node-neutral use of scan, ComponentRef, resolve, revalidate, and refresh.
16. Concurrent-write ordering, stale-revision retry/rejection, quota behavior,
    and bounded large-page persistence.

## Live Engine Acceptance

Use `../MAPPER_MANUAL_ACCEPTANCE.md`. Live acceptance must cover static controls,
semantic content, duplicate labels, controlled drift, ambiguity, refresh/version
isolation, bounded dynamics, mutation-heavy decline, repeated records, open
Shadow DOM, frames, and contextual chat/social fixtures.

Viewer layout, navigation, highlighting polish, responsiveness, accessibility,
and current-node execution are not substitutes for engine evidence and are not
mapper-phase gates.

## Acceptance Criteria

The mapper foundation is accepted when:

- scan reliably returns actionable and semantic components plus actual
  contextual hierarchy within bounds;
- every retained component has a locked readable identity and can produce a
  node-neutral ComponentRef;
- resolve and revalidate enforce context, compatibility, uniqueness, score, and
  margin without performing an action;
- ambiguous/not-found/stale/deferred/protected cases never yield a selected
  candidate;
- reconciliation preserves identity only with strong unique evidence;
- static and dynamic histories remain isolated;
- explicit refresh updates only the selected page and retains bounded history;
- open-shadow and extension-accessible-frame paths work while unsupported boundaries fail
  honestly;
- deterministic tests and the live engine checklist pass;
- final nodes can integrate the API without depending on the current node or
  saved-map viewer implementations.

## V2 Saved-Map Viewer

After engine acceptance, V2 may productize a dedicated saved-map explorer and
Mapper Inspector with site/page/version navigation, search, Tree/Graph views,
details, aliases, review workflows, policy editing, live highlighting, and
responsive/accessibility behavior. Specifications 10 and 11 retain viewer and
profile-presentation backlog without expanding the mapper engine gate.

## Guardrails

1. Do not retain `ctrlHash` or a generated selector as durable identity.
2. Do not use `querySelector()`/first visible element as a terminal decision.
3. Do not cross page, frame, shadow, container, thread, card, or mapping-layer
   boundaries to rescue a weak candidate.
4. Do not turn mapper failures into generic success.
5. Do not add current-node-specific logic to the portable mapper core.
6. Keep evidence, history, and diagnostics bounded and versioned.
7. Keep scoring constants deterministic and tested.
8. Do not make polished viewer work a prerequisite for final-node integration.
