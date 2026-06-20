// core/runtimeState.js
// Authoritative recording and workflow-execution state shared by every UI.

import { Messages } from "./constants.js";
import {
  appendBoundedExecutionLog,
  createExecutionLogEntry,
} from "./executionLog.js";

export function createRuntimeStateStore() {
  let executionLogSequence = 0;
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
      currentNodeId: "",
      totalSteps: 0,
      currentAction: "",
      error: "",
      diagnostics: null,
      variables: [],
      skippedSteps: 0,
      completedNodeIds: [],
      skippedNodeIds: [],
      logs: [],
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
    if (Array.isArray(patch.logs) && patch.logs.length === 0) {
      executionLogSequence = 0;
    }
    state.execution = {
      ...state.execution,
      ...patch,
    };

    broadcast();
    return getState();
  }

  function appendExecutionLog(event = {}, patch = {}) {
    executionLogSequence += 1;
    const entry = createExecutionLogEntry(
      event,
      executionLogSequence,
    );
    state.execution = {
      ...state.execution,
      ...patch,
      logs: appendBoundedExecutionLog(state.execution.logs, entry),
    };
    broadcast();
    return entry;
  }

  function clearExecutionLogs() {
    executionLogSequence = 0;
    state.execution = {
      ...state.execution,
      logs: [],
    };
    broadcast();
    return getState();
  }

  function isRunning() {
    return ["running", "cancelling"].includes(state.execution.status);
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
    appendExecutionLog,
    clearExecutionLogs,
    isRunning,
    isRecording,
  };
}
