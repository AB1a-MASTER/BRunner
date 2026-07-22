import {
  NodeErrorCategories,
  NodeErrorCodes,
  NodeExecutionError,
  getNodeErrorCategory,
} from "./nodeContracts.js";

export const RetrySafety = Object.freeze({
  Safe: "safe",
  VerifyBeforeRetry: "verify_before_retry",
  Unsafe: "unsafe",
  Explicit: "explicit",
});

export const RetryStrategies = Object.freeze({
  Fixed: "fixed",
  Increasing: "increasing",
});

export const RetryReasons = Object.freeze({
  Timeout: "timeout",
  TargetNotFound: "target_not_found",
  NavigationFailure: "navigation_failure",
  HostUnavailable: "host_unavailable",
  DependencyNotReady: "dependency_not_ready",
  AnyError: "any_error",
});

export const HostClassifications = Object.freeze({
  None: "none",
  Assisted: "host_assisted",
  Required: "host_required",
});

export const HostFallbackTriggers = Object.freeze({
  BrowserActionFailed: "browser_action_failed",
  Blocked: "blocked",
  SyntheticEventRejected: "synthetic_event_rejected",
  CoordinateActionRequired: "coordinate_action_required",
  BrowserAccessUnavailable: "browser_access_unavailable",
});

export const HostUnavailableBehaviors = Object.freeze({
  Fail: "fail",
  Skip: "skip",
  ErrorPath: "error_path",
});

export const HostStatusTags = Object.freeze({
  FallbackOff: "Host fallback: off",
  FallbackAvailable: "Host fallback: available",
  FallbackUnavailable: "Host fallback: unavailable",
  RequiredConnected: "Host required: connected",
  RequiredUnavailable: "Host required: unavailable",
  ActionInProgress: "Host action in progress",
});

export const SideEffectStates = Object.freeze({
  NotStarted: "not_started",
  NotCompleted: "not_completed",
  Completed: "completed",
  Unknown: "unknown",
});

const NEVER_RETRY_CODES = new Set([
  NodeErrorCodes.Cancelled,
  NodeErrorCodes.ProtectedPage,
  NodeErrorCodes.ConfigInvalid,
  NodeErrorCodes.ValidationFailed,
]);

const DEFAULT_RETRY_REASONS = Object.freeze([RetryReasons.AnyError]);

export function normalizeRetryPolicy(config = {}, definition = {}) {
  const retryCount = boundedInteger(
    config.retryCount ?? definition.defaultRetryCount,
    0,
    definition.maximumRetryCount ?? 10,
    0,
  );
  const retryDelay = boundedNumber(
    config.retryDelay ?? definition.defaultRetryDelay,
    0,
    definition.maximumRetryDelay ?? 300_000,
    0,
  );
  const retryStrategy = Object.values(RetryStrategies).includes(
    config.retryStrategy,
  )
    ? config.retryStrategy
    : RetryStrategies.Fixed;
  const retryOnlyFor = normalizeRetryReasons(
    config.retryOnlyFor ?? definition.retryOnlyFor,
  );
  const requestedSafety =
    definition.retrySafety ??
    definition.safety ??
    config.retrySafety ??
    config.safety;
  const safety = Object.values(RetrySafety).includes(requestedSafety)
    ? requestedSafety
    : RetrySafety.Unsafe;

  return Object.freeze({
    retryCount,
    retryDelay,
    retryStrategy,
    retryOnlyFor,
    safety,
    allowUnsafeRetry:
      safety === RetrySafety.Explicit && config.allowUnsafeRetry === true,
  });
}

