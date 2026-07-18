import assert from "node:assert/strict";
import { test } from "node:test";

import { createMapperCoordinator } from "../BRunner/core/mapperCoordinator.js";
import { ChromeMapStore } from "../BRunner/core/mapStore.js";
import { normalizePageProfile } from "../BRunner/mapper/core.js";

test("mapper coordinator persists recorded facts as workflow page maps", async () => {
  const storage = createMemoryStorage();
  const store = new ChromeMapStore(storage);
  const coordinator = createMapperCoordinator({
    mapStore: store,
    clock: () => "2026-07-04T00:00:00.000Z",
  });

  const enriched = await coordinator.reconcileRecordedStep(
    recordedStep({
      componentId: "pending_save",
      componentUid: "incoming-1",
      locator: "#save",
    }),
    { sessionId: "recording-1" },
  );
  const state = await store.getWorkflowMapperState("recording-1");

  assert.equal(enriched.componentRef.componentId, "example_com_account_save_button");
  assert.equal(enriched.mapper.workflowId, "recording-1");
  assert.equal(state.maps.length, 1);
  assert.equal(state.maps[0].components.length, 1);
  assert.equal(state.maps[0].components[0].componentId, enriched.componentRef.componentId);
});

test("mapper coordinator preserves locked component ids across recorder drift", async () => {
  const storage = createMemoryStorage();
  const store = new ChromeMapStore(storage);
  const coordinator = createMapperCoordinator({
    mapStore: store,
    clock: () => "2026-07-04T00:00:00.000Z",
  });

  const first = await coordinator.reconcileRecordedStep(
    recordedStep({
      componentId: "pending_save",
      componentUid: "stable-uid",
      locator: "#save-old",
    }),
    { sessionId: "recording-2" },
  );
  const second = await coordinator.reconcileRecordedStep(
    recordedStep({
      componentId: "pending_save_after_drift",
      componentUid: "stable-uid",
      locator: "#save-new",
      accessibleName: "Save changes",
    }),
    { sessionId: "recording-2" },
  );

  assert.equal(second.componentRef.componentId, first.componentRef.componentId);
  const state = await store.getWorkflowMapperState("recording-2");
  assert.equal(state.maps.length, 2);
  assert.equal(state.maps.at(-1).components.at(-1).componentId, first.componentRef.componentId);
});

test("explicit mapper mode does not create or mutate maps during recording", async () => {
  const storage = createMemoryStorage();
  const store = new ChromeMapStore(storage);
  await store.saveWorkflowMapperState("recording-explicit", {
    workflowId: "recording-explicit",
    settings: {
      mode: "automatic",
      pageOverrides: {
        "example_com::account": { mode: "explicit" },
      },
    },
    maps: [],
  });
  const coordinator = createMapperCoordinator({
    mapStore: store,
    clock: () => "2026-07-04T00:00:00.000Z",
  });

  const recorded = await coordinator.reconcileRecordedStep(
    recordedStep({
      componentId: "pending_explicit",
      componentUid: "explicit-uid",
      locator: "#explicit",
    }),
    { sessionId: "recording-explicit" },
  );
  const state = await store.getWorkflowMapperState("recording-explicit");

  assert.equal(recorded.mapper.mode, "explicit");
  assert.equal(recorded.mapper.classification, "explicit_mapping_required");
  assert.equal(recorded.mapper.componentId, "");
  assert.equal(state.maps.length, 0);
});

test("mapper coordinator links incoming fact after visual reordering", async () => {
  const storage = createMemoryStorage();
  const store = new ChromeMapStore(storage);
  const coordinator = createMapperCoordinator({
    mapStore: store,
    clock: () => "2026-07-04T00:00:00.000Z",
  });

  await coordinator.reconcileRecordedStep(
    recordedStep({
      componentId: "pending_bottom",
      componentUid: "bottom-uid",
      locator: "#bottom",
      accessibleName: "Bottom",
      documentBounds: { x: 20, y: 400, width: 80, height: 30 },
    }),
    { sessionId: "recording-visual-order" },
  );
  const top = await coordinator.reconcileRecordedStep(
    recordedStep({
      componentId: "pending_top",
      componentUid: "top-uid",
      locator: "#top",
      accessibleName: "Top",
      documentBounds: { x: 20, y: 20, width: 80, height: 30 },
    }),
    { sessionId: "recording-visual-order" },
  );

  const state = await store.getWorkflowMapperState("recording-visual-order");
  const components = state.maps.at(-1).components;

  assert.deepEqual(components.map((component) => component.displayName), ["Top", "Bottom"]);
  assert.equal(top.componentRef.componentId, components[0].componentId);
  assert.equal(components[0].historicalLinks.some((link) => link.componentUid === "top-uid"), true);
});

