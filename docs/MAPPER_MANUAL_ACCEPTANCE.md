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
- `http://127.0.0.1:8765/BRunner_Host/mapper_platform_profiles_test.html`

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

## Same-Origin Frames

1. Open `mapper_stress_test.html` and map the page.
2. Confirm **Frame name** and **Save Frame** appear under a non-top Frame Scope.
3. In Structure mode, confirm same-origin iframe content appears under its own
   frame grouping row instead of merging into the top-page `body`, `main`, or
   `form` branches.
4. Select **Save Frame** and confirm highlight is drawn inside the iframe.
5. Reload the stress page, run Check live resolution again, and confirm the
   stable frame path rediscovers the current Chrome frame ID.
6. Execute a recorded frame input/save action and confirm the nested frame log
   changes without targeting a same-named top-page control.
7. Confirm inaccessible cross-origin frames are counted as protected and never
   exposed as actionable components.

Expected result: same-origin frames work by stable path; cross-origin frames
fail honestly as `protected_unsupported`.

## Platform Profile Fixture

1. Open `mapper_platform_profiles_test.html`.
2. In the chat fixture, map the active thread region, conversation list,
   message composer, **Attach**, **Send**, and one loaded message action.
   Confirm Structure and Graph begin with a Chat Application shell and separate
   **Navigation Rail**, **Contacts Pane**, and **Chat Pane** major regions.
   Confirm conversation rows appear under a Contact template and loaded
   messages under Message template parts instead of one giant component list.
   Select Contacts Pane and Chat Pane Structure rows and confirm each complete
   live pane highlights independently.
   Confirm the page header/results outside the chat fixture are not grouped
   under Chat Application. Confirm **Swap Active Thread**, **Load Older
   Messages**, and **Tick Chat Ephemeral Data** appear under **Chat Shell** ->
   **Profile Controls**, not under Thread Header or Chat Pane.
3. Use **Swap Active Thread**, **Load Older Messages**, and **Tick Chat
   Ephemeral Data**. Confirm mapper grouping remains scoped to the active
   thread, composer targets do not drift to another thread, and ephemeral unread
   badges/timestamps do not cause durable Component ID churn. Confirm the
   Inspector subtitle or Policy panel reports a redacted `chat` platform
   profile hint when mapped. Confirm component IDs/Structure groups include
   chat scope such as message composer, message row, or thread context, and
   Regions mode groups by the same chat scope without storing raw message text.
   Select one scoped component and confirm its Component panel shows the same
   sanitized family, region, durability, and available thread/container/window
   metadata in a compact **Platform Scope** block.
   With that component selected, swap threads and confirm live resolution never
   targets an identically named control from the other thread; it should report
   `no_platform_scope_compatible_candidates` when the original scoped target is
   absent.
4. In the social fixture, map the home feed region, one post/card action bar,
   the comment composer, **Media**, and **Post**.
   Confirm Graph separates Navigation Pane, Feed Pane, and Right Rail and
   summarizes repeated Post template content/actions by record count.
   Confirm **Append Feed Window** and **Tick Social Ephemeral Data** appear
   under **Social Shell** -> **Profile Controls**, not under Feed Pane.
5. Use **Append Feed Window** and **Tick Social Ephemeral Data**. Confirm
   repeated post/card controls stay scoped to their card, loaded-window content
   is represented as currently loaded only, and changing counters/timestamps are
   treated as dynamic context rather than stable action identity. Confirm the
   Inspector subtitle or Policy panel reports a redacted `social` platform
   profile hint when mapped. Confirm component IDs/Structure groups include
   social scope such as feed card, profile tabs, or comment composer, and
   Regions mode groups by the same social scope without storing raw post text.
   Select one scoped component and confirm its compact **Platform Scope** block
   agrees with the Structure and Regions grouping.
   Append or replace feed cards and confirm a repeated action never rebinds to
   an identically named action in another card. Loading a different virtualized
   window may change the displayed window index without invalidating the same
   thread/card target.

Expected result: chat/social pages are either grouped by profile-specific
regions with safe scope, or conservatively marked unresolved/dynamic-deferred.
Generic flat page-level grouping is not considered accepted for these app
classes.

For the generic stress-page feed, select a repeated **Open item** component and
confirm Repeat Scope shows a pinned item key and `loaded only`. Append feed
items, refresh the map, and confirm the selected item does not resolve to a
different card when its loaded-window index changes. A deliberately unkeyed
repeated fixture should report `repeat_condition_required` rather than click an
arbitrary row.

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
   deleting the rest of the site. Delete a disposable selected page from the
   button beside the Page selector and confirm all retained versions for that
   page are removed while other pages for the site remain.
