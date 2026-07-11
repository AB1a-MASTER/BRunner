# Specification 10 - Mapper Inspector Small-Screen App Layout

## Status

Source implementation complete. Viewport metadata, stacked collapsed-panel
behavior, mobile touch target minimums, detail text wrapping, and mobile graph
control wrapping are in source. At phone width the Graph canvas becomes a
compact selectable region/component hierarchy list while desktop/tablet retain
pan and zoom. Live visual acceptance is still required in a narrow desktop
window and browser mobile emulation.

The Inspector is not a marketing website. Small screens should prioritize fast
inspection, readable hierarchy, tappable controls, and predictable panel
navigation over decorative layout.

## Goals

- Use a real mobile viewport so the app is not scaled down as a desktop page.
- Stack major panels instead of keeping desktop side rails on narrow screens.
- Render collapsed Websites and Details as horizontal disclosure bars, not
  vertical rail text.
- Keep common controls at tappable sizes on small screens.
- Avoid horizontal clipping in Page/Version selectors, filters, legends, Tree
  rows, Graph controls, and details sections.
- Preserve all desktop capabilities: saved site/page/version selection, delete
  site/page/version, Tree/Graph switching, live checks, highlighting, policy,
  Review Queue, and Component details.

## Layout Rules

### Desktop

Use the three-pane workbench:

```text
Websites | Tree/Graph | Details
```

Collapsed Websites/Details may be vertical rails because there is enough height
and the layout is spatially stable.

### Narrow Desktop and Tablet

Stack the major panels:

```text
Header
Websites
Tree/Graph
Details
```

Collapsed Websites/Details become horizontal bars with readable labels and a
single expand affordance. Page/Version controls and filters wrap to available
width.

### Phone-Width Viewports

Use app-density controls:

- minimum 36px interactive control height;
- full-width or two-column button groups only where labels still fit;
- horizontal collapsed panel labels;
- normal text wrapping for map title/subtitle;
- bounded scroll areas for Tree, Graph, legend, policy, review, and component
  detail content;
- no reliance on hover-only controls.

## Implementation Plan

1. Done: add viewport metadata to `mapper-inspector/index.html`.
2. Done: override desktop vertical collapsed rails below the stacked-layout
   breakpoint.
3. Done: increase mobile touch target minimums for inputs, selects, toggles,
   and icon buttons.
4. Done: add source-level wrapping for Tree labels, Graph controls, detail
   cards, badges, and saved-site rows.
5. Done: add source guards for viewport metadata, mobile collapsed-panel
   behavior, graph control wrapping, and mobile label wrapping.
6. Next: run live acceptance in browser mobile emulation and in a narrow
   desktop window.
7. Done: add a phone-specific selectable Graph hierarchy list fallback.

## Acceptance

1. Open the Inspector at desktop width and confirm the three-pane workbench is
   unchanged.
2. Resize below the stacked-layout breakpoint and collapse Websites/Details.
   Confirm each collapsed panel is a readable horizontal bar.
3. Use mobile emulation. Confirm the UI uses the device width rather than a
   scaled desktop canvas.
4. Confirm Page/Version selectors, delete buttons, Tree/Graph tabs, filters,
   and Check live remain tappable and do not clip.
5. Confirm Tree rows, Graph controls, legends, Review Queue, and Component
   details remain readable without horizontal scrolling of the whole page.
