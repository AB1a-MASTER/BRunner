# Mapper Engine Manual Acceptance

This checklist contains only acceptance that requires the unpacked extension,
the Mapper Inspector, and live Chrome/Chromium tabs. Persistence races, schema
validation, quota recovery, overflow bounds, and fixture integrity are covered
by the automated suites and must not be recreated by manually editing extension
storage.

The checklist accepts the node-neutral mapper engine. It does not accept the
current provisional nodes, Graph Studio node behavior, release packaging, or
the visual quality of the V2 saved-map viewer.

## Start the Fixtures

From the repository root run:

```powershell
.\start_acceptance_server.ps1
```

Open these as ordinary website tabs:

- `http://127.0.0.1:8765/BRunner_Host/mapper_test.html`
- `http://127.0.0.1:8765/BRunner_Host/mapper_stress_test.html`
- `http://127.0.0.1:8765/BRunner_Host/mapper_platform_profiles_test.html`
- `http://localhost:8765/BRunner_Host/mapper_stress_test.html` for the unrelated-site check

Then:

- [ ] Reload BRunner at `chrome://extensions`.
- [ ] Open the BRunner side panel and Mapper Inspector.
- [ ] Enter workflow ID `mapper-live-acceptance`.
- [ ] Keep the fixture being tested as the active ordinary website tab.

Use **Map Active Page** only to create an initial map or map an explicitly
changed route/page. Use **Check live resolution** for a selected component,
**Check live** for read-only map comparison, and **Refresh Map** only when a
step explicitly asks for persistence.

Use **Verify & Export** for fixture-level mapper checks. It performs a fresh
read-only mapper scan, independently enumerates the live HTML/DOM, compares all
visible top-document mapper candidates plus stable accessible-frame candidates,
checks that every mapped path remains under the document body, and downloads a
JSON report. A failure report includes missing, duplicate, tag-mismatched, and
outside-body records together with the exported PageMap and DOM manifest.

For every failure retain the workflow ID, URL, Component ID/`ComponentRef`, map
version, frame/shadow/repeat scope, resolver state/reason, score, runner-up,
margin, selected candidate, and the exported verification JSON.

## 1. Node-Neutral Static Map

- [ ] Activate `mapper_test.html` and click **Map Active Page**.
- [ ] Confirm the Tree contains Profile name/email, Profile Help, Billing email,
  Billing plan, Automatically renew billing, both Billing frequency radios, and
  both Save buttons.
- [ ] Confirm the two Save buttons have different Component IDs and remain under
  their actual Profile and Billing form/container paths.
- [ ] Confirm headings, labels, forms, and containers appear as semantic/context
  facts rather than a flattened control list.
- [ ] Select one actionable control and one semantic/content component and run
  **Check live resolution** with the default requirement.
- [ ] Confirm both resolve without any current node type being selected or run.

Pass: scan and resolution are node-neutral, the required control types are
discoverable, and contextual hierarchy distinguishes duplicate controls.

## 2. Independent Identity Drift

Map the Publish Settings target in the Source container and record its Component
ID and current map version. Before each case click **Reset Drift**, then use only
the named fixture control.

- [ ] **Apply ID/Class Drift**: run **Check live resolution**, then **Refresh Map**.
- [ ] **Apply Text/Label Drift**: revalidate, then refresh.
- [ ] **Apply Layout Drift**: revalidate, then refresh.
- [ ] **Apply Container Drift**: revalidate, then refresh.
- [ ] Confirm each strong-evidence case retains the original locked Component ID
  and records the changed evidence/history.
- [ ] Click **Replace With Weak Lookalike**, revalidate, and refresh.
- [ ] Confirm the old reference is unresolved/ambiguous/stale rather than silently
  rebound; the refreshed map represents the lookalike as new and retains the old
  component as removed history.

Pass: strong independent evidence retains identity; weak/conflicting evidence
never causes a guessed rebind.

## 3. Ambiguity and Capability Compatibility

Click **Reset Ambiguity**, refresh the page map, and select Review Account.

- [ ] Confirm its initial live result is `resolved` or
  `resolved_with_fallback`.
- [ ] Click **Remove Primary Locator** and confirm ordered fallback resolution.
- [ ] Reset, refresh, select Review Account, then click **Add Equal Duplicate**.
- [ ] Confirm live resolution is `ambiguous` and no document-order candidate is
  selected.
