# Specification 10 - Mapper Viewer Small-Screen Layout (V2 Deferred)

## Status

Deferred to the V2 saved-map explorer/Mapper Inspector product phase.

The current mapper phase accepts the engine: discovery, contextual hierarchy,
ComponentRef stability, resolution, revalidation, refresh, reconciliation, and
bounded persistence. A polished saved-map viewer is not required for that gate.
Existing Inspector HTML/CSS/JS is a developer prototype and may be used to
exercise the engine, but its layout is not an accepted product contract.

## V2 Goal

When the saved-map explorer becomes a product surface, small screens should
prioritize fast inspection, readable hierarchy, tappable controls, and
predictable navigation over decorative layout.

## Retained V2 Requirements

- Use a real mobile viewport.
- Stack major panels instead of preserving desktop side rails.
- Render collapsed panels as horizontal disclosure bars at narrow widths.
- Keep controls at least 36 CSS pixels high where touch use is supported.
- Avoid document-level horizontal clipping.
- Preserve site/page/version selection, search, filters, map details, and live
  engine checks in a compact navigation model.
- Provide a non-canvas hierarchy fallback when graph pan/zoom is unsuitable.
- Support keyboard navigation, visible focus, accessible names, reduced motion,
  and screen-reader state for tabs, trees, disclosure controls, and resizers.

## Candidate Layouts

Desktop:

```text
Saved Maps | Map View | Details
```

Narrow desktop/tablet:

```text
Header and navigation
Saved Maps
Map View
Details
```

Phone:

```text
Header
Page/version navigation
Selectable hierarchy list
Selected component details
```

## Deferred Acceptance

Do not run or report small-screen viewer acceptance as part of mapper engine
completion. During V2, validate at 320/375, 768, 1024, and desktop widths plus
short-height windows, and cover:

1. no page-level horizontal scroll;
2. readable collapsed-panel labels;
3. usable page/version/filter controls;
4. equivalent keyboard and touch access;
5. bounded Tree/Graph/list/detail scrolling;
6. no hover-only functionality;
7. stable selection and engine-check state while layouts change.
