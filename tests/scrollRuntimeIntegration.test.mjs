import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FinalizedNodeRoutes,
  executeFinalizedNode,
} from "../BRunner/nodes/runtime/executeFinalizedNode.js";
import {
  NodeErrorCodes,
  NodeExecutionError,
  NodeStatuses,
} from "../BRunner/nodes/shared/nodeContracts.js";
import {
  createContainerNotReadyError,
  executeScroll,
  scrollNodeDefinition,
  validateScrollConfig,
  verifyScrollBeforeRetry,
} from "../BRunner/nodes/navigation/scroll/index.js";

function createHarness(overrides = {}) {
  const values = {};
  const logs = [];
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
      async delay() {},
      async withTimeout(task) {
        return await task();
      },
      ...overrides,
    },
  };
}

function pageConfig(overrides = {}) {
  return {
    operation: "by_amount",
    scrollTarget: "page",
    direction: "down",
    amount: 200,
    amountUnit: "pixels",
    retryCount: 1,
    retryOnlyFor: "container_not_ready",
    timeout: 2000,
    ...overrides,
  };
}

function telemetry(overrides = {}) {
  return {
    operation: "by_amount",
    scrollCount: 1,
    finalPosition: {
      x: 0,
      y: 200,
      maxX: 0,
      maxY: 1500,
      atStart: false,
      atEnd: false,
    },
    stopReason: "amount_complete",
    executionMethod: "browser",
    ...overrides,
  };
}

function runScroll({
  nodeId = "scroll",
  config = pageConfig(),
  tab = { id: 12, url: "https://example.test/fixture" },
  target = null,
  scroll,
  harness,
  selectFailureRoute,
}) {
  return executeFinalizedNode({
    node: {
      id: nodeId,
      type: "browser.scroll",
      version: 2,
      config,
      data: target ? { target } : {},
    },
    nodeId,
    nodeType: "browser.scroll",
    nodeVersion: 2,
    definition: scrollNodeDefinition,
    config,
    validateConfig: (preparedConfig) => validateScrollConfig(preparedConfig, {
      target,
    }),
    executor: (context) => executeScroll({
      ...context,
      tab,
      target,
    }),
    verifyBeforeRetry: ({ error }) => verifyScrollBeforeRetry({ error }),
    selectFailureRoute,
  }, {
    ...harness.services,
    scroll,
  });
}

test("finalized Scroll runtime publishes typed output and structural logs", async () => {
  const harness = createHarness();
  let calls = 0;
  const outcome = await runScroll({
    harness,
    scroll: {
      async perform() {
        calls += 1;
        return { ok: true, value: telemetry(), executionMethod: "browser" };
      },
    },
  });

  assert.equal(calls, 1);
  assert.equal(outcome.route, FinalizedNodeRoutes.Success);
  assert.equal(outcome.result.status, NodeStatuses.Completed);
  assert.deepEqual(harness.values["nodes.scroll.output"], telemetry());
  assert.equal(harness.logs[0].event, "node_started");
  assert.equal(harness.logs.at(-1).event, "node_completed");
  assert.equal(
    harness.logs.at(-1).output.keys.includes("finalPosition"),
    true,
  );
});

test("disabled and protected finalized Scroll paths never invoke movement", async () => {
  for (const [nodeId, config, tab, expectedStatus, expectedCode] of [
    [
      "disabled-scroll",
      pageConfig({ enabled: false }),
      { id: 12, url: "https://example.test/fixture" },
      NodeStatuses.SkippedDisabled,
      null,
    ],
    [
      "protected-scroll",
      pageConfig(),
      { id: 12, url: "chrome://settings/" },
      NodeStatuses.Failed,
      NodeErrorCodes.ProtectedPage,
    ],
  ]) {
    const harness = createHarness();
    let calls = 0;
    const outcome = await runScroll({
      nodeId,
      config,
      tab,
      harness,
      scroll: {
        async perform() {
          calls += 1;
          return { ok: true, value: telemetry() };
        },
      },
    });
    assert.equal(calls, 0);
    assert.equal(outcome.result.status, expectedStatus);
    if (expectedCode) {
      assert.equal(outcome.result.errors[0].code, expectedCode);
      assert.equal(outcome.route, FinalizedNodeRoutes.Fail);
    } else {
      assert.equal(outcome.route, FinalizedNodeRoutes.Success);
    }
  }
});

test("finalized Scroll retries only a pre-movement container readiness failure", async () => {
  const harness = createHarness();
  let calls = 0;
  const target = {
    identifierType: "css",
    identifierValue: "#scroll-panel",
  };
  const outcome = await runScroll({
    config: pageConfig({ scrollTarget: "container" }),
    target,
    harness,
    scroll: {
      async perform() {
        calls += 1;
        if (calls === 1) throw createContainerNotReadyError();
        return { ok: true, value: telemetry() };
      },
    },
  });

  assert.equal(calls, 2);
  assert.equal(outcome.result.status, NodeStatuses.Completed);
  assert.equal(outcome.result.execution.attempt, 2);
  assert.equal(
    harness.logs.some((event) => event.event === "node_retry"),
    true,
  );
});

test("finalized Scroll timeout and mapper-unresolved routes retain diagnostics", async () => {
  const timeoutHarness = createHarness({
    async withTimeout() {
      throw new NodeExecutionError(
        NodeErrorCodes.Timeout,
        "Scroll timed out.",
      );
    },
  });
  const timedOut = await runScroll({
    harness: timeoutHarness,
    scroll: {
      async perform() {
        return { ok: true, value: telemetry() };
      },
    },
  });
  assert.equal(timedOut.result.status, NodeStatuses.TimedOut);
  assert.equal(timedOut.route, FinalizedNodeRoutes.Fail);

  const unresolvedHarness = createHarness();
  const mapperError = new Error("Mapped container is ambiguous.");
  mapperError.diagnostics = {
    mapperState: "ambiguous",
    finalReason: "mapper_ambiguous",
  };
  const unresolved = await runScroll({
    config: pageConfig({ scrollTarget: "container", retryCount: 0 }),
    target: {
      identifierType: "css",
      identifierValue: "#results-panel",
    },
    harness: unresolvedHarness,
    scroll: {
      async perform() {
        throw mapperError;
      },
    },
    selectFailureRoute(error) {
      return error?.diagnostics?.mapperState
        ? FinalizedNodeRoutes.Unresolved
        : null;
    },
  });
  assert.equal(unresolved.route, FinalizedNodeRoutes.Unresolved);
  assert.equal(unresolved.routeError.diagnostics.mapperState, "ambiguous");
  assert.equal(unresolved.result.status, NodeStatuses.Failed);
});
