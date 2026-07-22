import {
  NodeErrorCodes,
  NodeExecutionError,
} from "../../shared/nodeContracts.js";
import {
  RetryReasons,
  SideEffectStates,
} from "../../shared/executionPolicy.js";
import {
  NavigateDestinations,
  NavigateNoHistoryBehaviors,
  NavigateOperations,
  NavigateReadiness,
  NavigateTabSources,
  ProtectedPagePolicies,
} from "./definition.js";
import {
  buildNavigateOutput,
  createTabReference,
  isProtectedBrowserUrl,
  normalizeNavigateTab,
} from "./outputs.js";
import { normalizeNavigateConfig } from "./validators.js";

const DOM_READINESS = new Set([
  NavigateReadiness.DomReady,
  NavigateReadiness.NetworkIdle,
]);

export async function executeNavigate(context = {}) {
  const config = normalizeNavigateConfig(context.config || {});
  const services = context.services || {};
  const tabs = requireTabs(services.tabs);
  const startedMs = nowMs(services.clock);
  let tab = await resolveTab(tabs, config, context);
  const previousUrl = nullableUrl(tab.url);
  let actionStarted = false;
  let navigationState = NavigateReadiness.None;
  let warnings = [];

  try {
    if (
      [NavigateOperations.Back, NavigateOperations.Forward].includes(
        config.operation,
      )
    ) {
      const historyAvailable = await checkHistoryAvailability(
        tabs,
        config.operation,
        tab,
        context,
      );
      if (historyAvailable === false) {
        const noHistory = noHistoryResult(config, tab, previousUrl, startedMs, services);
        if (noHistory) return noHistory;
      }
    }

    actionStarted = true;
    const actionResult = await performNavigationAction(
      tabs, config, tab, context,
    );
    if (actionResult?.noHistory) {
      const noHistory = noHistoryResult(
        config, tab, previousUrl, startedMs, services,
      );
      if (noHistory) return noHistory;
    }
    tab = actionResult;
    navigationState =
      config.waitUntil === NavigateReadiness.None
        ? NavigateReadiness.None
        : NavigateReadiness.NavigationStart;

    const protectedDecision = await applyProtectedReadinessPolicy({
      config,
      tab,
      tabs,
      context,
      services,
    });
    tab = protectedDecision.tab;
    if (protectedDecision.skipReadiness) {
      navigationState = "protected_page_skipped";
      warnings.push({
        code: NodeErrorCodes.ProtectedPage,
        message: "Readiness wait skipped on a protected browser page.",
      });
    } else {
      navigationState = await waitForReadiness(
        tabs,
        config,
        tab,
        context,
      );
    }

    tab = await refreshTab(tabs, tab, context);
    const output = buildNavigateOutput({
      operation: config.operation,
      previousUrl,
      currentUrl: tab.url,
      tab,
      navigationState,
      durationMs: elapsedMs(startedMs, services.clock),
    });

    if (config.saveTabReferenceAs) {
      if (typeof tabs.saveReference !== "function") {
        dependency("tabs.saveReference");
      }
      await tabs.saveReference(
        config.saveTabReferenceAs,
        createTabReference(tab),
        serviceOptions(context),
      );
    }

    return {
      output,
      warnings,
      executionMethod: "browser",
    };
  } catch (error) {
    if (error instanceof NodeExecutionError) throw error;
    throw navigationFailure(error, {
      operation: config.operation,
      tabId: tab?.id ?? null,
      previousUrl,
      targetUrl:
        config.operation === NavigateOperations.GotoUrl ? config.url : null,
      sideEffectState: actionStarted
        ? SideEffectStates.Unknown
        : SideEffectStates.NotStarted,
      phase: actionStarted ? "after_action" : "before_action",
    });
  }
}

