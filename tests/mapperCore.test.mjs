import assert from "node:assert/strict";
import { test } from "node:test";

import { Defaults } from "../BRunner/core/constants.js";
import {
  buildStaticPageMap,
  createComponentRef,
  createDefaultMapperSettings,
  createEmptyWorkflowMapperState,
  createPlaceholderComponentRef,
  deserializeWorkflowMapperState,
  getPageMap,
  isComponentRef,
  MapperComponentLayers,
  MapperComponentStatuses,
  MapperPageClassifications,
  MapperResolverStates,
  pageMapMatchesUrl,
  recordMapperRuntimeResolution,
  normalizeMapperSettings,
  normalizePageProfile,
  refreshPageMap,
  revalidateComponent,
  resolveComponent,
  resolveMappedComponent,
  scanPage,
  serializeWorkflowMapperState,
} from "../BRunner/mapper/core.js";
import {
  ChromeMapStore,
  MapStoreConflictError,
  mapperWorkflowStorageKey,
} from "../BRunner/core/mapStore.js";

test("mapper settings normalize to bounded workflow-scoped defaults", () => {
  const settings = normalizeMapperSettings({
    enabled: false,
    mode: "explicit",
    maxComponents: 99999,
    maxVersions: -1,
    queryAllowlist: ["tab", "tab", " "],
    siteOverrides: {
      example_com: { mode: "explicit", sensitive: true, redaction: "all" },
    },
    pageOverrides: {
      "example_com::account": { sensitiveSite: true, redactSensitive: true },
    },
  });

  assert.equal(settings.enabled, false);
  assert.equal(settings.mode, "explicit");
  assert.equal(settings.maxComponents, 2000);
  assert.equal(settings.maxVersions, 1);
  assert.deepEqual(settings.queryAllowlist, ["tab"]);
  assert.deepEqual(settings.siteOverrides, {
    example_com: { mode: "explicit" },
  });
  assert.deepEqual(settings.pageOverrides, {
    "example_com::account": {},
  });
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
    pageKey: profile.pageKey,
  });
  assert.match(profile.pageKey, /^example_com::app_page::identity_v2_[0-9a-f]{32}$/);
  assert.equal(
    normalizePageProfile(
      "https://example.com/app/page?tab=users&utm=other#different",
      { queryAllowlist: ["tab"] },
    ).pageKey,
    profile.pageKey,
  );
});

test("page maps persist route identity and reject cross-route or cross-origin URLs", () => {
  const settings = { queryAllowlist: ["route"] };
  const pageMap = scanPage({
    page: {
      url: "http://127.0.0.1:8765/BRunner_Host/mapper_test.html?route=account&utm=ignored#section",
      title: "Mapper route account",
    },
    componentFacts: [],
    settings,
    now: "2026-07-17T00:00:00.000Z",
  });
  const state = {
    ...createEmptyWorkflowMapperState("route-identity", settings),
    maps: [pageMap],
  };
  const restored = deserializeWorkflowMapperState(serializeWorkflowMapperState(state));
  const restoredMap = restored.maps[0];

  assert.equal(restoredMap.origin, "http://127.0.0.1:8765");
  assert.equal(restoredMap.hostname, "127.0.0.1");
  assert.equal(restoredMap.path, "/BRunner_Host/mapper_test.html");
  assert.equal(restoredMap.query, "route=account");
  assert.equal(restoredMap.title, "Mapper route account");
  assert.equal(pageMapMatchesUrl(
    restoredMap,
    "http://127.0.0.1:8765/BRunner_Host/mapper_test.html?route=account&utm=other#different",
    settings,
  ), true);
  assert.equal(pageMapMatchesUrl(
    restoredMap,
    "http://127.0.0.1:8765/BRunner_Host/mapper_test.html?route=billing",
    settings,
  ), false);
  assert.equal(pageMapMatchesUrl(
    restoredMap,
    "http://127.0.0.1:8765/BRunner_Host/other.html?route=account",
    settings,
  ), false);
  assert.equal(pageMapMatchesUrl(
    restoredMap,
    "https://127.0.0.1:8765/BRunner_Host/mapper_test.html?route=account",
    settings,
  ), false);
  assert.equal(pageMapMatchesUrl(
    restoredMap,
    "http://127.0.0.1:9999/BRunner_Host/mapper_test.html?route=account",
    settings,
  ), false);
});

