import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildStaticPageMap,
  createDefaultMapperSettings,
  createEmptyWorkflowMapperState,
  createPlaceholderComponentRef,
  deserializeWorkflowMapperState,
  isComponentRef,
  MapperComponentStatuses,
  MapperPageClassifications,
  MapperResolverStates,
  recordMapperRuntimeResolution,
  normalizeMapperSettings,
  normalizePageProfile,
  resolveMappedComponent,
} from "../BRunner/mapper/core.js";
import { ChromeMapStore } from "../BRunner/core/mapStore.js";

test("mapper settings normalize to bounded workflow-scoped defaults", () => {
  const settings = normalizeMapperSettings({
    enabled: false,
    mode: "explicit",
    maxComponents: 99999,
    maxVersions: -1,
    queryAllowlist: ["tab", "tab", " "],
  });

  assert.equal(settings.enabled, false);
  assert.equal(settings.mode, "explicit");
  assert.equal(settings.maxComponents, 2000);
  assert.equal(settings.maxVersions, 1);
  assert.deepEqual(settings.queryAllowlist, ["tab"]);
  assert.deepEqual(createDefaultMapperSettings().siteOverrides, {});
  assert.equal(createDefaultMapperSettings().maxVersions, 3);
  assert.equal(normalizeMapperSettings({ maxVersions: 99 }).maxVersions, 3);
});

test("page profiles ignore non-allowlisted query and hash", () => {
  const profile = normalizePageProfile(
    "https://example.com/app/page?tab=users&utm=ad#section",
    { queryAllowlist: ["tab"] },
  );

  assert.deepEqual(profile, {
    origin: "https://example.com",
    hostname: "example.com",
    path: "/app/page",
    query: "tab=users",
    title: "",
    siteKey: "example_com",
    pageKey: "example_com::app_page::tab_users",
  });
});

test("component refs and mapper state serialize safely", () => {
  const ref = createPlaceholderComponentRef("element.click-123", "element.click");
  assert.equal(isComponentRef(ref), true);
  assert.equal(ref.id, "pending:element-click-123");

  const state = createEmptyWorkflowMapperState("flow-1", {
    queryAllowlist: ["view"],
  });
  const restored = deserializeWorkflowMapperState(state);
  assert.equal(restored.workflowId, "flow-1");
  assert.deepEqual(restored.settings.queryAllowlist, ["view"]);
});

test("chrome map store persists workflow mapper state by workflow id", async () => {
  const memory = {};
  const storage = {
    async get(key) {
      return { [key]: memory[key] };
    },
    async set(value) {
      Object.assign(memory, value);
    },
  };
  const store = new ChromeMapStore(storage);

  const saved = await store.saveWorkflowMapperState("flow-1", {
    settings: { queryAllowlist: ["page"] },
    maps: [{ pageId: "home" }],
  });
  const loaded = await store.getWorkflowMapperState("flow-1");

  assert.equal(saved.workflowId, "flow-1");
  assert.deepEqual(loaded.maps, [{ pageId: "home" }]);
  assert.deepEqual(loaded.settings.queryAllowlist, ["page"]);
  assert.equal(await store.deleteWorkflowMapperState("flow-1"), true);
  assert.equal(await store.getWorkflowMapperState("flow-1"), null);
});

test("static page map creates locked readable component ids", () => {
  const pageMap = buildStaticPageMap({
    page: { url: "https://example.com/account/settings" },
    componentFacts: [
      componentFact({
        accessibleName: "Save",
        role: "button",
        ancestorTokens: ["profile form"],
        locator: { strategy: "css_selector", value: "#profile-save", reliability: 98 },
      }),
      componentFact({
        accessibleName: "Save",
        role: "button",
        ancestorTokens: ["billing form"],
        locator: { strategy: "css_selector", value: "#billing-save", reliability: 98 },
      }),
    ],
    now: "2026-07-04T00:00:00.000Z",
  });

  assert.equal(pageMap.classification, MapperPageClassifications.Static);
  assert.deepEqual(pageMap.components.map((component) => component.componentId), [
    "example_com_account_settings_profile_form_save_button",
    "example_com_account_settings_billing_form_save_button",
  ]);
  assert.equal(pageMap.components[0].displayName, "Save");
  assert.equal(pageMap.components[0].primaryLocator.value, "#profile-save");
});

