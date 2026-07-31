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
  BookmarkFolderModes,
  BookmarkSelectorKinds,
  CloseBehaviors,
  TabControlErrorCodes,
  TabControlOperations,
  TabNotFoundBehaviors,
  TabReadiness,
} from "./definition.js";
import {
  buildTabControlOutput,
  createTabControlReference,
} from "./outputs.js";
import { normalizeTabControlConfig } from "./validators.js";

const OPEN_OPERATIONS = new Set([
  TabControlOperations.OpenBrowserNewTab,
  TabControlOperations.OpenUrlInNewTab,
]);
const ACTIVATE_OPERATIONS = new Set([
  TabControlOperations.SwitchTab,
  TabControlOperations.SwitchRelativeTab,
  TabControlOperations.ReturnToOriginTab,
  TabControlOperations.FocusTab,
]);
const BOOKMARK_OPERATIONS = new Set([
  TabControlOperations.BookmarkPage,
  TabControlOperations.RemoveBookmark,
]);

export async function executeTabControl(context = {}) {
  const config = normalizeTabControlConfig(context.config || {});
  const services = context.services || {};
  const tabs = requireService(services.tabs, "tabs");
  const originTab = normalizeOptionalTab(context.originTab || context.tab);
  const currentTab = normalizeOptionalTab(context.tab);
  let selected = null;
  let created = null;
  let matchedBy = null;
  let bookmarked = null;
  let actionStarted = false;
  const warnings = [];

  try {
    if (OPEN_OPERATIONS.has(config.operation)) {
      if (
        config.operation === TabControlOperations.OpenUrlInNewTab &&
        config.reuseMatchingTab
      ) {
        const reuse = await tabs.resolve({
          kind: "url",
          value: config.url,
          matchMode: "exact",
          multipleMatchBehavior: "fail",
          currentTab,
        }, serviceOptions(context));
        selected = reuse?.tab || null;
        matchedBy = selected ? "reuse_exact_url" : null;
      }

      if (!selected) {
        actionStarted = true;
        created = normalizeOptionalTab(await tabs.create({
          url: config.operation === TabControlOperations.OpenBrowserNewTab
            ? "chrome://newtab/"
            : config.url,
          active: !config.openInBackground,
          openerTabId: integerOrNull(currentTab?.id),
          windowId: integerOrNull(currentTab?.windowId),
        }, serviceOptions(context)));
        selected = created;
        matchedBy = "created_tab";
      } else if (!config.openInBackground) {
        actionStarted = true;
        selected = normalizeOptionalTab(
          await tabs.activate(selected.id, serviceOptions(context)),
        );
      }

      if (
        selected &&
        config.waitUntil !== TabReadiness.None &&
        config.waitUntil !== TabReadiness.NavigationStart
      ) {
        if (selected.pageCapability === "tab_control_only") {
          warnings.push({
            code: NodeErrorCodes.ProtectedPage,
            message: "DOM readiness was skipped for a protected browser tab.",
          });
        } else {
          await requireMethod(tabs, "waitForReadiness")(
            selected.id,
            config.waitUntil,
            {
              ...serviceOptions(context),
              timeoutMs: config.timeout,
            },
          );
          selected = normalizeOptionalTab(
            await tabs.get(selected.id, serviceOptions(context)),
          );
        }
      }
    } else if (config.operation === TabControlOperations.SwitchRelativeTab) {
      const resolution = await tabs.resolveRelative({
        currentTab,
        direction: config.relativeDirection,
        offset: config.relativeOffset,
        wrapAround: config.wrapAround,
      }, serviceOptions(context));
      selected = resolution?.tab || null;
      matchedBy = resolution?.matchedBy || `relative_${config.relativeDirection}`;
    } else if (config.operation === TabControlOperations.ReturnToOriginTab) {
      selected = originTab
        ? await safeGet(tabs, originTab.id, context)
        : null;
      matchedBy = "origin_tab";
    } else {
      const resolution = await tabs.resolve({
        kind: config.tabSelectorKind,
        value: config.tabSelectorValue,
        matchMode: config.tabMatchMode,
        multipleMatchBehavior: config.multipleMatchBehavior,
        currentTab,
      }, serviceOptions(context));
      selected = resolution?.tab || null;
      matchedBy = resolution?.matchedBy || config.tabSelectorKind;
    }

    if (!selected) {
      return notFoundResult({
        config,
        originTab,
        matchedBy,
        warnings,
      });
    }

    if (ACTIVATE_OPERATIONS.has(config.operation)) {
      actionStarted = true;
      selected = normalizeOptionalTab(
        await tabs.activate(selected.id, serviceOptions(context)),
      );
      if (config.operation === TabControlOperations.FocusTab) {
        await requireMethod(tabs, "focusWindow")(
          selected.windowId,
          serviceOptions(context),
        );
        selected = normalizeOptionalTab(
          await tabs.get(selected.id, serviceOptions(context)),
        );
      }
    } else if (config.operation === TabControlOperations.CloseTab) {
      if (config.confirmBeforeClose) {
        const request = services.confirmation?.request;
        if (typeof request !== "function") {
          throw nodeError(
            TabControlErrorCodes.CloseConfirmationUnavailable,
            "Interactive close confirmation is unavailable.",
            { retryable: false, sideEffectState: SideEffectStates.NotStarted },
            NodeErrorCategories.Dependency,
          );
        }
        const response = await request({
          reason: "close_tab",
          tab: selected,
          timeoutMs: config.timeout,
        }, serviceOptions(context));
        if (!(response === true || response?.approved === true)) {
          throw nodeError(
            TabControlErrorCodes.CloseNotConfirmed,
            "The user did not approve closing the selected tab.",
            { retryable: false, sideEffectState: SideEffectStates.NotStarted },
            NodeErrorCategories.Cancelled,
          );
        }
      }
      const fallback = await tabs.resolveCloseFallback(
        selected,
        config.closeBehavior,
        serviceOptions(context),
      );
      actionStarted = true;
      await tabs.remove(selected.id, serviceOptions(context));
      await tabs.removeReferencesForTab?.(selected.id, serviceOptions(context));
      selected = null;
      if (fallback?.id) {
        selected = normalizeOptionalTab(
          await tabs.activate(fallback.id, serviceOptions(context)),
        );
      }
    } else if (
      [
        TabControlOperations.PinTab,
        TabControlOperations.UnpinTab,
      ].includes(config.operation)
    ) {
      actionStarted = true;
      selected = normalizeOptionalTab(await tabs.updateState(
        selected.id,
        { pinned: config.operation === TabControlOperations.PinTab },
        serviceOptions(context),
      ));
    } else if (
      [
        TabControlOperations.MuteTab,
        TabControlOperations.UnmuteTab,
        TabControlOperations.ToggleMute,
      ].includes(config.operation)
    ) {
      const muted = config.operation === TabControlOperations.ToggleMute
        ? !isMuted(selected)
        : config.operation === TabControlOperations.MuteTab;
      actionStarted = true;
      selected = normalizeOptionalTab(await tabs.updateState(
        selected.id,
        { muted },
        serviceOptions(context),
      ));
    } else if (BOOKMARK_OPERATIONS.has(config.operation)) {
      const bookmarks = requireService(services.bookmarks, "bookmarks");
      const permitted = await bookmarks.hasPermission(serviceOptions(context));
      if (!permitted) {
        throw nodeError(
          TabControlErrorCodes.BookmarkPermissionUnavailable,
          "The optional bookmarks permission is unavailable. Grant it from a visible Graph Studio control.",
          { retryable: false, sideEffectState: SideEffectStates.NotStarted },
          NodeErrorCategories.Dependency,
        );
      }
      if (!selected.url) {
        throw nodeError(
          TabControlErrorCodes.OperationFailed,
          "The selected tab has no bookmarkable URL.",
          { operation: config.operation, retryable: false },
          NodeErrorCategories.Tab,
        );
      }

      if (config.operation === TabControlOperations.BookmarkPage) {
        const folderId =
          config.bookmarkFolderMode === BookmarkFolderModes.FolderId
            ? config.bookmarkFolderId
            : await bookmarks.getDefaultBarId(serviceOptions(context));
        const existing = await bookmarks.findByUrl(
          selected.url,
          serviceOptions(context),
        );
        const inFolder = existing.filter((bookmark) => (
          String(bookmark.parentId || "") === String(folderId || "")
        ));
        if (!inFolder.length) {
          actionStarted = true;
          await bookmarks.create({
            parentId: folderId,
            title: selected.title || selected.url,
            url: selected.url,
          }, serviceOptions(context));
        }
        bookmarked = true;
      } else {
        const matches =
          config.bookmarkSelectorKind === BookmarkSelectorKinds.BookmarkId
            ? await bookmarks.getById(config.bookmarkId, serviceOptions(context))
            : await bookmarks.findByUrl(selected.url, serviceOptions(context));
        if (!matches.length) {
          bookmarked = false;
        } else {
          if (
            matches.length > 1 &&
            !config.removeAllBookmarkMatches &&
            config.bookmarkSelectorKind === BookmarkSelectorKinds.CurrentPageUrl
          ) {
            throw nodeError(
              TabControlErrorCodes.AmbiguousSelector,
              "More than one bookmark has the selected page URL.",
              {
                bookmarkIds: matches.map((bookmark) => bookmark.id),
                retryable: false,
                sideEffectState: SideEffectStates.NotStarted,
              },
              NodeErrorCategories.Tab,
            );
          }
          actionStarted = true;
          const removals = config.removeAllBookmarkMatches
            ? matches
            : matches.slice(0, 1);
          for (const bookmark of removals) {
            await bookmarks.remove(bookmark.id, serviceOptions(context));
          }
          bookmarked = false;
        }
      }
    }

    if (selected?.id && config.saveTabReferenceAs) {
      await requireMethod(tabs, "saveReference")(
        config.saveTabReferenceAs,
        createTabControlReference(selected),
        serviceOptions(context),
      );
    }

    const output = buildOutput({
      config,
      originTab,
      tab: selected,
      createdTab: created,
      matchedBy,
      bookmarked,
    });
    return { output, warnings, executionMethod: "browser" };
  } catch (error) {
    if (error instanceof NodeExecutionError) throw error;
    throw nodeError(
      TabControlErrorCodes.OperationFailed,
      error?.message || "Browser tab operation failed.",
      {
        operation: config.operation,
        tabId: selected?.id ?? null,
        createdTabId: created?.id ?? null,
        expectedState: expectedState(config, selected),
        retryReason: RetryReasons.AnyError,
        sideEffectState: actionStarted
          ? SideEffectStates.Unknown
          : SideEffectStates.NotStarted,
      },
      NodeErrorCategories.Tab,
    );
  }
}

