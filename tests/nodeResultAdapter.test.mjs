import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NodeErrorCodes,
  NodeExecutionError,
  NodeStatuses,
} from "../BRunner/nodes/shared/nodeContracts.js";
import {
  createCompletedNodeResult,
  createDisabledNodeResult,
  createFailedNodeResult,
  createNodeLogEvents,
  normalizeWorkflowClipboardConfig,
  publishNodeResult,
} from "../BRunner/nodes/shared/resultAdapter.js";

test("completed results use the standard envelope and execution metadata", () => {
  const result = createCompletedNodeResult({
    nodeId: "node_123",
    attempt: 2,
    startedAt: "2026-06-30T10:15:00.000Z",
    finishedAt: "2026-06-30T10:15:00.840Z",
    executionMethod: "browser",
    output: {
      currentUrl: "https://example.test/",
    },
    warnings: ["navigation used cached tab state"],
  });

  assert.deepEqual(result, {
    status: NodeStatuses.COMPLETED,
    output: {
      currentUrl: "https://example.test/",
    },
    warnings: ["navigation used cached tab state"],
    errors: [],
    execution: {
      nodeId: "node_123",
      attempt: 2,
      startedAt: "2026-06-30T10:15:00.000Z",
      finishedAt: "2026-06-30T10:15:00.840Z",
      durationMs: 840,
      executionMethod: "browser",
    },
  });
});

test("disabled results always clear output, warnings, and errors", () => {
  const result = createDisabledNodeResult({
    nodeId: "node_disabled",
    now: 0,
    output: { stale: true },
    warnings: ["stale warning"],
    errors: [new Error("stale error")],
  });

  assert.equal(result.status, NodeStatuses.SKIPPED_DISABLED);
  assert.equal(result.output, null);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.errors, []);
  assert.equal(result.execution.startedAt, "1970-01-01T00:00:00.000Z");
  assert.equal(result.execution.finishedAt, "1970-01-01T00:00:00.000Z");
});

test("failed results normalize errors without removing arbitrary local details", () => {
  const localDetails = {
    rawInput: "credential-like data remains ordinary local workflow data",
    nested: { token: "visible in verbose local history" },
  };
  const result = createFailedNodeResult({
    nodeId: "node_failed",
    errors: [
      new NodeExecutionError(
        NodeErrorCodes.VALIDATION_FAILED,
        "Output validation failed.",
        localDetails,
      ),
    ],
  });

  assert.deepEqual(result.errors, [{
    code: NodeErrorCodes.VALIDATION_FAILED,
    category: "validation",
    message: "Output validation failed.",
    details: localDetails,
  }]);
});

test("publishing exposes node output, friendly aliases, and injected clipboard output", async () => {
  const writes = [];
  const clipboardWrites = [];
  const registry = {
    set(path, value) {
      writes.push([path, value]);
    },
  };
  const workflowClipboard = {
    append(entryName, value) {
      clipboardWrites.push([entryName, value]);
    },
  };
  const output = {
    email: "person@example.test",
  };
  const result = createCompletedNodeResult({
    nodeId: "extract_customer",
    output,
  });

  await publishNodeResult({
    result,
    registry,
    workflowClipboard,
    config: {
      saveOutputAs: "customer",
      saveToWorkflowClipboard: {
        mode: "append entry",
        entryName: "customerHistory",
      },
    },
  });

  assert.deepEqual(writes, [
    ["nodes.extract_customer.output", output],
    ["variables.customer", output],
  ]);
  assert.deepEqual(clipboardWrites, [
    ["customerHistory", output],
  ]);
});

test("workflow clipboard configuration normalizes mode and key", () => {
  assert.deepEqual(normalizeWorkflowClipboardConfig({
    mode: "Create version",
    entryName: "  customerHistory  ",
  }, "fallback"), {
    mode: "version",
    key: "customerHistory",
  });
  assert.deepEqual(normalizeWorkflowClipboardConfig("append", "events"), {
    mode: "append",
    key: "events",
  });
});

