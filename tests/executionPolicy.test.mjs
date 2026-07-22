import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HostClassifications,
  HostFallbackTriggers,
  HostStatusTags,
  RetrySafety,
  SideEffectStates,
  executeBrowserFirst,
  executeWithRetry,
  normalizeHostFallbackPolicy,
  normalizeRetryPolicy,
  planHostFallback,
  projectHostStatusTag,
  retryDelayMs,
  shouldRetry,
} from "../BRunner/nodes/shared/executionPolicy.js";
import {
  NodeErrorCodes,
  NodeExecutionError,
} from "../BRunner/nodes/shared/nodeContracts.js";

test("retry policy supports fixed and increasing delays", () => {
  const fixed = normalizeRetryPolicy({
    retryCount: 2,
    retryDelay: 25,
    retryStrategy: "fixed",
  }, {
    retrySafety: RetrySafety.Safe,
  });
  assert.equal(retryDelayMs(2, fixed), 25);

  const increasing = normalizeRetryPolicy({
    retryCount: 2,
    retryDelay: 25,
    retryStrategy: "increasing",
  }, {
    retrySafety: RetrySafety.Safe,
  });
  assert.equal(retryDelayMs(2, increasing), 50);
});

test("retry filtering and safety prevent unsafe repeats", () => {
  const safe = normalizeRetryPolicy({
    retryCount: 1,
    retryOnlyFor: ["timeout"],
  }, {
    retrySafety: RetrySafety.Safe,
  });
  assert.equal(shouldRetry({
    attempt: 1,
    error: { code: NodeErrorCodes.Timeout },
    policy: safe,
  }), true);
  assert.equal(shouldRetry({
    attempt: 1,
    error: { code: NodeErrorCodes.HostUnavailable },
    policy: safe,
  }), false);

  const verify = normalizeRetryPolicy({ retryCount: 1 }, {
    retrySafety: RetrySafety.VerifyBeforeRetry,
  });
  assert.equal(shouldRetry({
    attempt: 1,
    error: { code: NodeErrorCodes.Timeout },
    policy: verify,
    sideEffectState: SideEffectStates.Unknown,
  }), false);
  assert.equal(shouldRetry({
    attempt: 1,
    error: { code: NodeErrorCodes.Timeout },
    policy: verify,
    sideEffectState: SideEffectStates.NotCompleted,
  }), true);
});

test("cancelled, protected, invalid, and exhausted attempts never retry", () => {
  const policy = normalizeRetryPolicy({ retryCount: 3 }, {
    retrySafety: RetrySafety.Safe,
  });
  for (const code of [
    NodeErrorCodes.Cancelled,
    NodeErrorCodes.ProtectedPage,
    NodeErrorCodes.ConfigInvalid,
    NodeErrorCodes.ValidationFailed,
  ]) {
    assert.equal(shouldRetry({
      attempt: 1,
      error: { code },
      policy,
    }), false);
  }
  assert.equal(shouldRetry({
    attempt: 4,
    error: { code: NodeErrorCodes.Timeout },
    policy,
  }), false);
});

test("executeWithRetry reports attempts and retry reason", async () => {
  let executions = 0;
  const retryEvents = [];
  const delays = [];
  const result = await executeWithRetry(async () => {
    executions += 1;
    if (executions === 1) {
      throw new NodeExecutionError(NodeErrorCodes.Timeout, "not ready");
    }
    return "ready";
  }, {
    policy: { retryCount: 1, retryDelay: 10 },
    definition: { retrySafety: RetrySafety.Safe },
    delay: async (ms) => delays.push(ms),
    onRetry: async (event) => retryEvents.push(event),
  });

  assert.deepEqual(result, { value: "ready", attempts: 2 });
  assert.deepEqual(delays, [10]);
  assert.equal(retryEvents[0].retryReason, "timeout");
});

test("host status projection uses the exact blueprint tags", () => {
  const assisted = normalizeHostFallbackPolicy({ useHostFallback: true }, {
    hostClassification: HostClassifications.Assisted,
    hostCapabilities: ["host.action"],
  });
  assert.equal(projectHostStatusTag({
    policy: assisted,
    hostStatus: { connected: true, capabilities: ["host.action"] },
  }), HostStatusTags.FallbackAvailable);
  assert.equal(projectHostStatusTag({
    policy: assisted,
    hostStatus: { connected: false },
  }), HostStatusTags.FallbackUnavailable);
  assert.equal(projectHostStatusTag({
    policy: { ...assisted, useHostFallback: false },
    hostStatus: { connected: true },
  }), HostStatusTags.FallbackOff);
  assert.equal(projectHostStatusTag({
    policy: { hostClassification: HostClassifications.Required },
    hostStatus: { connected: true },
  }), HostStatusTags.RequiredConnected);
  assert.equal(projectHostStatusTag({
    policy: assisted,
    hostStatus: { connected: true },
    inProgress: true,
  }), HostStatusTags.ActionInProgress);
});