test("mapper coordinator attaches stored component context for execution", async () => {
  const storage = createMemoryStorage();
  const store = new ChromeMapStore(storage);
  const coordinator = createMapperCoordinator({
    mapStore: store,
    clock: () => "2026-07-04T00:00:00.000Z",
  });

  const recorded = await coordinator.reconcileRecordedStep(
    recordedStep({
      componentId: "pending_save",
      componentUid: "execution-uid",
      locator: "#save",
    }),
    { sessionId: "recording-3" },
  );
  const executable = await coordinator.attachExecutionContext(recorded);

  assert.equal(executable.mapperContext.state, "ready");
  assert.equal(executable.mapperContext.workflowId, "recording-3");
  assert.equal(executable.mapperContext.component.componentId, recorded.componentRef.componentId);
  assert.equal(executable.mapperContext.pageMap.classification, "static");
});

test("mapper coordinator marks missing execution records as handled not_found", async () => {
  const coordinator = createMapperCoordinator({
    mapStore: new ChromeMapStore(createMemoryStorage()),
    clock: () => "2026-07-04T00:00:00.000Z",
  });

  const executable = await coordinator.attachExecutionContext({
    action: "element.click",
    componentRef: {
      mapperSchemaVersion: 1,
      componentId: "missing",
      componentUid: "missing",
      siteKey: "example_com",
      pageProfileKey: "example_com::account",
      capturedMapVersionId: "missing",
    },
    mapper: {
      workflowId: "recording-missing",
    },
  });

  assert.equal(executable.mapperContext.state, "not_found");
  assert.equal(executable.mapperContext.reason, "component_record_missing");
});

test("mapper coordinator exposes node-neutral scan/get/ref/resolve/revalidate/refresh APIs", async () => {
  const storage = createMemoryStorage();
  const store = new ChromeMapStore(storage);
  let tick = 0;
  const coordinator = createMapperCoordinator({
    mapStore: store,
    clock: () => `2026-07-04T00:0${tick++}:00.000Z`,
  });
  const initialFact = recordedStep({
    componentId: "source-save",
    componentUid: "api-save-uid",
    locator: "#save",
  }).mapperFact;
  const scanned = await coordinator.scanPage({
    workflowId: "node-neutral-api",
    page: { url: "https://example.com/account", title: "Account" },
    componentFacts: [initialFact],
  });
  const found = await coordinator.getPageMap("node-neutral-api", {
    pageProfileKey: scanned.pageMap.pageProfileKey,
  });
  const componentRef = await coordinator.createComponentRef(
    "node-neutral-api",
    { pageProfileKey: found.pageProfileKey },
    found.components[0].componentId,
  );
  const resolved = await coordinator.resolveComponent({
    componentRef,
    candidateFacts: [initialFact],
    requirements: { action: "element.click" },
  });
  const revalidated = await coordinator.revalidateComponent({
    componentRef,
    candidateFacts: [initialFact],
    requirements: { action: "element.click" },
  });
  const refreshed = await coordinator.refreshPageMap({
    workflowId: "node-neutral-api",
    page: { url: "https://example.com/account", title: "Account" },
    componentFacts: [{
      ...initialFact,
      locatorCandidates: [{
        strategy: "css_selector",
        value: "#save-new",
        reliability: 95,
        selectedAtCapture: true,
      }],
    }],
  });

  assert.equal(componentRef.workflowId, "node-neutral-api");
  assert.equal(resolved.state, "resolved");
  assert.equal(revalidated.state, "resolved");
  assert.equal(revalidated.operation, "revalidate");
  assert.equal(refreshed.pageMap.components[0].componentId, componentRef.componentId);
  assert.equal(Object.hasOwn(scanned, "node"), false);
});