export function classifyRetryError(error = {}) {
  const code = String(error?.code || error?.details?.code || "").toUpperCase();
  const category = getNodeErrorCategory(
    error?.code,
    error?.category || error?.details?.category,
  );
  if (error?.details?.retryReason === RetryReasons.NavigationFailure) {
    return RetryReasons.NavigationFailure;
  }
  if (category === NodeErrorCategories.Navigation) {
    return RetryReasons.NavigationFailure;
  }
  if (category === NodeErrorCategories.Timeout) return RetryReasons.Timeout;
  if (category === NodeErrorCategories.Target) return RetryReasons.TargetNotFound;
  if (category === NodeErrorCategories.Host) return RetryReasons.HostUnavailable;
  if (category === NodeErrorCategories.Dependency) {
    return RetryReasons.DependencyNotReady;
  }
  if (code === NodeErrorCodes.Timeout) return RetryReasons.Timeout;
  if (
    [
      NodeErrorCodes.TargetNotFound,
      NodeErrorCodes.TargetNotVisible,
      NodeErrorCodes.TargetNotInteractable,
      NodeErrorCodes.AmbiguousTarget,
    ].includes(code)
  ) {
    return RetryReasons.TargetNotFound;
  }
  if (code === NodeErrorCodes.HostUnavailable) {
    return RetryReasons.HostUnavailable;
  }
  if (code === NodeErrorCodes.DependencyNotReady) {
    return RetryReasons.DependencyNotReady;
  }
  if (code === "NAVIGATION_FAILED") {
    return RetryReasons.NavigationFailure;
  }
  return RetryReasons.AnyError;
}

export function shouldRetry({
  attempt = 1,
  error = null,
  policy = {},
  sideEffectState = SideEffectStates.Unknown,
  verification = "",
} = {}) {
  const normalized = normalizeRetryPolicy(policy, policy);
  const code = String(error?.code || "").toUpperCase();
  const category = getNodeErrorCategory(
    error?.code,
    error?.category || error?.details?.category,
  );
  if (error?.details?.retryable === false) return false;
  const retryReason = classifyRetryError(error);
  const retryableNavigationValidation =
    code === NodeErrorCodes.ValidationFailed &&
    retryReason === RetryReasons.NavigationFailure;
  if (
    attempt > normalized.retryCount ||
    ((NEVER_RETRY_CODES.has(code) || [
      NodeErrorCategories.Configuration,
      NodeErrorCategories.Validation,
      NodeErrorCategories.ProtectedPage,
      NodeErrorCategories.Cancelled,
    ].includes(category)) && !retryableNavigationValidation)
  ) {
    return false;
  }

  if (
    !normalized.retryOnlyFor.includes(RetryReasons.AnyError) &&
    !normalized.retryOnlyFor.includes(retryReason)
  ) {
    return false;
  }

  if (normalized.safety === RetrySafety.Safe) return true;
  if (normalized.safety === RetrySafety.Unsafe) return false;
  if (normalized.safety === RetrySafety.Explicit) {
    return normalized.allowUnsafeRetry;
  }

  return [
    SideEffectStates.NotStarted,
    SideEffectStates.NotCompleted,
  ].includes(sideEffectState) || verification === "not_completed";
}

export function retryDelayMs(attempt = 1, policy = {}) {
  const normalized = normalizeRetryPolicy(policy, policy);
  if (normalized.retryStrategy === RetryStrategies.Increasing) {
    return normalized.retryDelay * Math.max(1, Number(attempt) || 1);
  }
  return normalized.retryDelay;
}

export async function executeWithRetry(executor, options = {}) {
  if (typeof executor !== "function") {
    throw new TypeError("executeWithRetry requires an executor function.");
  }
  const policy = normalizeRetryPolicy(
    options.policy || {},
    options.definition || options.policy || {},
  );
  let attempt = 0;

  while (attempt <= policy.retryCount) {
    attempt += 1;
    if (options.isCancelled?.()) {
      throw new NodeExecutionError(
        NodeErrorCodes.Cancelled,
        "Node execution was cancelled.",
        { attempt },
      );
    }
    await options.onAttempt?.({ attempt, policy });

    try {
      const value = await executor({ attempt, policy });
      return { value, attempts: attempt };
    } catch (rawError) {
      const error = normalizeExecutionError(rawError);
      const verification =
        typeof options.verifyBeforeRetry === "function"
          ? await options.verifyBeforeRetry({ error, attempt, policy })
          : null;
      const sideEffectState =
        verification?.sideEffectState ||
        error.details?.sideEffectState ||
        SideEffectStates.Unknown;

      if (!shouldRetry({
        attempt,
        error,
        policy,
        sideEffectState,
        verification: verification?.result || "",
      })) {
        error.details = {
          ...(error.details || {}),
          attempts: attempt,
        };
        throw error;
      }

      const delayMs = retryDelayMs(attempt, policy);
      await options.onRetry?.({
        attempt,
        nextAttempt: attempt + 1,
        error,
        delayMs,
        retryReason: classifyRetryError(error),
      });
      if (delayMs > 0) {
        if (typeof options.delay !== "function") {
          throw new NodeExecutionError(
            NodeErrorCodes.DependencyNotReady,
            "Retry delay service is unavailable.",
            { attempt, delayMs },
          );
        }
        await options.delay(delayMs);
      }
    }
  }

  throw new NodeExecutionError(
    NodeErrorCodes.ValidationFailed,
    "Retry execution ended without a result.",
  );
}