export async function verifyNavigateBeforeRetry({
  config: rawConfig = {},
  services = {},
  context = {},
  error = null,
} = {}) {
  const config = normalizeNavigateConfig(rawConfig);
  const tabs = requireTabs(services.tabs);
  const details = error?.details || {};
  if (details.retryable === false) {
    return {
      sideEffectState: SideEffectStates.Unknown,
      result: "blocked",
    };
  }
  if (details.sideEffectState === SideEffectStates.NotStarted) {
    return {
      sideEffectState: SideEffectStates.NotStarted,
      result: "not_completed",
    };
  }

  if (typeof tabs.verifyNavigation === "function") {
    const verification = await tabs.verifyNavigation(
      {
        operation: config.operation,
        tabId: details.tabId,
        previousUrl: details.previousUrl,
        targetUrl: details.targetUrl,
      },
      serviceOptions(context),
    );
    if (verification?.completed || verification?.navigationStarted) {
      return {
        sideEffectState: SideEffectStates.Completed,
        result: "completed",
      };
    }
    if (verification?.completed === false) {
      return {
        sideEffectState: SideEffectStates.NotCompleted,
        result: "not_completed",
      };
    }
  }

  if (Number.isInteger(Number(details.tabId)) && typeof tabs.get === "function") {
    try {
      const current = await tabs.get(
        Number(details.tabId),
        serviceOptions(context),
      );
      const currentUrl = nullableUrl(current?.url);
      if (currentUrl && currentUrl !== nullableUrl(details.previousUrl)) {
        return {
          sideEffectState: SideEffectStates.Completed,
          result: "completed",
        };
      }
      if (current && details.phase === "after_action") {
        return {
          sideEffectState: SideEffectStates.NotCompleted,
          result: "not_completed",
        };
      }
    } catch {
      // An unavailable verification path must not authorize a duplicate side effect.
    }
  }

  return {
    sideEffectState: SideEffectStates.Unknown,
    result: "unknown",
  };
}

async function resolveTab(tabs, config, context) {
  let tab = null;
  if (typeof tabs.resolve === "function") {
    tab = await tabs.resolve(
      {
        source: config.tabSource,
        reference: config.tabReference,
        currentTab: context.tab || null,
        previousTab: context.previousTab || null,
      },
      serviceOptions(context),
    );
  } else if (
    config.tabSource === NavigateTabSources.Current &&
    context.tab
  ) {
    tab = context.tab;
  } else if (
    config.tabSource === NavigateTabSources.PreviousNode &&
    context.previousTab
  ) {
    tab = context.previousTab;
  } else if (
    config.tabSource === NavigateTabSources.Active &&
    typeof tabs.getActive === "function"
  ) {
    tab = await tabs.getActive(serviceOptions(context));
  } else if (
    config.tabSource === NavigateTabSources.SavedReference &&
    typeof tabs.getByReference === "function"
  ) {
    tab = await tabs.getByReference(
      config.tabReference,
      serviceOptions(context),
    );
  }

  if (!tab || !Number.isInteger(Number(tab.id))) {
    throw new NodeExecutionError(
      NodeErrorCodes.TabNotFound,
      "Navigate could not resolve the requested browser tab.",
      {
        tabSource: config.tabSource,
        retryable: false,
      },
    );
  }
  return normalizeNavigateTab(tab);
}

async function performNavigationAction(tabs, config, tab, context) {
  const options = serviceOptions(context);
  if (config.operation === NavigateOperations.GotoUrl) {
    if (config.openDestinationIn === NavigateDestinations.NewTab) {
      requireMethod(tabs, "create");
      return normalizeNavigateTab(
        await tabs.create(
          {
            url: config.url,
            active: true,
            openerTabId: tab.id,
            windowId: tab.windowId,
          },
          options,
        ),
      );
    }
    requireMethod(tabs, "navigate");
    return normalizeActionTab(
      await tabs.navigate(tab.id, config.url, options),
      tab,
      config.url,
    );
  }

  const method =
    config.operation === NavigateOperations.Back
      ? "back"
      : config.operation === NavigateOperations.Forward
        ? "forward"
        : "reload";
  requireMethod(tabs, method);
  const result = await tabs[method](tab.id, options);
  if (result?.performed === false && result?.reason === "no_history") {
    return { noHistory: true };
  }
  return normalizeActionTab(result, tab);
}

async function checkHistoryAvailability(tabs, operation, tab, context) {
  const method =
    operation === NavigateOperations.Back ? "canGoBack" : "canGoForward";
  if (typeof tabs[method] !== "function") return null;
  return await tabs[method](tab.id, serviceOptions(context));
}

function noHistoryResult(config, tab, previousUrl, startedMs, services) {
  if (config.onNoHistory === NavigateNoHistoryBehaviors.Fail) {
    throw new NodeExecutionError(
      NodeErrorCodes.ValidationFailed,
      "Browser history is unavailable for Navigate " + config.operation + ".",
      {
        operation: config.operation,
        reason: "no_history",
        retryable: false,
      },
    );
  }

  const suffix =
    config.onNoHistory === NavigateNoHistoryBehaviors.Skip
      ? "skipped"
      : "continued";
  return {
    output: buildNavigateOutput({
      operation: config.operation,
      previousUrl,
      currentUrl: tab.url,
      tab,
      navigationState: "no_history_" + suffix,
      durationMs: elapsedMs(startedMs, services.clock),
    }),
    warnings: [
      {
        code: NodeErrorCodes.ValidationFailed,
        message: "Browser history was unavailable; Navigate " + suffix + ".",
      },
    ],
    executionMethod: "browser",
  };
}

