import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FinalizedNodeRoutes,
  executeFinalizedNode as executeVersionedNode,
} from "../BRunner/nodes/runtime/executeFinalizedNode.js";
import {
  NodeErrorCodes,
  NodeExecutionError,
  NodeStatuses,
} from "../BRunner/nodes/shared/nodeContracts.js";
import { RetrySafety } from "../BRunner/nodes/shared/executionPolicy.js";

function createHarness() {
  const values = {};
  const logs = [];
  let now = Date.parse("2026-07-20T12:00:00.000Z");
  return {
    values,
    logs,
    services: {
      registry: {
        set(path, value) {
          values[path] = structuredClone(value);
        },
      },
      logger(event) {
        logs.push(structuredClone(event));
      },
      clock() {
        now += 10;
        return now;
      },
      async delay() {},
    },
  };
}

function executeFinalizedNode(request, services) {
  const supplied = request.definition || {};
  const type = request.nodeType || request.node?.type || supplied.type || "test.node";
  const definition = {
    type,
    version: 1,
    outputPorts: [
      { id: "success", label: "Success" },
      { id: "error", label: "Error" },
    ],
    ...supplied,
  };
  return executeVersionedNode({
    ...request,
    nodeType: type,
    nodeVersion: request.nodeVersion ?? request.node?.version ?? definition.version,
    definition,
  }, services);
}

test("disabled finalized nodes do not execute and clear stale output", async () => {
  const harness = createHarness();
  harness.values["nodes.disabled.output"] = { stale: true };
  let executions = 0;
  const outcome = await executeFinalizedNode({
    nodeId: "disabled",
    nodeType: "browser.navigate",
    config: { enabled: false, saveOutputAs: "old_result" },
    async executor() {
      executions += 1;
    },
  }, harness.services);

  assert.equal(executions, 0);
  assert.equal(outcome.result.status, NodeStatuses.SKIPPED_DISABLED);
  assert.equal(outcome.result.output, null);
  assert.equal(harness.values["nodes.disabled.output"], null);
  assert.equal(harness.values["variables.old_result"], null);
  assert.equal(outcome.route, FinalizedNodeRoutes.Success);
});

test("finalized runtime requires invocation type and version even with a definition", async () => {
  await assert.rejects(
    executeVersionedNode({
      nodeId: "missing-contract",
      definition: { type: "test.node", version: 1, outputs: ["success"] },
      executor: async () => ({ output: true }),
    }),
    (error) => error.code === NodeErrorCodes.NodeTypeUnsupported,
  );
  await assert.rejects(
    executeVersionedNode({
      nodeId: "missing-version",
      nodeType: "test.node",
      definition: { type: "test.node", version: 1, outputs: ["success"] },
      executor: async () => ({ output: true }),
    }),
    (error) => error.code === NodeErrorCodes.NodeVersionUnsupported,
  );
});

test("disabled finalized nodes do not require an executor", async () => {
  const harness = createHarness();
  const outcome = await executeFinalizedNode({
    nodeId: "disabled-no-executor",
    nodeType: "browser.navigate",
    config: { enabled: false },
  }, harness.services);

  assert.equal(outcome.result.status, NodeStatuses.SKIPPED_DISABLED);
  assert.equal(outcome.route, FinalizedNodeRoutes.Success);
});

test("finalized runtime executes the same prepared configuration as Graph Studio", async () => {
  const harness = createHarness();
  harness.services.withTimeout = async (task) => task();
  let receivedConfig;
  const outcome = await executeFinalizedNode({
    nodeId: "typed-config",
    definition: {
      unknownConfigPolicy: "reject",
      config: [
        { key: "enabled", label: "Enabled", kind: "boolean", default: true },
        { key: "timeout", label: "Timeout", kind: "number", default: 1000, minimum: 1 },
        { key: "retryCount", label: "Retry Count", kind: "number", default: 0, integer: true, minimum: 0 },
        { key: "displayName", label: "Display Name", kind: "text", default: "Typed node" },
      ],
    },
    config: {
      timeout: "2500",
      retryCount: "2",
    },
    async executor(context) {
      receivedConfig = context.config;
      return { output: { timeout: context.config.timeout } };
    },
  }, harness.services);

  assert.equal(outcome.result.status, NodeStatuses.COMPLETED);
  assert.equal(receivedConfig.timeout, 2500);
  assert.equal(receivedConfig.retryCount, 2);
  assert.equal(receivedConfig.enabled, true);
  assert.equal(receivedConfig.displayName, "Typed node");
});