test("host planning handles unavailable routes and foreground enforcement", () => {
  const base = {
    hostClassification: HostClassifications.Assisted,
    useHostFallback: true,
    fallbackTrigger: HostFallbackTriggers.BrowserActionFailed,
  };
  const unavailable = planHostFallback({
    policy: { ...base, ifHostUnavailable: "error_path" },
    hostStatus: { connected: false },
    sideEffectState: SideEffectStates.NotCompleted,
    foregroundReady: true,
    targetVisible: true,
  });
  assert.equal(unavailable.attempt, false);
  assert.equal(unavailable.route, "error");
  assert.equal(unavailable.error.code, NodeErrorCodes.HostUnavailable);

  const background = planHostFallback({
    policy: base,
    hostStatus: { connected: true },
    sideEffectState: SideEffectStates.NotCompleted,
    foregroundReady: false,
    targetVisible: true,
  });
  assert.equal(background.error.code, NodeErrorCodes.HostForegroundRequired);
});

test("browser-first execution uses a verified host fallback once", async () => {
  let browserCalls = 0;
  let hostCalls = 0;
  const result = await executeBrowserFirst({
    policy: {
      hostClassification: HostClassifications.Assisted,
      useHostFallback: true,
      fallbackTrigger: HostFallbackTriggers.BrowserActionFailed,
    },
    hostStatus: { connected: true },
    async browser() {
      browserCalls += 1;
      return {
        ok: false,
        sideEffectState: SideEffectStates.NotCompleted,
      };
    },
    async verifyBrowser() {
      return {
        ok: false,
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
    async host() {
      hostCalls += 1;
      return { ok: true, value: "clicked" };
    },
    async verifyHost() {
      return { ok: true };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.executionMethod, "host");
  assert.equal(result.value, "clicked");
  assert.equal(browserCalls, 1);
  assert.equal(hostCalls, 1);
});

test("browser and host success require verification when policy enables it", async () => {
  const unverifiedBrowser = await executeBrowserFirst({
    policy: { hostClassification: HostClassifications.None },
    async browser() {
      return { ok: true, value: "changed" };
    },
  });
  assert.equal(unverifiedBrowser.ok, false);
  assert.equal(
    unverifiedBrowser.browserVerification.reason,
    "browser_verification_unavailable",
  );

  const unverifiedHost = await executeBrowserFirst({
    policy: {
      hostClassification: HostClassifications.Assisted,
      useHostFallback: true,
    },
    hostStatus: { connected: true },
    async browser() {
      return {
        ok: false,
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
    async host() {
      return { ok: true };
    },
  });
  assert.equal(unverifiedHost.ok, false);
  assert.equal(
    unverifiedHost.hostVerification.reason,
    "host_verification_unavailable",
  );
});

test("uncertain browser side effects block duplicate host action", async () => {
  let hostCalls = 0;
  const result = await executeBrowserFirst({
    policy: {
      hostClassification: HostClassifications.Assisted,
      useHostFallback: true,
    },
    hostStatus: { connected: true },
    async browser() {
      return {
        ok: false,
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
    async host() {
      hostCalls += 1;
      return { ok: true };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(hostCalls, 0);
  assert.equal(
    result.hostPlan.reason,
    "browser_side_effect_completion_unknown",
  );
});

test("coordinate-required fallback may run before a browser side effect", async () => {
  let hostCalls = 0;
  const result = await executeBrowserFirst({
    policy: {
      hostClassification: HostClassifications.Assisted,
      useHostFallback: true,
      fallbackTrigger: HostFallbackTriggers.CoordinateActionRequired,
    },
    hostStatus: { connected: true },
    async browser() {
      return {
        ok: false,
        trigger: HostFallbackTriggers.CoordinateActionRequired,
        sideEffectState: SideEffectStates.NotStarted,
      };
    },
    async prepareHostFallback() {
      return {
        trigger: HostFallbackTriggers.CoordinateActionRequired,
        foregroundReady: true,
        targetVisible: true,
      };
    },
    async host() {
      hostCalls += 1;
      return { ok: true };
    },
    async verifyHost() {
      return { ok: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(hostCalls, 1);
});