5. Confirm top-bar, map, graph, clear-filter, collapse, delete-page,
   delete-version, and delete-site controls use compact icon affordances with
   hover/focus tooltips where text labels are not necessary.
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
    In mobile/narrow emulation, confirm the Inspector uses the device viewport
    instead of shrinking the whole desktop UI, buttons/selects remain tappable,
    and collapsed Websites/Details panels render as horizontal disclosure bars
    with readable text.
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
   compact labels, pan/zoom controls, and selected node state. Use the layout
   icon to switch between vertical and horizontal hierarchies; confirm the
   horizontal view flows left-to-right with sibling nodes stacked by layer and
   switches back without changing filters or the selected component.
   Confirm Graph is built from the same structure as Tree Structure: page DOM
   containers such as `body`, `header`, `main`, `section`, forms, app shells,
   and nested divs appear as parent/child nodes instead of a one-layer
   region-to-component list.
   Reload the Inspector while leaving the mapped page open, then click and
   hover Tree records again. Confirm the website accepts the new highlight
   requests rather than reporting them as stale. Repeated chat/social templates
   should show numbered records, with each record appearing once and
   highlighting its own live container.
   Trigger a dynamic sibling insertion before highlighting a pane or record;
   confirm the container is recovered through its live mapped descendant even
   when the original positional DOM path moved. In Graph, confirm each repeated
   template appears once with combined record, part, and element counts.
15. On the stress page, append feed items or apply controlled dynamic drift,
   then choose **Refresh Map** in the Inspector. Confirm Tree and Graph update
   the selected page with the new/changed component count while other saved
   pages for the same site remain unchanged. Before refreshing, use **Check
   live** and confirm the live-status badge reports the changed/dynamic state
   without saving a new map version. Confirm appended feed items appear after
   existing feed items in Tree/Graph, and removed historical records do not
   interleave with live rows unless filtering for **Removed** or **Review
   required**.
   Confirm the saved map exposes separate static and dynamic layer diagnostics:
   stable/static controls keep their Component IDs, loaded-window/dynamic
   records reconcile only against dynamic history, and a dynamic record with
   matching visible text does not inherit an older static Component ID. In the
   Policy rail, confirm **Map Layers** shows static/dynamic counts, lane states,
   removed counts, and any deferred dynamic reason.
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
31. In Structure mode, select an intermediate `div`, `form`, or `section` row.
    Confirm the complete live container is highlighted, including its child
    area. Use that row's chevron and confirm expand/collapse works without
    triggering a different highlight.
32. Hide or remove a saved container, then select its Structure row. Confirm
    the Inspector reports hidden or not found instead of highlighting a child
    or a similarly shaped container.
33. Select a mapped element that is outside the current viewport. Confirm the
    real page scrolls the resolved element into view before drawing the overlay.
34. Confirm ambiguous or unresolved components are not clicked or typed into.
35. Save a display alias and refresh the Inspector. Confirm the alias persists
    and the canonical Component ID is unchanged.
36. For a review-required component, choose **Accept current mapping** and
    confirm it leaves the Review Queue.
37. Select a review-required component and choose **Check live resolution**.
    Confirm the Component panel shows Live Resolution and Resolver Log details.
38. If the live resolution shows candidate attempts, link a live candidate.
    Confirm the canonical Component ID is unchanged, review is cleared, history
    records the linked candidate, and a new map version appears while the
    previous map version remains selectable.
39. Mark the site sensitive in Policy and confirm locator/resolution details are
    redacted while Component IDs and status remain visible.
40. Confirm live resolution details include a structured resolver log with
    thresholds, selected candidate, runner-up when present, margin, ranked
    candidates, and attempts.

Current follow-up gaps found during stress-page testing:

- Hover and click highlighting now have source-level stale-request guards plus
  debounced selected-highlight restore; verify visually that quick row hover,
  click, and focus changes no longer fight in the live extension window.
- Tree/Graph switching now clears transient graph panning state before view
  changes and map rerenders; verify visually that no panning/artifact state
  remains in the live extension window.
- Component search now uses exact phrase or all-term matching across visible
  semantic text, structural labels, locator data, decision metadata, Component
  IDs, and capabilities; verify live stress-page searches such as partial feed
  item text and role/type terms.
- The compact Inspector UI pass now includes icon controls, tooltips, a map
  color legend, direct site deletion, improved contrast, and responsive wrapping;
  these still need manual visual acceptance in the live extension window.
- Mid-size Inspector responsive wrapping now has tighter source-level guards for
  the map title/subtitle, live-status badge, page/version selectors, and filter
  summary; verify the toolbar and filter bar do not clip around tablet and
  narrow desktop widths.
- Mobile/narrow Inspector layout now has an explicit viewport and collapsed
  panels should become horizontal disclosure bars instead of clipped vertical
  rail labels; verify in browser mobile emulation.
- Platform-specific app profiles remain unimplemented. WhatsApp Web, chat apps,
  and social media apps need dedicated profile rules/checklists for virtualized
  feeds, repeated cards, thread/composer regions, action bars, unread badges,
  and ephemeral dynamic content before generic mapper support is claimed. See
  `specs/11_MAPPER_PLATFORM_APP_PROFILES.md`.