test("static page map stores components in visual reading order", () => {
  const pageMap = buildStaticPageMap({
    page: { url: "https://example.com/dashboard" },
    componentFacts: [
      componentFact({
        accessibleName: "Bottom left",
        role: "button",
        locator: { strategy: "css_selector", value: "#bottom-left", reliability: 98 },
        documentBounds: { x: 20, y: 400, width: 80, height: 30 },
      }),
      componentFact({
        accessibleName: "Top right",
        role: "button",
        locator: { strategy: "css_selector", value: "#top-right", reliability: 98 },
        documentBounds: { x: 400, y: 20, width: 80, height: 30 },
      }),
      componentFact({
        accessibleName: "Top left",
        role: "button",
        locator: { strategy: "css_selector", value: "#top-left", reliability: 98 },
        documentBounds: { x: 20, y: 20, width: 80, height: 30 },
      }),
    ],
    now: "2026-07-04T00:00:00.000Z",
  });

  assert.deepEqual(pageMap.components.map((component) => component.displayName), [
    "Top left",
    "Top right",
    "Bottom left",
  ]);
  assert.deepEqual(pageMap.components.map((component) => component.primaryLocator.value), [
    "#top-left",
    "#top-right",
    "#bottom-left",
  ]);
});

test("static page map stores redacted platform profile hints", () => {
  const pageMap = buildStaticPageMap({
    page: {
      url: "https://example.com/chat",
      platformProfile: {
        version: "mapper.platform_profile.v1",
        family: "chat",
        confidence: 87,
        product: "whatsapp",
        detectionSource: "known_host_plus_landmarks",
        signals: {
          chat: 5,
          social: 1,
        },
        loadedWindowHints: {
          messages: 12,
          feedCards: 0,
        },
        rawText: "do not store this conversation",
      },
    },
    componentFacts: [
      componentFact({
        accessibleName: "Send",
        role: "button",
        locator: { strategy: "css_selector", value: "#send", reliability: 90 },
      }),
    ],
  });

  assert.deepEqual(pageMap.platformProfile, {
    version: "mapper.platform_profile.v1",
    family: "chat",
    confidence: 87,
    product: "whatsapp",
    detectionSource: "known_host_plus_landmarks",
    signals: {
      chat: 5,
      social: 1,
    },
    loadedWindowHints: {
      messages: 12,
      feedCards: 0,
    },
  });
  assert.equal(pageMap.diagnostics.platformProfileFamily, "chat");
  assert.equal(Object.hasOwn(pageMap.platformProfile, "rawText"), false);
});

test("static page map uses platform scope as structural identity context", () => {
  const pageMap = buildStaticPageMap({
    page: { url: "https://example.com/chat" },
    componentFacts: [
      componentFact({
        accessibleName: "Reply",
        role: "button",
        platformScope: {
          family: "chat",
          region: "message_row",
          threadId: "alpha",
          containerId: "message-alpha-1",
          repeatedKind: "message_row",
          loadedWindowIndex: "1",
          durability: "loaded_window",
          rawText: "do not keep message text",
        },
        locator: { strategy: "css_selector", value: "[data-testid='message-alpha-1-reply']", reliability: 90 },
      }),
      componentFact({
        accessibleName: "Reply",
        role: "button",
        platformScope: {
          family: "chat",
          region: "message_row",
          threadId: "beta",
          containerId: "message-beta-1",
          repeatedKind: "message_row",
          loadedWindowIndex: "1",
          durability: "loaded_window",
        },
        locator: { strategy: "css_selector", value: "[data-testid='message-beta-1-reply']", reliability: 90 },
      }),
    ],
  });

  assert.deepEqual(pageMap.components.map((component) => component.componentId), [
    "example_com_chat_chat_message_row_chat_thread_alpha_reply_button",
    "example_com_chat_chat_message_row_chat_thread_beta_reply_button",
  ]);
  assert.equal(pageMap.components[0].fingerprint.structural.platformScope.family, "chat");
  assert.equal(pageMap.components[0].fingerprint.structural.platformScope.threadId, "alpha");
  assert.equal(pageMap.components[0].fingerprint.structural.platformScope.repeatedKind, "message_row");
  assert.equal(Object.hasOwn(pageMap.components[0].fingerprint.structural.platformScope, "rawText"), false);
});

test("static page map retains bounded open-shadow boundary paths", () => {
  const pageMap = buildStaticPageMap({
    page: { url: "https://example.com/settings" },
    componentFacts: [componentFact({
      accessibleName: "Save Shadow",
      role: "button",
      locator: { strategy: "data-testid", value: "shadow-save", reliability: 96 },
      shadowPath: [
        { hostPath: "body:1/main:0/shadow-card:2", innerPath: "div:0/button:1" },
        { hostPath: "div:0/nested-card:0", innerPath: "section:0/button:0" },
        { hostPath: "ignored", innerPath: "ignored" },
        { hostPath: "ignored-2", innerPath: "ignored-2" },
        { hostPath: "too-deep", innerPath: "too-deep" },
      ],
    })],
  });

  const shadowPath = pageMap.components[0].fingerprint.technical.shadowPath;
  assert.equal(shadowPath.length, 4);
  assert.deepEqual(shadowPath[0], {
    hostPath: "body:1/main:0/shadow-card:2",
    innerPath: "div:0/button:1",
  });
});

