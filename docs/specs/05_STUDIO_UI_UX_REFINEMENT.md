# Specification 05 — Studio UI/UX Refinement

## Status

Approved implementation specification. Functional Milestone 3 behavior is
accepted and must be preserved. The user confirmed the interaction and
persistence decisions on 2026-06-20. Slices 1–5 are implemented; Slice 6 is
implemented at the shared-shell level. Live extension acceptance remains.

Slice 1 delivered:

- workflow-description preservation across v1 upgrade, v2 graph metadata,
  runtime adaptation, Graph Studio, and Sequential Studio round trips;
- versioned global Studio preferences with safe defaults, cross-tab density
  updates, and shared Compact/Comfortable/Large CSS tokens;
- unchanged `icon2.png` manifest and current Studio identity wiring;
- authenticated host-backed `.log` persistence with bounded allowlisted entries,
  atomic writes, safe filenames, no returned paths, and deterministic tests.

## Goal

Unify Graph Studio and Sequential Studio into a consistent, adjustable desktop
editor experience. Graph Studio receives the new information architecture first;
Sequential Studio then adopts the same visual language, command hierarchy,
panel behavior, icons, density controls, and accessibility conventions.

This is a structural UI/UX pass, not a runtime rewrite. Workflow execution,
cancellation, persistence, v1 backup safety, graph validation, logs, navigation
tools, node selection, and data handling must retain their accepted behavior.

## Product principles

1. One top command bar; workflow details belong in the Inspector.
2. The canvas remains the primary surface and gains space when panels collapse.
3. Context appears when needed without causing accidental edits or layout jumps.
4. Every hidden panel has a visible, keyboard-accessible way to restore it.
5. Compact controls use consistent SVG/icon assets and expose text through
   accessible names and tooltips.
6. Display and panel preferences persist without contaminating workflow data.
7. Graph and Sequential Studio expose equivalent workflow-management features.

## Shared application identity

- Use `BRunner/icons/icon2.png` as the extension and Studio identity asset.
- Add the asset to the extension manifest icon declarations at the required
  sizes, reusing the 512×512 source where Chrome scaling is acceptable.
- Show the icon beside the BRunner name at the left of both Studio command bars.
- Keep the source artwork unchanged, including its current white background. The
  user will replace or edit the asset manually later if needed.

## Graph Studio information architecture

### Unified command bar

Replace the current Graph Header plus Workflow Bar with one command bar.

Left zone:

- BRunner `icon2` identity and Graph Studio label.
- New Workflow button beside the identity.
- Sequential Studio navigation button/link.
- Panel restoration controls when a major panel is collapsed, if those controls
  are not placed on the corresponding canvas edge.

Center zone:

- Native-host connection status: Connecting, Connected, or Disconnected.
- Connected/disconnected state uses icon plus text, not color alone.
- Disconnected state exposes Retry Connection.
- Runtime/validation notices may appear here without displacing core controls.

Right zone:

- Recording group: recording tab policy plus Record/Stop Recording, directly
  visible in the command bar.
- Saved Workflow group: selector plus Load/refresh affordances.
- Execution group: Run/Stop as the visually primary action.
- Run remains right-aligned and keeps existing execution-lock behavior.

Controls are separated into visually distinct labeled/semantic groups for easy
scanning: Identity/Navigation, Connection, Recording, Saved Workflow, and
Execution. Compact separators, spacing, and group labels must not create a second
toolbar. Every control and icon exposes both an accessible name and a tooltip.

The command bar must remain usable at supported narrow widths. Lower-priority
labels may collapse into accessible icon buttons before essential controls are
hidden.

### Inspector panel

The right panel title is always **Inspector**. Remove the secondary
**Properties** heading/text.

Inspector modes:

1. **Pinned** — the panel remains visible. With no node selected it shows the
   Workflow view; with a node selected it shows Node details.
