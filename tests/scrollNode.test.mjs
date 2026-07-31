import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NodeErrorCodes,
  NodeExecutionError,
} from "../BRunner/nodes/shared/nodeContracts.js";
import {
  RetryReasons,
  SideEffectStates,
} from "../BRunner/nodes/shared/executionPolicy.js";
import {
  ScrollAmountUnits,
  ScrollDirections,
  ScrollErrorCodes,
  ScrollExecutionMethods,
  ScrollOperations,
  ScrollStopConditions,
  ScrollStopReasons,
  ScrollTargets,
  buildScrollOutput,
  createContainerNotReadyError,
  executeScroll,
  normalizeScrollConfig,
  scrollNodeDefinition,
  validateScrollConfig,
  verifyScrollBeforeRetry,
} from "../BRunner/nodes/navigation/scroll/index.js";

const cssTarget = Object.freeze({
  identifierType: "css",
  identifierValue: "#scroll-panel",
});

test("Scroll definition freezes the exact versioned package contract", () => {
  assert.equal(scrollNodeDefinition.type, "browser.scroll");
  assert.equal(scrollNodeDefinition.version, 2);
  assert.equal(scrollNodeDefinition.catalogNumber, 2);
  assert.equal(scrollNodeDefinition.contractKind, "finalized");
  assert.equal(scrollNodeDefinition.targetSupported, true);
  assert.equal(scrollNodeDefinition.targetRequired, false);
  assert.deepEqual(
    scrollNodeDefinition.outputPorts.map((port) => port.id),
    ["success", "error", "unresolved"],
  );
  assert.equal(scrollNodeDefinition.retrySafety, "verify_before_retry");
  assert.deepEqual(scrollNodeDefinition.retryOnlyFor, [
    RetryReasons.ContainerNotReady,
  ]);
  assert.equal(scrollNodeDefinition.hostClassification, "host_assisted");
  assert.deepEqual(scrollNodeDefinition.hostCapabilities, [
    "host.window",
    "host.action",
  ]);
  assert.equal(
    scrollNodeDefinition.errorCodes[ScrollErrorCodes.ContainerNotReady],
    "target",
  );
  assert.equal(Object.isFrozen(scrollNodeDefinition), true);
  assert.equal(scrollNodeDefinition.configSchema.length >= 25, true);
  for (const field of scrollNodeDefinition.configSchema) {
    assert.equal(Boolean(field.help), true, `${field.key} help`);
    assert.equal(Boolean(field.example), true, `${field.key} example`);
    assert.equal(Boolean(field.placeholder), true, `${field.key} placeholder`);
    assert.equal(Boolean(field.expressionMode), true, `${field.key} expression mode`);
    assert.equal(Array.isArray(field.autocompleteSources), true);
  }
});

test("Scroll configuration normalizes fixed page movement", () => {
  const config = normalizeScrollConfig({
    operation: ScrollOperations.ByAmount,
    scrollTarget: ScrollTargets.Page,
    direction: ScrollDirections.Right,
    amount: "40",
    amountUnit: ScrollAmountUnits.ViewportPercent,
    smooth: true,
    timeout: 5000,
  });

  assert.equal(config.operation, ScrollOperations.ByAmount);
  assert.equal(config.direction, ScrollDirections.Right);
  assert.equal(config.amount, 40);
  assert.equal(config.amountUnit, ScrollAmountUnits.ViewportPercent);
  assert.equal(config.smooth, true);
  assert.deepEqual(config.retryOnlyFor, [RetryReasons.ContainerNotReady]);
});

test("Scroll requires a canonical target for container and element modes", () => {
  assert.throws(
    () => normalizeScrollConfig({
      operation: ScrollOperations.ByAmount,
      scrollTarget: ScrollTargets.Container,
    }),
    (error) =>
      error.code === NodeErrorCodes.ConfigInvalid &&
      /target container/.test(error.message),
  );
  assert.throws(
    () => normalizeScrollConfig({
      operation: ScrollOperations.ToElement,
      scrollTarget: ScrollTargets.Page,
    }),
    (error) =>
      error.code === NodeErrorCodes.ConfigInvalid &&
      /target element/.test(error.message),
  );

  const container = normalizeScrollConfig({
    operation: ScrollOperations.ToBottom,
    scrollTarget: ScrollTargets.Container,
  }, { target: cssTarget });
  assert.equal(container.scrollTarget, ScrollTargets.Container);

  const element = normalizeScrollConfig({
    operation: ScrollOperations.ToElement,
  }, { target: cssTarget });
  assert.equal(element.operation, ScrollOperations.ToElement);
});