test("static page map safely declines mutation-heavy pages", () => {
  const pageMap = buildStaticPageMap({
    page: {
      url: "https://example.com/feed",
      materialMutationCount: 99,
    },
    settings: { materialMutationLimit: 5 },
    componentFacts: [
      componentFact({
        accessibleName: "Like",
        role: "button",
        locator: { strategy: "css_selector", value: "#like", reliability: 90 },
      }),
    ],
  });

  assert.equal(pageMap.classification, MapperPageClassifications.DynamicDeferred);
  assert.equal(pageMap.componentCount, 0);
  assert.equal(pageMap.diagnostics.reason, "material_mutation_limit_exceeded");
});

test("bounded dynamic regions remain mapped as loaded-content-only", () => {
  const pageMap = buildStaticPageMap({
    page: {
      url: "https://example.com/dashboard",
      materialMutationCount: 120,
    },
    settings: { materialMutationLimit: 5 },
    componentFacts: [componentFact({
      accessibleName: "Open item",
      role: "button",
      regionDynamics: {
        regionId: "activity_feed",
        classification: "loaded_window",
        mutationCount: 120,
        loadedContentOnly: true,
        bounded: true,
      },
      locator: { strategy: "data-testid", value: "feed-action-1", reliability: 95 },
    })],
  });

  assert.equal(pageMap.classification, MapperPageClassifications.HybridDynamic);
  assert.equal(pageMap.status, "ready");
  assert.equal(pageMap.componentCount, 1);
  assert.equal(pageMap.diagnostics.dynamicRegionCount, 1);
  assert.equal(pageMap.diagnostics.loadedContentOnly, true);
  assert.equal(pageMap.diagnostics.reason, "bounded_dynamic_regions");
  assert.equal(
    pageMap.components[0].fingerprint.structural.regionDynamics.classification,
    "loaded_window",
  );
});

test("page map reconciliation marks changed and removed components", () => {
  const previous = buildStaticPageMap({
    page: { url: "https://example.com/account" },
    componentFacts: [
      componentFact({
        accessibleName: "Save",
        role: "button",
        ancestorTokens: ["account form"],
        locator: { strategy: "css_selector", value: "#save-old", reliability: 98 },
      }),
      componentFact({
        accessibleName: "Cancel",
        role: "button",
        locator: { strategy: "css_selector", value: "#cancel", reliability: 98 },
      }),
    ],
    now: "2026-07-04T00:00:00.000Z",
  });

  const refreshed = buildStaticPageMap({
    page: { url: "https://example.com/account" },
    previousMap: previous,
    componentFacts: [
      componentFact({
        accessibleName: "Save",
        role: "button",
        ancestorTokens: ["account form"],
        locator: { strategy: "css_selector", value: "#save-new", reliability: 98 },
      }),
    ],
    now: "2026-07-04T00:01:00.000Z",
  });

  assert.equal(refreshed.reconciliation.changed, 1);
  assert.equal(refreshed.reconciliation.removed, 1);
  assert.equal(refreshed.components[0].componentId, previous.components[0].componentId);
  assert.equal(refreshed.components[0].status, MapperComponentStatuses.Changed);
  assert.equal(refreshed.components[0].reviewRequired, false);
  assert.equal(refreshed.components[0].reconciliationDecision.reason, "component_uid_drift");
  assert.equal(refreshed.reliabilityMetrics.redaction.rawTextStored, false);
  assert.equal(refreshed.reliabilityMetrics.redaction.rawLocatorStored, false);
  assert.equal(refreshed.reliabilityMetrics.automaticStrongMatchCount, 1);
  assert.equal(refreshed.reliabilityMetrics.uncertainAsNewCount, 0);
  assert.equal(refreshed.reliabilityMetrics.componentIdSurvivalRate, 0.5);
  assert.equal(refreshed.components.at(-1).status, MapperComponentStatuses.Removed);
  assert.equal(refreshed.components.at(-1).reviewRequired, false);
});

