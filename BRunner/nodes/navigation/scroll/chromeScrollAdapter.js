import {
  HostClassifications,
  HostFallbackTriggers,
  SideEffectStates,
  executeBrowserFirst,
} from "../../shared/executionPolicy.js";
import {
  NodeErrorCodes,
  NodeExecutionError,
} from "../../shared/nodeContracts.js";
import {
  ScrollExecutionMethods,
  ScrollOperations,
  ScrollStopConditions,
  ScrollStopReasons,
} from "./definition.js";

export function createChromeScrollAdapter(options = {}) {
  if (typeof options.executeBrowser !== "function") {
    throw new TypeError("Scroll adapter requires executeBrowser.");
  }

  return Object.freeze({
    async perform(request = {}, runtime = {}) {
      const config = request.config || {};
      const attempts = config.operation === ScrollOperations.UntilCondition
        ? config.maxAttempts
        : 1;
      let scrollCount = 0;
      let finalPosition = null;
      let executionMethod = ScrollExecutionMethods.Browser;

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        throwIfCancelled(runtime);
        const action = await performOne(options, request, runtime, attempt);
        if (!action.ok) return action;

        const value = action.value || {};
        finalPosition = value.finalPosition || value.position || finalPosition;
        scrollCount += Number.isInteger(Number(value.scrollCount))
          ? Number(value.scrollCount)
          : 1;
        if (action.executionMethod === ScrollExecutionMethods.Host) {
          executionMethod = ScrollExecutionMethods.Host;
        }

        if (config.operation !== ScrollOperations.UntilCondition) {
          return {
            ok: true,
            value: {
              operation: config.operation,
              scrollCount,
              finalPosition,
              stopReason: value.stopReason || defaultStopReason(config.operation, value),
            },
            executionMethod,
          };
        }

        if (value.conditionMet === true) {
          return {
            ok: true,
            value: {
              operation: config.operation,
              scrollCount,
              finalPosition,
              stopReason:
                value.stopReason ||
                conditionStopReason(config.stopCondition),
            },
            executionMethod,
          };
        }
        if (value.moved === false) {
          return {
            ok: true,
            value: {
              operation: config.operation,
              scrollCount,
              finalPosition,
              stopReason:
                value.stopReason ||
                noMovementStopReason(config.stopCondition),
            },
            executionMethod,
          };
        }

        if (
          config.waitForContentAfterEachScroll &&
          typeof options.waitForContent === "function"
        ) {
          await options.waitForContent({
            ...request,
            attempt,
            previousContentToken: value.contentToken,
          }, runtime);
          throwIfCancelled(runtime);
        }
        if (attempt < attempts && config.pauseBetweenScrolls > 0) {
          await requireDelay(options.delay)(config.pauseBetweenScrolls, runtime);
          throwIfCancelled(runtime);
        }
      }

      return {
        ok: true,
        value: {
          operation: config.operation,
          scrollCount,
          finalPosition,
          stopReason: ScrollStopReasons.MaxAttempts,
        },
        executionMethod,
      };
    },
  });
}

