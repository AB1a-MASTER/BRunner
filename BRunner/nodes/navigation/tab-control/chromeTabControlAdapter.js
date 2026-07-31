import {
  NodeErrorCodes,
  NodeExecutionError,
} from "../../shared/nodeContracts.js";
import {
  createChromeNavigateTabsService,
} from "../navigate/chromeTabsAdapter.js";
import {
  CloseBehaviors,
} from "./definition.js";
import {
  orderTabs,
  selectRelativeTab,
  selectTabFromCandidates,
} from "./tabSelector.js";

export function createChromeTabControlService(options = {}) {
  const chromeApi = options.chromeApi || globalThis.chrome;
  const tabsApi = chromeApi?.tabs;
  const windowsApi = chromeApi?.windows;
  const tabsByRef = options.tabsByRef instanceof Map
    ? options.tabsByRef
    : new Map();
  const creationSequence = options.creationSequence instanceof Map
    ? options.creationSequence
    : new Map();
  const sequenceState = options.sequenceState &&
      typeof options.sequenceState === "object"
    ? options.sequenceState
    : { value: highestSequence(creationSequence) };
  const navigate = createChromeNavigateTabsService({
    chromeApi,
    tabsByRef,
    currentTab: options.currentTab || null,
    delay: options.delay,
    clock: options.clock,
  });
  let lastTab = options.currentTab || null;

  requireMethod(tabsApi, "get", "chrome.tabs.get");
  requireMethod(tabsApi, "query", "chrome.tabs.query");

  return {
    creationSequence,

    async resolve(request = {}, runtime = {}) {
      throwIfAborted(runtime.signal);
      const tabs = await tabsApi.query({});
      const referencedTab = request.kind === "saved_reference"
        ? resolveReference(request.value, tabsByRef)
        : null;
      const selected = selectTabFromCandidates({
        kind: request.kind,
        value: request.value,
        matchMode: request.matchMode,
        multipleMatchBehavior: request.multipleMatchBehavior,
        currentTab: request.currentTab || options.currentTab || lastTab,
        referencedTab,
        tabs,
        creationSequence,
      });
      if (selected.tab?.id) {
        try {
          selected.tab = remember(await tabsApi.get(Number(selected.tab.id)));
        } catch {
          selected.tab = null;
        }
      }
      return selected;
    },

    async resolveRelative(request = {}, runtime = {}) {
      throwIfAborted(runtime.signal);
      const tabs = await tabsApi.query({});
      const selected = selectRelativeTab({
        currentTab: request.currentTab || options.currentTab || lastTab,
        tabs,
        direction: request.direction,
        offset: request.offset,
        wrapAround: request.wrapAround,
      });
      if (selected.tab?.id) {
        selected.tab = remember(await tabsApi.get(Number(selected.tab.id)));
      }
      return selected;
    },

    async get(tabId, runtime = {}) {
      throwIfAborted(runtime.signal);
      return remember(await tabsApi.get(Number(tabId)));
    },

    async create(properties = {}, runtime = {}) {
      throwIfAborted(runtime.signal);
      requireMethod(tabsApi, "create", "chrome.tabs.create");
      const tab = remember(await tabsApi.create(compactObject({
        url: properties.url,
        active: properties.active !== false,
        openerTabId: integerOrUndefined(properties.openerTabId),
        windowId: integerOrUndefined(properties.windowId),
      })));
      sequenceState.value = Math.max(0, Number(sequenceState.value) || 0) + 1;
      creationSequence.set(Number(tab.id), sequenceState.value);
      return tab;
    },

    async activate(tabId, runtime = {}) {
      throwIfAborted(runtime.signal);
      requireMethod(tabsApi, "update", "chrome.tabs.update");
      return remember(await tabsApi.update(Number(tabId), { active: true }));
    },

    async focusWindow(windowId, runtime = {}) {
      throwIfAborted(runtime.signal);
      requireMethod(windowsApi, "update", "chrome.windows.update");
      return await windowsApi.update(Number(windowId), { focused: true });
    },

    async updateState(tabId, state = {}, runtime = {}) {
      throwIfAborted(runtime.signal);
      requireMethod(tabsApi, "update", "chrome.tabs.update");
      return remember(await tabsApi.update(Number(tabId), compactObject({
        pinned: typeof state.pinned === "boolean" ? state.pinned : undefined,
        muted: typeof state.muted === "boolean" ? state.muted : undefined,
      })));
    },

    async remove(tabId, runtime = {}) {
      throwIfAborted(runtime.signal);
      requireMethod(tabsApi, "remove", "chrome.tabs.remove");
      await tabsApi.remove(Number(tabId));
      creationSequence.delete(Number(tabId));
      if (lastTab?.id === Number(tabId)) lastTab = null;
    },

    async resolveCloseFallback(tab, behavior, runtime = {}) {
      throwIfAborted(runtime.signal);
      if (behavior === CloseBehaviors.None) return null;
      if (
        behavior === CloseBehaviors.Opener &&
        Number.isInteger(Number(tab?.openerTabId))
      ) {
        try {
          return await tabsApi.get(Number(tab.openerTabId));
        } catch {
          return null;
        }
      }
      const tabs = orderTabs(await tabsApi.query({ windowId: Number(tab.windowId) }))
        .filter((candidate) => Number(candidate.id) !== Number(tab.id));
      if (behavior === CloseBehaviors.Left) {
        return tabs.filter((candidate) => Number(candidate.index) < Number(tab.index)).at(-1) || null;
      }
      if (behavior === CloseBehaviors.Right) {
        return tabs.find((candidate) => Number(candidate.index) > Number(tab.index)) || null;
      }
      if (behavior === CloseBehaviors.MostRecent) {
        return mostRecentTracked(tabs, creationSequence);
      }
      return null;
    },

    async saveReference(name, reference, runtime = {}) {
      throwIfAborted(runtime.signal);
      const key = String(name || "").trim();
      const id = Number(reference?.tabId ?? reference?.id);
      if (!key || !Number.isInteger(id)) {
        throw new NodeExecutionError(
          NodeErrorCodes.ConfigInvalid,
          "Tab Control requires a valid reference name and tab ID.",
          { field: "saveTabReferenceAs", retryable: false },
        );
      }
      const tab = await tabsApi.get(id);
      tabsByRef.set(key, { ...tab, tabId: id, kind: "tab" });
    },

    async removeReferencesForTab(tabId) {
      for (const [name, reference] of tabsByRef.entries()) {
        if (Number(reference?.id ?? reference?.tabId) === Number(tabId)) {
          tabsByRef.delete(name);
        }
      }
    },

    async waitForReadiness(tabId, readiness, runtime = {}) {
      return await navigate.waitForReadiness(tabId, readiness, runtime);
    },

    currentTab() {
      return lastTab ? structuredClone(lastTab) : null;
    },
  };

  function remember(tab) {
    if (!tab || !Number.isInteger(Number(tab.id))) return tab;
    const normalized = !tab.url && tab.pendingUrl
      ? { ...tab, url: tab.pendingUrl }
      : tab;
    lastTab = structuredClone(normalized);
    return normalized;
  }
}

