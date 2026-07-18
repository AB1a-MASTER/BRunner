import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildStaticPageMap,
  createEmptyWorkflowMapperState,
  deserializeWorkflowMapperState,
  MapperMapStatuses,
  MapperPageClassifications,
  MapperPersistenceLimits,
  recordMapperRuntimeResolution,
} from "../BRunner/mapper/core.js";
import { Defaults } from "../BRunner/core/constants.js";
import {
  ChromeMapStore,
  mapperWorkflowStorageKey,
} from "../BRunner/core/mapStore.js";

test("workflow state deserialization safely drops malformed and unsupported nested records", () => {
  const source = {
    mapperSchemaVersion: 1,
    workflowId: "flow-malformed",
    maps: [
      null,
      "not-a-map",
      [],
      { schemaVersion: 999, pageProfileKey: "unsupported" },
      {
        schemaVersion: 1,
        pageProfileKey: "example_com::valid",
        mapVersionId: "valid-v1",
        components: [
          null,
          "not-a-component",
          { mapperSchemaVersion: 999, componentId: "unsupported" },
          { mapperSchemaVersion: 1, componentId: "valid-component" },
        ],
        resolverAttempts: [
          null,
          "not-an-attempt",
          { version: "mapper.runtime_resolution.v1", state: "resolved" },
        ],
      },
    ],
  };

  const restored = deserializeWorkflowMapperState(source);

  assert.equal(restored.maps.length, 1);
  assert.equal(restored.maps[0].mapVersionId, "valid-v1");
  assert.deepEqual(
    restored.maps[0].components.map((component) => component.componentId),
    ["valid-component"],
  );
  assert.equal(restored.maps[0].resolverAttempts.length, 1);
  assert.equal(source.maps.length, 5, "deserialization must not mutate caller state");
});

test("map store rejects an explicit unsupported workflow schema before writing", async () => {
  const storage = createMemoryChromeStorage();
  const store = new ChromeMapStore(storage);

  await assert.rejects(
    () => store.saveWorkflowMapperState("flow-unsupported", {
      mapperSchemaVersion: 999,
      maps: [],
    }),
    (error) => error?.code === "mapper_schema_unsupported",
  );

  assert.equal(storage.setCount(), 0);
  assert.deepEqual(storage.snapshot(), {});
});

test("map store ignores a direct record whose embedded workflow id mismatches its key", async () => {
  const directKey = mapperWorkflowStorageKey("flow-key");
  const storage = createMemoryChromeStorage({
    [directKey]: {
      ...createEmptyWorkflowMapperState("flow-embedded"),
      maps: [{ schemaVersion: 1, mapVersionId: "wrong-workflow-map" }],
    },
  });
  const store = new ChromeMapStore(storage);

  assert.equal(await store.getWorkflowMapperState("flow-key"), null);
  assert.equal(await store.getWorkflowMapperState("flow-embedded"), null);
  assert.deepEqual(await store.getAllWorkflowMapperStates(), {});
});

test("malformed direct tombstones do not suppress a valid legacy workflow", async (t) => {
  const workflowId = "flow-legacy";
  const legacyState = {
    ...createEmptyWorkflowMapperState(workflowId),
    maps: [{ schemaVersion: 1, mapVersionId: "legacy-map" }],
  };
  const validTombstone = {
    mapperSchemaVersion: 1,
    workflowId,
    deleted: true,
    revision: "2",
    deletedAt: "2026-07-17T00:00:00.000Z",
    reason: "workflow_deleted",
  };
  const cases = [
    ["unsupported schema", { ...validTombstone, mapperSchemaVersion: 999 }],
    ["mismatched workflow id", { ...validTombstone, workflowId: "flow-other" }],
    ["invalid revision", { ...validTombstone, revision: "not-a-revision" }],
    ["invalid deletion timestamp", { ...validTombstone, deletedAt: "not-a-date" }],
  ];

  for (const [name, tombstone] of cases) {
    await t.test(name, async () => {
      const storage = createMemoryChromeStorage({
        [Defaults.MapperStorageKey]: { [workflowId]: legacyState },
        [mapperWorkflowStorageKey(workflowId)]: tombstone,
      });
      const store = new ChromeMapStore(storage);

      const loaded = await store.getWorkflowMapperState(workflowId);
      const all = await store.getAllWorkflowMapperStates();
      assert.equal(loaded.workflowId, workflowId);
      assert.equal(loaded.maps[0].mapVersionId, "legacy-map");
      assert.deepEqual(Object.keys(all), [workflowId]);
      assert.equal(all[workflowId].maps[0].mapVersionId, "legacy-map");
    });
  }
});