test("page map reconciliation confirms automatic rebinding across settled captures", () => {
  const previous = buildStaticPageMap({
    page: { url: "https://example.com/account" },
    componentFacts: [
      componentFact({
        componentUid: "old-save-uid",
        accessibleName: "Save",
        role: "button",
        ancestorTokens: ["account form"],
        locator: { strategy: "css_selector", value: "#save", reliability: 98 },
      }),
    ],
    now: "2026-07-04T00:00:00.000Z",
  });

  const rebound = buildStaticPageMap({
    page: { url: "https://example.com/account" },
    previousMap: previous,
    componentFacts: [
      componentFact({
        componentUid: "new-save-uid",
        accessibleName: "Save",
        role: "button",
        ancestorTokens: ["account form"],
        locator: { strategy: "css_selector", value: "#save", reliability: 98 },
      }),
    ],
    now: "2026-07-04T00:01:00.000Z",
  });

  assert.equal(rebound.components[0].componentId, previous.components[0].componentId);
  assert.equal(rebound.components[0].reconciliationDecision.reason, "strong_unique_history_match");
  assert.deepEqual(rebound.components[0].reconciliationDecision.evidence, [
    "role",
    "name",
    "structural",
    "technical",
    "behavioral",
  ]);
  assert.equal(rebound.components[0].identityConfirmation.status, "pending");
  assert.equal(rebound.components[0].identityConfirmation.confirmationCount, 1);
  assert.equal(rebound.reliabilityMetrics.rebindConfirmation.pendingCount, 1);

  const confirmed = buildStaticPageMap({
    page: { url: "https://example.com/account" },
    previousMap: rebound,
    componentFacts: [
      componentFact({
        componentUid: "new-save-uid",
        accessibleName: "Save",
        role: "button",
        ancestorTokens: ["account form"],
        locator: { strategy: "css_selector", value: "#save", reliability: 98 },
      }),
    ],
    now: "2026-07-04T00:02:00.000Z",
  });

  assert.equal(confirmed.components[0].componentId, previous.components[0].componentId);
  assert.equal(confirmed.components[0].identityConfirmation.status, "confirmed");
  assert.equal(confirmed.components[0].identityConfirmation.confirmationCount, 2);
  assert.equal(confirmed.components[0].identityConfirmation.reason, "settled_capture_confirmed_rebind");
  assert.equal(confirmed.reliabilityMetrics.rebindConfirmation.confirmedCount, 1);
});

test("runtime resolver outcomes update redacted page reliability counters", () => {
  const pageMap = buildStaticPageMap({
    page: { url: "https://example.com/account" },
    componentFacts: [
      componentFact({
        accessibleName: "Email",
        role: "textbox",
        tag: "input",
        inputType: "text",
        locator: { strategy: "css_selector", value: "#email", reliability: 98 },
      }),
    ],
    now: "2026-07-04T00:00:00.000Z",
  });

  const fallback = recordMapperRuntimeResolution(pageMap, {
    action: "element.type",
    componentId: pageMap.components[0].componentId,
    componentUid: pageMap.components[0].componentUid,
    pageProfileKey: pageMap.pageProfileKey,
    mapVersionId: pageMap.mapVersionId,
    state: MapperResolverStates.ResolvedWithFallback,
    reason: "fingerprint_unique",
    confidence: 88,
    resolverLog: {
      selected: {
        rank: 1,
        score: 88,
        evidence: ["name", "structural"],
        componentId: "raw candidate id",
        componentUid: "raw candidate uid",
        displayName: "Do not persist",
        primary: { strategy: "css_selector", value: "#do-not-persist" },
      },
      runnerUp: {
        rank: 2,
        score: 60,
        evidence: ["name"],
        componentId: "runner",
        componentUid: "runner-uid",
        primary: { strategy: "text", value: "Secret text" },
      },
      margin: 28,
      attemptCount: 2,
    },
  }, "2026-07-04T00:01:00.000Z");
  const ambiguous = recordMapperRuntimeResolution(fallback, {
    state: MapperResolverStates.Ambiguous,
    reason: "runner_up_margin_too_small",
    confidence: 80,
  }, "2026-07-04T00:02:00.000Z");
  const notFound = recordMapperRuntimeResolution(ambiguous, {
    state: MapperResolverStates.NotFound,
    reason: "below_threshold",
    confidence: 40,
  }, "2026-07-04T00:03:00.000Z");

  assert.equal(notFound.reliabilityMetrics.runtime.attemptCount, 3);
  assert.equal(notFound.reliabilityMetrics.runtime.fallbackRecoveryCount, 1);
  assert.equal(notFound.reliabilityMetrics.runtime.ambiguousCount, 1);
  assert.equal(notFound.reliabilityMetrics.runtime.notFoundCount, 1);
  assert.equal(notFound.resolverAttempts.length, 3);
  assert.equal(notFound.resolverAttempts[0].redaction.rawTextStored, false);
  assert.equal(notFound.resolverAttempts[0].redaction.rawLocatorStored, false);
  assert.equal(notFound.resolverAttempts[0].selected.primaryStrategy, "css_selector");
  assert.equal(Object.hasOwn(notFound.resolverAttempts[0].selected, "displayName"), false);
  assert.equal(Object.hasOwn(notFound.resolverAttempts[0].selected, "primary"), false);
});

