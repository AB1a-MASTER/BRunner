import assert from "node:assert/strict";
import { test } from "node:test";

import { createMapperCoordinator } from "../BRunner/core/mapperCoordinator.js";
import { ChromeMapStore } from "../BRunner/core/mapStore.js";

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
  const loginMaps = state.maps.filter((map) => map.pageProfileKey === "example_com::login");
  const homeMaps = state.maps.filter((map) => map.pageProfileKey === "example_com::home");

  assert.equal(login.mapper.pageProfileKey, "example_com::login");
  assert.equal(home.mapper.pageProfileKey, "example_com::home");
  assert.equal(loginMaps.length, 2);
  assert.equal(homeMaps.length, 1);
  assert.equal(homeMaps[0].components[0].componentId, home.componentRef.componentId);
  assert.equal(homeMaps[0].components[0].status, "new");
  assert.equal(loginMaps.at(-1).components[0].componentId, login.componentRef.componentId);
  assert.equal(loginMaps.at(-1).components[0].status, "changed");
});

function createMemoryStorage() {
  const memory = {};
  return {
    async get(key) {
      return { [key]: memory[key] };
    },
    async set(value) {
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
