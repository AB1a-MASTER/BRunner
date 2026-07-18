// core/runtimeSession.js
// Serializable MV3 service-worker session checkpoints and restart recovery.

export const RUNTIME_SESSION_STORAGE_KEY = "brunner.runtime.session.v1";
export const RUNTIME_SESSION_VERSION = 1;

const ACTIVE_EXECUTION_STATUSES = new Set(["running", "cancelling"]);

export function createRuntimeSessionId(now = Date.now, random = Math.random) {
  return `worker_${now()}_${random().toString(36).slice(2, 10)}`;
}

export function createEmptyRuntimeSession(workerInstanceId = "") {
  return {
    version: RUNTIME_SESSION_VERSION,
    workerInstanceId: String(workerInstanceId || ""),
    restoredFromWorkerInstanceId: "",
    updatedAt: "",
    recording: normalizeRecordingCheckpoint(),
    execution: normalizeExecutionCheckpoint(),
    cancellation: normalizeCancellationCheckpoint(),
    host: normalizeHostCheckpoint(),
  };
}

export function normalizeRuntimeSession(input = {}, options = {}) {
  const workerInstanceId = String(
    options.workerInstanceId ?? input?.workerInstanceId ?? "",
  );

  return {
    version: RUNTIME_SESSION_VERSION,
    workerInstanceId,
    restoredFromWorkerInstanceId: String(
      input?.restoredFromWorkerInstanceId || "",
    ),
    updatedAt: typeof input?.updatedAt === "string" ? input.updatedAt : "",
    recording: normalizeRecordingCheckpoint(input?.recording),
    execution: normalizeExecutionCheckpoint(input?.execution),
    cancellation: normalizeCancellationCheckpoint(input?.cancellation),
    host: normalizeHostCheckpoint(input?.host),
  };
}

export function recoverRuntimeSession(
  storedSession = {},
  {
    workerInstanceId = createRuntimeSessionId(),
    openTabs = [],
    recoveredAt = new Date().toISOString(),
  } = {},
) {
  const previous = normalizeRuntimeSession(storedSession);
  const openTabIds = new Set(
    (Array.isArray(openTabs) ? openTabs : [])
      .map((tab) => Number(tab?.id))
      .filter(Number.isInteger),
  );
  const recording = reconcileRecordingCheckpoint(
    previous.recording,
    openTabIds,
  );
  const executionWasActive = ACTIVE_EXECUTION_STATUSES.has(
    previous.execution.status,
  );
  const execution = executionWasActive
    ? {
        ...previous.execution,
        status: "interrupted",
        error: "Extension service worker restarted before the run completed.",
      }
    : previous.execution;

  return normalizeRuntimeSession({
    ...previous,
    workerInstanceId,
    restoredFromWorkerInstanceId: previous.workerInstanceId,
    updatedAt: recoveredAt,
    recording,
    execution,
    cancellation: {
      runId: executionWasActive
        ? previous.execution.runId
        : previous.cancellation.runId,
      requested: executionWasActive || previous.cancellation.requested,
      requestedAt: executionWasActive
        ? recoveredAt
        : previous.cancellation.requestedAt,
      reason: executionWasActive
        ? "service_worker_restart"
        : previous.cancellation.reason,
    },
    // A socket and its hello result cannot survive an MV3 worker restart.
    host: {
      ...previous.host,
      connected: false,
      helloAccepted: false,
      pairedProfileAccepted: false,
      ready: false,
      capabilities: [],
    },
  });
}

export function createRuntimeSessionStore({
  storage = globalThis.chrome?.storage?.session,
  now = () => new Date().toISOString(),
} = {}) {
  let writeQueue = Promise.resolve();

  async function load() {
    if (!storage) return createEmptyRuntimeSession();
    const stored = await storage.get(RUNTIME_SESSION_STORAGE_KEY);
    return normalizeRuntimeSession(stored?.[RUNTIME_SESSION_STORAGE_KEY]);
  }

  function save(session = {}) {
    const checkpoint = normalizeRuntimeSession({
      ...session,
      updatedAt: now(),
    });

    if (!storage) return Promise.resolve(checkpoint);

    const write = writeQueue
      .catch(() => {})
      .then(async () => {
        await storage.set({
          [RUNTIME_SESSION_STORAGE_KEY]: checkpoint,
        });
        return checkpoint;
      });
    writeQueue = write;
    return write;
  }

  async function clear() {
    if (!storage) return;
    writeQueue = writeQueue.catch(() => {}).then(async () => {
      if (typeof storage.remove === "function") {
        await storage.remove(RUNTIME_SESSION_STORAGE_KEY);
      } else {
        await storage.set({ [RUNTIME_SESSION_STORAGE_KEY]: undefined });
      }
    });
    await writeQueue;
  }

  async function flush() {
    await writeQueue;
  }

  return { load, save, clear, flush };
}