test("page map reconciliation keeps appended feed items after existing items", () => {
  const previous = buildStaticPageMap({
    page: { url: "https://example.com/feed" },
    componentFacts: [
      componentFact({
        stableText: "Loaded item 1 for mapper infinite-scroll boundary checks.",
        role: "text",
        tag: "p",
        domPath: "main/section[4]/div/article[1]/p[1]",
        documentBounds: { x: 40, y: 100, width: 280, height: 24 },
        locator: { strategy: "text", value: "Loaded item 1 for mapper infinite-scroll boundary checks.", reliability: 88 },
      }),
      componentFact({
        stableText: "Loaded item 2 for mapper infinite-scroll boundary checks.",
        role: "text",
        tag: "p",
        domPath: "main/section[4]/div/article[2]/p[1]",
        documentBounds: { x: 40, y: 160, width: 280, height: 24 },
        locator: { strategy: "text", value: "Loaded item 2 for mapper infinite-scroll boundary checks.", reliability: 88 },
      }),
    ],
    now: "2026-07-04T00:00:00.000Z",
  });

  const refreshed = buildStaticPageMap({
    page: { url: "https://example.com/feed" },
    previousMap: previous,
    componentFacts: [
      componentFact({
        stableText: "Loaded item 1 for mapper infinite-scroll boundary checks.",
        role: "text",
        tag: "p",
        domPath: "main/section[4]/div/article[1]/p[1]",
        documentBounds: { x: 40, y: 100, width: 280, height: 24 },
        locator: { strategy: "text", value: "Loaded item 1 for mapper infinite-scroll boundary checks.", reliability: 88 },
      }),
      componentFact({
        stableText: "Loaded item 2 for mapper infinite-scroll boundary checks.",
        role: "text",
        tag: "p",
        domPath: "main/section[4]/div/article[2]/p[1]",
        documentBounds: { x: 40, y: 160, width: 280, height: 24 },
        locator: { strategy: "text", value: "Loaded item 2 for mapper infinite-scroll boundary checks.", reliability: 88 },
      }),
      componentFact({
        stableText: "Loaded item 3 for mapper infinite-scroll boundary checks.",
        role: "text",
        tag: "p",
        domPath: "main/section[4]/div/article[3]/p[1]",
        documentBounds: { x: 40, y: 220, width: 280, height: 24 },
        locator: { strategy: "text", value: "Loaded item 3 for mapper infinite-scroll boundary checks.", reliability: 88 },
      }),
    ],
    now: "2026-07-04T00:01:00.000Z",
  });

  assert.deepEqual(refreshed.components.map((component) => component.status), [
    MapperComponentStatuses.Changed,
    MapperComponentStatuses.Changed,
    MapperComponentStatuses.New,
  ]);
  assert.deepEqual(refreshed.components.map((component) => component.displayName), [
    "Loaded item 1 for mapper infinite-scroll boundary checks.",
    "Loaded item 2 for mapper infinite-scroll boundary checks.",
    "Loaded item 3 for mapper infinite-scroll boundary checks.",
  ]);
  assert.equal(refreshed.reconciliation.removed, 0);
});

test("page map reconciliation keeps removed history after live components", () => {
  const previous = buildStaticPageMap({
    page: { url: "https://example.com/feed" },
    componentFacts: [
      componentFact({
        stableText: "Removed feed item",
        role: "text",
        tag: "p",
        ancestorTokens: ["loaded feed items"],
        domPath: "main/section[4]/div/article[1]/p[1]",
        documentBounds: { x: 40, y: 100, width: 260, height: 24 },
        locator: { strategy: "text", value: "Removed feed item", reliability: 88 },
      }),
      componentFact({
        stableText: "Kept feed item",
        role: "text",
        tag: "p",
        ancestorTokens: ["loaded feed items"],
        domPath: "main/section[4]/div/article[2]/p[1]",
        documentBounds: { x: 40, y: 160, width: 260, height: 24 },
        locator: { strategy: "text", value: "Kept feed item", reliability: 88 },
      }),
    ],
    now: "2026-07-04T00:00:00.000Z",
  });

  const refreshed = buildStaticPageMap({
    page: { url: "https://example.com/feed" },
    previousMap: previous,
    componentFacts: [
      componentFact({
        stableText: "Kept feed item",
        role: "text",
        tag: "p",
        ancestorTokens: ["loaded feed items"],
        domPath: "main/section[4]/div/article[1]/p[1]",
        documentBounds: { x: 40, y: 100, width: 260, height: 24 },
        locator: { strategy: "text", value: "Kept feed item", reliability: 88 },
      }),
      componentFact({
        stableText: "New feed item",
        role: "text",
        tag: "p",
        ancestorTokens: ["loaded feed items"],
        domPath: "main/section[4]/div/article[2]/p[1]",
        documentBounds: { x: 40, y: 160, width: 260, height: 24 },
        locator: { strategy: "text", value: "New feed item", reliability: 88 },
      }),
    ],
    now: "2026-07-04T00:01:00.000Z",
  });

  assert.deepEqual(refreshed.components.map((component) => component.status), [
    MapperComponentStatuses.Changed,
    MapperComponentStatuses.New,
    MapperComponentStatuses.Removed,
  ]);
  assert.equal(refreshed.components.at(-1).displayName, "Removed feed item");
});