test("publishing keeps an explicit variables alias and uses set as replace fallback", async () => {
  const writes = [];
  const clipboardWrites = [];
  const registry = {
    set(path, value) {
      writes.push([path, value]);
    },
  };
  const workflowClipboard = {
    set(entryName, value) {
      clipboardWrites.push([entryName, value]);
    },
  };

  await publishNodeResult({
    result: createCompletedNodeResult({
      nodeId: "parse_csv",
      output: { rows: [{ id: 1 }] },
    }),
    registry,
    workflowClipboard,
    config: {
      saveOutputAs: "variables.rows",
      saveToWorkflowClipboard: "replace",
    },
  });

  assert.deepEqual(writes.map(([path]) => path), [
    "nodes.parse_csv.output",
    "variables.rows",
  ]);
  assert.equal(clipboardWrites[0][0], "variables.rows");
});

test("disabled publication clears current and aliased output without clipboard side effects", async () => {
  const writes = [];
  let clipboardCalls = 0;
  const registry = {
    set(path, value) {
      writes.push([path, value]);
    },
  };
  const workflowClipboard = {
    append() {
      clipboardCalls += 1;
    },
  };

  await publishNodeResult({
    result: createDisabledNodeResult({ nodeId: "node_disabled" }),
    registry,
    workflowClipboard,
    config: {
      saveOutputAs: "previousResult",
      saveToWorkflowClipboard: "append",
    },
  });

  assert.deepEqual(writes, [
    ["nodes.node_disabled.output", null],
    ["variables.previousResult", null],
  ]);
  assert.equal(clipboardCalls, 0);
});

test("unsupported clipboard modes fail before publishing partial registry output", async () => {
  const writes = [];
  const registry = {
    set(path, value) {
      writes.push([path, value]);
    },
  };

  await assert.rejects(
    publishNodeResult({
      result: createCompletedNodeResult({
        nodeId: "node_append",
        output: { value: 1 },
      }),
      registry,
      workflowClipboard: {
        set() {},
      },
      config: {
        saveToWorkflowClipboard: "append",
      },
    }),
    (error) => {
      assert.equal(error.code, NodeErrorCodes.DEPENDENCY_NOT_READY);
      return true;
    },
  );
  assert.deepEqual(writes, []);
});

test("verbose log events retain full local inputs and outputs without filtering", () => {
  const inputs = {
    password: "intentionally-visible",
    headers: {
      authorization: "Bearer local-value",
    },
  };
  const output = {
    response: "complete local response",
  };
  const events = createNodeLogEvents({
    nodeId: "http_node",
    nodeType: "network.http_request",
    config: {
      displayName: "HTTP request",
      logLevel: "verbose",
    },
    inputs,
    result: createCompletedNodeResult({
      nodeId: "http_node",
      output,
      startedAt: "2026-06-30T10:15:00.000Z",
      finishedAt: "2026-06-30T10:15:00.010Z",
      executionMethod: "browser",
    }),
  });

  assert.equal(events.length, 2);
  assert.equal(events[0].inputs, inputs);
  assert.equal(events[1].output, output);
  assert.equal(
    JSON.stringify(events).includes("intentionally-visible"),
    true,
  );
  assert.equal(
    JSON.stringify(events).includes("Bearer local-value"),
    true,
  );
});

test("normal log events summarize structured values without security filtering", () => {
  const events = createNodeLogEvents({
    nodeId: "normal_node",
    config: {
      displayName: "Normal node",
      logLevel: "normal",
    },
    inputs: {
      one: 1,
      two: 2,
    },
    result: createCompletedNodeResult({
      nodeId: "normal_node",
      output: [1, 2, 3],
    }),
    retries: [{
      attempt: 2,
      reason: "timeout",
      delayMs: 100,
    }],
  });

  assert.deepEqual(events[0].inputs, {
    type: "object",
    keys: ["one", "two"],
    keyCount: 2,
  });
  assert.equal(events[1].event, "node_retry");
  assert.deepEqual(events[2].output, {
    type: "array",
    length: 3,
  });
});