test("node-neutral APIs retain and resolve extension-accessible cross-origin frame contexts", async () => {
  const store = new ChromeMapStore(createMemoryStorage());
  const coordinator = createMapperCoordinator({
    mapStore: store,
    clock: () => "2026-07-04T00:00:00.000Z",
  });
  const frameScope = {
    access: "cross_origin",
    path: "isolated/frame_checkout/instance_1",
    depth: 1,
    contextKey: "frame_checkout",
    frameContextId: "frame_checkout_instance_1",
    frameIdHint: 12,
    extensionAccessible: true,
  };
  const baseFact = recordedStep({
    componentId: "checkout-pay",
    componentUid: "checkout-pay-uid",
    locator: "#pay",
    accessibleName: "Pay",
  }).mapperFact;
  const framedFact = {
    ...baseFact,
    fingerprint: {
      ...baseFact.fingerprint,
      structural: {
        ...baseFact.fingerprint.structural,
        frameScope,
      },
    },
  };
  const scanned = await coordinator.scanPage({
    workflowId: "cross-origin-api",
    page: { url: "https://merchant.example/checkout" },
    componentFacts: [framedFact],
  });
  const componentRef = await coordinator.createComponentRef(
    "cross-origin-api",
    { pageProfileKey: scanned.pageMap.pageProfileKey },
    scanned.pageMap.components[0].componentId,
  );
  const resolved = await coordinator.resolveComponent({
    componentRef,
    candidateFacts: [framedFact],
    requirements: { action: "element.click" },
  });
  const revalidated = await coordinator.revalidateComponent({
    componentRef,
    candidateFacts: [framedFact],
    requirements: { action: "element.click" },
    frameContexts: [frameScope],
  });
  const unreachable = await coordinator.revalidateComponent({
    componentRef,
    candidateFacts: [],
    requirements: { action: "element.click" },
    frameContexts: [],
  });
  const refreshed = await coordinator.refreshPageMap({
    workflowId: "cross-origin-api",
    page: { url: "https://merchant.example/checkout" },
    componentFacts: [framedFact],
  });

  assert.equal(resolved.state, "resolved");
  assert.equal(revalidated.state, "resolved");
  assert.equal(unreachable.state, "protected_unsupported");
  assert.equal(unreachable.reason, "cross_origin_frame_unreachable");
  assert.equal(
    refreshed.pageMap.components[0].fingerprint.structural.frameScope.frameContextId,
    "frame_checkout_instance_1",
  );
  assert.equal(refreshed.pageMap.components[0].componentId, componentRef.componentId);
});

test("mapper coordinator preserves concurrent page scans in one workflow", async () => {
  const storage = createMemoryStorage({ yieldBeforeSet: true });
  const store = new ChromeMapStore(storage);
  const coordinator = createMapperCoordinator({
    mapStore: store,
    clock: () => "2026-07-04T00:00:00.000Z",
  });
  const scan = (page, locator) => coordinator.scanPage({
    workflowId: "concurrent-pages",
    page: { url: `https://example.com/${page}`, title: page },
    componentFacts: [recordedStep({
      componentId: `${page}-component`,
      componentUid: `${page}-uid`,
      locator,
      url: `https://example.com/${page}`,
      pageProfileKey: `example_com::${page}`,
    }).mapperFact],
  });

  await Promise.all([
    scan("first", "#first"),
    scan("second", "#second"),
  ]);

  const state = await store.getWorkflowMapperState("concurrent-pages");
  const expectedPageKeys = ["first", "second"]
    .map((page) => normalizePageProfile(`https://example.com/${page}`).pageKey)
    .sort();
  assert.deepEqual(
    state.maps.map((map) => map.pageProfileKey).sort(),
    expectedPageKeys,
  );
  assert.equal(state.storage.revision, "2");
});