export function normalizeHostFallbackPolicy(config = {}, definition = {}) {
  const requestedClassification =
    definition.hostClassification ??
    definition.classification ??
    config.hostClassification ??
    config.classification;
  const classification = Object.values(HostClassifications).includes(
    requestedClassification,
  )
    ? requestedClassification
    : HostClassifications.None;
  const supported =
    classification === HostClassifications.Assisted ||
    classification === HostClassifications.Required;
  const triggers = normalizeHostTriggers(
    config.fallbackTrigger ??
      config.fallbackTriggers ??
      definition.fallbackTrigger ??
      definition.fallbackTriggers,
  );

  return Object.freeze({
    classification,
    supported,
    useHostFallback:
      classification === HostClassifications.Required ||
      (supported && config.useHostFallback === true),
    fallbackTriggers: triggers,
    ifHostUnavailable: Object.values(HostUnavailableBehaviors).includes(
      config.ifHostUnavailable,
    )
      ? config.ifHostUnavailable
      : HostUnavailableBehaviors.Fail,
    verifyAfterHostAction: config.verifyAfterHostAction !== false,
    requireForegroundWindow: config.requireForegroundWindow !== false,
    screenshotBeforeFallback: config.screenshotBeforeFallback === true,
    screenshotAfterFallback: config.screenshotAfterFallback === true,
    requiredCapabilities: normalizeStrings(
      definition.hostCapabilities ||
        definition.requiredCapabilities ||
        config.hostCapabilities ||
        config.requiredCapabilities,
    ),
  });
}

export function projectHostStatusTag({
  policy = {},
  hostStatus = {},
  inProgress = false,
} = {}) {
  const normalized = normalizeHostFallbackPolicy(policy, policy);
  if (inProgress) return HostStatusTags.ActionInProgress;

  if (normalized.classification === HostClassifications.Required) {
    return hostIsAvailable(normalized, hostStatus)
      ? HostStatusTags.RequiredConnected
      : HostStatusTags.RequiredUnavailable;
  }
  if (!normalized.useHostFallback) return HostStatusTags.FallbackOff;
  return hostIsAvailable(normalized, hostStatus)
    ? HostStatusTags.FallbackAvailable
    : HostStatusTags.FallbackUnavailable;
}

export function planHostFallback({
  policy = {},
  hostStatus = {},
  trigger = HostFallbackTriggers.BrowserActionFailed,
  sideEffectState = SideEffectStates.Unknown,
  foregroundReady = false,
  targetVisible = false,
} = {}) {
  const normalized = normalizeHostFallbackPolicy(policy, policy);

  if (!normalized.supported || !normalized.useHostFallback) {
    return hostPlan(false, "disabled", normalized);
  }
  if (!normalized.fallbackTriggers.includes(trigger)) {
    return hostPlan(false, "trigger_not_enabled", normalized);
  }
  if (
    trigger !== HostFallbackTriggers.CoordinateActionRequired &&
    ![
      SideEffectStates.NotStarted,
      SideEffectStates.NotCompleted,
    ].includes(sideEffectState)
  ) {
    return hostPlan(
      false,
      "browser_side_effect_completion_unknown",
      normalized,
      NodeErrorCodes.ValidationFailed,
    );
  }
  if (!hostIsAvailable(normalized, hostStatus)) {
    return unavailableHostPlan(normalized, hostStatus);
  }
  if (
    normalized.requireForegroundWindow &&
    (!foregroundReady || !targetVisible)
  ) {
    return hostPlan(
      false,
      "foreground_or_target_not_ready",
      normalized,
      NodeErrorCodes.HostForegroundRequired,
    );
  }

  return {
    attempt: true,
    reason: "host_fallback_ready",
    route: "host",
    error: null,
    policy: normalized,
  };
}

