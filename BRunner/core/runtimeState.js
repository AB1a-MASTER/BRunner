// core/runtimeState.js
// Authoritative recording and workflow-execution state shared by every UI.

import { Messages } from "./constants.js";
import {
  appendBoundedExecutionLog,
  createExecutionLogEntry,
} from "./executionLog.js";

export function createDefaultRuntimeState() {
  return {
    recording: {
      isRecording: false,
      sessionId: "",
      tabPolicy: "openerDescendants",
      boundDomain: "",
      recordedStepCount: 0,
      recordedSteps: [],
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
      unresolvedNodeIds: [],
      logs: [],
    },
  };
}

export function createRuntimeStateStore({
  initialState = null,
  onStateChanged = null,
} = {}) {
  let state = normalizeRuntimeState(initialState);
  let executionLogSequence = getHighestExecutionLogSequence(
    state.execution.logs,
  );

  function getState() {
    return structuredClone(state);
  }

  function replaceState(nextState = {}) {
    state = normalizeRuntimeState(nextState);
    executionLogSequence = getHighestExecutionLogSequence(state.execution.logs);
    notifyChanged();
    return getState();
  }

  function updateRecording(recording = {}) {
    state.recording = {
      ...state.recording,
      isRecording: Boolean(recording.isRecording),
      sessionId: recording.sessionId || "",
      tabPolicy: recording.tabPolicy || "openerDescendants",
      boundDomain: recording.boundDomain || "",
      recordedSteps: Array.isArray(recording.recordedSteps)
        ? recording.recordedSteps.map((step) => structuredClone(step))
        : [],
      recordedStepCount: Array.isArray(recording.recordedSteps)
        ? recording.recordedSteps.length
        : Number(recording.recordedStepCount || 0),
    };

    notifyChanged();
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

    notifyChanged();
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
    notifyChanged();
    return entry;
  }

  function clearExecutionLogs() {
    executionLogSequence = 0;
    state.execution = {
      ...state.execution,
      logs: [],
    };
    notifyChanged();
    return getState();
  }

  function isRunning() {
    return ["running", "cancelling"].includes(state.execution.status);
  }

  function isRecording() {
    return state.recording.isRecording;
  }

  function notifyChanged() {
    const snapshot = getState();
    if (typeof onStateChanged === "function") {
      Promise.resolve(onStateChanged(snapshot)).catch(() => {});
    }

    globalThis.chrome?.runtime
      .sendMessage({
        type: Messages.RuntimeStateChanged,
        state: snapshot,
      })
      .catch(() => {});
  }

  return {
    getState,
    replaceState,
    updateRecording,
    updateExecution,
    appendExecutionLog,
    clearExecutionLogs,
    isRunning,
    isRecording,
  };
}

function normalizeRuntimeState(input = {}) {
  const defaults = createDefaultRuntimeState();
  const recordedSteps = Array.isArray(input?.recording?.recordedSteps)
    ? structuredClone(input.recording.recordedSteps)
    : [];
  return {
    recording: {
      ...defaults.recording,
      ...(input?.recording || {}),
      isRecording: Boolean(input?.recording?.isRecording),
      sessionId: String(input?.recording?.sessionId || ""),
      recordedSteps,
      recordedStepCount: recordedSteps.length,
    },
    execution: {
      ...defaults.execution,
      ...(input?.execution || {}),
      logs: Array.isArray(input?.execution?.logs)
        ? structuredClone(input.execution.logs)
        : [],
      variables: Array.isArray(input?.execution?.variables)
        ? structuredClone(input.execution.variables)
        : [],
      completedNodeIds: normalizeStringArray(input?.execution?.completedNodeIds),
      skippedNodeIds: normalizeStringArray(input?.execution?.skippedNodeIds),
      unresolvedNodeIds: normalizeStringArray(input?.execution?.unresolvedNodeIds),
    },
  };
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function getHighestExecutionLogSequence(logs) {
  return logs.reduce((maximum, entry) => {
    return Math.max(maximum, Number(entry?.sequence) || 0);
  }, 0);
}
