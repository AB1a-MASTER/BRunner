import assert from "node:assert/strict";
import { test } from "node:test";

import { createRecordingController } from "../BRunner/core/recordingController.js";

test("recording controller restores only live tabs and re-synchronizes the session id", async () => {
  const previousChrome = globalThis.chrome;
  const tabMessages = [];
  const stateChanges = [];
  const openTabs = [
    { id: 22, url: "https://example.test/second", active: true },
  ];
  globalThis.chrome = {
    runtime: {
      sendMessage: async () => ({ ok: true }),
    },
    tabs: {
      query: async () => openTabs,
      sendMessage: async (tabId, message) => {
        tabMessages.push({ tabId, message });
        return { ok: true };
      },
      get: async (tabId) => openTabs.find((tab) => tab.id === tabId),
    },
  };

  try {
    const controller = createRecordingController({
      nativeBridge: {},
      onStateChanged: (state) => stateChanges.push(state),
    });
    const state = await controller.restore({
      isRecording: true,
      sessionId: "recording-restored",
      tabPolicy: "activeTab",
      boundDomain: "example.test",
      recordingTabId: 21,
      activeRecordingTabId: 22,
      recordedSteps: [{ id: "step-1" }],
      trackedTabs: [
        { tabId: 21, tabRef: "tab_1" },
        { tabId: 22, tabRef: "tab_2" },
      ],
    }, openTabs);

    assert.equal(state.isRecording, true);
    assert.equal(state.sessionId, "recording-restored");
    assert.equal(state.recordingTabId, 22);
    assert.deepEqual(state.trackedTabs.map((tab) => tab.tabId), [22]);
    assert.equal(stateChanges.length, 1);
    assert.deepEqual(tabMessages, [{
      tabId: 22,
      message: {
        type: "SET_RECORDING_STATE",
        isRecording: true,
        sessionId: "recording-restored",
        boundDomain: "example.test",
      },
    }]);
  } finally {
    globalThis.chrome = previousChrome;
  }
});

test("recording controller checkpoints a session before enabling content scripts", async () => {
  const previousChrome = globalThis.chrome;
  const order = [];
  const openTabs = [
    { id: 24, url: "https://example.test/start", active: true },
  ];
  globalThis.chrome = {
    runtime: { sendMessage: async () => ({ ok: true }) },
    tabs: {
      query: async () => openTabs,
      sendMessage: async (_tabId, message) => {
        order.push(`broadcast:${message.sessionId}`);
        return { ok: true };
      },
      get: async (tabId) => openTabs.find((tab) => tab.id === tabId),
    },
  };

  try {
    const controller = createRecordingController({
      nativeBridge: {},
      onStateChanged: (state) => {
        order.push(`checkpoint:${state.sessionId}`);
      },
    });
    await controller.restore({
      isRecording: true,
      sessionId: "recording-start-order",
      recordingTabId: 24,
      activeRecordingTabId: 24,
      trackedTabs: [{ tabId: 24, tabRef: "tab_1" }],
    }, openTabs);

    assert.deepEqual(order, [
      "checkpoint:recording-start-order",
      "broadcast:recording-start-order",
    ]);
  } finally {
    globalThis.chrome = previousChrome;
  }
});

test("recording controller preserves recovered steps but remains stopped without a live tab", async () => {
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: { sendMessage: async () => ({ ok: true }) },
    tabs: {
      query: async () => [],
      sendMessage: async () => ({ ok: true }),
    },
  };

  try {
    const controller = createRecordingController({
      nativeBridge: {},
      onStateChanged: () => {},
    });
    const state = await controller.restore({
      isRecording: true,
      sessionId: "recording-restored",
      recordedSteps: [{ id: "step-1" }],
      trackedTabs: [{ tabId: 21, tabRef: "tab_1" }],
    }, []);

    assert.equal(state.isRecording, false);
    assert.equal(state.sessionId, "");
    assert.deepEqual(state.recordedSteps, [{ id: "step-1" }]);
  } finally {
    globalThis.chrome = previousChrome;
  }
});

test("recording controller checkpoints tracked-tab removal immediately", async () => {
  const previousChrome = globalThis.chrome;
  const stateChanges = [];
  const openTabs = [
    { id: 31, url: "https://example.test/first", active: true },
    { id: 32, url: "https://example.test/second", active: false },
  ];
  globalThis.chrome = {
    runtime: { sendMessage: async () => ({ ok: true }) },
    tabs: {
      query: async () => openTabs,
      sendMessage: async () => ({ ok: true }),
      get: async (tabId) => openTabs.find((tab) => tab.id === tabId),
    },
  };

  try {
    const controller = createRecordingController({
      nativeBridge: {},
      onStateChanged: (state) => stateChanges.push(state),
    });
    await controller.restore({
      isRecording: true,
      sessionId: "recording-restored",
      recordingTabId: 31,
      activeRecordingTabId: 31,
      trackedTabs: [
        { tabId: 31, tabRef: "tab_1" },
        { tabId: 32, tabRef: "tab_2" },
      ],
    }, openTabs);
    stateChanges.length = 0;

    controller.handleTabRemoved(32);

    assert.equal(stateChanges.length, 1);
    assert.deepEqual(
      stateChanges[0].trackedTabs.map((tab) => tab.tabId),
      [31],
    );
    assert.equal(stateChanges[0].activeRecordingTabId, 31);

    controller.handleTabRemoved(31);

    assert.equal(stateChanges.length, 2);
    assert.deepEqual(stateChanges[1].trackedTabs, []);
    assert.equal(stateChanges[1].activeRecordingTabId, null);
  } finally {
    globalThis.chrome = previousChrome;
  }
});
