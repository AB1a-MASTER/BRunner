import {
  NodeErrorCategories,
  NodeErrorCodes,
  NodeExecutionError,
} from "../../shared/nodeContracts.js";
import {
  RetryReasons,
  SideEffectStates,
} from "../../shared/executionPolicy.js";
import {
  NavigateErrorCodes,
  NavigateOperations,
  NavigateReadiness,
  NavigateTabSources,
} from "./definition.js";
import { isProtectedBrowserUrl } from "./outputs.js";

const DEFAULT_POLL_MS = 100;
const NETWORK_IDLE_MS = 500;

/**
 * Production browser-service adapter for the finalized Navigate executor.
 * The adapter owns Chrome API details; the node executor remains deterministic
 * and can use the same contract in unit tests.
 */
export function createChromeNavigateTabsService(options = {}) {
  const chromeApi = options.chromeApi || globalThis.chrome;
  const tabsApi = chromeApi?.tabs;
  const scriptingApi = chromeApi?.scripting;
  const tabsByRef = options.tabsByRef instanceof Map
    ? options.tabsByRef
    : new Map();
  const clock = typeof options.clock === "function" ? options.clock : Date.now;
  const delay = typeof options.delay === "function"
    ? options.delay
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let lastTab = options.currentTab || null;

  requireMethod(tabsApi, "get", "chrome.tabs.get");
  requireMethod(tabsApi, "query", "chrome.tabs.query");

  const service = {
    async resolve(request = {}, runtime = {}) {
      const signal = runtime.signal;
      throwIfAborted(signal);
      const source = request.source || NavigateTabSources.Current;
      let candidate = null;

      if (source === NavigateTabSources.Active) {
        const matches = await tabsApi.query({ active: true, currentWindow: true });
        candidate = matches?.[0] || null;
      } else if (source === NavigateTabSources.SavedReference) {
        candidate = resolveSavedReference(request.reference, tabsByRef);
      } else if (source === NavigateTabSources.PreviousNode) {
        candidate = request.previousTab || options.previousTab || request.currentTab;
      } else {
        candidate = request.currentTab || options.currentTab;
        if (!candidate) {
          const matches = await tabsApi.query({ active: true, currentWindow: true });
          candidate = matches?.[0] || null;
        }
      }

      const tabId = tabIdOf(candidate);
      if (!Number.isInteger(tabId)) {
        throw tabNotFound(source, request.reference);
      }
      try {
        return remember(await tabsApi.get(tabId));
      } catch (error) {
        throw tabNotFound(source, request.reference, error);
      }
    },

    async get(tabId, runtime = {}) {
      throwIfAborted(runtime.signal);
      return remember(await tabsApi.get(Number(tabId)));
    },

    async getActive(runtime = {}) {
      throwIfAborted(runtime.signal);
      const matches = await tabsApi.query({ active: true, currentWindow: true });
      if (!matches?.[0]) throw tabNotFound(NavigateTabSources.Active);
      return remember(matches[0]);
    },

    async getByReference(reference, runtime = {}) {
      throwIfAborted(runtime.signal);
      const tabId = tabIdOf(resolveSavedReference(reference, tabsByRef));
      if (!Number.isInteger(tabId)) {
        throw tabNotFound(NavigateTabSources.SavedReference, reference);
      }
      return remember(await tabsApi.get(tabId));
    },

    async navigate(tabId, url, runtime = {}) {
      throwIfAborted(runtime.signal);
      requireMethod(tabsApi, "update", "chrome.tabs.update");
      return remember(await tabsApi.update(Number(tabId), { url }));
    },

    async create(properties = {}, runtime = {}) {
      throwIfAborted(runtime.signal);
      requireMethod(tabsApi, "create", "chrome.tabs.create");
      return remember(await tabsApi.create(compactObject({
        url: properties.url,
        active: properties.active !== false,
        openerTabId: integerOrUndefined(properties.openerTabId),
        windowId: integerOrUndefined(properties.windowId),
      })));
    },

    async back(tabId, runtime = {}) {
      return await historyAction("goBack", tabId, runtime);
    },

    async forward(tabId, runtime = {}) {
      return await historyAction("goForward", tabId, runtime);
    },

    async reload(tabId, runtime = {}) {
      throwIfAborted(runtime.signal);
      requireMethod(tabsApi, "reload", "chrome.tabs.reload");
      await tabsApi.reload(Number(tabId));
      return remember(await tabsApi.get(Number(tabId)));
    },

    async waitForReadiness(tabId, readiness, runtime = {}) {
      const timeoutMs = positiveTimeout(runtime.timeoutMs);
      if (readiness === NavigateReadiness.FullLoad) {
        await pollUntil(async () => {
          const tab = remember(await tabsApi.get(Number(tabId)));
          if (tab?.status !== "complete") return null;
          if (typeof scriptingApi?.executeScript === "function") {
            try {
              const probe = await probeDocumentReadiness(
                scriptingApi,
                Number(tabId),
              );
              throwIfNetworkErrorDocument(probe);
            } catch (error) {
              if (isNetworkErrorFailure(error)) throw error;
            }
          }
          return { state: readiness };
        }, { timeoutMs, signal: runtime.signal, clock, delay });
        return { state: readiness };
      }

      if (
        readiness !== NavigateReadiness.DomReady &&
        readiness !== NavigateReadiness.NetworkIdle
      ) {
        return { state: readiness };
      }
      requireMethod(scriptingApi, "executeScript", "chrome.scripting.executeScript");

      let lastProbeError = null;
      const result = await pollUntil(async () => {
        try {
          const probe = await probeDocumentReadiness(scriptingApi, Number(tabId));
          throwIfNetworkErrorDocument(probe);
          lastProbeError = null;
          if (readiness === NavigateReadiness.DomReady) {
            return ["interactive", "complete"].includes(probe.readyState)
              ? { state: readiness }
              : null;
          }
          return probe.readyState === "complete" && probe.quietForMs >= NETWORK_IDLE_MS
            ? { state: readiness }
            : null;
        } catch (error) {
          if (isNetworkErrorFailure(error)) throw error;
          lastProbeError = error;
          return null;
        }
      }, {
        timeoutMs,
        signal: runtime.signal,
        clock,
        delay,
        timeoutDetails: () => ({
          readiness,
          cause: lastProbeError?.message || null,
        }),
      });
      return result;
    },

    async waitUntilSupported(tabId, runtime = {}) {
      const result = await pollUntil(async () => {
        const tab = remember(await tabsApi.get(Number(tabId)));
        return !isProtectedBrowserUrl(tab?.url) ? tab : null;
      }, {
        timeoutMs: positiveTimeout(runtime.timeoutMs),
        signal: runtime.signal,
        clock,
        delay,
        timeoutDetails: () => ({ policy: "wait_until_supported" }),
      });
      return remember(result);
    },

    async saveReference(name, reference, runtime = {}) {
      throwIfAborted(runtime.signal);
      const key = String(name || "").trim();
      const tabId = tabIdOf(reference);
      if (!key || !Number.isInteger(tabId)) {
        throw new NodeExecutionError(
          NodeErrorCodes.ConfigInvalid,
          "Navigate requires a valid tab-reference name and tab ID.",
          { field: "saveTabReferenceAs" },
        );
      }
      const tab = await tabsApi.get(tabId);
      tabsByRef.set(key, {
        ...tab,
        tabId,
        kind: "tab",
      });
      remember(tab);
    },

    async verifyNavigation(request = {}, runtime = {}) {
      throwIfAborted(runtime.signal);
      const tabId = Number(request.tabId);
      if (!Number.isInteger(tabId)) return { completed: false };
      try {
        const tab = remember(await tabsApi.get(tabId));
        const previousUrl = nullableUrl(request.previousUrl);
        const currentUrl = nullableUrl(tab?.url);
        if (request.operation === NavigateOperations.GotoUrl) {
          const targetUrl = nullableUrl(request.targetUrl);
          return {
            completed: Boolean(targetUrl && currentUrl === targetUrl && tab.status === "complete"),
            navigationStarted: Boolean(currentUrl && currentUrl !== previousUrl),
          };
        }
        if ([NavigateOperations.Back, NavigateOperations.Forward].includes(request.operation)) {
          return {
            completed: Boolean(currentUrl && currentUrl !== previousUrl),
            navigationStarted: Boolean(currentUrl && currentUrl !== previousUrl),
          };
        }
        if (request.operation === NavigateOperations.Reload) {
          return {
            completed: tab.status === "complete",
            navigationStarted: tab.status === "loading",
          };
        }
      } catch {
        // Verification must fail closed instead of authorizing a duplicate action.
      }
      return { completed: null, navigationStarted: false };
    },

    currentTab() {
      return lastTab ? structuredClone(lastTab) : null;
    },
  };

  return service;

  async function historyAction(method, tabId, runtime) {
    throwIfAborted(runtime.signal);
    requireMethod(tabsApi, method, `chrome.tabs.${method}`);
    try {
      await tabsApi[method](Number(tabId));
    } catch (error) {
      if (isNoHistoryError(error)) {
        return { performed: false, reason: "no_history" };
      }
      throw error;
    }
    return remember(await tabsApi.get(Number(tabId)));
  }

  function remember(tab) {
    const normalized =
      tab && !tab.url && tab.pendingUrl
        ? { ...tab, url: tab.pendingUrl }
        : tab;
    if (normalized && Number.isInteger(Number(normalized.id))) {
      lastTab = structuredClone(normalized);
    }
    return normalized;
  }
}

