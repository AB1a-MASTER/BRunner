import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyStudioDensity,
  DEFAULT_STUDIO_PREFERENCES,
  loadStudioPreferences,
  LogHandlingPolicy,
  normalizeStudioPreferences,
  saveStudioPreferences,
  STUDIO_PREFERENCES_KEY,
  updateStudioPreferences,
} from "../BRunner/core/studioPreferences.js";
import { initializeStudioPreferences } from "../BRunner/core/studioPreferencesBootstrap.js";

function createStorage(initial = {}) {
  const values = structuredClone(initial);
  return {
    values,
    async get(key) { return { [key]: structuredClone(values[key]) }; },
    async set(patch) { Object.assign(values, structuredClone(patch)); },
  };
}

test("Studio preferences recover invalid values to shared defaults", () => {
  assert.deepEqual(normalizeStudioPreferences({
    density: "tiny",
    inspectorMode: "floating",
    logPolicy: "eraseEverything",
    overviewVisible: false,
    panels: { nodeLibraryExpanded: false },
  }), {
    ...DEFAULT_STUDIO_PREFERENCES,
    overviewVisible: false,
    panels: {
      nodeLibraryExpanded: false,
      executionLogsExpanded: true,
    },
  });
});

test("Studio preferences persist globally and merge panel updates", async () => {
  const storage = createStorage();
  const saved = await saveStudioPreferences({
    density: "large",
    inspectorMode: "auto",
    logPolicy: LogHandlingPolicy.SaveAfterRun,
  }, storage);
  assert.deepEqual(await loadStudioPreferences(storage), saved);

  const updated = await updateStudioPreferences({
    panels: { nodeLibraryExpanded: false },
  }, storage);
  assert.equal(updated.panels.nodeLibraryExpanded, false);
  assert.equal(updated.panels.executionLogsExpanded, true);
  assert.deepEqual(storage.values[STUDIO_PREFERENCES_KEY], updated);
});

test("density application uses a safe normalized data attribute", () => {
  const root = { dataset: {} };
  assert.equal(applyStudioDensity("compact", root), "compact");
  assert.equal(root.dataset.studioDensity, "compact");
  assert.equal(applyStudioDensity("unknown", root), "comfortable");
});

test("preference bootstrap applies saved density and follows global changes", async () => {
  const storage = createStorage({
    [STUDIO_PREFERENCES_KEY]: { density: "large" },
  });
  const root = { dataset: {} };
  let listener;
  const changes = {
    addListener(value) { listener = value; },
    removeListener(value) { if (listener === value) listener = undefined; },
  };
  const initialized = await initializeStudioPreferences({ storage, changes, root });
  assert.equal(root.dataset.studioDensity, "large");
  listener({
    [STUDIO_PREFERENCES_KEY]: { newValue: { density: "compact" } },
  }, "local");
  assert.equal(root.dataset.studioDensity, "compact");
  initialized.dispose();
  assert.equal(listener, undefined);
});
