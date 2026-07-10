# Mapper Manual Acceptance

Use these steps after loading the unpacked extension from source. Do not use a
packaged build unless the current task explicitly asks for a release build.

## Serve Fixtures

From the repository root:

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory "C:\Users\MASTER\Desktop\project\BR"
```

Open:

- `http://127.0.0.1:8765/BRunner_Host/mapper_test.html`
- `http://127.0.0.1:8765/BRunner_Host/mapper_stress_test.html`

## Unresolved Routing

Goal: prove an ambiguous mapper target routes to **Needs attention** without
clicking the page or using visible-host fallback.

1. Start the source host, pair the extension, and open Graph Studio.
2. Open `mapper_test.html`.
3. Record a click on one of the duplicate **Save** controls.
4. Confirm the recorded graph has the DOM node plus a **Needs attention** node
   connected from the `unresolved` handle.
5. Mutate the page so the saved target can no longer be uniquely resolved, or
   use the duplicate Save fixture where both candidates remain equivalent.
6. Run the graph.
7. Confirm the page click counter/log does not increment for the ambiguous
   target.
8. Confirm host fallback does not fire for the unresolved mapper outcome.
9. Confirm Graph Studio marks the DOM node as `Unresolved`.
10. Confirm execution continues to **Needs attention** through the `unresolved`
    edge.

Expected result: no browser action, no OS fallback action, structured mapper
diagnostics, and controlled unresolved graph routing.

## Stress Page Static Section

1. Open `mapper_stress_test.html`.
2. Record the **Profile form Save** button.
3. Record the **Billing form Save** button.
4. Confirm Component IDs include enough context to distinguish profile versus
   billing.
5. Run each mapped action.
6. Confirm only the intended counter/log entry changes.

Expected result: duplicate labels create distinct locked Component IDs.

## Stress Page Dynamic Section

1. Record **Dynamic email** and **Update** in the dynamic section.
2. Click **Apply Dynamic Drift**.
3. Run the mapped actions again.
4. Confirm strong evidence preserves the Component ID when reconciliation is
   safe.
5. If evidence is no longer unique, confirm the result is handled unresolved
   instead of a best-guess action.

Expected result: safe reconciliation or explicit unresolved routing.

## Mutation-heavy Section

1. Click **Start Mutation Burst**.
2. Wait until **Material mutations** exceeds the mapper policy limit.
3. Attempt to map or run the volatile action.
4. Confirm the page is classified as `dynamic_deferred` or another honest
   unsupported state.
5. Confirm no persistent mapper interaction is claimed for the volatile region.

Expected result: safe decline, no fake dynamic-site support.

## Infinite-scroll Section

1. Record a visible loaded feed item.
2. Click **Append Feed Items** several times.
3. Confirm loaded items can be inspected as currently loaded content.
4. Confirm BRunner does not claim full infinite-feed traversal, automatic
   scrolling, or unloaded-item identity.

Expected result: loaded-content-only behavior until the deferred feed milestone.

## Open Shadow DOM Section

1. Record **Shadow note** or **Save Shadow** inside the open shadow component.
2. Run the mapped action.
3. Confirm composed-path capture and open-root traversal can resolve the target.
4. Confirm the page log records the intended shadow action only.

Expected result: open Shadow DOM controls can be captured and resolved.

## Mapper Inspector Checks

1. Open `mapper-inspector/index.html` from the extension or the sidebar button.
2. Confirm saved maps are grouped as one website card per base site, with no
   duplicate cards for repeated mapping of the same site.
3. Confirm each website row has a compact delete-site action with an icon
   tooltip. Delete a disposable saved site and confirm all retained pages and
   versions for that base site are removed while other sites remain listed.
4. Select the stress-test site, use the toolbar Page selector to switch between
   saved pages for that site, then use the Version selector to switch between
   retained versions for the selected page. Confirm only the latest three
   versions are available for any page profile. Delete an older selected
   version and confirm the Inspector falls back to another saved version without
   deleting the rest of the site.
5. Confirm top-bar, map, graph, clear-filter, collapse, delete-version, and
   delete-site controls use compact icon affordances with hover/focus tooltips
   where text labels are not necessary.
6. Confirm the Tree and Graph views show a visible color legend describing
   selected, review, hidden, removed, and component-type colors.
7. Collapse and restore the Websites rail, full Details rail, and individual
   Policy, Review Queue, and Component sections. Confirm the Inspector remains
   compact and usable.
8. Drag the Policy and Review Queue section dividers and confirm each section
   can be given more or less vertical space without breaking Component details.
9. Confirm the top-bar checkbox controls align with their labels.
10. Resize the Inspector below full desktop width and confirm the header,
    Page/Version controls, filters, Tree, Graph, Websites rail, and Details rail
    wrap or stack without horizontal control clipping or unreadable text.
11. Switch through Tree and Graph views.
12. In Tree view, confirm the map appears as a compact explorer hierarchy with
   type icons, indentation, lock affordances, compact labels, and stable
   Component IDs as secondary details.
