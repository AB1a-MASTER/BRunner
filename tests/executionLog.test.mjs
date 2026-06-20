import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendBoundedExecutionLog,
  createExecutionLogEntry,
  safeExecutionFailure,
  sanitizeExecutionDiagnostics,
} from "../BRunner/core/executionLog.js";

test("execution diagnostics retain only bounded non-secret metadata", () => {
  assert.deepEqual(sanitizeExecutionDiagnostics({
    action: "http.request",
    finalReason: "http_error",
    status: 422,
    body: "secret-body",
    headers: { authorization: "Bearer secret" },
    path: "C:\\private\\payload.txt",
    response: "secret-response",
  }), {
    action: "http.request",
    finalReason: "http_error",
    status: 422,
  });
});

test("failure summaries never reuse arbitrary exception messages", () => {
  const error = new Error("Token secret at C:\\private\\payload.txt");
  error.diagnostics = {
    action: "file.local.upload",
    finalReason: "file_read_failed",
    path: "C:\\private\\payload.txt",
  };

  const result = safeExecutionFailure(error);
  assert.equal(result.message, "file.local.upload failed (file read failed).");
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(JSON.stringify(result).includes("Token secret"), false);
});

test("execution log entries are structured and bounded", () => {
  const first = createExecutionLogEntry({
    runId: "run-1",
    nodeId: "node-1",
    action: "logic.wait",
    status: "completed",
    message: "Node completed.",
  }, 1, 0);
  const second = createExecutionLogEntry({ runId: "run-1", status: "completed" }, 2, 1);
  const third = createExecutionLogEntry({ runId: "run-1", status: "completed" }, 3, 2);

  assert.equal(first.scope, "node");
  assert.equal(first.timestamp, "1970-01-01T00:00:00.000Z");
  assert.deepEqual(appendBoundedExecutionLog([first, second], third, 2), [second, third]);
});