export async function verifyTabControlBeforeRetry({
  config: rawConfig = {},
  services = {},
  error = null,
} = {}) {
  const config = normalizeTabControlConfig(rawConfig);
  const tabs = requireService(services.tabs, "tabs");
  const details = error?.details || {};
  if (details.retryable === false) {
    return { sideEffectState: SideEffectStates.Unknown, result: "blocked" };
  }
  if (details.sideEffectState === SideEffectStates.NotStarted) {
    return {
      sideEffectState: SideEffectStates.NotStarted,
      result: "not_completed",
    };
  }

  const tabId = Number(details.createdTabId ?? details.tabId);
  if (OPEN_OPERATIONS.has(config.operation) && Number.isInteger(tabId)) {
    const tab = await safeGet(tabs, tabId, {});
    return tab
      ? { sideEffectState: SideEffectStates.Completed, result: "completed" }
      : { sideEffectState: SideEffectStates.NotCompleted, result: "not_completed" };
  }
  if (config.operation === TabControlOperations.CloseTab && Number.isInteger(tabId)) {
    const tab = await safeGet(tabs, tabId, {});
    return !tab
      ? { sideEffectState: SideEffectStates.Completed, result: "completed" }
      : { sideEffectState: SideEffectStates.NotCompleted, result: "not_completed" };
  }
  if (ACTIVATE_OPERATIONS.has(config.operation) && Number.isInteger(tabId)) {
    const tab = await safeGet(tabs, tabId, {});
    if (tab?.active === true) {
      return { sideEffectState: SideEffectStates.Completed, result: "completed" };
    }
    if (tab) {
      return { sideEffectState: SideEffectStates.NotCompleted, result: "not_completed" };
    }
  }
  if (Number.isInteger(tabId) && details.expectedState) {
    const tab = await safeGet(tabs, tabId, {});
    if (tab) {
      const completed = Object.entries(details.expectedState).every(
        ([key, value]) => tabState(tab, key) === value,
      );
      return completed
        ? { sideEffectState: SideEffectStates.Completed, result: "completed" }
        : { sideEffectState: SideEffectStates.NotCompleted, result: "not_completed" };
    }
  }
  return { sideEffectState: SideEffectStates.Unknown, result: "unknown" };
}

