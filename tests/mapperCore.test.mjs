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
  assert.equal(refreshed.components[0].reviewRequired, true);
  assert.equal(refreshed.components.at(-1).status, MapperComponentStatuses.Removed);
});

test("page map reconciliation flags close historical matches as ambiguous", () => {
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

  assert.equal(refreshed.reconciliation.ambiguous, 1);
  assert.equal(refreshed.components[0].status, MapperComponentStatuses.Ambiguous);
  assert.equal(refreshed.components[0].reviewRequired, true);
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
  accessibleName = "",
  role = "",
  labelText = "",
  stableText = "",
  tag = "button",
  inputType = "",
  ancestorTokens = [],
  locator = { strategy: "css_selector", value: "#target", reliability: 90 },
} = {}) {
  return {
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
      },
      technical: {
        tag,
      },
    },
  };
}