test("page map reconciliation treats close historical matches as new", () => {
  const previous = buildStaticPageMap({
    page: { url: "https://example.com/settings" },
    componentFacts: [
      componentFact({
        accessibleName: "Save",
        role: "button",
        ancestorTokens: ["settings form"],
        locator: { strategy: "css_selector", value: "#profile-save", reliability: 98 },
      }),
      componentFact({
        accessibleName: "Save",
        role: "button",
        ancestorTokens: ["settings form"],
        locator: { strategy: "css_selector", value: "#billing-save", reliability: 98 },
      }),
    ],
    now: "2026-07-04T00:00:00.000Z",
  });

  const refreshed = buildStaticPageMap({
    page: { url: "https://example.com/settings" },
    previousMap: previous,
    componentFacts: [
      componentFact({
        accessibleName: "Save",
        role: "button",
        tag: "a",
        ancestorTokens: ["settings form"],
        locator: { strategy: "css_selector", value: "#save", reliability: 98 },
      }),
    ],
    now: "2026-07-04T00:01:00.000Z",
  });

  assert.equal(refreshed.reconciliation.ambiguous, 0);
  assert.equal(refreshed.reconciliation.new, 1);
  assert.equal(refreshed.reconciliation.removed, 2);
  assert.equal(refreshed.components[0].status, MapperComponentStatuses.New);
  assert.equal(refreshed.components[0].reviewRequired, false);
  assert.equal(
    refreshed.components[0].reconciliationDecision.reason,
    "uncertain_history_treated_as_new",
  );
});

test("resolver uses unique primary locator before fuzzy evidence", () => {
  const pageMap = buildStaticPageMap({
    page: { url: "https://example.com/account" },
    componentFacts: [
      componentFact({
        accessibleName: "Save",
        role: "button",
        locator: { strategy: "css_selector", value: "#save", reliability: 98 },
      }),
    ],
  });
  const component = pageMap.components[0];

  const result = resolveMappedComponent(component, [
    componentFact({
      accessibleName: "Different Copy",
      role: "button",
      locator: { strategy: "css_selector", value: "#save", reliability: 98 },
    }),
  ], { action: "element.click" });

  assert.equal(result.state, MapperResolverStates.Resolved);
  assert.equal(result.reason, "primary_locator_unique");
});

test("resolver returns ambiguous for duplicate primary locators", () => {
  const pageMap = buildStaticPageMap({
    page: { url: "https://example.com/account" },
    componentFacts: [
      componentFact({
        accessibleName: "Save",
        role: "button",
        locator: { strategy: "text", value: "Save", reliability: 92 },
      }),
    ],
  });
  const component = pageMap.components[0];

  const result = resolveMappedComponent(component, [
    componentFact({
      accessibleName: "Save",
      role: "button",
      locator: { strategy: "text", value: "Save", reliability: 92 },
    }),
    componentFact({
      accessibleName: "Save",
      role: "button",
      ancestorTokens: ["footer"],
      locator: { strategy: "text", value: "Save", reliability: 92 },
    }),
  ], { action: "element.click" });

  assert.equal(result.state, MapperResolverStates.Ambiguous);
  assert.equal(result.reason, "primary_locator_ambiguous");
});