function notFoundResult({ config, originTab, matchedBy, warnings }) {
  const error = new NodeExecutionError(
    NodeErrorCodes.TabNotFound,
    "Tab Control could not resolve the requested browser tab.",
    {
      operation: config.operation,
      selectorKind: config.tabSelectorKind,
      requestedRoute:
        config.ifNotFound === TabNotFoundBehaviors.ErrorPort ? "error" : null,
      retryable: true,
      retryReason: RetryReasons.TargetNotFound,
      sideEffectState: SideEffectStates.NotStarted,
    },
  );
  if (config.ifNotFound !== TabNotFoundBehaviors.Skip) throw error;
  warnings.push({
    code: NodeErrorCodes.TabNotFound,
    message: "Requested tab was not found; Tab Control skipped deliberately.",
  });
  return {
    output: buildOutput({
      config,
      originTab,
      tab: null,
      createdTab: null,
      matchedBy,
      bookmarked: null,
    }),
    warnings,
    executionMethod: "browser",
  };
}

function buildOutput({ config, originTab, tab, createdTab, matchedBy, bookmarked }) {
  return buildTabControlOutput({
    operation: config.operation,
    originTab,
    tab,
    createdTab,
    pageCapability: tab?.pageCapability || createdTab?.pageCapability || null,
    matchedBy,
    pinned: tab ? tab.pinned === true : null,
    muted: tab ? isMuted(tab) : null,
    bookmarked,
  });
}