test("Scroll until-condition validation is bounded and never accepts script", () => {
  assert.throws(
    () => normalizeScrollConfig({
      operation: ScrollOperations.UntilCondition,
      stopCondition: ScrollStopConditions.SelectorVisible,
      stopValue: "",
    }),
    (error) =>
      error.code === NodeErrorCodes.ConfigInvalid &&
      error.details?.field === "stopValue",
  );
  assert.throws(
    () => normalizeScrollConfig({
      operation: ScrollOperations.UntilCondition,
      maxAttempts: 101,
    }),
    (error) =>
      error.code === NodeErrorCodes.ConfigInvalid &&
      error.details?.field === "maxAttempts",
  );
  assert.throws(
    () => normalizeScrollConfig({
      operation: ScrollOperations.UntilCondition,
      stopCondition: "javascript",
      stopValue: "window.done",
    }),
    (error) => error.code === NodeErrorCodes.ConfigInvalid,
  );
});

test("Scroll preflight preserves expressions while resolved validation stays strict", () => {
  const source = {
    operation: ScrollOperations.ByAmount,
    amount: "{{ variables.distance }}",
    timeout: "{{ variables.timeoutMs }}",
    retryDelay: "{{ variables.retryDelay }}",
  };
  const preflight = validateScrollConfig(source, { allowExpressions: true });
  assert.equal(preflight.valid, true);
  assert.deepEqual(preflight.config, source);
  assert.equal(validateScrollConfig(source).valid, false);
});

test("Scroll output builder enforces the frozen position and stop contract", () => {
  const output = buildScrollOutput({
    operation: ScrollOperations.ToBottom,
    scrollCount: 1,
    finalPosition: {
      x: 0,
      y: 900,
      maxX: 0,
      maxY: 900,
      atStart: false,
      atEnd: true,
    },
    stopReason: ScrollStopReasons.BottomReached,
    executionMethod: ScrollExecutionMethods.Browser,
  });
  assert.equal(output.finalPosition.atEnd, true);
  assert.equal(Object.isFrozen(output.finalPosition), true);

  assert.throws(
    () => buildScrollOutput({
      ...output,
      stopReason: "invented",
    }),
    (error) => error.code === NodeErrorCodes.ValidationFailed,
  );
});

test("Scroll executor publishes browser telemetry through the stable output", async () => {
  const calls = [];
  const result = await executeScroll({
    config: {
      operation: ScrollOperations.ByAmount,
      direction: ScrollDirections.Down,
      amount: 300,
    },
    tab: { id: 4, url: "https://example.test/results" },
    services: {
      scroll: {
        async perform(request, runtime) {
          calls.push({ request, runtime });
          return {
            ok: true,
            value: {
              scrollCount: 1,
              finalPosition: position(300, 900),
              stopReason: ScrollStopReasons.AmountComplete,
            },
            executionMethod: ScrollExecutionMethods.Browser,
          };
        },
      },
    },
    nodeId: "scroll-results",
    attempt: 1,
  });

  assert.equal(result.output.operation, ScrollOperations.ByAmount);
  assert.equal(result.output.finalPosition.y, 300);
  assert.equal(result.output.executionMethod, ScrollExecutionMethods.Browser);
  assert.equal(calls[0].request.tab.id, 4);
});

test("Scroll executor fails closed on protected pages and unavailable services", async () => {
  await assert.rejects(
    executeScroll({
      config: {},
      tab: { id: 2, url: "chrome://settings/" },
      services: { scroll: { perform() {} } },
    }),
    (error) => error.code === NodeErrorCodes.ProtectedPage,
  );
  await assert.rejects(
    executeScroll({
      config: {},
      tab: { id: 2, url: "https://example.test/" },
      services: {},
    }),
    (error) => error.code === NodeErrorCodes.DependencyNotReady,
  );
});

test("Scroll maps raw adapter failures to a stable node-specific error", async () => {
  await assert.rejects(
    executeScroll({
      config: {},
      tab: { id: 2, url: "https://example.test/" },
      services: {
        scroll: {
          async perform() {
            throw new Error("unbounded browser detail");
          },
        },
      },
    }),
    (error) =>
      error.code === ScrollErrorCodes.ScrollFailed &&
      error.category === "node_specific" &&
      error.details?.retryable === false,
  );
});

test("Scroll retry verification permits only pre-movement container readiness", async () => {
  const eligible = createContainerNotReadyError({
    sideEffectState: SideEffectStates.NotStarted,
  });
  const retry = await verifyScrollBeforeRetry({ error: eligible });
  assert.deepEqual(retry, {
    sideEffectState: SideEffectStates.NotCompleted,
    result: "not_completed",
  });
  assert.equal(
    eligible.details.retryReason,
    RetryReasons.ContainerNotReady,
  );

  const blocked = await verifyScrollBeforeRetry({
    error: new NodeExecutionError(
      ScrollErrorCodes.ScrollFailed,
      "failed after movement",
      { sideEffectState: SideEffectStates.Unknown },
    ),
  });
  assert.equal(blocked.sideEffectState, SideEffectStates.Unknown);
});

function position(y, maxY) {
  return {
    x: 0,
    y,
    maxX: 0,
    maxY,
    atStart: y === 0,
    atEnd: y === maxY,
  };
}