export async function executeBrowserFirst(options = {}) {
  if (typeof options.browser !== "function") {
    throw new TypeError("executeBrowserFirst requires a browser function.");
  }
  const policy = normalizeHostFallbackPolicy(
    options.policy || {},
    options.definition || options.policy || {},
  );
  let browserOutcome;

  try {
    browserOutcome = normalizeActionOutcome(await options.browser());
  } catch (error) {
    browserOutcome = normalizeActionOutcome({
      ok: false,
      error: normalizeExecutionError(error),
      trigger:
        error?.details?.fallbackTrigger ||
        HostFallbackTriggers.BrowserActionFailed,
      sideEffectState:
        error?.details?.sideEffectState ||
        SideEffectStates.Unknown,
    });
  }

  const browserVerification =
    typeof options.verifyBrowser === "function"
      ? await options.verifyBrowser(browserOutcome)
      : {
          ok:
            browserOutcome.ok === true &&
            browserOutcome.verified === true,
          sideEffectState: browserOutcome.sideEffectState,
          reason:
            browserOutcome.verified === true
              ? "browser_outcome_verified"
              : "browser_verification_unavailable",
        };
  if (browserOutcome.ok && browserVerification?.ok !== false) {
    return {
      ok: true,
      value: browserOutcome.value,
      executionMethod: "browser",
      browserOutcome,
      browserVerification,
      hostOutcome: null,
    };
  }

  const preparation =
    typeof options.prepareHostFallback === "function"
      ? await options.prepareHostFallback({
          browserOutcome,
          browserVerification,
          policy,
        })
      : {};
  const plan = planHostFallback({
    policy,
    hostStatus: options.hostStatus || {},
    trigger:
      preparation.trigger ||
      browserOutcome.trigger ||
      HostFallbackTriggers.BrowserActionFailed,
    sideEffectState:
      preparation.sideEffectState ||
      browserVerification?.sideEffectState ||
      browserOutcome.sideEffectState,
    foregroundReady: preparation.foregroundReady === true,
    targetVisible: preparation.targetVisible === true,
  });

  if (!plan.attempt) {
    return {
      ok: false,
      route: plan.route,
      error: plan.error || browserOutcome.error || createPolicyError(
        NodeErrorCodes.ValidationFailed,
        "Browser action failed and host fallback was not attempted.",
        { reason: plan.reason },
      ),
      executionMethod: "browser",
      browserOutcome,
      browserVerification,
      hostOutcome: null,
      hostPlan: plan,
    };
  }

  if (typeof options.host !== "function") {
    throw new NodeExecutionError(
      NodeErrorCodes.DependencyNotReady,
      "Host fallback service is unavailable.",
    );
  }
  await options.onHostStatus?.(HostStatusTags.ActionInProgress);
  if (policy.screenshotBeforeFallback) {
    await options.captureScreenshot?.("before");
  }

  let hostOutcome;
  try {
    hostOutcome = normalizeActionOutcome(await options.host({
      browserOutcome,
      browserVerification,
      preparation,
      policy,
    }));
  } catch (error) {
    hostOutcome = normalizeActionOutcome({
      ok: false,
      error: normalizeExecutionError(error),
      sideEffectState:
        error?.details?.sideEffectState ||
        SideEffectStates.Unknown,
    });
  }

  if (policy.screenshotAfterFallback) {
    await options.captureScreenshot?.("after");
  }
  const hostVerification = policy.verifyAfterHostAction
    ? typeof options.verifyHost === "function"
      ? await options.verifyHost(hostOutcome)
      : {
          ok:
            hostOutcome.ok === true &&
            hostOutcome.verified === true,
          sideEffectState: hostOutcome.sideEffectState,
          reason:
            hostOutcome.verified === true
              ? "host_outcome_verified"
              : "host_verification_unavailable",
        }
    : {
        ok: hostOutcome.ok === true,
        sideEffectState: hostOutcome.sideEffectState,
        reason: "host_verification_disabled",
      };
  const ok = hostOutcome.ok && hostVerification?.ok !== false;

  return {
    ok,
    route: ok ? "success" : "error",
    value: hostOutcome.value,
    error: ok
      ? null
      : hostOutcome.error || createPolicyError(
          NodeErrorCodes.ValidationFailed,
          "Host action could not be verified.",
          {
            sideEffectState:
              hostVerification?.sideEffectState ||
              hostOutcome.sideEffectState ||
              SideEffectStates.Unknown,
          },
        ),
    executionMethod: "host",
    browserOutcome,
    browserVerification,
    hostOutcome,
    hostVerification,
    hostPlan: plan,
  };
}