test("finalized runtime fails closed before execution on shared configuration issues", async () => {
  const harness = createHarness();
  let executions = 0;
  const outcome = await executeFinalizedNode({
    nodeId: "invalid-config",
    definition: {
      unknownConfigPolicy: "reject",
      config: [
        { key: "enabled", label: "Enabled", kind: "boolean", default: true },
        { key: "displayName", label: "Display Name", kind: "text", default: "Invalid node" },
      ],
    },
    config: {
      enabled: "yes",
      unsupported: true,
    },
    async executor() {
      executions += 1;
      return { output: "unexpected" };
    },
  }, harness.services);

  assert.equal(executions, 0);
  assert.equal(outcome.result.status, NodeStatuses.FAILED);
  assert.equal(outcome.result.errors[0].code, NodeErrorCodes.CONFIG_INVALID);
  assert.deepEqual(
    outcome.result.errors[0].details.issues.map((issue) => issue.fieldKey),
    ["config.unsupported", "enabled"],
  );
});

test("successful nodes publish structured output before returning", async () => {
  const harness = createHarness();
  const output = {
    currentUrl: "https://example.test/account",
    arbitraryLocalValue: "ordinary workflow text",
  };
  const outcome = await executeFinalizedNode({
    nodeId: "navigate",
    nodeType: "browser.navigate",
    config: {
      displayName: "Open account",
      saveOutputAs: "navigation",
      logLevel: "verbose",
    },
    inputs: { url: "https://example.test/account" },
    async executor() {
      return { output, executionMethod: "browser" };
    },
  }, harness.services);

  assert.equal(outcome.result.status, NodeStatuses.COMPLETED);
  assert.deepEqual(harness.values["nodes.navigate.output"], output);
  assert.deepEqual(harness.values["variables.navigation"], output);
  assert.equal(outcome.result.execution.executionMethod, "browser");
  assert.equal(harness.logs[0].inputs.url, "https://example.test/account");
  assert.deepEqual(harness.logs.at(-1).output, output);
});

test("safe failures retry then publish the successful attempt", async () => {
  const harness = createHarness();
  let attempts = 0;
  const outcome = await executeFinalizedNode({
    nodeId: "wait",
    nodeType: "wait.condition",
    definition: {
      retrySafety: RetrySafety.Safe,
      defaultRetryCount: 1,
    },
    config: {
      retryCount: 1,
      retryOnlyFor: ["target_not_found"],
    },
    async executor() {
      attempts += 1;
      if (attempts === 1) {
        throw new NodeExecutionError(
          NodeErrorCodes.TARGET_NOT_FOUND,
          "Not ready yet.",
        );
      }
      return { output: { conditionMet: true } };
    },
  }, harness.services);

  assert.equal(attempts, 2);
  assert.equal(outcome.result.status, NodeStatuses.COMPLETED);
  assert.equal(outcome.result.execution.attempt, 2);
  assert.equal(harness.logs.some((event) => event.event === "node_retry"), true);
});

test("exhausted retries remain present in failed node logs", async () => {
  const harness = createHarness();
  let attempts = 0;
  const outcome = await executeFinalizedNode({
    nodeId: "missing",
    nodeType: "element.resolve",
    definition: {
      retrySafety: RetrySafety.Safe,
      defaultRetryCount: 1,
      retryOnlyFor: ["target_not_found"],
    },
    async executor() {
      attempts += 1;
      throw new NodeExecutionError(
        NodeErrorCodes.TARGET_NOT_FOUND,
        "Still missing.",
      );
    },
  }, harness.services);

  assert.equal(attempts, 2);
  assert.equal(outcome.result.status, NodeStatuses.FAILED);
  assert.equal(harness.logs.some((event) => event.event === "node_retry"), true);
});

