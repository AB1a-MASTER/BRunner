import assert from "node:assert/strict";
import { test } from "node:test";

import {
  STUDIO_SESSION_KEY,
  StudioKind,
  loadStudioSession,
  normalizeStudioSession,
  saveStudioSession,
} from "../BRunner/core/studioSession.js";

function createStorage(initial = {}) {
  const values = structuredClone(initial);
  return {
    values,
    async get(key) { return { [key]: structuredClone(values[key]) }; },
    async set(patch) { Object.assign(values, structuredClone(patch)); },
  };
}

test("studio session normalizes active workflow identity", () => {
  assert.deepEqual(normalizeStudioSession({
    activeWorkflowFilename: "Demo.json",
    activeStudio: StudioKind.Graph,
    updatedAt: "2026-06-26T00:00:00.000Z",
  }), {
    version: 1,
    activeWorkflowFilename: "Demo.json",
    activeStudio: StudioKind.Graph,
    updatedAt: "2026-06-26T00:00:00.000Z",
  });

  assert.deepEqual(normalizeStudioSession({
    activeWorkflowFilename: "  ",
    activeStudio: "bad",
  }), {
    version: 1,
    activeWorkflowFilename: "",
    activeStudio: "",
    updatedAt: "",
  });
});

test("studio session persists and merges workflow identity", async () => {
  const storage = createStorage();
  const saved = await saveStudioSession({
    activeWorkflowFilename: "Flow.json",
    activeStudio: StudioKind.Sequential,
  }, storage);

  assert.equal(saved.activeWorkflowFilename, "Flow.json");
  assert.equal(saved.activeStudio, StudioKind.Sequential);
  assert.match(saved.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(await loadStudioSession(storage), storage.values[STUDIO_SESSION_KEY]);
});
