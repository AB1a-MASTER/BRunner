import assert from "node:assert/strict";
import { test } from "node:test";

import { createRuntimeStateStore } from "../BRunner/core/runtimeState.js";

test("runtime state clears the authoritative execution log stream", () => {
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: {
      sendMessage: async () => ({ ok: true }),
    },
  };

  try {
    const store = createRuntimeStateStore();
    store.updateExecution({ runId: "run-1", status: "running" });
    store.appendExecutionLog({ runId: "run-1", status: "started", message: "Started" });
    assert.equal(store.getState().execution.logs.length, 1);

    const cleared = store.clearExecutionLogs();
    assert.deepEqual(cleared.execution.logs, []);
    assert.equal(cleared.execution.runId, "run-1");
    assert.equal(cleared.execution.status, "running");
  } finally {
    globalThis.chrome = previousChrome;
  }
});

test("runtime state exposes recorded steps for Studio replay", () => {
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: {
      sendMessage: async () => ({ ok: true }),
    },
  };

  try {
    const store = createRuntimeStateStore();
    store.updateRecording({
      isRecording: true,
      sessionId: "recording-1",
      recordedSteps: [{ id: "step-1", action: "element.click" }],
    });
    const state = store.getState();
    assert.equal(state.recording.recordedStepCount, 1);
    assert.deepEqual(state.recording.recordedSteps, [
      { id: "step-1", action: "element.click" },
    ]);
  } finally {
    globalThis.chrome = previousChrome;
  }
});