test("timeout returns a timed-out envelope and fail route", async () => {
  const harness = createHarness();
  harness.services.withTimeout = async (_task, timeout, context) => {
    throw new NodeExecutionError(
      NodeErrorCodes.TIMEOUT,
      `Timed out after ${timeout}.`,
      { attempt: context.attempt },
    );
  };
  const outcome = await executeFinalizedNode({
    nodeId: "slow",
    definition: { retrySafety: RetrySafety.Unsafe },
    config: { timeout: 5 },
    async executor() {
      return { output: "never" };
    },
  }, harness.services);

  assert.equal(outcome.result.status, NodeStatuses.TIMED_OUT);
  assert.equal(outcome.result.errors[0].code, NodeErrorCodes.TIMEOUT);
  assert.equal(outcome.route, FinalizedNodeRoutes.Fail);
  assert.equal(harness.values["nodes.slow.output"], null);
});

test("enabled timeout requires a cancellable timeout service", async () => {
  const harness = createHarness();
  let executions = 0;
  const outcome = await executeFinalizedNode({
    nodeId: "unsafe-timeout",
    definition: { retrySafety: RetrySafety.Safe },
    config: { timeout: 5, retryCount: 2 },
    async executor() {
      executions += 1;
      return { output: "unexpected" };
    },
  }, harness.services);

  assert.equal(executions, 0);
  assert.equal(outcome.result.status, NodeStatuses.FAILED);
  assert.equal(outcome.result.errors[0].code, NodeErrorCodes.DEPENDENCY_NOT_READY);
  assert.equal(outcome.result.execution.attempt, 1);
});

test("failed, timed-out, and cancelled executor envelopes follow failure routing", async () => {
  const cases = [
    [NodeStatuses.FAILED, NodeErrorCodes.TAB_NOT_FOUND, NodeStatuses.FAILED],
    [NodeStatuses.TIMED_OUT, NodeErrorCodes.TIMEOUT, NodeStatuses.TIMED_OUT],
    [NodeStatuses.CANCELLED, NodeErrorCodes.CANCELLED, NodeStatuses.CANCELLED],
  ];

  for (const [returnedStatus, code, expectedStatus] of cases) {
    const harness = createHarness();
    const outcome = await executeFinalizedNode({
      nodeId: "returned-" + returnedStatus,
      config: { onError: "error_port" },
      async executor() {
        return {
          status: returnedStatus,
          output: null,
          warnings: [],
          errors: [{ code, message: "Returned " + returnedStatus + ".", details: {} }],
          execution: { executionMethod: "browser" },
        };
      },
    }, harness.services);

    assert.equal(outcome.route, FinalizedNodeRoutes.Error);
    assert.equal(outcome.result.status, expectedStatus);
    assert.equal(outcome.result.errors[0].code, code);
    assert.equal(outcome.result.execution.executionMethod, "browser");
  }
});

test("error policy routes to an error port or continues with a warning", async () => {
  const errorHarness = createHarness();
  const errorPort = await executeFinalizedNode({
    nodeId: "error-port",
    config: { onError: "error_port" },
    async executor() {
      throw new NodeExecutionError(
        NodeErrorCodes.TAB_NOT_FOUND,
        "Tab not found.",
      );
    },
  }, errorHarness.services);
  assert.equal(errorPort.route, FinalizedNodeRoutes.Error);
  assert.equal(errorPort.result.status, NodeStatuses.FAILED);

  const warningHarness = createHarness();
  const continued = await executeFinalizedNode({
    nodeId: "continue",
    config: { onError: "continue_with_warning" },
    async executor() {
      throw new NodeExecutionError(
        NodeErrorCodes.TARGET_NOT_FOUND,
        "Optional target not found.",
      );
    },
  }, warningHarness.services);
  assert.equal(continued.route, FinalizedNodeRoutes.Success);
  assert.equal(continued.result.status, NodeStatuses.COMPLETED);
  assert.equal(continued.result.warnings[0].code, NodeErrorCodes.TARGET_NOT_FOUND);
});

