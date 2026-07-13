# Specification 11 - Mapper Context Profiles

## Status

Engine-level contextual inference is in source and has a local fixture at
`BRunner_Host/mapper_platform_profiles_test.html`. It is part of mapper engine
acceptance only where it improves component scope, identity, and safe resolution.

Polished product-specific saved-map presentation, dedicated profile navigation,
and support claims for WhatsApp Web or social products are deferred to V2.

## Purpose

Generic visible-element scanning is insufficient for applications that reuse
rows/cards, virtualize loaded content, update counters continuously, and keep one
route shell while replacing an active region. The mapper therefore records
contextual boundaries that future nodes can use when resolving an element.

Profiles are evidence providers for the node-neutral mapper engine. They are not
current-node behavior and are not a requirement to build a profile-specific
Inspector UI during this phase.

## Principles

- Context inference must make resolution more conservative, never less.
- Actual page/container hierarchy remains canonical.
- Profile family, pane, thread/card, repeat, and loaded-window facts supplement
  the hierarchy; they do not replace it.
- Contradictory context rejects a candidate before ordinary locator scoring.
- Weak or indistinguishable repeated identities return unresolved/deferred.
- Loaded-window position is diagnostic, not by itself a durable identity.
- Local maps and diagnostics are user-managed and may contain raw page content
  or values needed for local mapping and debugging.

## Chat Context

Useful boundaries include:

- application shell and session/navigation areas;
- conversation/contact list;
- active conversation/thread;
- message composer and attachment controls;
- message rows and action areas;
- changing badges, timestamps, delivery state, and notifications.

Rules:

- Scope message rows and actions to a conversation/thread.
- Keep composer controls separate from repeated message records.
- Do not claim unloaded virtualized history.
- Do not resolve a saved component into another thread merely because text,
  role, or position looks similar.

## Social Context

Useful boundaries include:

- navigation and account areas;
- home/feed region and loaded window;
- post/card boundary, header, media, and action area;
- comment composer;
- profile/community navigation;
- changing counters, timestamps, and notification state.

Rules:

- Scope every repeated child/action to its card before it is eligible.
- Keep loaded-window records in the dynamic identity lane.
- Do not auto-scroll or paginate during mapping.
- Do not resolve a card action into a sibling card without a durable unique
  signal or independently verified container context.

## Detection Evidence

Context providers may use:

- hostname and route patterns;
- application shell landmarks;
- roles, labels, text, values, and stable attributes;
- repeated card/thread/message boundaries;
- scroll-container and virtualization behavior;
- mutation rate and loaded-window size;
- workflow-local site/page policy.

No single hostname or product guess is sufficient to select an element.
Resolution still follows the shared primary, fallback, compatibility, score, and
winner-margin contracts.

## Engine Data Contract

Maps may carry a profile/context record containing:

- family and detection evidence;
- application shell and major pane boundaries;
- semantic subregions;
- repeated template kind, part, and record/container identity;
- thread/card/container scope;
- dynamic classification and loaded-window metadata;
- canonical structural paths and frame scope.

Components may carry the applicable subset as structural scope facts. The
canonical hierarchy remains the actual site -> page -> frame/shadow/container ->
element structure used by scan, refresh, and resolution.

## Engine Acceptance

1. Scan the local chat fixture and confirm shell, contacts/navigation, active
   thread, message records, composer, and action areas have distinct scopes.
2. Confirm thread changes and ephemeral updates do not silently move a locked
   component into another thread.
3. Confirm repeated message actions require their record/container scope.
4. Scan the social fixture and confirm navigation, feed, card, action area,
   comment composer, and loaded-window boundaries.
5. Confirm appended cards stay in the dynamic lane and cannot inherit static or
   sibling identities.
6. Confirm contradictory family/pane/thread/card scope rejects a candidate before
   locator/fingerprint scoring.
7. Confirm unkeyed indistinguishable records return a conservative result.
8. Confirm actual DOM/container hierarchy is retained rather than flattened into
   profile-only regions.

These checks may use developer diagnostics or raw serialized map data. They do
not require a particular Tree, Graph, legend, pane layout, or viewer workflow.

## Deferred V2 Work

- Profile-specific saved-map explorer grouping and navigation.
- Dedicated viewer explanations, legends, and hierarchy presentation.
- Responsive/accessibility/visual acceptance of profile presentation.
- Product-specific live acceptance and support claims for WhatsApp Web,
  Facebook, Instagram, Reddit, or similar applications.
- Final-node behaviors that consume thread/card/profile context.