test("mapper coordinator rejects cross-workflow and cross-site component references", async () => {
  const store = new ChromeMapStore(createMemoryStorage());
  const coordinator = createMapperCoordinator({ mapStore: store });
  const fact = recordedStep({
    componentId: "route-save",
    componentUid: "route-save-uid",
    locator: "#route-save",
    url: "https://example.com/route-a",
    pageProfileKey: "example_com::route_a",
  }).mapperFact;
  const scanned = await coordinator.scanPage({
    workflowId: "workflow-a",
    page: { url: "https://example.com/route-a" },
    componentFacts: [fact],
  });
  const ref = await coordinator.createComponentRef(
    "workflow-a",
    { pageProfileKey: scanned.pageMap.pageProfileKey },
    scanned.pageMap.components[0].componentId,
  );

  const workflowMismatch = await coordinator.resolveComponent({
    workflowId: "workflow-b",
    componentRef: ref,
    pageMap: scanned.pageMap,
    candidateFacts: [fact],
  });
  const siteMismatch = await coordinator.resolveComponent({
    workflowId: "workflow-a",
    componentRef: { ...ref, siteKey: "other_example" },
    pageMap: scanned.pageMap,
    candidateFacts: [fact],
  });

  assert.equal(workflowMismatch.state, "map_stale");
  assert.equal(workflowMismatch.reason, "workflow_mismatch");
  assert.equal(siteMismatch.state, "map_stale");
  assert.equal(siteMismatch.reason, "site_key_mismatch");
});

test("mapper version lookup cannot bypass site or route constraints", async () => {
  const store = new ChromeMapStore(createMemoryStorage());
  const coordinator = createMapperCoordinator({ mapStore: store });
  const scanned = await coordinator.scanPage({
    workflowId: "version-route-isolation",
    page: { url: "https://example.com/route-a" },
    componentFacts: [recordedStep({
      componentId: "route-a-save",
      componentUid: "route-a-save-uid",
      locator: "#route-save",
      url: "https://example.com/route-a",
      pageProfileKey: "example_com::route_a",
    }).mapperFact],
  });

  assert.equal(await coordinator.getPageMap("version-route-isolation", {
    mapVersionId: scanned.pageMap.mapVersionId,
    pageProfileKey: "example_com::route_b",
  }), null);
  assert.equal(await coordinator.getPageMap("version-route-isolation", {
    mapVersionId: scanned.pageMap.mapVersionId,
    siteKey: "other_example",
  }), null);
  assert.equal((await coordinator.getPageMap("version-route-isolation", {
    mapVersionId: scanned.pageMap.mapVersionId,
    pageProfileKey: scanned.pageMap.pageProfileKey,
    siteKey: scanned.pageMap.siteKey,
  })).mapVersionId, scanned.pageMap.mapVersionId);
});

test("mapper coordinator discards a page snapshot older than the stored current map", async () => {
  const store = new ChromeMapStore(createMemoryStorage());
  const coordinator = createMapperCoordinator({ mapStore: store });
  const page = { url: "https://example.com/freshness" };
  const newestFact = recordedStep({
    componentId: "newest",
    componentUid: "newest-uid",
    locator: "#newest",
    url: page.url,
    pageProfileKey: "example_com::freshness",
  }).mapperFact;
  const staleFact = recordedStep({
    componentId: "stale",
    componentUid: "stale-uid",
    locator: "#stale",
    url: page.url,
    pageProfileKey: "example_com::freshness",
  }).mapperFact;

  const newest = await coordinator.scanPage({
    workflowId: "snapshot-freshness",
    page: { ...page, capturedAt: "2026-07-17T00:02:00.000Z" },
    componentFacts: [newestFact],
    settings: { maxVersions: 1 },
  });
  const stale = await coordinator.scanPage({
    workflowId: "snapshot-freshness",
    page: { ...page, capturedAt: "2026-07-17T00:01:00.000Z" },
    componentFacts: [staleFact],
    settings: { maxVersions: 1 },
  });
  const stored = await coordinator.getPageMap("snapshot-freshness", {
    pageProfileKey: newest.pageMap.pageProfileKey,
  });

  assert.equal(stale.persisted, false);
  assert.equal(stale.reason, "stale_snapshot");
  assert.equal(stale.pageMap.createdAt, "2026-07-17T00:02:00.000Z");
  assert.equal(stored.createdAt, "2026-07-17T00:02:00.000Z");
  assert.equal(stored.components.some((component) => component.componentUid === "newest-uid"), true);
  assert.equal(stored.components.some((component) => component.componentUid === "stale-uid"), false);
});

