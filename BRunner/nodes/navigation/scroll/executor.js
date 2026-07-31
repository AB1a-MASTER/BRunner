import {
  NodeErrorCategories,
  NodeErrorCodes,
  NodeExecutionError,
} from "../../shared/nodeContracts.js";
import {
  HostFallbackTriggers,
  RetryReasons,
  SideEffectStates,
} from "../../shared/executionPolicy.js";
import {
  ScrollErrorCodes,
  ScrollExecutionMethods,
} from "./definition.js";
import { buildScrollOutput } from "./outputs.js";
import {
  extractScrollTarget,
  normalizeScrollConfig,
} from "./validators.js";

export async function executeScroll(context = {}) {
  const target = context.target ??
    context.dependencies?.target ??
    extractScrollTarget({ node: context.node || {} });
  const config = normalizeScrollConfig(context.config || {}, { target });
  const service = requireScrollService(context.services?.scroll);
  const tab = context.tab || context.dependencies?.tab || null;
  if (!tab || !Number.isInteger(Number(tab.id))) {
    throw new NodeExecutionError(
      NodeErrorCodes.TabNotFound,
      "Scroll could not resolve the requested browser tab.",
      { retryable: false },
    );
  }
  if (isProtectedBrowserUrl(tab.url)) {
    throw new NodeExecutionError(
      NodeErrorCodes.ProtectedPage,
      "Scroll requires DOM access and cannot run on a protected browser page.",
      { tabId: Number(tab.id), url: String(tab.url || ""), retryable: false },
    );
  }

  try {
    const result = await service.perform({
      config,
      target,
      tab: structuredClone(tab),
    }, serviceOptions(context));
    if (result?.ok === false) {
      throw serviceError(result.error, result);
    }
    const source = result?.value ?? result?.output ?? result;
    const executionMethod = result?.executionMethod ||
      source?.executionMethod ||
      ScrollExecutionMethods.Browser;
    const output = buildScrollOutput({
      ...source,
      operation: config.operation,
      executionMethod,
    });
    return {
      output,
      warnings: Array.isArray(result?.warnings) ? result.warnings : [],
      executionMethod,
    };
  } catch (error) {
    if (error instanceof NodeExecutionError) throw error;
    if (error?.diagnostics?.mapperState) throw error;
    throw scrollFailure(error, {
      operation: config.operation,
      sideEffectState:
        error?.details?.sideEffectState || SideEffectStates.Unknown,
      fallbackTrigger:
        error?.details?.fallbackTrigger ||
        HostFallbackTriggers.BrowserActionFailed,
    });
  }
}

export async function verifyScrollBeforeRetry({ error = null } = {}) {
  const details = error?.details || {};
  if (
    error?.code === ScrollErrorCodes.ContainerNotReady &&
    [
      SideEffectStates.NotStarted,
      SideEffectStates.NotCompleted,
    ].includes(details.sideEffectState)
  ) {
    return {
      sideEffectState: SideEffectStates.NotCompleted,
      result: "not_completed",
    };
  }
  if (details.sideEffectState === SideEffectStates.Completed) {
    return {
      sideEffectState: SideEffectStates.Completed,
      result: "completed",
    };
  }
  return {
    sideEffectState: SideEffectStates.Unknown,
    result: "unknown",
  };
}

export function createContainerNotReadyError(details = {}) {
  return new NodeExecutionError(
    ScrollErrorCodes.ContainerNotReady,
    "The requested scroll container is not ready.",
    {
      ...details,
      retryReason: RetryReasons.ContainerNotReady,
      retryable: true,
      sideEffectState:
        details.sideEffectState || SideEffectStates.NotStarted,
    },
    { category: NodeErrorCategories.Target },
  );
}

function serviceError(error, result) {
  if (error instanceof NodeExecutionError) return error;
  if (error?.code === ScrollErrorCodes.ContainerNotReady) {
    return createContainerNotReadyError({
      ...(error.details || {}),
      sideEffectState:
        error.details?.sideEffectState ||
        result?.sideEffectState ||
        SideEffectStates.NotStarted,
    });
  }
  return scrollFailure(error, {
    sideEffectState:
      error?.details?.sideEffectState ||
      result?.sideEffectState ||
      SideEffectStates.Unknown,
  });
}

function scrollFailure(error, details = {}) {
  return new NodeExecutionError(
    ScrollErrorCodes.ScrollFailed,
    "Browser scrolling failed.",
    {
      ...details,
      cause: error?.message ? String(error.message) : null,
      retryable: false,
    },
    { category: NodeErrorCategories.NodeSpecific },
  );
}

function requireScrollService(service) {
  if (!service || typeof service.perform !== "function") {
    throw new NodeExecutionError(
      NodeErrorCodes.DependencyNotReady,
      "Scroll browser service is unavailable.",
      { dependency: "scroll.perform", retryable: false },
    );
  }
  return service;
}

function serviceOptions(context) {
  return {
    signal: context.signal,
    attempt: context.attempt,
    nodeId: context.nodeId,
    isCancelled: context.services?.isCancelled,
  };
}

function isProtectedBrowserUrl(value) {
  const url = String(value || "").trim().toLowerCase();
  return [
    "chrome://",
    "chrome-error://",
    "chrome-search://",
    "chrome-untrusted://",
    "edge://",
    "about:",
    "view-source:",
    "chrome-extension://",
    "devtools://",
  ].some((prefix) => url.startsWith(prefix));
}
