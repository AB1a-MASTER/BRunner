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

## Pre-Inspector Stop Point

Before Mapper Inspector exists, verification is limited to workflow graph state,
execution logs, page counters, and stored map data. Once the Inspector is added,
repeat these tests while also checking:

- saved-map website list;
- Tree view;
- Graph view;
- simplified Website view;
- live highlight-on-website mode.