test("delete quota fallback removes only its target from the legacy corpus", async () => {
  const targetId = "flow-delete-target";
  const unrelatedId = "flow-delete-unrelated";
  const target = {
    ...createEmptyWorkflowMapperState(targetId),
    maps: [{ schemaVersion: 1, mapVersionId: "target-map" }],
  };
  const unrelated = {
    ...createEmptyWorkflowMapperState(unrelatedId),
    maps: [{ schemaVersion: 1, mapVersionId: "unrelated-map" }],
  };
  const storage = createMemoryChromeStorage({
    [Defaults.MapperStorageKey]: {
      [targetId]: target,
      [unrelatedId]: unrelated,
    },
  });
  storage.failNextQuotaWrites(1);
  const store = new ChromeMapStore(storage, {
    clock: () => "2026-07-17T00:00:00.000Z",
  });

  assert.equal(await store.deleteWorkflowMapperState(targetId), true);
  assert.equal(await store.getWorkflowMapperState(targetId), null);
  assert.equal(
    (await store.getWorkflowMapperState(unrelatedId)).maps[0].mapVersionId,
    "unrelated-map",
  );
  const snapshot = storage.snapshot();
  assert.deepEqual(Object.keys(snapshot[Defaults.MapperStorageKey]), [unrelatedId]);
  assert.equal(snapshot[mapperWorkflowStorageKey(targetId)].deleted, true);
});

test("save quota fallback removes only its migrated legacy target", async () => {
  const targetId = "flow-save-target";
  const unrelatedId = "flow-save-unrelated";
  const target = {
    ...createEmptyWorkflowMapperState(targetId),
    maps: [{ schemaVersion: 1, mapVersionId: "target-legacy" }],
  };
  const unrelated = {
    ...createEmptyWorkflowMapperState(unrelatedId),
    maps: [{ schemaVersion: 1, mapVersionId: "unrelated-legacy" }],
  };
  const storage = createMemoryChromeStorage({
    [Defaults.MapperStorageKey]: {
      [targetId]: target,
      [unrelatedId]: unrelated,
    },
  });
  storage.failNextQuotaWrites(1);
  const store = new ChromeMapStore(storage);

  await store.saveWorkflowMapperState(targetId, {
    ...target,
    maps: [{ schemaVersion: 1, mapVersionId: "target-direct" }],
  });

  const snapshot = storage.snapshot();
  assert.deepEqual(Object.keys(snapshot[Defaults.MapperStorageKey]), [unrelatedId]);
  assert.equal(
    snapshot[mapperWorkflowStorageKey(targetId)].maps[0].mapVersionId,
    "target-direct",
  );
  assert.equal(
    (await store.getWorkflowMapperState(unrelatedId)).maps[0].mapVersionId,
    "unrelated-legacy",
  );
});

test("terminal delete quota failure rolls back the complete mapper corpus", async () => {
  const targetId = "flow-delete-rollback";
  const unrelatedId = "flow-delete-rollback-unrelated";
  const storage = createMemoryChromeStorage({
    [Defaults.MapperStorageKey]: {
      [targetId]: createEmptyWorkflowMapperState(targetId),
      [unrelatedId]: createEmptyWorkflowMapperState(unrelatedId),
    },
  });
  const before = storage.snapshot();
  storage.failNextQuotaWrites(2);
  const store = new ChromeMapStore(storage, {
    clock: () => "2026-07-17T00:00:00.000Z",
  });

  await assert.rejects(
    () => store.deleteWorkflowMapperState(targetId),
    /QUOTA_BYTES/,
  );

  assert.deepEqual(storage.snapshot(), before);
  assert.equal((await store.getWorkflowMapperState(targetId)).workflowId, targetId);
  assert.equal((await store.getWorkflowMapperState(unrelatedId)).workflowId, unrelatedId);
});

test("map store retains only the newest one hundred page profiles deterministically", async () => {
  const storage = createMemoryChromeStorage();
  const store = new ChromeMapStore(storage);
  const maps = Array.from({ length: 102 }, (_, index) => ({
    schemaVersion: 1,
    pageProfileKey: `example_com::page_${String(index).padStart(3, "0")}`,
    mapVersionId: `map-${String(index).padStart(3, "0")}`,
    createdAt: new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString(),
    components: [],
  }));

  const saved = await store.saveWorkflowMapperState("flow-profile-limit", { maps });
  const reloaded = await store.getWorkflowMapperState("flow-profile-limit");

  assert.equal(saved.maps.length, 100);
  assert.equal(reloaded.maps.length, 100);
  assert.equal(reloaded.maps[0].mapVersionId, "map-002");
  assert.equal(reloaded.maps.at(-1).mapVersionId, "map-101");
});