test("mapper coordinator retains bounded page map history", async () => {
  const storage = createMemoryStorage();
  const store = new ChromeMapStore(storage);
  let tick = 0;
  const coordinator = createMapperCoordinator({
    mapStore: store,
    clock: () => `2026-07-04T00:0${tick++}:00.000Z`,
  });

  for (const locator of ["#one", "#two", "#three"]) {
    await coordinator.reconcileRecordedStep(
      recordedStep({
        componentId: `pending_${locator.slice(1)}`,
        componentUid: `uid_${locator.slice(1)}`,
        locator,
        accessibleName: `Save ${locator}`,
      }),
      {
        sessionId: "recording-retention",
        settings: { maxVersions: 2 },
      },
    );
  }

  const state = await store.getWorkflowMapperState("recording-retention");
  assert.equal(state.maps.length, 2);
  assert.deepEqual(state.maps.map((map) => map.createdAt), [
    "2026-07-04T00:01:00.000Z",
    "2026-07-04T00:02:00.000Z",
  ]);
});

test("mapper coordinator isolates changes by page profile within the same site", async () => {
  const storage = createMemoryStorage();
  const store = new ChromeMapStore(storage);
  let tick = 0;
  const coordinator = createMapperCoordinator({
    mapStore: store,
    clock: () => `2026-07-04T00:0${tick++}:00.000Z`,
  });

  const login = await coordinator.reconcileRecordedStep(
    recordedStep({
      componentId: "pending_login",
      componentUid: "login-submit",
      locator: "#login-submit",
      accessibleName: "Sign in",
      url: "https://example.com/login",
      title: "Login",
      pageProfileKey: "example_com::login",
    }),
    { sessionId: "recording-pages" },
  );
  const home = await coordinator.reconcileRecordedStep(
    recordedStep({
      componentId: "pending_home",
      componentUid: "home-welcome",
      locator: "#home-welcome",
      accessibleName: "Welcome",
      url: "https://example.com/home",
      title: "Home",
      pageProfileKey: "example_com::home",
    }),
    { sessionId: "recording-pages" },
  );
  await coordinator.reconcileRecordedStep(
    recordedStep({
      componentId: "pending_login_changed",
      componentUid: "login-submit",
      locator: "#login-submit-new",
      accessibleName: "Sign in",
      url: "https://example.com/login",
      title: "Login",
      pageProfileKey: "example_com::login",
    }),
    { sessionId: "recording-pages" },
  );

  const state = await store.getWorkflowMapperState("recording-pages");
  const loginPageKey = normalizePageProfile("https://example.com/login").pageKey;
  const homePageKey = normalizePageProfile("https://example.com/home").pageKey;
  const loginMaps = state.maps.filter((map) => map.pageProfileKey === loginPageKey);
  const homeMaps = state.maps.filter((map) => map.pageProfileKey === homePageKey);

  assert.equal(login.mapper.pageProfileKey, loginPageKey);
  assert.equal(home.mapper.pageProfileKey, homePageKey);
  assert.equal(loginMaps.length, 2);
  assert.equal(homeMaps.length, 1);
  assert.equal(homeMaps[0].components[0].componentId, home.componentRef.componentId);
  assert.equal(homeMaps[0].components[0].status, "new");
  assert.equal(loginMaps.at(-1).components[0].componentId, login.componentRef.componentId);
  assert.equal(loginMaps.at(-1).components[0].status, "changed");
});

