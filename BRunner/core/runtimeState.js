// core/runtimeState.js
// Authoritative recording and workflow-execution state shared by every UI.

import { Messages } from "./constants.js";

export function createRuntimeStateStore() {
  let state = {
    recording: {
      isRecording: false,
      sessionId: "",
      tabPolicy: "openerDescendants",
      boundDomain: "",
      recordedStepCount: 0,
    },
    execution: {
      status: "idle",
      runId: "",
      workflowName: "",
      currentStepIndex: -1,
      totalSteps: 0,
      currentAction: "",
      error: "",
      diagnostics: null,
    },
  };

  function getState() {
    return {
      recording: { ...state.recording },
      execution: { ...state.execution },
    };
  }

  function updateRecording(recording = {}) {
    state.recording = {
      ...state.recording,
      isRecording: Boolean(recording.isRecording),
      sessionId: recording.sessionId || "",
      tabPolicy: recording.tabPolicy || "openerDescendants",
      boundDomain: recording.boundDomain || "",
      recordedStepCount: Array.isArray(recording.recordedSteps)
        ? recording.recordedSteps.length
        : Number(recording.recordedStepCount || 0),
    };

    broadcast();
    return getState();
  }

  function updateExecution(patch = {}) {
    state.execution = {
      ...state.execution,
      ...patch,
    };

    broadcast();
    return getState();
  }

  function isRunning() {
    return state.execution.status === "running";
  }

  function isRecording() {
    return state.recording.isRecording;
  }

  function broadcast() {
    chrome.runtime
      .sendMessage({
        type: Messages.RuntimeStateChanged,
        state: getState(),
      })
      .catch(() => {});
  }

  return {
    getState,
    updateRecording,
    updateExecution,
    isRunning,
    isRecording,
  };
}