function normalizeExecutionError(error) {
  if (error instanceof NodeExecutionError) return error;
  return new NodeExecutionError(
    error?.code || NodeErrorCodes.ValidationFailed,
    error?.message || "Node execution failed.",
    error?.details || {},
  );
}

function normalizeActionOutcome(value = {}) {
  const result =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : { ok: true, value };
  return {
    ...result,
    ok: result.ok !== false,
    sideEffectState: Object.values(SideEffectStates).includes(
      result.sideEffectState,
    )
      ? result.sideEffectState
      : result.ok === true
        ? SideEffectStates.Completed
        : SideEffectStates.Unknown,
  };
}

function unavailableHostPlan(policy, hostStatus) {
  const error = createPolicyError(
    NodeErrorCodes.HostUnavailable,
    "Host fallback is enabled but the required companion service is unavailable.",
    {
      connected: hostStatus?.connected === true,
      requiredCapabilities: policy.requiredCapabilities,
    },
  );
  if (policy.ifHostUnavailable === HostUnavailableBehaviors.Skip) {
    return {
      attempt: false,
      reason: "host_unavailable",
      route: "skip",
      error,
      policy,
    };
  }
  if (policy.ifHostUnavailable === HostUnavailableBehaviors.ErrorPath) {
    return {
      attempt: false,
      reason: "host_unavailable",
      route: "error",
      error,
      policy,
    };
  }
  return {
    attempt: false,
    reason: "host_unavailable",
    route: "fail",
    error,
    policy,
  };
}

function hostPlan(attempt, reason, policy, code = "") {
  return {
    attempt,
    reason,
    route: attempt ? "host" : "browser",
    error: code
      ? createPolicyError(
          code,
          reason === "browser_side_effect_completion_unknown"
            ? "Host fallback was blocked because the browser side effect may already have occurred."
            : "Host fallback requirements were not met.",
          { reason },
        )
      : null,
    policy,
  };
}

function hostIsAvailable(policy, status = {}) {
  if (status?.connected !== true) return false;
  if (!Array.isArray(status.capabilities)) return true;
  return policy.requiredCapabilities.every((capability) => {
    return status.capabilities.includes(capability);
  });
}

function createPolicyError(code, message, details = {}) {
  return { code, message, details: structuredClone(details) };
}

function normalizeRetryReasons(value) {
  const values = normalizeStrings(
    Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(",")
        : DEFAULT_RETRY_REASONS,
  );
  const allowed = new Set(Object.values(RetryReasons));
  const normalized = values.filter((entry) => allowed.has(entry));
  return Object.freeze(
    normalized.length ? normalized : [...DEFAULT_RETRY_REASONS],
  );
}

function normalizeHostTriggers(value) {
  const values = normalizeStrings(
    Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(",")
        : [HostFallbackTriggers.BrowserActionFailed],
  );
  const allowed = new Set(Object.values(HostFallbackTriggers));
  const normalized = values.filter((entry) => allowed.has(entry));
  return Object.freeze(
    normalized.length
      ? normalized
      : [HostFallbackTriggers.BrowserActionFailed],
  );
}

function normalizeStrings(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];
}

function boundedInteger(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric)
    ? Math.min(maximum, Math.max(minimum, numeric))
    : fallback;
}

function boundedNumber(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(maximum, Math.max(minimum, numeric))
    : fallback;
}
