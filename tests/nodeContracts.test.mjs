import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CommonNodeConfigDefaults,
  NodeErrorCodes,
  NodeExecutionError,
  NodeStatuses,
  normalizeCommonNodeConfig,
} from "../BRunner/nodes/shared/nodeContracts.js";

test("node lifecycle statuses exactly match the finalized blueprint", () => {
  assert.deepEqual(Object.values(NodeStatuses), [
    "queued",
    "waiting_for_dependencies",
    "running",
    "waiting_async",
    "completed",
    "failed",
    "timed_out",
    "cancelled",
    "skipped_disabled",
  ]);
});

test("node error codes exactly include the finalized baseline", () => {
  assert.deepEqual(Object.values(NodeErrorCodes), [
    "CONFIG_INVALID",
    "DEPENDENCY_NOT_READY",
    "TARGET_NOT_FOUND",
    "AMBIGUOUS_TARGET",
    "TARGET_NOT_INTERACTABLE",
    "TARGET_NOT_VISIBLE",
    "PROTECTED_PAGE",
    "TAB_NOT_FOUND",
    "HOST_UNAVAILABLE",
    "HOST_FOREGROUND_REQUIRED",
    "HOST_COORDINATE_LOW_CONFIDENCE",
    "TIMEOUT",
    "VALIDATION_FAILED",
    "FILE_NOT_FOUND",
    "FILE_ACCESS_DENIED",
    "FILE_PARSE_FAILED",
    "DOWNLOAD_NOT_FOUND",
    "DIALOG_NOT_FOUND",
    "MISSING_REQUIRED_OUTPUT",
    "CODE_EXECUTION_FAILED",
    "FUNCTION_EXECUTION_FAILED",
    "CANCELLED",
  ]);
});

test("NodeExecutionError exposes a stable structured error", () => {
  const details = {
    selector: "#missing",
    localValue: "ordinary workflow data",
  };
  const error = new NodeExecutionError(
    NodeErrorCodes.TARGET_NOT_FOUND,
    "The mapped target could not be resolved.",
    details,
  );

  assert.equal(error.name, "NodeExecutionError");
  assert.equal(error.code, NodeErrorCodes.TARGET_NOT_FOUND);
  assert.equal(error.message, "The mapped target could not be resolved.");
  assert.equal(error.details, details);
  assert.deepEqual(error.toJSON(), {
    code: NodeErrorCodes.TARGET_NOT_FOUND,
    message: "The mapped target could not be resolved.",
    details,
  });
  assert.throws(
    () => new NodeExecutionError("UNKNOWN", "Unknown"),
    /Unknown node error code/,
  );
});

test("common configuration receives finalized defaults and preserves node config", () => {
  const config = normalizeCommonNodeConfig({
    url: "https://example.test/",
  }, {
    displayName: "Navigate",
    retryCount: 2,
    timeout: 30_000,
  });

  assert.deepEqual(config, {
    url: "https://example.test/",
    enabled: true,
    displayName: "Navigate",
    retryCount: 2,
    retryDelay: CommonNodeConfigDefaults.retryDelay,
    retryStrategy: "fixed",
    retryOnlyFor: [],
    timeout: 30_000,
    onError: "fail",
    saveOutputAs: null,
    saveToWorkflowClipboard: "off",
    logLevel: "normal",
  });
});

test("common configuration normalizes retry, output, clipboard, and logging options", () => {
  const config = normalizeCommonNodeConfig({
    enabled: false,
    displayName: "  Customer lookup  ",
    retryCount: "3",
    retryDelay: "250",
    retryStrategy: "INCREASING",
    retryOnlyFor: ["Target not found", "timeout", "timeout"],
    timeout: "5000",
    onError: "Route to error port",
    saveOutputAs: " customer ",
    saveToWorkflowClipboard: { mode: "Create version" },
    logLevel: "VERBOSE",
  });

  assert.deepEqual(config, {
    enabled: false,
    displayName: "Customer lookup",
    retryCount: 3,
    retryDelay: 250,
    retryStrategy: "increasing",
    retryOnlyFor: ["target_not_found", "timeout"],
    timeout: 5000,
    onError: "error_port",
    saveOutputAs: "customer",
    saveToWorkflowClipboard: "version",
    logLevel: "verbose",
  });
});