export function mergeRuntimeSession(current = {}, patch = {}) {
  const normalized = normalizeRuntimeSession(current);
  return normalizeRuntimeSession({
    ...normalized,
    ...patch,
    recording: patch.recording
      ? { ...normalized.recording, ...patch.recording }
      : normalized.recording,
    execution: patch.execution
      ? { ...normalized.execution, ...patch.execution }
      : normalized.execution,
    cancellation: patch.cancellation
      ? { ...normalized.cancellation, ...patch.cancellation }
      : normalized.cancellation,
    host: patch.host
      ? { ...normalized.host, ...patch.host }
      : normalized.host,
  });
}

export function createRuntimeSessionCoordinator({
  store = createRuntimeSessionStore(),
  workerInstanceId = createRuntimeSessionId(),
  getOpenTabs = async () => globalThis.chrome?.tabs?.query?.({}) || [],
  now = () => new Date().toISOString(),
  onPersistenceError = () => {},
} = {}) {
  let session = createEmptyRuntimeSession(workerInstanceId);
  let initialization = null;

  function initialize() {
    if (initialization) return initialization;
    initialization = Promise.all([
      Promise.resolve().then(() => store.load()).catch((error) => {
        onPersistenceError(error);
        return createEmptyRuntimeSession();
      }),
      Promise.resolve().then(() => getOpenTabs()).catch((error) => {
        onPersistenceError(error);
        return [];
      }),
    ]).then(async ([stored, openTabs]) => {
      session = recoverRuntimeSession(stored, {
        workerInstanceId,
        openTabs,
        recoveredAt: now(),
      });
      await store.save(session).catch((error) => onPersistenceError(error));
      return getSession();
    });
    return initialization;
  }

  function checkpoint(patch = {}) {
    session = mergeRuntimeSession(session, {
      ...patch,
      updatedAt: now(),
    });
    const persistence = store.save(session);
    persistence.catch((error) => onPersistenceError(error));
    return persistence;
  }

  function checkpointRuntime(runtime = {}, recordingCheckpoint = null) {
    const execution = runtime?.execution || {};
    const status = String(execution.status || "idle");
    const runId = String(execution.runId || "");
    let cancellation = session.cancellation;

    if (status === "running" && runId !== cancellation.runId) {
      cancellation = normalizeCancellationCheckpoint({ runId });
    } else if (status === "cancelling") {
      cancellation = normalizeCancellationCheckpoint({
        runId,
        requested: true,
        requestedAt: now(),
        reason: "user_requested",
      });
    }

    return checkpoint({
      execution,
      ...(recordingCheckpoint ? { recording: recordingCheckpoint } : {}),
      cancellation,
    });
  }

  function checkpointHost(host = {}) {
    return checkpoint({ host });
  }

  function isCurrentRecordingMessage(messageSessionId) {
    return isCurrentRecordingSession(messageSessionId, session.recording);
  }

  function getSession() {
    return structuredClone(session);
  }

  async function flush() {
    await store.flush();
  }

  return {
    initialize,
    checkpoint,
    checkpointRuntime,
    checkpointHost,
    isCurrentRecordingMessage,
    getSession,
    flush,
  };
}

export function isCurrentRecordingSession(messageSessionId, recording = {}) {
  const expected = String(recording?.sessionId || "");
  const received = String(messageSessionId || "");
  return Boolean(recording?.isRecording && expected && received === expected);
}

