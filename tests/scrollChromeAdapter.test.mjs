import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NodeErrorCodes,
  NodeExecutionError,
} from "../BRunner/nodes/shared/nodeContracts.js";
import {
  SideEffectStates,
} from "../BRunner/nodes/shared/executionPolicy.js";
import {
  ScrollErrorCodes,
  ScrollExecutionMethods,
  ScrollOperations,
  ScrollStopConditions,
  ScrollStopReasons,
  createChromeScrollAdapter,
  normalizeScrollConfig,
} from "../BRunner/nodes/navigation/scroll/index.js";

const tab = Object.freeze({
  id: 7,
  windowId: 3,
  url: "https://example.test/results",
});

test("Scroll adapter performs one verified browser amount action", async () => {
  const calls = [];
  const adapter = createChromeScrollAdapter({
    async executeBrowser(request) {
      calls.push(request);
      return {
        moved: true,
        finalPosition: position(500, 2000),
      };
    },
  });
  const result = await adapter.perform({
    config: normalizeScrollConfig({}),
    tab,
  });

  assert.equal(result.ok, true);
  assert.equal(result.executionMethod, ScrollExecutionMethods.Browser);
  assert.equal(result.value.scrollCount, 1);
  assert.equal(result.value.stopReason, ScrollStopReasons.AmountComplete);
  assert.equal(calls.length, 1);
});

test("Scroll adapter reports a boundary no-op without retrying movement", async () => {
  let calls = 0;
  const adapter = createChromeScrollAdapter({
    async executeBrowser() {
      calls += 1;
      return {
        moved: false,
        finalPosition: position(1000, 1000),
      };
    },
  });
  const result = await adapter.perform({
    config: normalizeScrollConfig({
      operation: ScrollOperations.ByAmount,
    }),
    tab,
  });

  assert.equal(result.value.stopReason, ScrollStopReasons.NoMovement);
  assert.equal(result.value.scrollCount, 1);
  assert.equal(calls, 1);
});

test("Scroll adapter loops until a safe condition is met", async () => {
  let calls = 0;
  const delays = [];
  const contentWaits = [];
  const adapter = createChromeScrollAdapter({
    async executeBrowser() {
      calls += 1;
      return {
        moved: true,
        conditionMet: calls === 3,
        contentToken: `content-${calls}`,
        finalPosition: position(calls * 200, 1000),
      };
    },
    async waitForContent(request) {
      contentWaits.push(request.previousContentToken);
    },
    async delay(ms) {
      delays.push(ms);
    },
  });
  const result = await adapter.perform({
    config: normalizeScrollConfig({
      operation: ScrollOperations.UntilCondition,
      stopCondition: ScrollStopConditions.TextPresent,
      stopValue: "All results loaded",
      maxAttempts: 5,
      pauseBetweenScrolls: 25,
      waitForContentAfterEachScroll: true,
    }),
    tab,
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.scrollCount, 3);
  assert.equal(result.value.stopReason, ScrollStopReasons.ConditionMet);
  assert.deepEqual(delays, [25, 25]);
  assert.deepEqual(contentWaits, ["content-1", "content-2"]);
});

test("Scroll adapter stops at its configured attempt limit", async () => {
  let calls = 0;
  const adapter = createChromeScrollAdapter({
    async executeBrowser() {
      calls += 1;
      return {
        moved: true,
        conditionMet: false,
        finalPosition: position(calls * 100, 5000),
      };
    },
    async delay() {},
  });
  const result = await adapter.perform({
    config: normalizeScrollConfig({
      operation: ScrollOperations.UntilCondition,
      maxAttempts: 2,
      pauseBetweenScrolls: 0,
    }),
    tab,
  });

  assert.equal(calls, 2);
  assert.equal(result.value.scrollCount, 2);
  assert.equal(result.value.stopReason, ScrollStopReasons.MaxAttempts);
});

test("Scroll adapter uses one foreground-verified host fallback", async () => {
  let hostCalls = 0;
  const adapter = createChromeScrollAdapter({
    hostStatus: {
      connected: true,
      capabilities: ["host.window", "host.action"],
    },
    async executeBrowser() {
      return {
        ok: false,
        error: new NodeExecutionError(
          ScrollErrorCodes.ScrollFailed,
          "browser blocked",
          { sideEffectState: SideEffectStates.NotCompleted },
        ),
        sideEffectState: SideEffectStates.NotCompleted,
      };
    },
    async prepareHostFallback() {
      return {
        foregroundReady: true,
        targetVisible: true,
        sideEffectState: SideEffectStates.NotCompleted,
      };
    },
    async executeHost() {
      hostCalls += 1;
      return {
        verified: true,
        moved: true,
        finalPosition: position(400, 1000),
      };
    },
  });
  const result = await adapter.perform({
    config: normalizeScrollConfig({
      useHostFallback: true,
    }),
    tab,
  });

  assert.equal(result.ok, true);
  assert.equal(result.executionMethod, ScrollExecutionMethods.Host);
  assert.equal(result.value.finalPosition.y, 400);
  assert.equal(hostCalls, 1);
});

test("Scroll adapter blocks host fallback after an uncertain browser side effect", async () => {
  let hostCalls = 0;
  const adapter = createChromeScrollAdapter({
    hostStatus: {
      connected: true,
      capabilities: ["host.window", "host.action"],
    },
    async executeBrowser() {
      return {
        ok: false,
        error: new NodeExecutionError(
          ScrollErrorCodes.ScrollFailed,
          "browser state unknown",
          { sideEffectState: SideEffectStates.Unknown },
        ),
        sideEffectState: SideEffectStates.Unknown,
      };
    },
    async prepareHostFallback() {
      return {
        foregroundReady: true,
        targetVisible: true,
        sideEffectState: SideEffectStates.Unknown,
      };
    },
    async executeHost() {
      hostCalls += 1;
      return { verified: true, finalPosition: position(100, 1000) };
    },
  });
  const result = await adapter.perform({
    config: normalizeScrollConfig({ useHostFallback: true }),
    tab,
  });

  assert.equal(result.ok, false);
  assert.equal(hostCalls, 0);
  assert.equal(result.sideEffectState, SideEffectStates.Unknown);
});

test("Scroll adapter honors cancellation between bounded attempts", async () => {
  let cancelled = false;
  const adapter = createChromeScrollAdapter({
    async executeBrowser() {
      return {
        moved: true,
        conditionMet: false,
        finalPosition: position(100, 1000),
      };
    },
    async delay() {
      cancelled = true;
    },
  });

  await assert.rejects(
    adapter.perform({
      config: normalizeScrollConfig({
        operation: ScrollOperations.UntilCondition,
        maxAttempts: 3,
        pauseBetweenScrolls: 1,
      }),
      tab,
    }, {
      isCancelled: () => cancelled,
    }),
    (error) => error.code === NodeErrorCodes.Cancelled,
  );
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