export function createChromeBookmarksService(options = {}) {
  const chromeApi = options.chromeApi || globalThis.chrome;
  const bookmarksApi = chromeApi?.bookmarks;
  const permissionsApi = chromeApi?.permissions;

  return {
    async hasPermission(runtime = {}) {
      throwIfAborted(runtime.signal);
      if (typeof permissionsApi?.contains !== "function") return false;
      return await permissionsApi.contains({ permissions: ["bookmarks"] });
    },

    async getDefaultBarId(runtime = {}) {
      throwIfAborted(runtime.signal);
      requireMethod(bookmarksApi, "getTree", "chrome.bookmarks.getTree");
      const tree = await bookmarksApi.getTree();
      const root = tree?.[0];
      const bar = root?.children?.find((child) => (
        !child.url && Array.isArray(child.children)
      ));
      if (!bar?.id) {
        throw new NodeExecutionError(
          NodeErrorCodes.DependencyNotReady,
          "Chrome's default bookmark bar could not be resolved.",
          { dependency: "bookmarks.default_bar", retryable: false },
        );
      }
      return String(bar.id);
    },

    async findByUrl(url, runtime = {}) {
      throwIfAborted(runtime.signal);
      requireMethod(bookmarksApi, "search", "chrome.bookmarks.search");
      const matches = await bookmarksApi.search({ url: String(url) });
      return matches.filter((bookmark) => String(bookmark.url || "") === String(url));
    },

    async getById(id, runtime = {}) {
      throwIfAborted(runtime.signal);
      requireMethod(bookmarksApi, "get", "chrome.bookmarks.get");
      try {
        const matches = await bookmarksApi.get(String(id));
        return Array.isArray(matches) ? matches : [];
      } catch {
        return [];
      }
    },

    async create(bookmark, runtime = {}) {
      throwIfAborted(runtime.signal);
      requireMethod(bookmarksApi, "create", "chrome.bookmarks.create");
      return await bookmarksApi.create(bookmark);
    },

    async remove(id, runtime = {}) {
      throwIfAborted(runtime.signal);
      requireMethod(bookmarksApi, "remove", "chrome.bookmarks.remove");
      await bookmarksApi.remove(String(id));
    },
  };
}

function resolveReference(value, references) {
  if (value && typeof value === "object") return value;
  return references.get(String(value || "").trim()) || null;
}

function mostRecentTracked(tabs, creationSequence) {
  let selected = null;
  let sequence = -Infinity;
  for (const tab of tabs) {
    const candidate = Number(creationSequence.get(Number(tab.id)));
    if (Number.isFinite(candidate) && candidate > sequence) {
      selected = tab;
      sequence = candidate;
    }
  }
  return selected;
}

function highestSequence(sequence) {
  return Math.max(0, ...[...sequence.values()]
    .map(Number)
    .filter(Number.isFinite));
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw new NodeExecutionError(
    NodeErrorCodes.Cancelled,
    "Tab Control execution was cancelled.",
    { retryable: false },
  );
}

function requireMethod(object, name, dependency) {
  if (typeof object?.[name] === "function") return;
  throw new NodeExecutionError(
    NodeErrorCodes.DependencyNotReady,
    `Tab Control dependency is unavailable: ${dependency}.`,
    { dependency, retryable: false },
  );
}

function integerOrUndefined(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : undefined;
}

function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  );
}
