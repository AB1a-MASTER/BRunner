import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RUNTIME_SESSION_STORAGE_KEY,
  createRuntimeSessionCoordinator,
  createRuntimeSessionStore,
  isCurrentRecordingSession,
  normalizeHostCheckpoint,
  normalizeRuntimeSession,
  recoverRuntimeSession,
} from "../BRunner/core/runtimeSession.js";

function createStorage(initial = {}) {
  const values = structuredClone(initial);
  return {
    values,
    async get(key) {
      return { [key]: structuredClone(values[key]) };
    },
    async set(patch) {
      Object.assign(values, structuredClone(patch));
    },
    async remove(key) {
      delete values[key];
    },
  };
}

test("runtime session is fully serializable and normalizes host readiness", () => {
  const session = normalizeRuntimeSession({
    workerInstanceId: "worker-1",
    recording: {
      isRecording: true,
      sessionId: "recording-1",
      recordedSteps: [{ action: "element.click" }],
      trackedTabs: [{ tabId: 7, tabRef: "tab_1" }],
    },
    execution: {
      status: "running",
      runId: "run-1",
      logs: [{ message: "started" }],
    },
    host: {
      connected: true,
      helloAccepted: true,
      pairedProfileAccepted: false,
      capabilities: ["host.hello"],
    },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(session)), session);
  assert.equal(session.host.ready, false);
  assert.equal(normalizeHostCheckpoint({
    connected: true,
    helloAccepted: true,
    pairedProfileAccepted: true,
  }).ready, true);
});

test("worker recovery interrupts an active run, filters tabs, and resets host readiness", () => {
  const recovered = recoverRuntimeSession({
    workerInstanceId: "old-worker",
    recording: {
      isRecording: true,
      sessionId: "recording-1",
      recordingTabId: 10,
      activeRecordingTabId: 11,
      recordedSteps: [{ id: "step-1" }],
      trackedTabs: [
        { tabId: 10, tabRef: "tab_1" },
        { tabId: 11, tabRef: "tab_2" },
      ],
    },
    execution: {
      status: "running",
      runId: "run-1",
      currentStepIndex: 3,
    },
    host: {
      connected: true,
      helloAccepted: true,
      pairedProfileAccepted: true,
      capabilities: ["workflow.list"],
    },
  }, {
    workerInstanceId: "new-worker",
    openTabs: [{ id: 11 }],
    recoveredAt: "2026-07-14T00:00:00.000Z",
  });

  assert.equal(recovered.workerInstanceId, "new-worker");
  assert.equal(recovered.restoredFromWorkerInstanceId, "old-worker");
  assert.equal(recovered.execution.status, "interrupted");
  assert.equal(recovered.cancellation.requested, true);
  assert.equal(recovered.cancellation.runId, "run-1");
  assert.equal(recovered.cancellation.reason, "service_worker_restart");
  assert.deepEqual(recovered.recording.trackedTabs.map((tab) => tab.tabId), [11]);
  assert.equal(recovered.recording.recordingTabId, 11);
  assert.equal(recovered.recording.isRecording, true);
  assert.equal(recovered.host.connected, false);
  assert.equal(recovered.host.ready, false);
  assert.deepEqual(recovered.host.capabilities, []);
});

test("recording recovery keeps captured steps but does not resume without a live tab", () => {
  const recovered = recoverRuntimeSession({
    recording: {
      isRecording: true,
      sessionId: "recording-1",
      recordedSteps: [{ id: "step-1" }],
      trackedTabs: [{ tabId: 10, tabRef: "tab_1" }],
    },
  }, {
    workerInstanceId: "new-worker",
    openTabs: [],
  });

  assert.equal(recovered.recording.isRecording, false);
  assert.equal(recovered.recording.sessionId, "");
  assert.deepEqual(recovered.recording.recordedSteps, [{ id: "step-1" }]);
});

test("recorded events are accepted only for the active recording session", () => {
  const recording = { isRecording: true, sessionId: "recording-current" };
  assert.equal(isCurrentRecordingSession("recording-current", recording), true);
  assert.equal(isCurrentRecordingSession("recording-old", recording), false);
  assert.equal(isCurrentRecordingSession("", recording), false);
  assert.equal(isCurrentRecordingSession("recording-current", {
    ...recording,
    isRecording: false,
  }), false);
});

test("runtime session storage serializes writes in call order", async () => {
  const storage = createStorage();
  const store = createRuntimeSessionStore({
    storage,
    now: () => "2026-07-14T00:00:00.000Z",
  });

  const first = store.save({ workerInstanceId: "worker-1" });
  const second = store.save({ workerInstanceId: "worker-2" });
  await Promise.all([first, second]);
  await store.flush();

  assert.equal(
    storage.values[RUNTIME_SESSION_STORAGE_KEY].workerInstanceId,
    "worker-2",
  );
  assert.equal((await store.load()).updatedAt, "2026-07-14T00:00:00.000Z");

  await store.clear();
  assert.equal(storage.values[RUNTIME_SESSION_STORAGE_KEY], undefined);
});

test("runtime coordinator rehydrates once and checkpoints cancellation and host readiness", async () => {
  const storage = createStorage({
    [RUNTIME_SESSION_STORAGE_KEY]: {
      workerInstanceId: "worker-old",
      execution: { status: "running", runId: "run-old" },
      recording: {
        isRecording: true,
        sessionId: "recording-current",
        trackedTabs: [{ tabId: 4, tabRef: "tab_1" }],
      },
    },
  });
  const store = createRuntimeSessionStore({
    storage,
    now: () => "2026-07-14T00:00:01.000Z",
  });
  let tabQueries = 0;
  const coordinator = createRuntimeSessionCoordinator({
    store,
    workerInstanceId: "worker-new",
    getOpenTabs: async () => {
      tabQueries += 1;
      return [{ id: 4 }];
    },
    now: () => "2026-07-14T00:00:00.000Z",
  });

  const [first, second] = await Promise.all([
    coordinator.initialize(),
    coordinator.initialize(),
  ]);
  assert.deepEqual(first, second);
  assert.equal(tabQueries, 1);
  assert.equal(first.execution.status, "interrupted");
  assert.equal(coordinator.isCurrentRecordingMessage("recording-current"), true);
  assert.equal(coordinator.isCurrentRecordingMessage("recording-old"), false);

  await coordinator.checkpointRuntime({
    execution: { status: "running", runId: "run-new" },
  });
  assert.deepEqual(coordinator.getSession().cancellation, {
    runId: "run-new",
    requested: false,
    requestedAt: "",
    reason: "",
  });

  await coordinator.checkpointRuntime({
    execution: { status: "cancelling", runId: "run-new" },
  });
  assert.equal(coordinator.getSession().cancellation.requested, true);

  await coordinator.checkpointHost({
    connected: true,
    helloAccepted: true,
    pairedProfileAccepted: true,
    capabilities: ["workflow.list"],
  });
  assert.equal(coordinator.getSession().host.ready, true);
});

test("runtime coordinator remains usable when session persistence is unavailable", async () => {
  const errors = [];
  const coordinator = createRuntimeSessionCoordinator({
    workerInstanceId: "worker-fallback",
    store: {
      async load() { throw new Error("storage unavailable"); },
      async save() { throw new Error("storage unavailable"); },
      async flush() {},
    },
    getOpenTabs: async () => [],
    onPersistenceError: (error) => errors.push(error.message),
  });

  const session = await coordinator.initialize();
  assert.equal(session.workerInstanceId, "worker-fallback");
  assert.deepEqual(errors, ["storage unavailable", "storage unavailable"]);
});
