# Specification 11 - Mapper Platform App Profiles

## Status

Implementation and acceptance source for website/product-specific mapper profiles. The first local
chat/social acceptance fixture exists at
`BRunner_Host/mapper_platform_profiles_test.html`. Initial redacted profile
hint detection, saved-map metadata, and redacted component-level platform scope
facts are in source. Known chat/social hosts now receive conservative landmark
inference; scope contradictions are rejected before locator scoring, ephemeral
text is excluded from durable identity, and repeated rows/cards without a
durable container are protected unsupported. Product-specific live acceptance
is still required before claiming WhatsApp/social support.

## Problem

The generic mapper treats a page as a hierarchy of visible components. That is
not enough for products such as WhatsApp Web, Facebook, Instagram, and Reddit.
Those applications reuse row/card components, virtualize loaded content, update
badges/timestamps constantly, and often keep one route shell while replacing
only the active region. The result can be poor grouping, unstable identity, and
flat repeated components that are technically visible but not semantically
useful.

## Profile Principle

Platform profiles must make the mapper more conservative and more structured.
They should improve grouping and identity only when evidence is explainable.
When evidence is weak, they should return unresolved or `dynamic_deferred`
instead of pretending generic mapping is safe.

Profiles are workflow-scoped mapper behavior, not extension-global magic.

## First Profile Families

### Chat Apps

Examples: WhatsApp Web, Messenger-style products, Slack-like web apps.

Required regions:

- app shell;
- account/session chrome;
- conversation list;
- active conversation/thread;
- message composer;
- attachment/media controls;
- message rows;
- reactions and message action menus;
- unread/pinned/archived markers;
- ephemeral typing, timestamp, delivery, and notification indicators.

Rules:

- Treat message rows as repeated records scoped to a conversation/thread.
- Do not flatten every message child into page-level components.
- Composer controls are durable action targets; transient messages and badges
  are usually extraction/context records unless explicitly targeted.
- Virtualized unloaded history must not be claimed as mapped.

### Social Media Apps

Examples: Facebook, Instagram, Reddit.

Required regions:

- home/feed region;
- post/card boundary;
- author/header area;
- media/story/reel viewer;
- comment composer;
- action bar;
- profile/community tabs;
- notification and unread badges;
- infinite-scroll loaded window.

Rules:

- Repeated post/card children are scoped to their card.
- Action bars must be tied to a specific card before click actions are allowed.
- Infinite-feed content is loaded-window only until feed traversal exists.
- Ephemeral counters, timestamps, reactions, and notifications are dynamic
  context unless a workflow explicitly maps them as extraction targets.

## Detection Inputs

Profiles may use:

- hostname and route patterns;
- app shell landmarks;
- ARIA roles and labels;
- stable data attributes;
- repeated card/thread/message boundaries;
- scroll container and virtualization behavior;
- mutation rates and loaded-window size;
- user-approved workflow site/page overrides.

Profiles must not store raw secret-bearing chat/post content in logs or
profile decisions. They must use redacted counts, hashes, roles, and structural
labels where possible.

## Inspector Requirements

The Mapper Inspector should expose:

- detected profile family and confidence;
- profile-specific regions and loaded-window boundaries;
- why a region is durable, repeated, ephemeral, or unsupported;
- whether generic mapping was replaced by profile grouping;
- conservative unresolved/dynamic-deferred reasons when profile evidence is
  insufficient.

Current implementation note: saved maps can carry
`mapper.platform_profile.v1` metadata with family, confidence, signal counts,
and loaded-window counts. The Inspector shows the detected family/confidence in
the selected map subtitle and Policy panel. This is diagnostic only; it does
not yet replace generic grouping or resolution.

Component facts can also carry `mapper.platform_scope.v1` structural evidence.
For the local fixture this scopes controls to chat regions such as conversation
list, active thread, message row, and message composer, or social regions such
as profile tabs, feed card, loaded feed window, and comment composer. Scope data
is sanitized to family, region, container/thread tokens, loaded-window index,
repeat kind, and durability; raw chat/post text must not be stored.
The Inspector uses this scope for Structure paths and Regions labels before
falling back to generic DOM path/form/role grouping. The selected Component
panel also shows a compact Platform Scope block so operators can inspect the
sanitized family, region, durability, thread/container token, repeated kind,
and loaded-window index that influenced grouping.

Scoped reconciliation and runtime resolution now apply a conservative boundary
before locator or fingerprint scoring. A scoped chat/social component must stay
within the same family and region, plus the same available thread, container,
and repeated-kind tokens. A contradiction is treated as a new/not-found
component instead of rebinding or executing against another thread/card.
Loaded-window index is intentionally diagnostic rather than an identity gate so
loading older virtualized records does not invalidate an otherwise stable
target.

## Acceptance Before Support

1. Done: build a local fixture that simulates chat-thread virtualization,
   repeated messages, composer controls, unread badges, and active-thread
   swaps.
2. Done: build a local fixture that simulates social-feed cards, repeated
   action bars, comment composers, loaded-window appends, and changing
   counters.
3. Verify grouping is stable top-to-bottom and scoped by thread/card.
4. Source-covered: composer/action targets with contradictory scope are
   rejected before locator/fingerprint scoring. Verify this live in the fixture.
5. Verify unloaded virtualized records are not claimed as present.
6. Verify dynamic badges/counters/timestamps do not cause identity churn.
7. Verify Inspector explains the page profile, selected component scope, and
   any conservative unsupported outcome.
8. Only after fixture acceptance, run manual live checks against WhatsApp Web
   and one social app with redacted diagnostics.