test("validation runs before executor side effects", async () => {
  const harness = createHarness();
  let executions = 0;
  const outcome = await executeFinalizedNode({
    nodeId: "invalid",
    validateConfig() {
      return { valid: false, errors: ["URL is required."] };
    },
    async executor() {
      executions += 1;
    },
  }, harness.services);

  assert.equal(executions, 0);
  assert.equal(outcome.result.status, NodeStatuses.FAILED);
  assert.equal(outcome.result.errors[0].code, NodeErrorCodes.CONFIG_INVALID);
});

test("missing registry fails clearly instead of losing node output", async () => {
  const harness = createHarness();
  delete harness.services.registry;
  await assert.rejects(
    executeFinalizedNode({
      nodeId: "no-registry",
      async executor() {
        return { output: { value: 1 } };
      },
    }, harness.services),
    (error) => error.code === NodeErrorCodes.DEPENDENCY_NOT_READY,
  );
});

test("finalized dispatch rejects missing and mismatched version contracts", async () => {
  const harness = createHarness();
  await assert.rejects(
    executeVersionedNode({
      nodeId: "missing-definition",
      nodeType: "test.node",
      nodeVersion: 1,
      async executor() {},
    }, harness.services),
    (error) => error.code === NodeErrorCodes.NODE_VERSION_UNSUPPORTED,
  );
  await assert.rejects(
    executeVersionedNode({
      nodeId: "wrong-version",
      nodeType: "test.node",
      nodeVersion: 2,
      definition: { type: "test.node", version: 1, outputPorts: [] },
      async executor() {},
    }, harness.services),
    (error) => error.code === NodeErrorCodes.NODE_VERSION_UNSUPPORTED,
  );
});

test("error-port policy fails closed when the definition has no error port", async () => {
  const harness = createHarness();
  const outcome = await executeVersionedNode({
    nodeId: "missing-error-port",
    nodeType: "test.node",
    nodeVersion: 1,
    definition: {
      type: "test.node",
      version: 1,
      outputPorts: [{ id: "success", label: "Success" }],
    },
    config: { onError: "error_port" },
    async executor() {
      throw new NodeExecutionError(NodeErrorCodes.ValidationFailed, "Failed.");
    },
  }, harness.services);

  assert.equal(outcome.route, FinalizedNodeRoutes.Fail);
  assert.equal(outcome.selectedRoute, FinalizedNodeRoutes.Fail);
  assert.equal(outcome.handledError, false);
});

test("a finalized node may route a preserved mapper failure to unresolved", async () => {
  const harness = createHarness();
  const mapperError = new Error("Mapped component is ambiguous.");
  mapperError.diagnostics = {
    mapperState: "ambiguous",
    finalReason: "mapper_ambiguous",
  };
  const outcome = await executeVersionedNode({
    nodeId: "scroll-unresolved",
    nodeType: "browser.scroll",
    nodeVersion: 2,
    definition: {
      type: "browser.scroll",
      version: 2,
      outputPorts: [
        { id: "success", label: "Success" },
        { id: "error", label: "Error" },
        { id: "unresolved", label: "Unresolved" },
      ],
    },
    selectFailureRoute(error) {
      return error?.diagnostics?.mapperState
        ? FinalizedNodeRoutes.Unresolved
        : null;
    },
    async executor() {
      throw mapperError;
    },
  }, harness.services);

  assert.equal(outcome.route, FinalizedNodeRoutes.Unresolved);
  assert.equal(outcome.selectedRoute, FinalizedNodeRoutes.Unresolved);
  assert.equal(outcome.routeError.diagnostics.mapperState, "ambiguous");
  assert.equal(outcome.result.status, NodeStatuses.FAILED);
});

test("custom failure routes fail closed when the definition omits the port", async () => {
  const harness = createHarness();
  const outcome = await executeVersionedNode({
    nodeId: "missing-unresolved-port",
    nodeType: "test.node",
    nodeVersion: 1,
    definition: {
      type: "test.node",
      version: 1,
      outputPorts: [{ id: "success", label: "Success" }],
    },
    selectFailureRoute() {
      return FinalizedNodeRoutes.Unresolved;
    },
    async executor() {
      throw new NodeExecutionError(
        NodeErrorCodes.TargetNotFound,
        "Target missing.",
      );
    },
  }, harness.services);

  assert.equal(outcome.route, FinalizedNodeRoutes.Fail);
  assert.equal(outcome.routeError, undefined);
});