test("resolver never crosses chat thread scope for matching controls", () => {
  const pageMap = buildStaticPageMap({
    page: { url: "https://example.com/chat" },
    componentFacts: [componentFact({
      accessibleName: "Reply",
      role: "button",
      platformScope: {
        family: "chat",
        region: "message_row",
        threadId: "alpha",
        containerId: "message-alpha-1",
        repeatedKind: "message_row",
        loadedWindowIndex: "1",
      },
      locator: { strategy: "text", value: "Reply", reliability: 92 },
    })],
  });
  const component = pageMap.components[0];

  const resolved = resolveMappedComponent(component, [
    componentFact({
      accessibleName: "Reply",
      role: "button",
      platformScope: {
        family: "chat",
        region: "message_row",
        threadId: "beta",
        containerId: "message-beta-1",
        repeatedKind: "message_row",
        loadedWindowIndex: "1",
      },
      locator: { strategy: "text", value: "Reply", reliability: 92 },
    }),
    componentFact({
      accessibleName: "Reply",
      role: "button",
      platformScope: {
        family: "chat",
        region: "message_row",
        threadId: "alpha",
        containerId: "message-alpha-1",
        repeatedKind: "message_row",
        loadedWindowIndex: "9",
      },
      locator: { strategy: "css_selector", value: "#moved-reply", reliability: 92 },
    }),
  ], { action: "element.click" });

  assert.equal(resolved.state, MapperResolverStates.ResolvedWithFallback);
  assert.equal(resolved.candidate.fingerprint.structural.platformScope.threadId, "alpha");
  assert.equal(resolved.candidate.fingerprint.structural.platformScope.loadedWindowIndex, "9");

  const wrongThreadOnly = resolveMappedComponent(component, [componentFact({
    accessibleName: "Reply",
    role: "button",
    platformScope: {
      family: "chat",
      region: "message_row",
      threadId: "beta",
      containerId: "message-beta-1",
      repeatedKind: "message_row",
    },
    locator: { strategy: "text", value: "Reply", reliability: 92 },
  })], { action: "element.click" });

  assert.equal(wrongThreadOnly.state, MapperResolverStates.NotFound);
  assert.equal(wrongThreadOnly.reason, "no_platform_scope_compatible_candidates");
});

test("resolver blocks repeated platform controls without durable scope", () => {
  const pageMap = buildStaticPageMap({
    page: { url: "https://www.reddit.com/" },
    componentFacts: [componentFact({
      accessibleName: "Vote",
      role: "button",
      platformScope: {
        family: "social",
        region: "feed_card",
        repeatedKind: "feed_card",
        durability: "loaded_window",
        mappingDisposition: "unsupported_scope",
        scopeSource: "inferred_landmarks",
        confidence: 35,
      },
      locator: { strategy: "text", value: "Vote", reliability: 80 },
    })],
  });

  const result = resolveMappedComponent(pageMap.components[0], [componentFact({
    accessibleName: "Vote",
    role: "button",
    locator: { strategy: "text", value: "Vote", reliability: 80 },
  })], { action: "element.click" });

  assert.equal(result.state, MapperResolverStates.ProtectedUnsupported);
  assert.equal(result.reason, "platform_scope_insufficient");
});

test("resolver isolates same-origin frame paths and protects cross-origin frames", () => {
  const mapped = buildStaticPageMap({
    page: { url: "https://example.com/frames" },
    componentFacts: [componentFact({
      accessibleName: "Save",
      role: "button",
      frameScope: {
        access: "same_origin",
        path: "top/frame_alpha",
        depth: 1,
      },
      locator: { strategy: "text", value: "Save", reliability: 90 },
    })],
  }).components[0];
  const wrongFrame = resolveMappedComponent(mapped, [componentFact({
    accessibleName: "Save",
    role: "button",
    frameScope: {
      access: "same_origin",
      path: "top/frame_beta",
      depth: 1,
    },
    locator: { strategy: "text", value: "Save", reliability: 90 },
  })], { action: "element.click" });
  assert.equal(wrongFrame.state, MapperResolverStates.NotFound);

  const protectedComponent = buildStaticPageMap({
    page: { url: "https://example.com/frames" },
    componentFacts: [componentFact({
      accessibleName: "Pay",
      role: "button",
      frameScope: {
        access: "cross_origin",
        path: "cross_origin",
        depth: 1,
      },
      locator: { strategy: "text", value: "Pay", reliability: 90 },
    })],
  }).components[0];
  const protectedResult = resolveMappedComponent(protectedComponent, [], {
    action: "element.click",
  });
  assert.equal(protectedResult.state, MapperResolverStates.ProtectedUnsupported);
  assert.equal(protectedResult.reason, "cross_origin_frame_unsupported");
});