test("map store serializes a second mutation behind a genuinely blocked first set", async () => {
  const storage = createMemoryChromeStorage({}, { blockFirstSet: true });
  const firstStore = new ChromeMapStore(storage);
  const secondStore = new ChromeMapStore(storage);
  let updaterEntered = false;

  const firstSave = firstStore.saveWorkflowMapperState("flow-blocked-set", {
    maps: [{
      schemaVersion: 1,
      pageProfileKey: "example_com::first",
      mapVersionId: "first",
    }],
  });
  await storage.firstSetEntered;

  const secondSave = secondStore.updateWorkflowMapperState(
    "flow-blocked-set",
    (state) => {
      updaterEntered = true;
      return {
        ...state,
        maps: state.maps.concat({
          schemaVersion: 1,
          pageProfileKey: "example_com::second",
          mapVersionId: "second",
        }),
      };
    },
  );

  try {
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(storage.setCount(), 1);
    assert.equal(updaterEntered, false);
  } finally {
    storage.releaseFirstSet();
  }

  await Promise.all([firstSave, secondSave]);
  const reloaded = await firstStore.getWorkflowMapperState("flow-blocked-set");
  assert.equal(updaterEntered, true);
  assert.equal(reloaded.storage.revision, "2");
  assert.deepEqual(
    reloaded.maps.map((map) => map.mapVersionId),
    ["first", "second"],
  );
});

test("terminal quota failure rolls back all mapper-storage side effects", async () => {
  const storage = createMemoryChromeStorage();
  const store = new ChromeMapStore(storage, {
    clock: () => "2026-07-17T00:00:00.000Z",
    revisionGeneration: () => "fixed-generation",
  });

  await store.saveWorkflowMapperState("flow-victim", {
    maps: [{
      schemaVersion: 1,
      pageProfileKey: "example_com::victim",
      mapVersionId: "victim-v1",
      components: [],
    }],
  });
  await store.saveWorkflowMapperState("flow-target", {
    maps: [{
      schemaVersion: 1,
      pageProfileKey: "example_com::target",
      mapVersionId: "target-v1",
      components: [],
    }],
  });

  const before = storage.snapshot();
  const largestExistingWrite = Math.max(
    ...Object.entries(before).map(([key, value]) => serializedBytes({ [key]: value })),
  );
  storage.setMaxWriteBytes(largestExistingWrite + 128);
  const target = await store.getWorkflowMapperState("flow-target");

  await assert.rejects(
    () => store.saveWorkflowMapperState("flow-target", {
      ...target,
      maps: [{
        schemaVersion: 1,
        pageProfileKey: "example_com::target",
        mapVersionId: "target-too-large",
        components: [{
          mapperSchemaVersion: 1,
          componentId: "unprunable-component",
          primaryLocator: {
            strategy: "css_selector",
            value: "#" + "x".repeat(MapperPersistenceLimits.maxLocatorValueLength),
          },
          fingerprint: {
            semantic: { accessibleName: "x".repeat(MapperPersistenceLimits.maxTextLength) },
            technical: {
              tag: "button",
              domPath: "x".repeat(MapperPersistenceLimits.maxPathLength),
            },
          },
        }],
      }],
    }),
    /QUOTA_BYTES/,
  );

  assert.deepEqual(storage.snapshot(), before);
  assert.equal(
    (await store.getWorkflowMapperState("flow-target")).storage.revision,
    "1",
  );
  assert.equal(
    (await store.getWorkflowMapperState("flow-victim")).maps[0].mapVersionId,
    "victim-v1",
  );
});

test("persisted map records drop unknown payloads and bound permitted diagnostics", async () => {
  const restored = deserializeWorkflowMapperState({
    mapperSchemaVersion: 1,
    workflowId: "flow-bounded-records",
    maps: [{
      schemaVersion: 1,
      pageProfileKey: "example_com::bounded",
      mapVersionId: "bounded-v1",
      unknownMapPayload: "x".repeat(10000),
      diagnostics: {
        payload: "x".repeat(10000),
        entries: Array.from({ length: 150 }, () => "y".repeat(1000)),
      },
      components: [{
        mapperSchemaVersion: 1,
        componentId: "bounded-component",
        diagnosticPayload: "z".repeat(10000),
      }],
      resolverAttempts: [{
        state: "resolved",
        unknownAttemptPayload: "q".repeat(10000),
      }],
    }],
  });

  const map = restored.maps[0];
  assert.equal(Object.hasOwn(map, "unknownMapPayload"), false);
  assert.equal(Object.hasOwn(map.components[0], "diagnosticPayload"), false);
  assert.equal(Object.hasOwn(map.resolverAttempts[0], "unknownAttemptPayload"), false);
  assert.equal(map.diagnostics.payload.length, MapperPersistenceLimits.maxTextLength);
  assert.equal(map.diagnostics.entries.length, MapperPersistenceLimits.maxNestedArrayItems);
  assert.ok(map.diagnostics.entries.every((entry) => {
    return entry.length === MapperPersistenceLimits.maxTextLength;
  }));
});