async function applyProtectedReadinessPolicy({
  config,
  tab,
  tabs,
  context,
  services,
}) {
  if (!DOM_READINESS.has(config.waitUntil) || !isProtectedBrowserUrl(tab.url)) {
    return { tab, skipReadiness: false };
  }

  if (config.protectedPagePolicy === ProtectedPagePolicies.Skip) {
    return { tab, skipReadiness: true };
  }
  if (config.protectedPagePolicy === ProtectedPagePolicies.Fail) {
    throw new NodeExecutionError(
      NodeErrorCodes.ProtectedPage,
      "DOM readiness is unavailable on this protected browser page.",
      {
        url: tab.url,
        retryable: false,
      },
    );
  }
  if (config.protectedPagePolicy === ProtectedPagePolicies.AskUser) {
    const request =
      services.userGate?.request || services.requestUser;
    if (typeof request !== "function") dependency("userGate.request");
    const approved = await request(
      {
        reason: "protected_page",
        tab,
        operation: config.operation,
      },
      serviceOptions(context),
    );
    if (!approved) {
      throw new NodeExecutionError(
        NodeErrorCodes.ProtectedPage,
        "User did not approve waiting on the protected page.",
        { retryable: false },
      );
    }
    return { tab, skipReadiness: true };
  }

  if (typeof tabs.waitUntilSupported !== "function") {
    dependency("tabs.waitUntilSupported");
  }
  const supported = await tabs.waitUntilSupported(
    tab.id,
    {
      timeoutMs: config.timeout,
      signal: context.signal,
    },
  );
  return {
    tab: normalizeNavigateTab(supported),
    skipReadiness: false,
  };
}

async function waitForReadiness(tabs, config, tab, context) {
  if (config.waitUntil === NavigateReadiness.None) {
    return NavigateReadiness.None;
  }
  if (config.waitUntil === NavigateReadiness.NavigationStart) {
    return NavigateReadiness.NavigationStart;
  }
  requireMethod(tabs, "waitForReadiness");
  const result = await tabs.waitForReadiness(
    tab.id,
    config.waitUntil,
    {
      timeoutMs: config.timeout,
      signal: context.signal,
    },
  );
  return String(result?.state || result || config.waitUntil);
}

async function refreshTab(tabs, tab, context) {
  if (typeof tabs.get !== "function") return normalizeNavigateTab(tab);
  const current = await tabs.get(tab.id, serviceOptions(context));
  return current ? normalizeNavigateTab(current) : normalizeNavigateTab(tab);
}

function normalizeActionTab(result, fallback, url = null) {
  const candidate =
    result && typeof result === "object" && Number.isInteger(Number(result.id))
      ? result
      : {
          ...fallback,
          ...(url ? { url } : {}),
        };
  return normalizeNavigateTab(candidate);
}

function navigationFailure(error, details) {
  return new NodeExecutionError(
    NodeErrorCodes.ValidationFailed,
    error?.message || "Browser navigation failed.",
    {
      ...details,
      retryReason: RetryReasons.NavigationFailure,
      causeCode: error?.code || null,
    },
  );
}

function requireTabs(tabs) {
  if (!tabs || typeof tabs !== "object") dependency("tabs");
  return tabs;
}

function requireMethod(object, name) {
  if (typeof object?.[name] !== "function") dependency("tabs." + name);
}

function dependency(name) {
  throw new NodeExecutionError(
    NodeErrorCodes.DependencyNotReady,
    "Navigate dependency is unavailable: " + name + ".",
    {
      dependency: name,
      retryable: false,
    },
  );
}

function serviceOptions(context) {
  return { signal: context.signal };
}

function nowMs(clock) {
  const value = typeof clock === "function" ? clock() : Date.now();
  if (value instanceof Date) return value.getTime();
  const number = Number(value);
  return Number.isFinite(number) ? number : Date.now();
}

function elapsedMs(started, clock) {
  return Math.max(0, nowMs(clock) - started);
}

function nullableUrl(value) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}