2. **Auto/collapsed** — the panel is hidden when no node is selected. Selecting
   or clicking a node opens it temporarily. Clicking empty canvas or pressing
   Escape clears selection and closes it.

The active mode is visible, keyboard accessible, and persisted as a UI
preference. Switching mode must not change workflow content.

Workflow view (default Inspector content):

- Current workflow name.
- Bound domain.
- Workflow description.
- Node and edge counts.
- Saved/unsaved/read-only/invalid status.
- Layout direction and Arrange action.
- Data tab containing the Variables/Data Inspector.
- `Reuse an already-open matching tab` setting.
- **Save Changes** action, enabled only when valid saveable changes exist.
- **Upgrade to v2** action only for legacy v1 workflows, with the existing
  backup explanation and atomic upgrade safety.

These are the two workflow-persistence actions. There is no separate third
“Update Workflow” action: Save Changes updates the current v2 workflow, while
Upgrade to v2 converts a legacy workflow.

Node view:

- Existing registry-driven node fields and execution settings.
- No extra **Properties** title.
- Pin/collapse control remains available.
- Node selection from execution logs opens the same Node view.

Save-state contract:

- Save is disabled when the workflow is unchanged, read-only, invalid, busy, or
  executing.
- Save becomes enabled only after a saveable mutation.
- Saving clears dirty state only after native persistence succeeds.
- Validation explains why Save is disabled without relying on color.

### Node Library panel

- Rename the panel title to **Node Library**.
- Keep the visible filtered node count.
- Preserve search, category grouping, click creation, and drag creation.
- Add explicit collapse/restore controls.
- Collapsing must enlarge the canvas and must not change graph positions stored
  in the workflow.

### Execution Logs panel

- Use the single title **Execution Logs**; remove **Run history**.
- Preserve structured, bounded, secret-safe entries, summaries, node filtering,
  and node-selection links.
- Add Clear Logs with an appropriate confirmation/undo policy.
- Add Save Logs for manual export.
- Add a persisted handling-policy dropdown with exactly these options:
  - **Do nothing** — retain logs until manually cleared or saved.
  - **Clear after run** — clear after completed, failed, or cancelled.
  - **Clear & save after run** — save through the native host, then clear only
    after the host confirms success.
  - **Save after run** — save through the native host and retain in-app logs.
- Manual Save Logs also uses the native host.
- Save Logs, Clear & save after run, and Save after run are unavailable while
  the native host is disconnected. Do nothing and Clear after run remain usable.
- Log controls remain available when the panel is expanded and through an
  overflow/settings menu when space is constrained.
- The entire logs panel is collapsible and restorable.

### Overview/minimap

- Add a visible toggle for showing/hiding the overview map.
- Persist visibility as a UI preference.
- Preserve live Running, Completed, Bypassed, Failed, and Cancelled colors.
- Hiding the overview must not disable zoom, fit, or canvas navigation.

### Canvas tools

- Display Selector and Hand as icon-only buttons in a vertical toolbar.
- Keep tooltips, accessible names, `V`/`H` shortcuts, and Space-to-pan.
- Active state uses more than color (pressed state/border/indicator).
- Preserve all accepted accidental-edit protections.

### Collapsible surfaces

At minimum, Node Library, Inspector, Execution Logs, and Overview are
independently hideable. Collapse controls must:

- expose `aria-expanded` and a clear accessible name;
- remain reachable by keyboard;
- avoid destructive overlap with node/edge controls;
- persist in extension-local UI preferences;
- recover to a safe default if stored preferences are invalid;
- adapt at narrow widths without creating horizontal page overflow.

## Feature-parity inventory

Graph Studio must include or intentionally supersede these accepted Sequential
Studio capabilities before the Sequential UI is retired or deemphasized:

| Capability | Current Graph Studio | Refinement requirement |
|---|---|---|
| New/load/refresh/save/rename | Partial/current | Move into unified bar/Inspector and preserve |
| Duplicate workflow | Missing | Add to saved-workflow actions |
| Delete workflow | Missing | Add guarded destructive action |
| Native-host status and retry | Missing | Center of unified command bar |
| Record/stop recording | Missing | Add with recording tab policy |
| Recording tab policy | Missing | Add Follow opened tabs / Follow active tab |
| Run/Stop | Present | Keep right-aligned in command bar |
| Validation status | Partial notices | Provide persistent accessible status |
| Variables/Data Inspector | Missing | Add as Inspector Data tab |
| Reuse already-open matching tab | Schema exists, UI missing | Add to Workflow view |
| V1 read-only upgrade | Present | Keep in Workflow view |
| Workflow duplicate/delete confirmations | Missing | Match native operations safely |
| Graph logs/runtime visualization | Graph-only | Preserve |

## Workflow metadata and persistence

### Workflow description

Add optional `description` metadata to schema v2 and preserve it through:

- new workflow defaults;
- Graph Studio load/save/rename;
- explicit v1-to-v2 upgrade;
- native storage round trips;
- graph-to-sequential runtime adaptation where appropriate;
- Sequential Studio load/save after its UI refinement.

Legacy workflows without a description use an empty string. Description is
workflow metadata and must not affect execution validation.

### UI preferences

Store UI-only preferences outside workflow JSON in
`chrome.storage.local`, under a versioned Studio preference key. Candidate
settings:

- panel collapsed/expanded state;
- Inspector pinned/auto mode;
- overview visibility;
- log handling policy, shared globally across both Studios;
- display density/scale, shared globally across both Studios;
- last active Inspector tab;
- optional panel sizes if resizing is introduced.

Runtime status, selected nodes, temporary panel openings, and execution colors
remain transient.

## Log export contract

Manual and automatic export are handled by the native host and produce `.log`
files. Add a canonical extension/native command such as `SAVE_EXECUTION_LOG`
through constants, native bridge, authenticated host dispatch, and a host-owned
logs directory. The host returns success plus the safe saved filename; the UI
never sends or displays an arbitrary local path.

The export contains only the already-sanitized structured log model. It must not
add HTTP bodies, headers, clipboard contents, local paths, screenshots, file
payloads, or raw exception objects. Suggested filename:

`<workflow>-<run-id>-<timestamp>.log`.

Automatic export failures are reported visibly but do not change the workflow's
execution result. Clear & save after run retains the in-app logs when saving
fails so the user cannot silently lose the record.

## Sequential Studio refinement

After Graph Studio's structure is accepted, update Sequential Studio to use the
same:

- icon2 identity and unified command-bar styling;
- host status treatment;
- button hierarchy and SVG icon language (remove emoji controls);
- panel headers, collapse affordances, tabs, focus states, and tooltips;
- save/dirty/validation behavior;
- workflow metadata fields and Data Inspector organization;
- display density/scale preference;
- spacing, typography, colors, and responsive breakpoints.

Sequential editing remains functionally sequential. Do not back-port graph
branching or graph-only controls into it.

## Display size / density

Both Studios expose the same globally persisted display setting. Presets:

- Compact — reduced control height, padding, panel widths, and node spacing.
- Comfortable — current/default working density.
- Large — larger controls, text, hit targets, and panel widths.

The implementation should use shared CSS custom properties/tokens rather than
browser zoom. Canvas zoom remains independent of UI density. All presets must
meet minimum hit-target, focus visibility, clipping, and contrast requirements.

## Responsive behavior

Validate at 320/375, 768, 1024, 1280, and 1440 CSS pixels plus short-height
desktop layouts. Priority order when space is constrained:

1. Run/Stop and current workflow identity remain reachable.
2. Canvas remains usable.
3. Panels collapse into restore controls rather than overflowing.
4. Host state remains available, possibly as a compact icon with tooltip.
5. Saved workflow and lower-priority actions may move into an accessible menu.

