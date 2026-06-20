export const MAX_EXECUTION_LOG_ENTRIES = 200;

const ALLOWED_DIAGNOSTIC_KEYS = new Set([
  "action",
  "attempt",
  "finalReason",
  "maxAttempts",
  "status",
  "stepIndex",
  "timeoutMs",
  "variableName",
  "valuePath",
]);

export function sanitizeExecutionDiagnostics(diagnostics) {
  if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) {
    return null;
  }

  const safe = {};
  for (const [key, value] of Object.entries(diagnostics)) {
    if (!ALLOWED_DIAGNOSTIC_KEYS.has(key)) continue;
    if (!["string", "number", "boolean"].includes(typeof value)) continue;
    safe[key] = typeof value === "string" ? value.slice(0, 160) : value;
  }
  return Object.keys(safe).length ? safe : null;
}

export function safeExecutionFailure(error, fallbackAction = "unknown") {
  const diagnostics = sanitizeExecutionDiagnostics(error?.diagnostics);
  const action = diagnostics?.action || fallbackAction || "unknown";
  const reason = diagnostics?.finalReason || "step_failed";
  return {
    diagnostics,
    message: `${action} failed (${String(reason).replaceAll("_", " ")}).`,
  };
}

export function createExecutionLogEntry(event = {}, sequence = 0, now = Date.now()) {
  return {
    id: `${event.runId || "run"}:${sequence}`,
    sequence,
    timestamp: new Date(now).toISOString(),
    runId: String(event.runId || ""),
    workflowName: String(event.workflowName || "").slice(0, 120),
    scope: event.nodeId ? "node" : "run",
    nodeId: String(event.nodeId || ""),
    stepIndex: Number.isInteger(event.stepIndex) ? event.stepIndex : -1,
    action: String(event.action || "").slice(0, 120),
    status: String(event.status || "info"),
    message: String(event.message || "Execution update").slice(0, 240),
    diagnostics: sanitizeExecutionDiagnostics(event.diagnostics),
  };
}

export function appendBoundedExecutionLog(logs, entry, limit = MAX_EXECUTION_LOG_ENTRIES) {
  const current = Array.isArray(logs) ? logs : [];
  return [...current, entry].slice(-Math.max(1, limit));
}