async function probeDocumentReadiness(scriptingApi, tabId) {
  const results = await scriptingApi.executeScript({
    target: { tabId },
    func: () => {
      const entries = performance.getEntriesByType("resource");
      const lastResourceEnd = entries.reduce(
        (latest, entry) => Math.max(latest, Number(entry.responseEnd) || 0),
        0,
      );
      return {
        readyState: document.readyState,
        quietForMs: Math.max(0, performance.now() - lastResourceEnd),
        documentUrl: globalThis.location?.href || "",
        bodyClass: document.body?.className || "",
        mainFrameError: Boolean(document.getElementById("main-frame-error")),
        networkErrorCode:
          document.querySelector(".error-code")?.textContent?.trim() || "",
      };
    },
  });
  const value = results?.[0]?.result;
  return {
    readyState: String(value?.readyState || "loading"),
    quietForMs: Math.max(0, Number(value?.quietForMs) || 0),
    documentUrl: String(value?.documentUrl || ""),
    bodyClass: String(value?.bodyClass || ""),
    mainFrameError: value?.mainFrameError === true,
    networkErrorCode: String(value?.networkErrorCode || "").trim(),
  };
}

function throwIfNetworkErrorDocument(probe = {}) {
  const documentUrl = String(probe.documentUrl || "").trim().toLowerCase();
  const errorCode = String(probe.networkErrorCode || "").trim();
  const bodyClasses = String(probe.bodyClass || "")
    .split(/\s+/)
    .filter(Boolean);
  const isChromiumNetworkError =
    documentUrl.startsWith("chrome-error://") ||
    (
      bodyClasses.includes("neterror") &&
      probe.mainFrameError === true &&
      /^ERR_[A-Z0-9_]+$/.test(errorCode)
    );
  if (!isChromiumNetworkError) return;

  throw new NodeExecutionError(
    NavigateErrorCodes.NavigationFailed,
    errorCode
      ? `Chrome could not load the requested page (${errorCode}).`
      : "Chrome could not load the requested page.",
    {
      errorCode: errorCode || null,
      documentUrl: documentUrl || null,
      retryReason: RetryReasons.NavigationFailure,
      retryable: false,
      sideEffectState: SideEffectStates.Completed,
      finalReason: "chromium_network_error_document",
    },
    { category: NodeErrorCategories.Navigation },
  );
}

