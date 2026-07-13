# Mapper Engine Manual Acceptance

This checklist accepts the mapper engine that future nodes will consume. It does
not accept the current provisional nodes, Graph Studio authoring, or the visual
quality of the saved-map explorer/Mapper Inspector prototype.

Use the current developer mapping trigger, extension diagnostic surface, or
fixture harness only as a way to call the engine. Do not treat that transport's
layout, navigation, highlighting, responsiveness, or accessibility as a mapper
phase gate.

## Serve Fixtures

From the repository root:

```powershell
python -m http.server 8765
```

Open:

- `http://127.0.0.1:8765/BRunner_Host/mapper_test.html`
- `http://127.0.0.1:8765/BRunner_Host/mapper_stress_test.html`
- `http://127.0.0.1:8765/BRunner_Host/mapper_platform_profiles_test.html`

Reload the unpacked extension before live acceptance, especially after manifest,
content-script, mapper bundle, or frame-routing changes.

## Acceptance Record

For every scenario, retain the engine request/result and record:

- workflow, site, page, and map-version identity;
- Component ID and `ComponentRef` for the subject;
- contextual hierarchy and frame/shadow/repeat scope;
- resolver state, reason, score, runner-up, and margin when applicable;
- whether a component was returned as the selected result;
- whether revalidation or refresh created a retained version.

Local mapper data is user-managed and may include raw page content or values.
Redaction and sensitive-site display behavior are not part of this acceptance.

## 1. Node-Neutral API Contract

1. Call the mapper scan operation without supplying a current node type.
2. Confirm the result contains a page-map identity, contextual hierarchy, and
   components with locked Component IDs.
3. Choose an actionable component and a semantic/content component and create
   `ComponentRef` records for both.
4. Resolve both references through the common resolver API.
5. Revalidate each reference without performing a browser action.
6. Refresh the page map explicitly and resolve the same references again.

Expected: scan, resolve, revalidate, and refresh operate independently of the
current node catalogue or Studio schema. No test requires a current node to be
rewritten or executed.

## 2. Static Elements and Contextual Hierarchy

1. Open the static section of `mapper_test.html`.
2. Scan the page at the normal mapper tier.
3. Confirm actionable controls include buttons, links, text inputs, selects,
   checkboxes/radios, and other enabled semantic controls.
4. Confirm meaningful semantic elements needed for future extraction or context
   are included under configured bounds.
5. Confirm each component retains page/container/form/label context and the
   structural hierarchy contains the actual parent/child path.
6. Confirm duplicate **Save** controls in separate containers receive distinct
   contextual identities.

Expected: the map is useful to future click, type, wait, extraction, screenshot,
and form-oriented nodes without being tailored to any one of them.

## 3. Stable Identity and Reconciliation

1. Save the initial static map and Component IDs.
2. Apply the fixture's controlled ID/class/CSS-path drift.
3. Revalidate existing references before refreshing.
4. Refresh the map and compare retained identities and history.
5. Repeat with label/text drift, layout movement, and a controlled container
   change.

Expected: strong unique semantic/structural evidence preserves the locked
Component ID. Weak or conflicting history becomes a new component plus a
removed historical record. No close match is silently rebound.

## 4. Ambiguity and Compatibility

1. Resolve a uniquely identified control and confirm `resolved` or
   `resolved_with_fallback`.
2. Remove the unique locator while leaving sufficient fallback evidence and
   confirm ordered fallback recovery.
3. Make two candidates share the same saved locator and semantic evidence.
4. Resolve with different capability requirements, such as click versus input.
5. Create a close-score winner/runner-up pair below the required margin.

Expected: duplicate direct matches and inadequate winner margins return
`ambiguous`; incompatible candidates are rejected before scoring; document order
never breaks a tie.

## 5. Refresh and Version Isolation

1. Map two different pages for the same site and at least one unrelated site.
2. Change components on only one selected page.
3. Run read-only revalidation and confirm it does not persist a new version.
4. Run explicit refresh for the changed page.
5. Confirm bounded version retention and inspect the previous version through
   the map-store API or developer diagnostics.

Expected: only the selected page changes. Other pages and sites remain byte-for-
byte equivalent, and retention never exceeds the configured bound.

## 6. Bounded Dynamic and Mutation-Heavy Regions

1. Open `mapper_stress_test.html` and scan the stable plus bounded-dynamic
   sections.