async function performOne(options, request, runtime, attempt) {
  const config = request.config || {};
  const hostStatus = typeof options.getHostStatus === "function"
    ? await options.getHostStatus(request, runtime)
    : options.hostStatus || {};
  const outcome = await executeBrowserFirst({
    policy: {
      ...config,
      hostClassification: HostClassifications.Assisted,
      fallbackTrigger: HostFallbackTriggers.BrowserActionFailed,
      hostCapabilities: ["host.window", "host.action"],
      verifyAfterHostAction: true,
      requireForegroundWindow: true,
    },
    hostStatus,
    browser: async () => normalizeBrowserOutcome(
      await options.executeBrowser({ ...request, attempt }, runtime),
    ),
    verifyBrowser(browserOutcome) {
      return {
        ok: browserOutcome.ok === true &&
          browserOutcome.value?.verified !== false,
        sideEffectState: browserOutcome.sideEffectState,
        reason: browserOutcome.ok
          ? "scroll_browser_telemetry_verified"
          : "scroll_browser_failed",
      };
    },
    prepareHostFallback: async (context) => {
      if (!config.useHostFallback) return {};
      if (typeof options.prepareHostFallback !== "function") return {};
      return await options.prepareHostFallback({
        ...request,
        attempt,
        browserOutcome: context.browserOutcome,
      }, runtime);
    },
    host: typeof options.executeHost === "function"
      ? async (context) => normalizeHostOutcome(
          await options.executeHost({
            ...request,
            attempt,
            preparation: context.preparation,
          }, runtime),
        )
      : undefined,
    verifyHost(hostOutcome) {
      return {
        ok: hostOutcome.ok === true && hostOutcome.value?.verified === true,
        sideEffectState: hostOutcome.sideEffectState,
        reason: hostOutcome.value?.verified === true
          ? "scroll_host_movement_verified"
          : "scroll_host_verification_failed",
      };
    },
  });

  if (!outcome.ok) {
    return {
      ok: false,
      error: outcome.error,
      route: outcome.route,
      sideEffectState:
        outcome.hostOutcome?.sideEffectState ||
        outcome.browserOutcome?.sideEffectState ||
        SideEffectStates.Unknown,
      executionMethod: outcome.executionMethod,
    };
  }
  return {
    ok: true,
    value: outcome.value,
    executionMethod: outcome.executionMethod,
  };
}

function normalizeBrowserOutcome(value) {
  if (value?.ok === false) {
    return {
      ...value,
      sideEffectState:
        value.sideEffectState ||
        value.error?.details?.sideEffectState ||
        SideEffectStates.Unknown,
    };
  }
  const telemetry = value?.value ?? value;
  return {
    ok: true,
    value: {
      ...telemetry,
      verified: telemetry?.verified !== false,
    },
    verified: true,
    sideEffectState: SideEffectStates.Completed,
  };
}

function normalizeHostOutcome(value) {
  if (value?.ok === false) return value;
  const telemetry = value?.value ?? value;
  return {
    ok: true,
    value: telemetry,
    verified: telemetry?.verified === true,
    sideEffectState:
      telemetry?.verified === true
        ? SideEffectStates.Completed
        : SideEffectStates.Unknown,
  };
}

function defaultStopReason(operation, value = {}) {
  if (value.moved === false) return ScrollStopReasons.NoMovement;
  const reasons = {
    [ScrollOperations.ByAmount]: ScrollStopReasons.AmountComplete,
    [ScrollOperations.ToTop]: ScrollStopReasons.TopReached,
    [ScrollOperations.ToBottom]: ScrollStopReasons.BottomReached,
    [ScrollOperations.ToElement]: ScrollStopReasons.TargetAligned,
  };
  return reasons[operation] || ScrollStopReasons.AmountComplete;
}

function conditionStopReason(condition) {
  if (condition === ScrollStopConditions.ScrollEnd) {
    return ScrollStopReasons.ScrollEnd;
  }
  if (condition === ScrollStopConditions.PositionUnchanged) {
    return ScrollStopReasons.PositionUnchanged;
  }
  return ScrollStopReasons.ConditionMet;
}

function noMovementStopReason(condition) {
  return condition === ScrollStopConditions.PositionUnchanged
    ? ScrollStopReasons.PositionUnchanged
    : ScrollStopReasons.ScrollEnd;
}

function requireDelay(delay) {
  if (typeof delay !== "function") {
    throw new NodeExecutionError(
      NodeErrorCodes.DependencyNotReady,
      "Scroll delay service is unavailable.",
      { dependency: "delay", retryable: false },
    );
  }
  return delay;
}

function throwIfCancelled(runtime) {
  if (runtime.signal?.aborted || runtime.isCancelled?.()) {
    throw new NodeExecutionError(
      NodeErrorCodes.Cancelled,
      "Scroll execution was cancelled.",
      { retryable: false },
    );
  }
}