13. Switch Tree between **Structure**, **Regions**, and **Types**. Confirm
   every component list follows page reading order, top-to-bottom then
   left-to-right, both globally and inside Structure, Regions, and Types
   groups. Sequential row highlighting should walk nearby page elements rather
   than jumping around the page.
14. In Graph view, confirm Site -> Page -> Region -> Component nodes are visible
   in a top-down hierarchy with connector ports, right-angle relationship edges,
   compact labels, pan/zoom controls, and selected node state.
15. On the stress page, append feed items or apply controlled dynamic drift,
   then choose **Refresh Map** in the Inspector. Confirm Tree and Graph update
   the selected page with the new/changed component count while other saved
   pages for the same site remain unchanged. Before refreshing, use **Check
   live** and confirm the live-status badge reports the changed/dynamic state
   without saving a new map version. Confirm appended feed items appear after
   existing feed items in Tree/Graph, and removed historical records do not
   interleave with live rows unless filtering for **Removed** or **Review
   required**.
16. Start the mutation burst, wait until material mutations exceed the policy
   limit, then use **Check live**. Confirm the live-status badge reports
   `dynamic_deferred`. Stop or settle the burst, then choose **Refresh Map** and
   confirm Tree and Graph rebuild from the current settled DOM instead of
   staying stuck on the previous usable map.
17. Use the component search/status filters to narrow by Component ID, display
   name, role/type, capability, status, and review-required state. Confirm Tree,
   Graph, and Review Queue show the same filtered component set and that Clear
   restores the full map.
18. Expand and collapse the Tree site, page, structure, region, and type groups.
   Confirm collapsed branches stay collapsed while switching Tree modes and that
   component rows remain selectable/highlightable.
19. Confirm Review Queue contains changed, removed, or ambiguous components.
20. Select static, changed, removed, ambiguous, infinite-scroll, and shadow DOM
   components and confirm details show locators, fingerprints, capabilities,
   and history.
21. Keep the mapped page open beside the Inspector.
22. Enable **Highlight on website**.
23. Select components in Tree and Graph views.
24. Confirm the live page shows a color-coded inspection overlay after a unique
   mapper resolution.
25. Enable **Highlight on hover**, then hover or keyboard-focus mapped component
    rows and confirm the live page previews the same safe overlay without
    clicking the page.
26. Hide a previously mapped element with controlled page drift or devtools,
    then select it in the Inspector. Confirm live resolution reports `hidden`,
    no misleading highlight box is drawn, and Tree, Graph, Review Queue, and
    Component detail mark the component with a hidden badge.
27. Select components whose saved primary locator is an ID, test attribute,
    CSS selector, label text, visible text, role/text pair, form context, and
    DOM path. Confirm click-to-highlight tries the saved locator first, reports
    ambiguity when the saved locator matches multiple elements, and only falls
    back to fuzzy fingerprint matching when no unique saved locator is present.
28. With the same Component ID present on two saved pages or versions, resolve
    one page, then switch Page or Version. Confirm hidden/live-resolution state
    does not carry across, the old website overlay clears, and any late request
    cannot redraw the previous highlight. Turn **Highlight on hover** off while
    previewing a row and confirm the selected component highlight is restored.
29. Confirm image components and visible leaf-text components appear in Tree and
    Graph views when present on the page.
30. Select a mapped image and visible text component, then confirm details show
    locators, fingerprint, capabilities, and history.
31. Select a mapped element that is outside the current viewport. Confirm the
    real page scrolls the resolved element into view before drawing the overlay.
32. Confirm ambiguous or unresolved components are not clicked or typed into.
33. Save a display alias and refresh the Inspector. Confirm the alias persists
    and the canonical Component ID is unchanged.
34. For a review-required component, choose **Accept current mapping** and
    confirm it leaves the Review Queue.
35. Select a review-required component and choose **Check live resolution**.
    Confirm the Component panel shows Live Resolution and Resolver Log details.
36. If the live resolution shows candidate attempts, link a live candidate.
    Confirm the canonical Component ID is unchanged, review is cleared, history
    records the linked candidate, and a new map version appears while the
    previous map version remains selectable.
37. Mark the site sensitive in Policy and confirm locator/resolution details are
    redacted while Component IDs and status remain visible.
38. Confirm live resolution details include a structured resolver log with
    thresholds, selected candidate, runner-up when present, margin, ranked
    candidates, and attempts.

Current follow-up gaps found during stress-page testing:

- Hover and click highlighting can visually fight when requests complete out of
  order.
- Tree/Graph switching can show transient artifacts or stale interaction state.
- Component search must reliably match visible text, not only Component IDs and
  technical names.
- The compact Inspector UI pass now includes icon controls, tooltips, a map
  color legend, direct site deletion, improved contrast, and responsive wrapping;
  these still need manual visual acceptance in the live extension window.