export function normalizeRecordingCheckpoint(input = {}) {
  const trackedTabs = Array.isArray(input?.trackedTabs)
    ? input.trackedTabs
        .map(normalizeTrackedTab)
        .filter((tab) => Number.isInteger(tab.tabId))
    : [];

  return {
    isRecording: Boolean(input?.isRecording),
    sessionId: String(input?.sessionId || ""),
    tabPolicy: input?.tabPolicy === "activeTab"
      ? "activeTab"
      : "openerDescendants",
    boundDomain: String(input?.boundDomain || ""),
    recordedSteps: cloneArray(input?.recordedSteps),
    recordingTabId: normalizeTabId(input?.recordingTabId),
    activeRecordingTabId: normalizeTabId(input?.activeRecordingTabId),
    lastRecordedUrl: String(input?.lastRecordedUrl || ""),
    trackedTabs,
  };
}

export function normalizeExecutionCheckpoint(input = {}) {
  return {
    status: String(input?.status || "idle"),
    runId: String(input?.runId || ""),
    workflowName: String(input?.workflowName || ""),
    currentStepIndex: Number.isInteger(input?.currentStepIndex)
      ? input.currentStepIndex
      : -1,
    currentNodeId: String(input?.currentNodeId || ""),
    totalSteps: toNonNegativeInteger(input?.totalSteps),
    currentAction: String(input?.currentAction || ""),
    error: String(input?.error || ""),
    diagnostics: cloneSerializable(input?.diagnostics),
    variables: cloneArray(input?.variables),
    skippedSteps: toNonNegativeInteger(input?.skippedSteps),
    completedNodeIds: cloneStringArray(input?.completedNodeIds),
    skippedNodeIds: cloneStringArray(input?.skippedNodeIds),
    unresolvedNodeIds: cloneStringArray(input?.unresolvedNodeIds),
    logs: cloneArray(input?.logs),
  };
}

export function normalizeCancellationCheckpoint(input = {}) {
  return {
    runId: String(input?.runId || ""),
    requested: Boolean(input?.requested),
    requestedAt: typeof input?.requestedAt === "string"
      ? input.requestedAt
      : "",
    reason: String(input?.reason || ""),
  };
}

export function normalizeHostCheckpoint(input = {}) {
  const connected = Boolean(input?.connected);
  const helloAccepted = Boolean(input?.helloAccepted);
  const pairedProfileAccepted = Boolean(input?.pairedProfileAccepted);
  const ready = connected && helloAccepted && pairedProfileAccepted;
  return {
    connected,
    helloAccepted,
    pairedProfileAccepted,
    ready,
    profileInstanceId: String(input?.profileInstanceId || ""),
    protocolVersion: Number.isFinite(Number(input?.protocolVersion))
      ? Number(input.protocolVersion)
      : null,
    capabilities: ready ? cloneStringArray(input?.capabilities) : [],
    error: String(input?.error || ""),
  };
}

function reconcileRecordingCheckpoint(recording, openTabIds) {
  const trackedTabs = recording.trackedTabs.filter((tab) => {
    return openTabIds.has(tab.tabId);
  });
  const trackedTabIds = new Set(trackedTabs.map((tab) => tab.tabId));
  const fallbackTabId = trackedTabs[0]?.tabId ?? null;
  const canResume = Boolean(
    recording.isRecording && recording.sessionId && trackedTabs.length > 0,
  );

  return {
    ...recording,
    isRecording: canResume,
    sessionId: canResume ? recording.sessionId : "",
    recordingTabId: trackedTabIds.has(recording.recordingTabId)
      ? recording.recordingTabId
      : fallbackTabId,
    activeRecordingTabId: trackedTabIds.has(recording.activeRecordingTabId)
      ? recording.activeRecordingTabId
      : fallbackTabId,
    trackedTabs,
  };
}

function normalizeTrackedTab(input = {}) {
  return {
    tabId: normalizeTabId(input?.tabId),
    tabRef: String(input?.tabRef || ""),
    openerTabRef: String(input?.openerTabRef || ""),
    lastUrl: String(input?.lastUrl || ""),
    lastNavigationRecordedAt: Number(input?.lastNavigationRecordedAt) || 0,
  };
}

function normalizeTabId(value) {
  const tabId = Number(value);
  return Number.isInteger(tabId) && tabId >= 0 ? tabId : null;
}

function toNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function cloneStringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function cloneArray(value) {
  return Array.isArray(value)
    ? value.map((item) => cloneSerializable(item))
    : [];
}

function cloneSerializable(value) {
  if (value === undefined) return null;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      return null;
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}