test("page identity distinguishes lossy path, query, scheme, and port collisions", () => {
  const querySettings = { queryAllowlist: ["route"] };
  const nestedPath = normalizePageProfile(
    "https://example.com/account/settings",
    querySettings,
  );
  const dashedPath = normalizePageProfile(
    "https://example.com/account-settings",
    querySettings,
  );
  const dashedQuery = normalizePageProfile(
    "https://example.com/account?route=account-settings",
    querySettings,
  );
  const underscoredQuery = normalizePageProfile(
    "https://example.com/account?route=account_settings",
    querySettings,
  );
  const httpDefault = normalizePageProfile(
    "http://example.com/account?route=account-settings",
    querySettings,
  );
  const httpsDefault = normalizePageProfile(
    "https://example.com/account?route=account-settings",
    querySettings,
  );
  const httpsAlternatePort = normalizePageProfile(
    "https://example.com:8443/account?route=account-settings",
    querySettings,
  );

  assert.notEqual(nestedPath.pageKey, dashedPath.pageKey);
  assert.notEqual(dashedQuery.pageKey, underscoredQuery.pageKey);
  assert.notEqual(httpDefault.pageKey, httpsDefault.pageKey);
  assert.notEqual(httpsDefault.pageKey, httpsAlternatePort.pageKey);

  const pageMap = scanPage({
    page: {
      url: "https://example.com/account/settings?route=account-settings&utm=ignored#one",
    },
    componentFacts: [],
    settings: querySettings,
  });
  assert.equal(pageMapMatchesUrl(
    pageMap,
    "https://example.com/account/settings?route=account-settings&utm=other#two",
    querySettings,
  ), true);
  assert.equal(pageMapMatchesUrl(
    pageMap,
    "https://example.com/account-settings?route=account-settings",
    querySettings,
  ), false);
  assert.equal(pageMapMatchesUrl(
    pageMap,
    "https://example.com/account/settings?route=account_settings",
    querySettings,
  ), false);
  assert.equal(pageMapMatchesUrl(
    pageMap,
    "http://example.com/account/settings?route=account-settings",
    querySettings,
  ), false);
  assert.equal(pageMapMatchesUrl(
    pageMap,
    "https://example.com:8443/account/settings?route=account-settings",
    querySettings,
  ), false);
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

test("node-neutral mapper APIs scan, lookup, reference, resolve, revalidate, and refresh", () => {
  const fact = componentFact({
    componentUid: "save-uid",
    accessibleName: "Save",
    role: "button",
    locator: { strategy: "css_selector", value: "#save", reliability: 98 },
  });
  const pageMap = scanPage({
    page: { url: "https://example.com/account" },
    componentFacts: [fact],
    now: "2026-07-04T00:00:00.000Z",
  });
  const state = {
    ...createEmptyWorkflowMapperState("flow-api"),
    maps: [pageMap],
  };
  const found = getPageMap(state, { pageProfileKey: pageMap.pageProfileKey });
  const componentRef = createComponentRef(
    found,
    found.components[0].componentId,
    { workflowId: "flow-api" },
  );

  assert.equal(isComponentRef(componentRef), true);
  assert.equal(componentRef.schema, "mapper.component_ref.v1");
  assert.equal(componentRef.workflowId, "flow-api");

  const resolved = resolveComponent({
    pageMap: found,
    componentRef,
    candidateFacts: [fact],
    requirements: { action: "element.click" },
  });
  const revalidated = revalidateComponent({
    pageMap: found,
    componentRef,
    candidateFacts: [fact],
    requirements: { action: "element.click" },
  });
  const refreshed = refreshPageMap({
    page: { url: "https://example.com/account" },
    componentFacts: [{
      ...fact,
      locatorCandidates: [{ strategy: "css_selector", value: "#save-new", reliability: 98 }],
    }],
    previousMap: pageMap,
    now: "2026-07-04T00:01:00.000Z",
  });

  assert.equal(resolved.state, MapperResolverStates.Resolved);
  assert.equal(revalidated.state, MapperResolverStates.Resolved);
  assert.equal(revalidated.operation, "revalidate");
  assert.equal(refreshed.components[0].componentId, componentRef.componentId);
  assert.notEqual(refreshed.mapVersionId, pageMap.mapVersionId);
});

test("chrome map store persists workflow mapper state by workflow id", async () => {
  const storage = createMemoryChromeStorage();
  const store = new ChromeMapStore(storage);

  const saved = await store.saveWorkflowMapperState("flow-1", {
    settings: { queryAllowlist: ["page"] },
    maps: [{ pageId: "home" }],
  });
  const loaded = await store.getWorkflowMapperState("flow-1");

  assert.equal(saved.workflowId, "flow-1");
  assert.equal(saved.storage.revision, "1");
  assert.deepEqual(loaded.maps, [{ pageId: "home" }]);
  assert.deepEqual(loaded.settings.queryAllowlist, ["page"]);
  assert.ok(storage.snapshot()[mapperWorkflowStorageKey("flow-1")]);
  assert.equal(await store.deleteWorkflowMapperState("flow-1"), true);
  assert.equal(await store.getWorkflowMapperState("flow-1"), null);
});

test("chrome map store isolates concurrent workflows without corpus rewrites", async () => {
  const storage = createMemoryChromeStorage({}, { yieldBeforeSet: true });
  const firstStore = new ChromeMapStore(storage);
  const secondStore = new ChromeMapStore(storage);

  await Promise.all([
    firstStore.saveWorkflowMapperState("flow-a", {
      maps: [{ pageProfileKey: "example_com::a", mapVersionId: "a1" }],
    }),
    secondStore.saveWorkflowMapperState("flow-b", {
      maps: [{ pageProfileKey: "example_com::b", mapVersionId: "b1" }],
    }),
  ]);

  const states = await firstStore.getAllWorkflowMapperStates();
  const snapshot = storage.snapshot();
  assert.deepEqual(Object.keys(states).sort(), ["flow-a", "flow-b"]);
  assert.equal(snapshot["brunner.mapper.v1"], undefined);
  assert.ok(snapshot[mapperWorkflowStorageKey("flow-a")]);
  assert.ok(snapshot[mapperWorkflowStorageKey("flow-b")]);
});

test("chrome map store serializes concurrent mutations within one workflow", async () => {
  const storage = createMemoryChromeStorage({}, { yieldBeforeSet: true });
  const firstStore = new ChromeMapStore(storage);
  const secondStore = new ChromeMapStore(storage);
  await firstStore.saveWorkflowMapperState("flow-shared", { maps: [] });

  await Promise.all([
    firstStore.updateWorkflowMapperState("flow-shared", (state) => ({
      ...state,
      maps: state.maps.concat({ pageProfileKey: "example_com::a", mapVersionId: "a1" }),
    })),
    secondStore.updateWorkflowMapperState("flow-shared", (state) => ({
      ...state,
      maps: state.maps.concat({ pageProfileKey: "example_com::b", mapVersionId: "b1" }),
    })),
  ]);

  const state = await firstStore.getWorkflowMapperState("flow-shared");
  assert.deepEqual(state.maps.map((map) => map.mapVersionId), ["a1", "b1"]);
  assert.equal(state.storage.revision, "3");
});

test("chrome map store rejects stale revision writes", async () => {
  const storage = createMemoryChromeStorage();
  const store = new ChromeMapStore(storage);
  await store.saveWorkflowMapperState("flow-revision", { maps: [] });
  const first = await store.getWorkflowMapperState("flow-revision");
  const stale = await store.getWorkflowMapperState("flow-revision");
  await store.saveWorkflowMapperState("flow-revision", {
    ...first,
    maps: [{ pageProfileKey: "example_com::one", mapVersionId: "one" }],
  });

  await assert.rejects(
    () => store.saveWorkflowMapperState("flow-revision", {
      ...stale,
      maps: [{ pageProfileKey: "example_com::stale", mapVersionId: "stale" }],
    }),
    (error) => {
      assert.ok(error instanceof MapStoreConflictError);
      assert.equal(error.expectedRevision, "1");
      assert.equal(error.actualRevision, "2");
      return true;
    },
  );
  const state = await store.getWorkflowMapperState("flow-revision");
  assert.deepEqual(state.maps.map((map) => map.mapVersionId), ["one"]);
});

test("chrome map store rejects a stale revision after its record is absent", async () => {
  const storage = createMemoryChromeStorage();
  const store = new ChromeMapStore(storage);
  const stale = {
    ...createEmptyWorkflowMapperState("flow-absent-stale"),
    storage: {
      ...createEmptyWorkflowMapperState("flow-absent-stale").storage,
      revision: "7",
    },
  };

  await assert.rejects(
    () => store.saveWorkflowMapperState("flow-absent-stale", stale),
    (error) => {
      assert.ok(error instanceof MapStoreConflictError);
      assert.equal(error.expectedRevision, "7");
      assert.equal(error.actualRevision, "");
      return true;
    },
  );
  assert.equal(await store.getWorkflowMapperState("flow-absent-stale"), null);
});

test("chrome map store rejects an old generation when numeric revisions collide", async () => {
  const storage = createMemoryChromeStorage();
  const store = new ChromeMapStore(storage, {
    revisionGeneration: () => "new-generation",
  });
  const current = await store.updateWorkflowMapperState(
    "flow-generation",
    (state) => state,
  );
  assert.equal(current.storage.revision, "1");
  assert.equal(current.storage.generation, "new-generation");

  await assert.rejects(
    () => store.saveWorkflowMapperState("flow-generation", {
      ...current,
      storage: {
        ...current.storage,
        revision: "1",
        generation: "old-generation",
      },
    }),
    (error) => {
      assert.ok(error instanceof MapStoreConflictError);
      assert.equal(error.expectedRevision, "1");
      assert.equal(error.actualRevision, "1");
      assert.equal(error.expectedGeneration, "old-generation");
      assert.equal(error.actualGeneration, "new-generation");
      return true;
    },
  );
});

test("chrome map store tombstone rejects a pre-delete stale save without resurrection", async () => {
  const storage = createMemoryChromeStorage();
  const store = new ChromeMapStore(storage);
  await store.saveWorkflowMapperState("flow-delete-race", {
    maps: [{ pageProfileKey: "example_com::one", mapVersionId: "one" }],
  });
  const stale = await store.getWorkflowMapperState("flow-delete-race");

  assert.equal(await store.deleteWorkflowMapperState("flow-delete-race"), true);
  assert.equal(await store.getWorkflowMapperState("flow-delete-race"), null);
  assert.equal(
    storage.snapshot()[mapperWorkflowStorageKey("flow-delete-race")].revision,
    "2",
  );

  await assert.rejects(
    () => store.saveWorkflowMapperState("flow-delete-race", {
      ...stale,
      maps: [{ pageProfileKey: "example_com::stale", mapVersionId: "stale" }],
    }),
    (error) => {
      assert.ok(error instanceof MapStoreConflictError);
      assert.equal(error.expectedRevision, "1");
      assert.equal(error.actualRevision, "2");
      return true;
    },
  );

  const tombstone = storage.snapshot()[mapperWorkflowStorageKey("flow-delete-race")];
  assert.equal(tombstone.deleted, true);
  assert.equal(tombstone.revision, "2");
  assert.equal(await store.getWorkflowMapperState("flow-delete-race"), null);
});

test("chrome map store serializes update and delete with a monotonic tombstone revision", async () => {
  const storage = createMemoryChromeStorage({}, { yieldBeforeSet: true });
  const updatingStore = new ChromeMapStore(storage);
  const deletingStore = new ChromeMapStore(storage);
  await updatingStore.saveWorkflowMapperState("flow-update-delete", { maps: [] });

  let announceUpdateStarted;
  let releaseUpdate;
  const updateStarted = new Promise((resolve) => {
    announceUpdateStarted = resolve;
  });
  const updateRelease = new Promise((resolve) => {
    releaseUpdate = resolve;
  });
  const updatePromise = updatingStore.updateWorkflowMapperState(
    "flow-update-delete",
    async (state) => {
      announceUpdateStarted();
      await updateRelease;
      return {
        ...state,
        maps: [{ pageProfileKey: "example_com::updated", mapVersionId: "updated" }],
      };
    },
  );
  await updateStarted;
  const deletePromise = deletingStore.deleteWorkflowMapperState("flow-update-delete");
  releaseUpdate();

  const [updated, deleted] = await Promise.all([updatePromise, deletePromise]);
  assert.equal(updated.storage.revision, "2");
  assert.equal(deleted, true);
  assert.equal(await updatingStore.getWorkflowMapperState("flow-update-delete"), null);
  const tombstone = storage.snapshot()[mapperWorkflowStorageKey("flow-update-delete")];
  assert.equal(tombstone.deleted, true);
  assert.equal(tombstone.revision, "3");
});

test("chrome map store recreates after deletion at the next tombstone revision", async () => {
  const storage = createMemoryChromeStorage();
  const store = new ChromeMapStore(storage);
  await store.saveWorkflowMapperState("flow-recreate", { maps: [] });
  await store.deleteWorkflowMapperState("flow-recreate");

  const recreated = await store.updateWorkflowMapperState("flow-recreate", (state, context) => {
    assert.equal(context.exists, false);
    assert.equal(context.revision, "2");
    return {
      ...state,
      maps: [{ pageProfileKey: "example_com::new", mapVersionId: "new" }],
    };
  });

  assert.equal(recreated.storage.revision, "3");
  assert.equal(
    (await store.getWorkflowMapperState("flow-recreate")).maps[0].mapVersionId,
    "new",
  );
});

test("chrome map store treats missing and already-deleted workflows as delete no-ops", async () => {
  const storage = createMemoryChromeStorage();
  const store = new ChromeMapStore(storage);

  assert.equal(await store.deleteWorkflowMapperState("flow-missing"), false);
  assert.deepEqual(storage.snapshot(), {});

  await store.saveWorkflowMapperState("flow-once", { maps: [] });
  assert.equal(await store.deleteWorkflowMapperState("flow-once"), true);
  const tombstone = storage.snapshot()[mapperWorkflowStorageKey("flow-once")];
  assert.equal(await store.deleteWorkflowMapperState("flow-once"), false);
  assert.deepEqual(
    storage.snapshot()[mapperWorkflowStorageKey("flow-once")],
    tombstone,
  );
});

test("chrome map store applies bounded version, component, and attempt pruning", async () => {
  const storage = createMemoryChromeStorage();
  const store = new ChromeMapStore(storage);
  const maps = Array.from({ length: 4 }, (_, index) => ({
    pageProfileKey: "example_com::account",
    mapVersionId: `version-${index + 1}`,
    components: Array.from({ length: 4 }, (__, componentIndex) => ({
      componentId: `component-${index}-${componentIndex}`,
      status: "new",
    })),
    resolverAttempts: Array.from({ length: 40 }, (__, attemptIndex) => ({
      createdAt: `attempt-${attemptIndex}`,
    })),
  }));

  const saved = await store.saveWorkflowMapperState("flow-bounded", {
    settings: { maxVersions: 2, maxComponents: 2 },
    maps,
  });

  assert.deepEqual(saved.maps.map((map) => map.mapVersionId), ["version-3", "version-4"]);
  assert.deepEqual(saved.maps.map((map) => map.components.length), [2, 2]);
  assert.deepEqual(saved.maps.map((map) => map.resolverAttempts.length), [25, 25]);
});

test("chrome map store retries quota failures with deterministic pruning", async () => {
  const storage = createMemoryChromeStorage({}, { maxWriteBytes: 5500 });
  const store = new ChromeMapStore(storage);
  const maps = Array.from({ length: 3 }, (_, pageIndex) => ({
    pageProfileKey: `example_com::page_${pageIndex}`,
    mapVersionId: `map-${pageIndex}`,
    components: Array.from({ length: 12 }, (__, componentIndex) => ({
      componentId: `component-${pageIndex}-${componentIndex}`,
      status: "new",
      fingerprint: { semantic: { stableText: "x".repeat(300) } },
    })),
  }));

  const saved = await store.saveWorkflowMapperState("flow-quota", {
    settings: { maxVersions: 3, maxComponents: 500 },
    maps,
  });

  assert.equal(saved.storage.quotaPruned, true);
  assert.ok(saved.storage.prunedComponentCount > 0);
  assert.ok(saved.maps.reduce((total, map) => total + map.components.length, 0) < 36);
  assert.ok(storage.setCount() > 1);
});

test("chrome map store evicts the oldest workflow before pruning the current aggregate write", async () => {
  const largeState = (workflowId, marker) => ({
    maps: Array.from({ length: 3 }, (_, mapIndex) => ({
      pageProfileKey: `example_com::${marker}_${mapIndex}`,
      mapVersionId: `${marker}-${mapIndex}`,
      components: Array.from({ length: 3 }, (__, componentIndex) => ({
        componentId: `${marker}-${mapIndex}-${componentIndex}`,
        status: "new",
        fingerprint: { semantic: { stableText: marker.repeat(180) } },
      })),
    })),
  });
  const seedStorage = createMemoryChromeStorage();
  const seedStore = new ChromeMapStore(seedStorage, {
    clock: () => "2026-07-01T00:00:00.000Z",
  });
  await seedStore.saveWorkflowMapperState("flow-old", largeState("flow-old", "old"));
  const seeded = seedStorage.snapshot();
  const oldKey = mapperWorkflowStorageKey("flow-old");
  const oldBytes = Buffer.byteLength(JSON.stringify(seeded), "utf8");
  const storage = createMemoryChromeStorage(seeded, {
    maxTotalBytes: oldBytes + 1500,
  });
  const store = new ChromeMapStore(storage, {
    clock: () => "2026-07-02T00:00:00.000Z",
  });

  const saved = await store.saveWorkflowMapperState(
    "flow-current",
    largeState("flow-current", "new"),
  );

  assert.equal(saved.storage.quotaPruned, false);
  assert.equal(saved.maps.length, 3);
  assert.equal(saved.maps.reduce((total, map) => total + map.components.length, 0), 9);
  assert.equal(await store.getWorkflowMapperState("flow-old"), null);
  assert.equal(
    (await store.getWorkflowMapperState("flow-current")).workflowId,
    "flow-current",
  );
  const tombstone = storage.snapshot()[oldKey];
  assert.equal(tombstone.deleted, true);
  assert.equal(tombstone.reason, "aggregate_quota_eviction");
});

test("chrome map store bounds retained live workflow states globally", async () => {
  const initial = {};
  for (let index = 0; index < 50; index += 1) {
    const workflowId = `flow-${String(index).padStart(2, "0")}`;
    initial[mapperWorkflowStorageKey(workflowId)] = {
      ...createEmptyWorkflowMapperState(workflowId),
      storage: {
        ...createEmptyWorkflowMapperState(workflowId).storage,
        revision: "1",
        savedAt: new Date(Date.UTC(2026, 5, 1, 0, 0, index)).toISOString(),
      },
    };
  }
  const storage = createMemoryChromeStorage(initial);
  const store = new ChromeMapStore(storage, {
    clock: () => "2026-07-31T00:00:00.000Z",
  });

  await store.saveWorkflowMapperState("flow-current", { maps: [] });

  const snapshot = storage.snapshot();
  const live = Object.entries(snapshot).filter(([key, value]) => {
    return key.startsWith(`${Defaults.MapperStorageKey}.workflow.`)
      && value?.deleted !== true;
  });
  assert.equal(live.length, 50);
  assert.equal(snapshot[mapperWorkflowStorageKey("flow-00")].deleted, true);
  assert.equal(
    snapshot[mapperWorkflowStorageKey("flow-00")].reason,
    "global_retention_eviction",
  );
});

test("chrome map store bounds tombstones and compacts the oldest entries", async () => {
  const initial = {};
  for (let index = 0; index < 101; index += 1) {
    const workflowId = `deleted-${String(index).padStart(3, "0")}`;
    initial[mapperWorkflowStorageKey(workflowId)] = {
      mapperSchemaVersion: 1,
      workflowId,
      deleted: true,
      revision: "2",
      deletedAt: new Date(Date.UTC(2026, 6, 1, 0, 0, index)).toISOString(),
      reason: "workflow_deleted",
    };
  }
  const storage = createMemoryChromeStorage(initial);
  const store = new ChromeMapStore(storage);

  await store.saveWorkflowMapperState("flow-current", { maps: [] });

  const snapshot = storage.snapshot();
  const tombstones = Object.entries(snapshot).filter(([key, value]) => {
    return key.startsWith(`${Defaults.MapperStorageKey}.workflow.`)
      && value?.deleted === true;
  });
  assert.equal(tombstones.length, 100);
  assert.equal(
    Object.hasOwn(snapshot, mapperWorkflowStorageKey("deleted-000")),
    false,
  );
});

test("chrome map store counts legacy and direct records in global retention", async () => {
  const legacy = {};
  for (let index = 0; index < 50; index += 1) {
    const workflowId = `legacy-${String(index).padStart(2, "0")}`;
    legacy[workflowId] = {
      ...createEmptyWorkflowMapperState(workflowId),
      storage: {
        ...createEmptyWorkflowMapperState(workflowId).storage,
        revision: "1",
        savedAt: new Date(Date.UTC(2026, 5, 1, 0, 0, index)).toISOString(),
      },
    };
  }
  const storage = createMemoryChromeStorage({
    [Defaults.MapperStorageKey]: legacy,
  });
  const store = new ChromeMapStore(storage, {
    clock: () => "2026-07-31T00:00:00.000Z",
  });

  await store.saveWorkflowMapperState("flow-current", { maps: [] });

  const states = await store.getAllWorkflowMapperStates();
  assert.equal(Object.keys(states).length, 50);
  assert.equal(states["legacy-00"], undefined);
  assert.equal(states["flow-current"].workflowId, "flow-current");
});

test("chrome map store excludes malformed direct records from live retention", async () => {
  const initial = {
    [mapperWorkflowStorageKey("invalid")]: {
      workflowId: "invalid",
      mapperSchemaVersion: 999,
      updatedAt: "2020-01-01T00:00:00.000Z",
    },
  };
  for (let index = 0; index < 49; index += 1) {
    const workflowId = `valid-${String(index).padStart(2, "0")}`;
    initial[mapperWorkflowStorageKey(workflowId)] = {
      ...createEmptyWorkflowMapperState(workflowId),
      storage: {
        ...createEmptyWorkflowMapperState(workflowId).storage,
        revision: "1",
        savedAt: new Date(Date.UTC(2026, 5, 1, 0, 0, index)).toISOString(),
      },
    };
  }
  const storage = createMemoryChromeStorage(initial);
  const store = new ChromeMapStore(storage);

  await store.saveWorkflowMapperState("flow-current", { maps: [] });

  const states = await store.getAllWorkflowMapperStates();
  assert.equal(Object.keys(states).length, 50);
  assert.equal(states["valid-00"].workflowId, "valid-00");
  assert.equal(states["flow-current"].workflowId, "flow-current");
  assert.equal(states.invalid, undefined);
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

test("static page map stores bounded platform profile hints", () => {
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
          majorRegion: "chat_pane",
          subregion: "message_row",
          templateKind: "message",
          templatePart: "actions",
          majorRegionPath: "body:0/div:1/main:0",
          subregionPath: "body:0/div:1/main:0/div:2/article:0",
          repeatedRecordPath: "body:0/div:1/main:0/div:2/article:0",
          majorRegionDepth: 4,
          subregionDepth: 1,
          repeatedRecordDepth: 0,
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
          majorRegion: "chat_pane",
          subregion: "message_row",
          templateKind: "message",
          templatePart: "actions",
          majorRegionPath: "body:0/div:1/main:0",
          subregionPath: "body:0/div:1/main:0/div:2/article:1",
          majorRegionDepth: 4,
          subregionDepth: 1,
          repeatedRecordDepth: 0,
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
    "example_com_chat_chat_message_row_chat_container_message_alpha_1_reply_button",
    "example_com_chat_chat_message_row_chat_container_message_beta_1_reply_button",
  ]);
  assert.equal(pageMap.components[0].fingerprint.structural.platformScope.family, "chat");
  assert.equal(pageMap.components[0].fingerprint.structural.platformScope.threadId, "alpha");
  assert.equal(pageMap.components[0].fingerprint.structural.platformScope.majorRegion, "chat_pane");
  assert.equal(pageMap.components[0].fingerprint.structural.platformScope.templateKind, "message");
  assert.equal(pageMap.components[0].fingerprint.structural.platformScope.templatePart, "actions");
  assert.equal(pageMap.components[0].fingerprint.structural.platformScope.majorRegionPath, "body:0/div:1/main:0");
  assert.equal(pageMap.components[0].fingerprint.structural.platformScope.repeatedRecordPath, "body:0/div:1/main:0/div:2/article:0");
  assert.equal(pageMap.components[0].fingerprint.structural.platformScope.majorRegionDepth, 4);
  assert.equal(pageMap.components[0].fingerprint.structural.platformScope.subregionDepth, 1);
  assert.equal(pageMap.components[0].fingerprint.structural.platformScope.repeatedKind, "message_row");
  assert.equal(pageMap.platformStructure.version, "mapper.platform_structure.v1");
  assert.equal(pageMap.platformStructure.majorRegions[0].id, "chat_pane");
  assert.equal(pageMap.platformStructure.majorRegions[0].subregions[0].templates[0].kind, "message");
  assert.equal(pageMap.platformStructure.majorRegions[0].subregions[0].templates[0].recordCount, 2);
  assert.equal(Object.hasOwn(pageMap.components[0].fingerprint.structural.platformScope, "rawText"), false);
});

test("static page map retains complete open-shadow boundary paths", () => {
  const deepHostPath = Array.from(
    { length: 40 },
    (_, index) => `custom-shadow-host-${index}:0`,
  ).join("/");
  const pageMap = buildStaticPageMap({
    page: { url: "https://example.com/settings" },
    componentFacts: [componentFact({
      accessibleName: "Save Shadow",
      role: "button",
      locator: { strategy: "data-testid", value: "shadow-save", reliability: 96 },
      shadowPath: [
        { hostPath: "body:1/main:0/shadow-card:2", innerPath: "div:0/button:1" },
        { hostPath: "div:0/nested-card:0", innerPath: "section:0/button:0" },
        { hostPath: "section:0/deep-card:0", innerPath: "article:0/button:0" },
        { hostPath: "article:0/deeper-card:0", innerPath: "div:0/button:0" },
        { hostPath: deepHostPath, innerPath: "main:0/button:0" },
      ],
    })],
  });

  const shadowPath = pageMap.components[0].fingerprint.technical.shadowPath;
  assert.equal(shadowPath.length, 5);
  assert.deepEqual(shadowPath[0], {
    hostPath: "body:1/main:0/shadow-card:2",
    innerPath: "div:0/button:1",
  });
  assert.deepEqual(shadowPath[4], {
    hostPath: deepHostPath,
    innerPath: "main:0/button:0",
  });
  assert.ok(shadowPath[4].hostPath.length > 320);
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

test("bounded scan overflow defers both mapper layers instead of accepting a truncated map", () => {
  const pageMap = buildStaticPageMap({
    page: {
      url: "https://example.com/large-page",
      scanDiagnostics: {
        version: "mapper.scan.v1",
        maxComponents: 2,
        sampledComponentCount: 2,
        candidateCount: 3,
        candidateCountIsLowerBound: true,
        overflow: true,
        overflowKind: "visited_node_budget",
      },
    },
    settings: { maxComponents: 2 },
    componentFacts: [
      componentFact({
        accessibleName: "Stable control",
        role: "button",
        locator: { strategy: "css_selector", value: "#stable", reliability: 95 },
      }),
      componentFact({
        accessibleName: "Loaded control",
        role: "button",
        regionDynamics: {
          regionId: "loaded_feed",
          classification: "loaded_window",
          loadedContentOnly: true,
        },
        locator: { strategy: "css_selector", value: "#loaded", reliability: 95 },
      }),
    ],
  });

  assert.equal(pageMap.status, "unsupported");
  assert.equal(pageMap.classification, MapperPageClassifications.DynamicDeferred);
  assert.equal(pageMap.componentCount, 0);
  assert.equal(pageMap.layers.static.status, "deferred");
  assert.equal(pageMap.layers.dynamic.status, "deferred");
  assert.equal(pageMap.layers.static.reason, "component_scan_overflow");
  assert.equal(pageMap.layers.dynamic.reason, "component_scan_overflow");
  assert.equal(pageMap.diagnostics.scanOverflow, true);
  assert.equal(pageMap.diagnostics.scanCandidateCount, 3);
  assert.equal(pageMap.diagnostics.scanOverflowKind, "visited_node_budget");
  assert.equal(pageMap.diagnostics.reason, "component_scan_overflow");
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

test("static and dynamic map layers reconcile independently", () => {
  const previous = buildStaticPageMap({
    page: { url: "https://example.com/feed" },
    componentFacts: [componentFact({
      componentUid: "shared-uid",
      accessibleName: "Open",
      role: "button",
      locator: { strategy: "css_selector", value: "#open-static", reliability: 95 },
    })],
    now: "2026-07-04T00:00:00.000Z",
  });

  const refreshed = buildStaticPageMap({
    page: { url: "https://example.com/feed" },
    previousMap: previous,
    componentFacts: [componentFact({
      componentUid: "shared-uid",
      accessibleName: "Open",
      role: "button",
      regionDynamics: {
        regionId: "activity_feed",
        classification: "loaded_window",
        loadedContentOnly: true,
      },
      locator: { strategy: "css_selector", value: "#open-dynamic", reliability: 95 },
    })],
    now: "2026-07-04T00:01:00.000Z",
  });

  assert.equal(refreshed.classification, MapperPageClassifications.HybridDynamic);
  assert.deepEqual(refreshed.components.map((component) => component.mappingLayer), [
    MapperComponentLayers.Dynamic,
    MapperComponentLayers.Static,
  ]);
  assert.deepEqual(refreshed.components.map((component) => component.status), [
    MapperComponentStatuses.New,
    MapperComponentStatuses.Removed,
  ]);
  assert.notEqual(refreshed.components[0].componentId, previous.components[0].componentId);
  assert.equal(refreshed.layers.static.removedCount, 1);
  assert.equal(refreshed.layers.dynamic.componentCount, 1);
  assert.equal(refreshed.architecture.isolatedLayerReconciliation, true);
});

test("dynamic component limits do not erase the static map layer", () => {
  const dynamicFacts = Array.from({ length: 4 }, (_, index) => componentFact({
    accessibleName: `Loaded item ${index + 1}`,
    role: "button",
    regionDynamics: {
      regionId: "activity_feed",
      classification: "loaded_window",
      loadedContentOnly: true,
    },
    locator: { strategy: "css_selector", value: `#feed-${index + 1}`, reliability: 90 },
  }));
  const pageMap = buildStaticPageMap({
    page: {
      url: "https://example.com/dashboard",
      materialMutationCount: 120,
    },
    settings: {
      maxComponents: 2,
      materialMutationLimit: 5,
    },
    componentFacts: [
      componentFact({
        accessibleName: "Stable search",
        role: "textbox",
        tag: "input",
        inputType: "text",
        locator: { strategy: "css_selector", value: "#stable-search", reliability: 95 },
      }),
      ...dynamicFacts,
    ],
  });

  assert.equal(pageMap.status, "ready");
  assert.equal(pageMap.classification, MapperPageClassifications.HybridDynamic);
  assert.deepEqual(pageMap.components.map((component) => component.displayName), ["Stable search"]);
  assert.equal(pageMap.components[0].mappingLayer, MapperComponentLayers.Static);
  assert.equal(pageMap.layers.static.status, "ready");
  assert.equal(pageMap.layers.dynamic.status, "deferred");
  assert.equal(pageMap.layers.dynamic.reason, "dynamic_component_limit_exceeded");
  assert.equal(pageMap.diagnostics.reason, "bounded_dynamic_regions");
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
  assert.equal(Object.hasOwn(refreshed.reliabilityMetrics, "redaction"), false);
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

test("runtime resolver outcomes retain local raw diagnostics and reliability counters", () => {
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
        displayName: "Persist local candidate",
        primary: { strategy: "css_selector", value: "#persist-local" },
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
  assert.equal(Object.hasOwn(notFound.resolverAttempts[0], "redaction"), false);
  assert.equal(notFound.resolverAttempts[0].selected.componentId, "raw candidate id");
  assert.equal(notFound.resolverAttempts[0].selected.componentUid, "raw candidate uid");
  assert.equal(notFound.resolverAttempts[0].selected.displayName, "Persist local candidate");
  assert.equal(notFound.resolverAttempts[0].selected.primary.strategy, "css_selector");
  assert.equal(notFound.resolverAttempts[0].selected.primary.value, "#persist-local");
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

test("resolver isolates frame paths, supports accessible cross-origin frames, and protects unreachable frames", () => {
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

  const accessibleCrossOriginScope = {
    access: "cross_origin",
    path: "isolated/frame_checkout/instance_1",
    depth: 1,
    contextKey: "frame_checkout",
    frameContextId: "frame_checkout_instance_1",
    frameIdHint: 7,
    extensionAccessible: true,
  };
  const accessibleComponent = buildStaticPageMap({
    page: { url: "https://example.com/frames" },
    componentFacts: [componentFact({
      accessibleName: "Pay",
      role: "button",
      frameScope: accessibleCrossOriginScope,
      locator: { strategy: "text", value: "Pay", reliability: 90 },
    })],
  }).components[0];
  const accessibleResult = resolveMappedComponent(accessibleComponent, [componentFact({
    accessibleName: "Pay",
    role: "button",
    frameScope: accessibleCrossOriginScope,
    locator: { strategy: "text", value: "Pay", reliability: 90 },
  })], { action: "element.click" });
  assert.equal(accessibleResult.state, MapperResolverStates.Resolved);
  assert.equal(
    accessibleComponent.fingerprint.structural.frameScope.extensionAccessible,
    true,
  );

  const rawCrossOriginScope = {
    ...accessibleCrossOriginScope,
    path: "isolated/frame_checkout",
    frameContextId: "",
    frameIdHint: null,
  };
  const rawComponent = buildStaticPageMap({
    page: { url: "https://example.com/frames" },
    componentFacts: [componentFact({
      accessibleName: "Pay",
      role: "button",
      frameScope: rawCrossOriginScope,
      locator: { strategy: "text", value: "Pay", reliability: 90 },
    })],
  }).components[0];
  const rawToDecoratedResult = resolveMappedComponent(rawComponent, [componentFact({
    accessibleName: "Pay",
    role: "button",
    frameScope: accessibleCrossOriginScope,
    locator: { strategy: "text", value: "Pay", reliability: 90 },
  })], {
    action: "element.click",
    accessibleFramePaths: [accessibleCrossOriginScope.path],
  });
  assert.equal(rawToDecoratedResult.state, MapperResolverStates.Resolved);

  const ambiguousScope = {
    ...accessibleCrossOriginScope,
    contextMultiplicity: 2,
    identityAmbiguous: true,
  };
  const ambiguousComponent = buildStaticPageMap({
    page: { url: "https://example.com/frames" },
    componentFacts: [componentFact({
      accessibleName: "Pay",
      role: "button",
      frameScope: ambiguousScope,
      locator: { strategy: "text", value: "Pay", reliability: 90 },
    })],
  }).components[0];
  const ambiguousResult = resolveMappedComponent(ambiguousComponent, [componentFact({
    accessibleName: "Pay",
    role: "button",
    frameScope: ambiguousScope,
    locator: { strategy: "text", value: "Pay", reliability: 90 },
  })], { action: "element.click" });
  assert.equal(ambiguousResult.state, MapperResolverStates.Ambiguous);
  assert.equal(ambiguousResult.reason, "cross_origin_frame_context_ambiguous");

  const liveAmbiguousResult = resolveMappedComponent(accessibleComponent, [componentFact({
    accessibleName: "Pay",
    role: "button",
    frameScope: ambiguousScope,
    locator: { strategy: "text", value: "Pay", reliability: 90 },
  })], { action: "element.click" });
  assert.equal(liveAmbiguousResult.state, MapperResolverStates.Ambiguous);
  assert.equal(liveAmbiguousResult.reason, "cross_origin_frame_context_ambiguous");

  const duplicatedInventoryResult = resolveMappedComponent(accessibleComponent, [], {
    action: "element.click",
    accessibleFramePaths: [
      "isolated/frame_checkout/instance_1",
      "isolated/frame_checkout/instance_2",
    ],
  });
  assert.equal(duplicatedInventoryResult.state, MapperResolverStates.Ambiguous);
  assert.equal(duplicatedInventoryResult.reason, "cross_origin_frame_context_ambiguous");

  const unreachableAfterCapture = resolveMappedComponent(accessibleComponent, [], {
    action: "element.click",
    accessibleFramePaths: [],
  });
  assert.equal(unreachableAfterCapture.state, MapperResolverStates.ProtectedUnsupported);
  assert.equal(unreachableAfterCapture.reason, "cross_origin_frame_unreachable");

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
  assert.equal(protectedResult.reason, "cross_origin_frame_unreachable");
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

function createMemoryChromeStorage(
  initial = {},
  {
    maxWriteBytes = Number.POSITIVE_INFINITY,
    maxTotalBytes = Number.POSITIVE_INFINITY,
    yieldBeforeSet = false,
  } = {},
) {
  const values = structuredClone(initial);
  let writes = 0;
  return {
    async get(key) {
      if (key === null) return structuredClone(values);
      if (Array.isArray(key)) {
        return Object.fromEntries(key.map((entry) => [entry, structuredClone(values[entry])]));
      }
      return { [key]: structuredClone(values[key]) };
    },
    async set(next) {
      writes += 1;
      if (yieldBeforeSet) await Promise.resolve();
      if (Buffer.byteLength(JSON.stringify(next), "utf8") > maxWriteBytes) {
        throw new Error("QUOTA_BYTES exceeded for deterministic test storage");
      }
      const proposed = { ...values, ...structuredClone(next) };
      if (Buffer.byteLength(JSON.stringify(proposed), "utf8") > maxTotalBytes) {
        throw new Error("QUOTA_BYTES exceeded for aggregate deterministic test storage");
      }
      Object.assign(values, structuredClone(next));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    },
    snapshot() {
      return structuredClone(values);
    },
    setCount() {
      return writes;
    },
  };
}