- [ ] Reset, refresh, select Review Account, then click **Create Close-Score
  Pair**.
- [ ] Confirm the resolver refuses the pair when the winner margin is below
  policy; record score, runner-up, and margin.
- [ ] Select `capability-input`, choose **Type/input** in **Resolution
  requirement**, and confirm it resolves.
- [ ] Select `capability-button`, keep **Type/input**, and confirm the click-only
  candidate is rejected as incompatible.
- [ ] Change the button requirement to **Click** and confirm it resolves.

Pass: direct duplicates and inadequate margins stay ambiguous, and incompatible
capabilities are rejected before scoring.

## 4. Page, Site, Version, and Read Isolation

Using workflow ID `mapper-live-acceptance`, map all four fixture URLs listed in
the setup. Record every current map version.

- [ ] On the 127.0.0.1 `mapper_test.html` map, run **Check live** and confirm no
  map version is created.
- [ ] Apply one drift and click **Refresh Map**.
- [ ] Confirm only that page receives a new version; the stress, platform, and
  localhost-site map objects and versions remain unchanged.
- [ ] Refresh the selected page enough times to exceed configured history.
- [ ] Confirm only the newest configured versions remain in the version picker.

Pass: revalidation is read-only, explicit refresh is page-scoped, unrelated
pages/sites remain unchanged, and version history stays bounded.

## 5. Dynamic Regions and Honest Overflow

Activate `mapper_stress_test.html`, restore policy **Max components** `500` and
**Mutation limit** `50`, click **Save policy**, reset the mutation/repeat/large
fixtures, and map the page.

- [ ] Click **Verify & Export** and confirm the initial report passes with zero
  missing records and zero outside-body records.
- [ ] Record a stable static Save control and one keyed feed action.
- [ ] Append keyed records once, click **Verify & Export**, and confirm every
  currently loaded `feed-action-*` record is mapped, classification remains
  `hybrid_dynamic`, and no scan/fact-work overflow is reported.
- [ ] Remove keyed records; confirm both saved references revalidate without the
  static control taking a dynamic identity.
- [ ] Refresh after the page settles and confirm the static layer remains.
- [ ] Set **Mutation limit** to `10`, save policy, enter finite count `11`, and
  click **Run Finite Mutation Count**.
- [ ] Run **Check live** and attempt an explicit refresh.
- [ ] Confirm an over-limit result is `dynamic_deferred` with an explicit
  mutation reason and the last good static map is not overwritten.
- [ ] Restore mutation limit `50`, click **Reset Mutation Region**, and clear the
  large control set.
- [ ] Keep max components `500`, generate `600` controls, and map/refresh.
- [ ] Confirm `component_scan_overflow` is reported, runtime resolution does not
  search a silently truncated corpus, the tab remains responsive, and the last
  good map is retained.
- [ ] Clear the large controls, restore policy `500`/`50`, wait for settlement,
  refresh successfully, and obtain a passing **Verify & Export** report.

Pass: static and dynamic lanes remain separate, overflow is explicit and
bounded, and a settled explicit refresh recovers.

## 6. Repeated and Loaded-Window Records

On `mapper_stress_test.html`, click **Reset Repeated Records**, refresh, and
record a keyed feed card/action Component ID.

- [ ] Click **Append Feed Items**; confirm existing keyed records retain IDs.
- [ ] Click **Remove First Feed Item**; confirm removed history does not transfer
  to a sibling.
- [ ] Click **Replace Loaded Feed Window** without scrolling; confirm old-window
  references do not resolve into the replacement window.
- [ ] Inspect an action under the Unkeyed twins, add/remove twins, and check live
  resolution.
- [ ] Confirm indistinguishable unkeyed records return a conservative
  unresolved/protected result such as `repeat_condition_required`, never a
  guessed sibling identity.

Pass: only loaded content is claimed, keyed records remain container-scoped, and
unkeyed twins are not assigned guessed durable identities.

## 7. Open and Closed Shadow DOM

Reset `mapper_test.html`, map it, and record the `shadow-save` ComponentRef and
its composed host path.

- [ ] Click **Apply Shadow Host Drift**, check live resolution, and refresh.
- [ ] Reset, click **Apply Shadow Child Drift**, check live resolution, and
  refresh.