test("component and resolver evidence remains bounded after persistence and reload", async () => {
  const longText = "Long evidence value ".repeat(400);
  const longToken = "long-token-".repeat(400);
  const pageMap = recordMapperRuntimeResolution(buildStaticPageMap({
    page: { url: "https://example.com/bounded-evidence" },
    componentFacts: [{
      action: longToken,
      locators: Array.from({ length: 40 }, (_, index) => ({
        strategy: `${longToken}-${index}`,
        value: `${index}-${longText}`,
        family: longToken,
        reliability: 100 - index,
        selectedAtCapture: index === 0,
      })),
      fingerprint: {
        semantic: {
          role: longToken,
          accessibleName: longText,
          stableAttributes: Object.fromEntries(
            Array.from({ length: 40 }, (_, index) => [`data-key-${index}`, longText]),
          ),
        },
        structural: {
          ancestorTokens: Array.from({ length: 10 }, (_, index) => `${index}-${longText}`),
        },
        technical: {
          tag: "button",
          classes: Array.from({ length: 20 }, (_, index) => `${index}-${longToken}`),
          domPath: longText,
          shadowPath: Array.from({
            length: MapperPersistenceLimits.maxShadowPathDepth + 8,
          }, (_, index) => ({
            hostPath: index === 0 ? longText : `host-${index}`,
            innerPath: index === 0 ? longText : `inner-${index}`,
          })),
        },
        behavioral: {
          capabilities: Array.from({ length: 24 }, (_, index) => `${index}-${longToken}`),
          href: longText,
          state: Object.fromEntries(
            Array.from({ length: 40 }, (_, index) => [`state-${index}`, longText]),
          ),
        },
      },
    }],
    now: "2026-07-17T00:00:00.000Z",
  }), {
    state: "resolved_with_fallback",
    reason: longToken,
    evidence: Array.from({ length: 20 }, (_, index) => `${index}-${longToken}`),
    selected: {
      rank: 1,
      score: 90,
      componentId: longText,
      componentUid: longText,
      displayName: longText,
      primary: { strategy: longToken, value: longText, family: longToken },
    },
  }, "2026-07-17T00:01:00.000Z");
  const storage = createMemoryChromeStorage();
  const store = new ChromeMapStore(storage);

  await store.saveWorkflowMapperState("flow-bounded-evidence", { maps: [pageMap] });
  const reloaded = await store.getWorkflowMapperState("flow-bounded-evidence");
  const component = reloaded.maps[0].components[0];
  const locators = [component.primaryLocator, ...component.fallbackLocators];
  const attempt = reloaded.maps[0].resolverAttempts[0];

  assert.ok(component.fingerprint.semantic.accessibleName.length <=
    MapperPersistenceLimits.maxTextLength);
  assert.equal(
    Object.keys(component.fingerprint.semantic.stableAttributes).length,
    MapperPersistenceLimits.maxRecordEntries,
  );
  assert.ok(Object.values(component.fingerprint.semantic.stableAttributes)
    .every((value) => value.length <= MapperPersistenceLimits.maxTextLength));
  assert.equal(component.fingerprint.structural.ancestorTokens.length, 3);
  assert.ok(component.fingerprint.structural.ancestorTokens.every((value) => value.length <= 160));
  assert.equal(component.fingerprint.technical.classes.length, 8);
  assert.equal(component.fingerprint.technical.domPath.length,
    MapperPersistenceLimits.maxPathLength);
  assert.equal(component.fingerprint.technical.shadowPath.length,
    MapperPersistenceLimits.maxShadowPathDepth);
  assert.equal(component.fingerprint.technical.shadowPath[0].hostPath.length,
    MapperPersistenceLimits.maxPathLength);
  assert.equal(locators.length, MapperPersistenceLimits.maxLocatorsPerComponent);
  assert.ok(locators.every((locator) => {
    return locator.value.length <= MapperPersistenceLimits.maxLocatorValueLength;
  }));
  assert.equal(component.fingerprint.behavioral.capabilities.length,
    MapperPersistenceLimits.maxCapabilities);
  assert.equal(attempt.evidence.length, MapperPersistenceLimits.maxEvidenceLabels);
  assert.ok(attempt.evidence.every((entry) => {
    return entry.length <= MapperPersistenceLimits.maxEvidenceLabelLength;
  }));
  assert.ok(attempt.reason.length <= MapperPersistenceLimits.maxTokenLength);
  assert.ok(attempt.selected.primary.value.length <=
    MapperPersistenceLimits.maxLocatorValueLength);
});