No density preset or panel combination may introduce document-level horizontal
scrolling.

## Accessibility requirements

- Logical command-bar and panel tab order.
- Visible focus in every density and panel state.
- `aria-expanded` for collapsible surfaces and `aria-pressed` for pin/toggle
  controls.
- Tooltips supplement, never replace, accessible names.
- Escape closes temporary Inspector state and menus without discarding edits.
- Status and saveability changes use polite live announcements.
- Panel animation respects `prefers-reduced-motion`.
- Icon-only controls meet hit-target and contrast requirements.

## Implementation sequence

### Slice 1 — Contracts and shared preferences

Status: complete.

- Add workflow description persistence and tests.
- Add versioned shared Studio UI preferences and density tokens.
- Add icon2 manifest/application identity.
- Add the authenticated host-backed `.log` save command and deterministic tests.

### Slice 2 — Graph Studio shell

Status: implemented.

- Build unified command bar and host status.
- Move workflow controls into the bar and Inspector.
- Remove the second top bar.
- Implement saveability state.

### Slice 3 — Inspector and panels

Status: implemented.

- Implement pinned/auto Inspector modes and Workflow/Node/Data views.
- Add panel collapse/restore behavior and persistence.
- Rename Node Library and Execution Logs headers.
- Add overview toggle and vertical icon-only canvas tools.

### Slice 4 — Workflow parity

Status: implemented.

- Add recording/tab policy, duplicate/delete, reconnect, reuse-tab setting, and
  Data Inspector parity to Graph Studio.
- Verify v1 upgrade and native-host operations remain safe.

### Slice 5 — Log lifecycle

Status: implemented.

- Implement clear, manual save, auto-clear, and auto-save policies.
- Verify bounded secret-safe export behavior and failure diagnostics.

### Slice 6 — Sequential Studio consistency

Status: shared shell, density, metadata, dirty-save, responsive tokens, and
control-language consistency implemented. Further visual tuning belongs to the
live acceptance pass.

- Apply shared identity, command hierarchy, panel language, density, metadata,
  and responsive behavior without changing sequential execution semantics.

### Slice 7 — Acceptance

- Run deterministic tests and both production/syntax gates.
- Live-check both Studios in every density and representative panel state.
- Verify workflow round trips, runtime locking, recording, host reconnect,
  logs, Data Inspector, v1 safety, and responsive/accessibility behavior.

## Acceptance checklist

1. Graph Studio has one command bar and no duplicate workflow toolbar.
2. Inspector pin/auto behavior matches the specified selection and click-away
   rules.
3. Workflow view exposes every requested metadata, status, layout, Data, reuse,
   Save Changes, and Upgrade to v2 control.
4. Save is enabled only for valid saveable changes.
5. Node Library, Inspector, Logs, and Overview independently hide and restore.
6. Host status, retry, saved workflow selector, navigation, New, and Run remain
   usable from the unified bar.
7. Graph Studio passes the parity inventory.
8. Logs clear/save and each lifecycle policy behave safely.
9. Minimap runtime colors and icon-only vertical tools retain accepted behavior.
10. Description and settings survive save/reload/rename/upgrade.
11. Compact, Comfortable, and Large work in both Studios.
12. Sequential Studio is visually consistent and retains all accepted behavior.

## Confirmed user decisions

1. The button beside the logo is **New Workflow**.
2. Workflow persistence has two actions: **Save Changes** for v2 edits and
   **Upgrade to v2** for legacy conversion.
3. Inspector defaults to **Pinned**, showing Workflow details when no node is
   selected.
4. Logs save as host-managed `.log` files. The global policy dropdown contains
   Do nothing, Clear after run, Clear & save after run, and Save after run.
5. Log policy and display density are global across both Studios.
6. Keep `icon2.png` unchanged; the user may edit it manually later.
7. Recording controls remain visible in the top command bar. Controls are
   separated into understandable groups, and every control/icon has a tooltip.