test("recorded facts use the workflow query policy for collision-safe page identity", async () => {
  const store = new ChromeMapStore(createMemoryStorage());
  await store.saveWorkflowMapperState("recording-routes", {
    workflowId: "recording-routes",
    settings: {
      queryAllowlist: ["route"],
    },
    maps: [],
  });
  let tick = 0;
  const coordinator = createMapperCoordinator({
    mapStore: store,
    clock: () => `2026-07-04T00:1${tick++}:00.000Z`,
  });
  const accountUrl = "https://example.com/app?route=account-settings&utm=ignored";
  const billingUrl = "https://example.com/app?route=account_settings&utm=ignored";

  const account = await coordinator.reconcileRecordedStep(recordedStep({
    componentId: "pending_account",
    componentUid: "account-route",
    locator: "#account",
    url: accountUrl,
    pageProfileKey: "example_com::app",
  }), { sessionId: "recording-routes" });
  const billing = await coordinator.reconcileRecordedStep(recordedStep({
    componentId: "pending_billing",
    componentUid: "billing-route",
    locator: "#billing",
    url: billingUrl,
    pageProfileKey: "example_com::app",
  }), { sessionId: "recording-routes" });
  const state = await store.getWorkflowMapperState("recording-routes");

  assert.equal(
    account.mapper.pageProfileKey,
    normalizePageProfile(accountUrl, { queryAllowlist: ["route"] }).pageKey,
  );
  assert.equal(
    billing.mapper.pageProfileKey,
    normalizePageProfile(billingUrl, { queryAllowlist: ["route"] }).pageKey,
  );
  assert.notEqual(account.mapper.pageProfileKey, billing.mapper.pageProfileKey);
  assert.equal(state.maps.length, 2);
});

test("mapper coordinator persists runtime resolver reliability outcomes", async () => {
  const storage = createMemoryStorage();
  const store = new ChromeMapStore(storage);
  const coordinator = createMapperCoordinator({
    mapStore: store,
    clock: () => "2026-07-04T00:05:00.000Z",
  });

  const recorded = await coordinator.reconcileRecordedStep(
    recordedStep({
      componentId: "pending_email",
      componentUid: "email-uid",
      locator: "#email",
      accessibleName: "Email",
    }),
    { sessionId: "recording-runtime-metrics" },
  );

  await coordinator.recordResolverOutcome(recorded, {
    state: "resolved_with_fallback",
    reason: "fingerprint_unique",
    confidence: 86,
    resolverLog: {
      selected: {
        rank: 1,
        score: 86,
        evidence: ["name", "structural"],
        componentId: "candidate",
        componentUid: "candidate-uid",
        primary: { strategy: "css_selector", value: "#email-new" },
      },
      attemptCount: 1,
    },
  });

  const state = await store.getWorkflowMapperState("recording-runtime-metrics");
  const pageMap = state.maps.at(-1);

  assert.equal(pageMap.reliabilityMetrics.runtime.attemptCount, 1);
  assert.equal(pageMap.reliabilityMetrics.runtime.fallbackRecoveryCount, 1);
  assert.equal(pageMap.resolverAttempts.length, 1);
  assert.equal(Object.hasOwn(pageMap.resolverAttempts[0], "redaction"), false);
  assert.equal(pageMap.resolverAttempts[0].selected.primary.strategy, "css_selector");
  assert.equal(pageMap.resolverAttempts[0].selected.primary.value, "#email-new");
});

function createMemoryStorage({ yieldBeforeSet = false } = {}) {
  const memory = {};
  return {
    async get(key) {
      if (key === null) return structuredClone(memory);
      return { [key]: memory[key] };
    },
    async set(value) {
      if (yieldBeforeSet) await Promise.resolve();
      Object.assign(memory, value);
    },
  };
}

function recordedStep({
  componentId,
  componentUid,
  locator,
  accessibleName = "Save",
  url = "https://example.com/account",
  title = "Account",
  siteKey = "example_com",
  pageProfileKey = "example_com::account",
  documentBounds = null,
} = {}) {
  return {
    action: "element.click",
    page: {
      url,
      title,
    },
    componentRef: {
      mapperSchemaVersion: 1,
      componentId,
      componentUid,
      siteKey,
      pageProfileKey,
      capturedMapVersionId: "incoming",
    },
    mapperFact: {
      mapperSchemaVersion: 1,
      action: "element.click",
      siteKey,
      pageProfileKey,
      componentId,
      componentUid,
      capturedMapVersionId: "incoming",
      locatorCandidates: [{
        strategy: "css_selector",
        value: locator,
        reliability: 95,
        selectedAtCapture: true,
      }],
      fingerprint: {
        semantic: {
          accessibleName,
          role: "button",
        },
        structural: {
          ancestorTokens: [],
        },
        technical: {
          tag: "button",
        },
        visual: {
          documentBounds,
        },
      },
      expectedCapabilities: ["click", "extract"],
    },
  };
}