- [ ] Reload the extension and resolve the saved open-shadow reference again.
- [ ] Confirm the visible **Closed Shadow Action** is not enumerated or persisted
  as an ordinary component.
- [ ] Confirm no closed-root target is guessed through coordinates or a light-DOM
  sibling.

Closed Shadow DOM is opaque: an ordinary page cannot reveal whether a host has a
closed root or no root. `protected_unsupported` is required only when a caller
already supplies explicit unsupported-boundary metadata; scan-time detection of
an unmarked closed root is not claimed.

## 8. Frame Isolation

On the mapped `mapper_test.html` page:

- [ ] Confirm **Top document** is the first structure root and contains its own
  `html > body` hierarchy.
- [ ] Confirm **Embedded frame documents** contains a clearly labelled
  **Same-origin frame document** whose controls remain under that document's own
  `html > body`; frame-local coordinates must not place it before the top
  document.
- [ ] Resolve `frame-name` and `frame-save`, reload the page, and resolve them
  again through the saved frame path.
- [ ] Confirm the localhost cross-origin frame is mapped under an isolated,
  extension-accessible cross-origin context and never as a top-document control.
- [ ] Resolve its controls, reload, and resolve them again.
- [ ] Confirm controls inside **Mapper protected sandbox fixture** are not exposed
  as ordinary top-page candidates and the boundary is not guessed through.

Pass: accessible frames resolve within stable isolated frame paths; inaccessible
content stays protected.

## 9. Chat and Social Context

Activate and map `mapper_platform_profiles_test.html`.

- [ ] Confirm chat shell, navigation, contacts, active thread, loaded messages,
  composer, and controls have distinct contextual paths.
- [ ] Save one Alpha message action, click **Swap Active Thread**, and confirm it
  cannot resolve in Beta.
- [ ] Use **Load Older Messages**, **Replace Message Window**, and **Tick Chat
  Ephemeral Data**; confirm stable records retain scope and counters do not
  become identity.
- [ ] Save one social-card action, use **Append Feed Window**, **Replace Social
  Window**, and **Tick Social Ephemeral Data**.
- [ ] Confirm an action never resolves into a sibling card or replacement-window
  record.

Pass: thread, card, composer, and loaded-window boundaries are enforced without
making product-specific UI claims.

## 10. SPA Route Isolation

Activate the base `mapper_test.html` page and map it once. In the Inspector
policy set **Query allowlist** to `route`, click **Save policy**, then:

- [ ] Click **Go To Route A** and **Map Active Page**; record the route-A page
  profile, map version, and `spa-account-save` reference.
- [ ] Click **Go To Route B** and **Map Active Page**; confirm a distinct route-B
  page profile and record `spa-billing-save`.
- [ ] While Route B is active, select the saved Route A component and click
  **Check live resolution**.
- [ ] Confirm `map_stale` / `page_profile_mismatch`, no Route B component is
  selected, and no website highlight is shown.
- [ ] Use **Browser Back** and **Browser Forward** and confirm the matching saved
  route becomes resolvable while the other remains isolated.
- [ ] Reload the extension while on a query route and confirm its saved profile
  still loads and resolves.

Pass: same-looking controls cannot cross SPA routes, including between target-tab
selection and in-page resolution.

## 11. Extension Restart Persistence

- [ ] Ensure static, dynamic, open-shadow, frame, and SPA-route maps exist.
- [ ] Close the Mapper Inspector, reload the unpacked extension, and reopen the
  Inspector.
- [ ] Confirm workflow `mapper-live-acceptance`, its sites/pages, retained
  versions, and representative Component IDs remain available.
- [ ] Resolve one representative static, dynamic, shadow, frame, and route
  reference.

Pass: the bounded Chrome-storage map state survives a real extension restart.

## Completion Gate

- [x] Every section above passed in live Chrome/Chromium.
- [x] Every failure was fixed and its affected section rerun.
- [x] The current automated suites pass: 357 JavaScript tests and 176 Python
  tests on 2026-07-20.

The operator completed the live sequence and reported the corrected final
**Verify & Export** run passing on 2026-07-20. The section checkboxes above remain
as the reusable rerun procedure; this completion record is the current gate
status.

The mapper engine is accepted for the finalized node phase. Polished
saved-map browsing, Tree/Graph presentation, responsive/accessibility polish,
current-node retrofits, and real-product chat/social support claims remain V2
or node-phase work.