function isNetworkErrorFailure(error) {
  return (
    error instanceof NodeExecutionError &&
    error.code === NavigateErrorCodes.NavigationFailed &&
    error.details?.finalReason === "chromium_network_error_document"
  );
}

async function pollUntil(probe, options = {}) {
  const timeoutMs = positiveTimeout(options.timeoutMs);
  const started = nowMs(options.clock);
  const deadline = started + timeoutMs;

  while (true) {
    throwIfAborted(options.signal);
    const result = await probe();
    if (result) return result;
    const remaining = deadline - nowMs(options.clock);
    if (remaining <= 0) {
      const extra = typeof options.timeoutDetails === "function"
        ? options.timeoutDetails()
        : {};
      throw new NodeExecutionError(
        NodeErrorCodes.Timeout,
        "Navigate readiness wait timed out.",
        {
          timeoutMs,
          retryReason: RetryReasons.NavigationFailure,
          sideEffectState: "unknown",
          ...extra,
        },
      );
    }
    await abortableDelay(
      Math.min(DEFAULT_POLL_MS, remaining),
      options.delay,
      options.signal,
    );
  }
}

async function abortableDelay(ms, delay, signal) {
  throwIfAborted(signal);
  if (!signal) {
    await delay(ms);
    return;
  }
  let onAbort = null;
  try {
    await Promise.race([
      Promise.resolve(delay(ms)),
      new Promise((_, reject) => {
        onAbort = () => reject(cancelled());
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
  throwIfAborted(signal);
}

function resolveSavedReference(reference, tabsByRef) {
  if (typeof reference === "string") {
    return tabsByRef.get(reference.trim()) || null;
  }
  return reference && typeof reference === "object" ? reference : null;
}

function tabIdOf(value) {
  const id = Number(value?.id ?? value?.tabId);
  return Number.isInteger(id) ? id : null;
}

function tabNotFound(source, reference = null, cause = null) {
  return new NodeExecutionError(
    NodeErrorCodes.TabNotFound,
    "Navigate could not resolve the requested browser tab.",
    {
      tabSource: source,
      tabReference: typeof reference === "string" ? reference : null,
      cause: cause?.message || null,
      retryable: false,
    },
  );
}

function isNoHistoryError(error) {
  const message = String(error?.message || error || "");
  return /history entry|no history|cannot find.*(?:back|forward)/i.test(message);
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw cancelled();
}

function cancelled() {
  return new NodeExecutionError(
    NodeErrorCodes.Cancelled,
    "Navigate execution was cancelled.",
    { retryable: false },
  );
}

function requireMethod(object, method, dependency) {
  if (typeof object?.[method] === "function") return;
  throw new NodeExecutionError(
    NodeErrorCodes.DependencyNotReady,
    `Navigate dependency is unavailable: ${dependency}.`,
    { dependency, retryable: false },
  );
}

function positiveTimeout(value) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 30000;
}

function integerOrUndefined(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : undefined;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

function nullableUrl(value) {
  return value === null || value === undefined || value === ""
    ? null
    : String(value);
}

function nowMs(clock) {
  const value = typeof clock === "function" ? clock() : Date.now();
  const numeric = Number(value instanceof Date ? value.getTime() : value);
  return Number.isFinite(numeric) ? numeric : Date.now();
}