test("resolver pins repeated feed items and protects unconditioned patterns", () => {
  const pinned = buildStaticPageMap({
    page: { url: "https://example.com/feed" },
    componentFacts: [componentFact({
      accessibleName: "Open item",
      role: "button",
      repeatScope: {
        kind: "feed_item",
        containerId: "activity_feed",
        itemKey: "item_alpha",
        loadedWindowIndex: "1",
        loadedContentOnly: true,
        resolutionPolicy: "pinned_item",
      },
      locator: { strategy: "text", value: "Open item", reliability: 85 },
    })],
  }).components[0];
  const result = resolveMappedComponent(pinned, [
    componentFact({
      accessibleName: "Open item",
      role: "button",
      repeatScope: {
        kind: "feed_item",
        containerId: "activity_feed",
        itemKey: "item_beta",
        loadedWindowIndex: "1",
        loadedContentOnly: true,
        resolutionPolicy: "pinned_item",
      },
      locator: { strategy: "text", value: "Open item", reliability: 85 },
    }),
    componentFact({
      accessibleName: "Open item",
      role: "button",
      repeatScope: {
        kind: "feed_item",
        containerId: "activity_feed",
        itemKey: "item_alpha",
        loadedWindowIndex: "9",
        loadedContentOnly: true,
        resolutionPolicy: "pinned_item",
      },
      locator: { strategy: "css_selector", value: "#moved-item", reliability: 85 },
    }),
  ], { action: "element.click" });
  assert.equal(result.state, MapperResolverStates.ResolvedWithFallback);
  assert.equal(result.candidate.fingerprint.structural.repeatScope.itemKey, "item_alpha");

  const pattern = buildStaticPageMap({
    page: { url: "https://example.com/feed" },
    componentFacts: [componentFact({
      accessibleName: "Open item",
      role: "button",
      repeatScope: {
        kind: "feed_item",
        containerId: "activity_feed",
        loadedContentOnly: true,
        resolutionPolicy: "pattern_requires_condition",
      },
      locator: { strategy: "text", value: "Open item", reliability: 85 },
    })],
  }).components[0];
  const protectedResult = resolveMappedComponent(pattern, [], { action: "element.click" });
  assert.equal(protectedResult.state, MapperResolverStates.ProtectedUnsupported);
  assert.equal(protectedResult.reason, "repeat_condition_required");
});

test("reconciliation treats a matching control in another social card as new", () => {
  const previous = buildStaticPageMap({
    page: { url: "https://example.com/feed" },
    componentFacts: [componentFact({
      componentUid: "reused-cross-card-uid",
      accessibleName: "Like",
      role: "button",
      platformScope: {
        family: "social",
        region: "feed_card",
        containerId: "social-card-1",
        repeatedKind: "feed_card",
      },
      locator: { strategy: "css_selector", value: "#card-1-like", reliability: 90 },
    })],
  });
  const refreshed = buildStaticPageMap({
    page: { url: "https://example.com/feed" },
    previousMap: previous,
    componentFacts: [componentFact({
      componentUid: "reused-cross-card-uid",
      accessibleName: "Like",
      role: "button",
      platformScope: {
        family: "social",
        region: "feed_card",
        containerId: "social-card-2",
        repeatedKind: "feed_card",
      },
      locator: { strategy: "css_selector", value: "#card-2-like", reliability: 90 },
    })],
  });

  assert.equal(refreshed.reconciliation.new, 1);
  assert.equal(refreshed.reconciliation.removed, 1);
  assert.equal(refreshed.components[0].reconciliationDecision.reason, "no_compatible_history");
});

test("resolver finds unique fallback and rejects incompatible actions", () => {
  const pageMap = buildStaticPageMap({
    page: { url: "https://example.com/account" },
    componentFacts: [
      componentFact({
        accessibleName: "Email",
        role: "textbox",
        tag: "input",
        inputType: "text",
        ancestorTokens: ["profile form"],
        locator: { strategy: "css_selector", value: "#old-email", reliability: 95 },
      }),
    ],
  });
  const component = pageMap.components[0];

  const resolved = resolveMappedComponent(component, [
    componentFact({
      accessibleName: "Email",
      role: "textbox",
      tag: "input",
      inputType: "text",
      ancestorTokens: ["profile form"],
      locator: { strategy: "css_selector", value: "#new-email", reliability: 95 },
    }),
  ], { action: "element.type" });
  assert.equal(resolved.state, MapperResolverStates.ResolvedWithFallback);

  const incompatible = resolveMappedComponent(component, [
    componentFact({
      accessibleName: "Email",
      role: "textbox",
      tag: "input",
      inputType: "text",
      ancestorTokens: ["profile form"],
      locator: { strategy: "css_selector", value: "#new-email", reliability: 95 },
    }),
  ], { action: "file.input.upload" });
  assert.equal(incompatible.state, MapperResolverStates.NotFound);
});

function componentFact({
  componentId = "",
  componentUid = "",
  accessibleName = "",
  role = "",
  labelText = "",
  stableText = "",
  tag = "button",
  inputType = "",
  ancestorTokens = [],
  platformScope = null,
  frameScope = null,
  repeatScope = null,
  regionDynamics = null,
  locator = { strategy: "css_selector", value: "#target", reliability: 90 },
  documentBounds = null,
  domPath = "",
  shadowPath = [],
} = {}) {
  return {
    componentId,
    componentUid,
    locatorCandidates: [locator],
    fingerprint: {
      semantic: {
        accessibleName,
        role,
        labelText,
        stableText,
        inputType,
      },
      structural: {
        ancestorTokens,
        platformScope,
        frameScope,
        repeatScope,
        regionDynamics,
      },
      technical: {
        tag,
        domPath,
        shadowPath,
      },
      visual: {
        documentBounds,
      },
    },
  };
}