function expectedState(config, tab) {
  if (!tab) return null;
  if (config.operation === TabControlOperations.PinTab) return { pinned: true };
  if (config.operation === TabControlOperations.UnpinTab) return { pinned: false };
  if (config.operation === TabControlOperations.MuteTab) return { muted: true };
  if (config.operation === TabControlOperations.UnmuteTab) return { muted: false };
  return null;
}

function tabState(tab, key) {
  return key === "muted" ? isMuted(tab) : tab[key];
}

function isMuted(tab) {
  return tab?.mutedInfo?.muted === true || tab?.muted === true;
}

function normalizeOptionalTab(tab) {
  if (!tab || !Number.isInteger(Number(tab.id))) return null;
  return {
    ...structuredClone(tab),
    id: Number(tab.id),
    pageCapability: tab.pageCapability ||
      (/^(?:chrome|edge):\/\/|^about:|^view-source:|^chrome-extension:|^devtools:/i
        .test(String(tab.url || ""))
        ? "tab_control_only"
        : "dom_supported"),
  };
}

async function safeGet(tabs, tabId, context) {
  if (!Number.isInteger(Number(tabId)) || typeof tabs.get !== "function") return null;
  try {
    return normalizeOptionalTab(
      await tabs.get(Number(tabId), serviceOptions(context)),
    );
  } catch {
    return null;
  }
}

function requireService(service, name) {
  if (service && typeof service === "object") return service;
  throw new NodeExecutionError(
    NodeErrorCodes.DependencyNotReady,
    `Tab Control dependency is unavailable: ${name}.`,
    { dependency: name, retryable: false },
  );
}

function requireMethod(service, name) {
  if (typeof service?.[name] === "function") return service[name].bind(service);
  throw new NodeExecutionError(
    NodeErrorCodes.DependencyNotReady,
    `Tab Control dependency is unavailable: tabs.${name}.`,
    { dependency: `tabs.${name}`, retryable: false },
  );
}

function nodeError(code, message, details, category) {
  return new NodeExecutionError(code, message, details, { category });
}

function serviceOptions(context) {
  return { signal: context?.signal };
}

function integerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}