2. Append and remove controlled dynamic records, then revalidate existing
   references.
3. Refresh after the page settles.
4. Start the mutation burst until the policy limit is exceeded.
5. Stop the burst, allow the page to settle, and refresh again.

Expected: stable/static components remain available throughout. Bounded records
use the dynamic lane and reconcile only against dynamic history. Excessive
mutation returns `dynamic_deferred`; a later explicit settled refresh can
recover without erasing the static map.

## 7. Repeated and Loaded-Window Records

1. Append repeated feed/list records under fixture control.
2. Confirm durable keys or independent container evidence produce stable,
   container-scoped records.
3. Present an unkeyed repeated record with indistinguishable siblings.
4. Change the loaded window without asking the mapper to scroll or paginate.

Expected: loaded content is mapped honestly; unloaded content is never claimed.
Unkeyed ambiguous records return a conservative unresolved/deferred reason and
never inherit an older static or sibling identity.

## 8. Open Shadow DOM

1. Scan the open-shadow fixture control.
2. Confirm its ComponentRef includes a composed host path.
3. Resolve and revalidate it after ordinary host/child drift.
4. Reload the page and resolve it again from the saved map.
5. Confirm a closed-root fixture reports protected unsupported.

Expected: open roots are traversed host-by-host with uniqueness checks at every
boundary. Closed roots are not guessed through coordinates or sibling matches.

## 9. Same-Origin and Extension-Accessible Cross-Origin Frames

1. Scan the same-origin frame fixture.
2. Confirm the frame document is a separate hierarchy root and its `body/main`
   path does not merge with the top page.
3. Resolve frame controls, reload the page, and resolve them again through the
   stable frame path.
4. Scan a cross-origin frame for which the extension has host permission and a
   running frame content script.
5. Separately test a frame the extension genuinely cannot access.

Expected: same-origin components map and resolve within their frame scope.
Accessible cross-origin components also map under an isolated frame context and
never become top-document candidates. A genuinely inaccessible frame returns a
protected outcome.

## 10. Contextual Chat/Social Fixture

1. Open `mapper_platform_profiles_test.html` and scan the chat fixture.
2. Confirm application shell, navigation/contact area, active thread, message
   records, composer, and controls have distinct contextual boundaries.
3. Switch threads, append messages, and change ephemeral counters.
4. Confirm a component from one thread cannot resolve inside another thread.
5. Repeat for social navigation, feed cards, action areas, comment composers,
   and appended loaded-window records.
6. Confirm a card action cannot resolve into a sibling card.

Expected: the engine records and enforces contextual scope conservatively. This
accepts engine facts and resolution boundaries only; polished profile-specific
Tree/Graph rendering and real-product support claims are deferred to V2.

## 11. Persistence and Restart

1. Save maps, close the mapper surface, and restart/reload the extension.
2. Load the workflow/page map through the map-store API.
3. Resolve representative static, dynamic, shadow, and frame references.
4. Corrupt a copy with an unsupported schema version and confirm safe rejection.
5. Exceed configured history/component bounds and confirm deterministic pruning.

Expected: local user-managed maps remain schema-valid, bounded, and usable after
restart. The inactive native filesystem adapter is not required.

## 12. Concurrent Persistence and Large Pages

1. Start scans or refreshes from two frames/tabs for the same workflow while a
   diagnostic reader is active.
2. Delay one storage operation so the writes complete out of order.
3. Confirm both page/frame updates survive and the store revision advances
   deterministically.
4. Repeat with two different workflows and confirm neither rewrites the other's
   stored state.
5. Scan the large-page fixture to the configured component bound and inspect
   duration, serialized size, pruning, and quota behavior.

Expected: mapper persistence serializes or rejects/retries stale revisions;
concurrent operations do not lose updates. Large pages remain bounded without
silently discarding unrelated maps.

## Completion Gate

The mapper engine is ready for final-node integration only when deterministic
tests and every applicable live section above pass. Failures must identify the
fixture, ComponentRef, resolver outcome, and evidence, not merely a viewer or
current-node UI symptom.

The following are explicitly deferred and must not block this gate:

- polished saved-map explorer/Inspector windows and navigation;
- Tree/Graph/Review Queue visual behavior;
- viewer responsive, touch, keyboard, accessibility, and styling acceptance;
- current-node/Studio retrofits;
- product-specific chat/social viewer presentation.