test("an overflow map survives reload without changing an unrelated page map", async () => {
  const unrelated = buildStaticPageMap({
    page: { url: "https://example.com/unrelated" },
    componentFacts: [{
      locatorCandidates: [{ strategy: "css_selector", value: "#keep", reliability: 95 }],
      fingerprint: {
        semantic: { role: "button", accessibleName: "Keep" },
        technical: { tag: "button", id: "keep" },
      },
    }],
    now: "2026-07-17T00:00:00.000Z",
  });
  const overflow = buildStaticPageMap({
    page: {
      url: "https://example.com/overflow",
      scanDiagnostics: {
        maxComponents: 1,
        sampledComponentCount: 1,
        candidateCount: 2,
        candidateCountIsLowerBound: true,
        overflow: true,
        reason: "component_scan_overflow",
        overflowKind: "dom_candidate_limit",
      },
    },
    componentFacts: [],
    settings: { maxComponents: 1 },
    now: "2026-07-17T00:01:00.000Z",
  });
  const storage = createMemoryChromeStorage();
  const store = new ChromeMapStore(storage);

  await store.saveWorkflowMapperState("flow-overflow-reload", {
    maps: [unrelated, overflow],
  });
  const reloaded = await store.getWorkflowMapperState("flow-overflow-reload");
  const reloadedUnrelated = reloaded.maps.find((map) => {
    return map.pageProfileKey === unrelated.pageProfileKey;
  });
  const reloadedOverflow = reloaded.maps.find((map) => {
    return map.pageProfileKey === overflow.pageProfileKey;
  });

  assert.deepEqual(reloadedUnrelated, unrelated);
  assert.equal(reloadedOverflow.status, MapperMapStatuses.Unsupported);
  assert.equal(reloadedOverflow.classification, MapperPageClassifications.DynamicDeferred);
  assert.equal(reloadedOverflow.componentCount, 0);
  assert.equal(reloadedOverflow.diagnostics.scanOverflow, true);
  assert.equal(reloadedOverflow.diagnostics.reason, "component_scan_overflow");
});

function createMemoryChromeStorage(
  initial = {},
  { blockFirstSet = false } = {},
) {
  const values = structuredClone(initial);
  let writes = 0;
  let maxWriteBytes = Number.POSITIVE_INFINITY;
  let quotaFailuresRemaining = 0;
  let releaseFirstSet = () => {};
  let markFirstSetEntered = () => {};
  const firstSetGate = blockFirstSet
    ? new Promise((resolve) => { releaseFirstSet = resolve; })
    : Promise.resolve();
  const firstSetEntered = blockFirstSet
    ? new Promise((resolve) => { markFirstSetEntered = resolve; })
    : Promise.resolve();

  return {
    firstSetEntered,
    async get(key) {
      if (key === null) return structuredClone(values);
      if (Array.isArray(key)) {
        return Object.fromEntries(key.map((entry) => [entry, structuredClone(values[entry])]));
      }
      return { [key]: structuredClone(values[key]) };
    },
    async set(next) {
      writes += 1;
      if (quotaFailuresRemaining > 0) {
        quotaFailuresRemaining -= 1;
        throw new Error("QUOTA_BYTES exceeded for deterministic test storage");
      }
      if (blockFirstSet && writes === 1) {
        markFirstSetEntered();
        await firstSetGate;
      }
      if (serializedBytes(next) > maxWriteBytes) {
        throw new Error("QUOTA_BYTES exceeded for deterministic test storage");
      }
      Object.assign(values, structuredClone(next));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    },
    releaseFirstSet() {
      releaseFirstSet();
    },
    setMaxWriteBytes(value) {
      maxWriteBytes = value;
    },
    failNextQuotaWrites(count = 1) {
      quotaFailuresRemaining = Math.max(0, Number(count) || 0);
    },
    setCount() {
      return writes;
    },
    snapshot() {
      return structuredClone(values);
    },
  };
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
