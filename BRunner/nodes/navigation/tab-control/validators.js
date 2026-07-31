import {
  NodeErrorCodes,
  NodeExecutionError,
  normalizeCommonNodeConfig,
} from "../../shared/nodeContracts.js";
import { RetryReasons } from "../../shared/executionPolicy.js";
import {
  BookmarkFolderModes,
  BookmarkSelectorKinds,
  CloseBehaviors,
  MultipleMatchBehaviors,
  RelativeDirections,
  TabControlDefaults,
  TabControlOperations,
  TabNotFoundBehaviors,
  TabReadiness,
  TabMatchModes,
  TabSelectorKinds,
} from "./definition.js";

const URL_PROTOCOLS = new Set([
  "http:",
  "https:",
  "file:",
  "about:",
  "chrome:",
  "chrome-extension:",
  "edge:",
]);

const SELECTOR_VALUE_KINDS = new Set([
  TabSelectorKinds.SavedReference,
  TabSelectorKinds.Id,
  TabSelectorKinds.Index,
  TabSelectorKinds.Title,
  TabSelectorKinds.Url,
]);

const SELECTOR_OPERATIONS = new Set([
  TabControlOperations.SwitchTab,
  TabControlOperations.CloseTab,
  TabControlOperations.FocusTab,
  TabControlOperations.PinTab,
  TabControlOperations.UnpinTab,
  TabControlOperations.MuteTab,
  TabControlOperations.UnmuteTab,
  TabControlOperations.ToggleMute,
  TabControlOperations.BookmarkPage,
  TabControlOperations.RemoveBookmark,
]);

export function normalizeTabControlConfig(value = {}) {
  if (!isPlainObject(value)) invalid("Tab Control configuration must be an object.");
  validateRawCommon(value);

  const common = normalizeCommonNodeConfig(value, TabControlDefaults);
  const config = {
    ...common,
    operation: enumValue(
      value.operation,
      Object.values(TabControlOperations),
      TabControlDefaults.operation,
      "operation",
    ),
    tabSelectorKind: enumValue(
      value.tabSelectorKind,
      Object.values(TabSelectorKinds),
      TabControlDefaults.tabSelectorKind,
      "tabSelectorKind",
    ),
    tabSelectorValue:
      value.tabSelectorValue === undefined
        ? TabControlDefaults.tabSelectorValue
        : clone(value.tabSelectorValue),
    tabMatchMode: enumValue(
      value.tabMatchMode,
      Object.values(TabMatchModes),
      TabControlDefaults.tabMatchMode,
      "tabMatchMode",
    ),
    multipleMatchBehavior: enumValue(
      value.multipleMatchBehavior,
      Object.values(MultipleMatchBehaviors),
      TabControlDefaults.multipleMatchBehavior,
      "multipleMatchBehavior",
    ),
    relativeDirection: enumValue(
      value.relativeDirection,
      Object.values(RelativeDirections),
      TabControlDefaults.relativeDirection,
      "relativeDirection",
    ),
    relativeOffset: integerValue(
      value.relativeOffset,
      TabControlDefaults.relativeOffset,
      1,
      Number.MAX_SAFE_INTEGER,
      "relativeOffset",
    ),
    wrapAround: booleanValue(
      value.wrapAround,
      TabControlDefaults.wrapAround,
      "wrapAround",
    ),
    url: String(value.url ?? "").trim(),
    openInBackground: booleanValue(
      value.openInBackground,
      TabControlDefaults.openInBackground,
      "openInBackground",
    ),
    reuseMatchingTab: booleanValue(
      value.reuseMatchingTab,
      TabControlDefaults.reuseMatchingTab,
      "reuseMatchingTab",
    ),
    closeBehavior: enumValue(
      value.closeBehavior,
      Object.values(CloseBehaviors),
      TabControlDefaults.closeBehavior,
      "closeBehavior",
    ),
    ifNotFound: enumValue(
      value.ifNotFound,
      Object.values(TabNotFoundBehaviors),
      TabControlDefaults.ifNotFound,
      "ifNotFound",
    ),
    waitUntil: enumValue(
      value.waitUntil,
      Object.values(TabReadiness),
      TabControlDefaults.waitUntil,
      "waitUntil",
    ),
    saveTabReferenceAs: optionalString(value.saveTabReferenceAs),
    confirmBeforeClose: booleanValue(
      value.confirmBeforeClose,
      TabControlDefaults.confirmBeforeClose,
      "confirmBeforeClose",
    ),
    bookmarkFolderMode: enumValue(
      value.bookmarkFolderMode,
      Object.values(BookmarkFolderModes),
      TabControlDefaults.bookmarkFolderMode,
      "bookmarkFolderMode",
    ),
    bookmarkFolderId: optionalString(value.bookmarkFolderId),
    bookmarkSelectorKind: enumValue(
      value.bookmarkSelectorKind,
      Object.values(BookmarkSelectorKinds),
      TabControlDefaults.bookmarkSelectorKind,
      "bookmarkSelectorKind",
    ),
    bookmarkId: optionalString(value.bookmarkId),
    removeAllBookmarkMatches: booleanValue(
      value.removeAllBookmarkMatches,
      TabControlDefaults.removeAllBookmarkMatches,
      "removeAllBookmarkMatches",
    ),
    workflowClipboardEntry: optionalString(value.workflowClipboardEntry),
  };

  if (!Number.isFinite(config.timeout) || config.timeout <= 0) {
    invalid("Tab Control timeout must be greater than zero.", {
      field: "timeout",
    });
  }

  if (
    SELECTOR_OPERATIONS.has(config.operation) &&
    SELECTOR_VALUE_KINDS.has(config.tabSelectorKind) &&
    !hasSelectorValue(config.tabSelectorValue)
  ) {
    invalid(
      `tabSelectorValue is required for ${config.tabSelectorKind}.`,
      { field: "tabSelectorValue" },
    );
  }
  if (config.tabSelectorKind === TabSelectorKinds.Id) {
    config.tabSelectorValue = integerValue(
      config.tabSelectorValue,
      null,
      0,
      Number.MAX_SAFE_INTEGER,
      "tabSelectorValue",
    );
  }
  if (config.tabSelectorKind === TabSelectorKinds.Index) {
    config.tabSelectorValue = integerValue(
      config.tabSelectorValue,
      null,
      0,
      Number.MAX_SAFE_INTEGER,
      "tabSelectorValue",
    );
  }
  if (config.operation === TabControlOperations.OpenUrlInNewTab) {
    config.url = normalizeTabControlUrl(config.url);
  } else if (config.url) {
    invalid("url is only supported by open_url_in_new_tab.", { field: "url" });
  }
  if (
    config.reuseMatchingTab &&
    config.operation !== TabControlOperations.OpenUrlInNewTab
  ) {
    invalid("reuseMatchingTab only applies to open_url_in_new_tab.", {
      field: "reuseMatchingTab",
    });
  }
  if (
    config.confirmBeforeClose &&
    config.operation !== TabControlOperations.CloseTab
  ) {
    invalid("confirmBeforeClose only applies to close_tab.", {
      field: "confirmBeforeClose",
    });
  }
  if (
    config.operation === TabControlOperations.BookmarkPage &&
    config.bookmarkFolderMode === BookmarkFolderModes.FolderId &&
    !config.bookmarkFolderId
  ) {
    invalid("bookmarkFolderId is required for folder_id.", {
      field: "bookmarkFolderId",
    });
  }
  if (
    config.operation === TabControlOperations.RemoveBookmark &&
    config.bookmarkSelectorKind === BookmarkSelectorKinds.BookmarkId &&
    !config.bookmarkId
  ) {
    invalid("bookmarkId is required for bookmark_id.", { field: "bookmarkId" });
  }
  if (
    config.removeAllBookmarkMatches &&
    (
      config.operation !== TabControlOperations.RemoveBookmark ||
      config.bookmarkSelectorKind !== BookmarkSelectorKinds.CurrentPageUrl
    )
  ) {
    invalid(
      "removeAllBookmarkMatches only applies to current-page URL removal.",
      { field: "removeAllBookmarkMatches" },
    );
  }

  return Object.freeze(config);
}

export function validateTabControlConfig(value = {}, options = {}) {
  try {
    const config =
      options.allowExpressions === true && containsExpression(value)
        ? validateExpressionConfig(value)
        : normalizeTabControlConfig(value);
    return { valid: true, config, errors: [] };
  } catch (error) {
    if (error instanceof NodeExecutionError) {
      return { valid: false, config: null, errors: [error.message] };
    }
    throw error;
  }
}

export function normalizeTabControlUrl(value) {
  const input = String(value ?? "").trim();
  if (!input) {
    invalid("URL is required for open_url_in_new_tab.", { field: "url" });
  }
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    invalid("Tab Control requires an absolute URL and never treats text as search.", {
      field: "url",
      value: input,
    });
  }
  if (!URL_PROTOCOLS.has(parsed.protocol)) {
    invalid("URL protocol is not supported for tab creation.", {
      field: "url",
      protocol: parsed.protocol,
    });
  }
  if (
    ["http:", "https:"].includes(parsed.protocol) &&
    !String(parsed.hostname || "").trim()
  ) {
    invalid("HTTP tab URLs require a hostname.", { field: "url" });
  }
  return parsed.href;
}

export function selectorRequiresValue(kind) {
  return SELECTOR_VALUE_KINDS.has(kind);
}

export function operationUsesSelector(operation) {
  return SELECTOR_OPERATIONS.has(operation);
}

function validateExpressionConfig(value) {
  const probe = structuredClone(value);
  if (isExpression(probe.url)) {
    probe.url = /^\s*\{\{[^{}]+\}\}\s*$/.test(probe.url)
      ? "https://expression.invalid/"
      : probe.url.replace(/\{\{[^{}]+\}\}/g, "expression");
  }
  if (isExpression(probe.tabSelectorValue)) {
    probe.tabSelectorValue = ["id", "index"].includes(probe.tabSelectorKind)
      ? 1
      : "expression";
  }
  for (const [key, fallback] of Object.entries({
    relativeOffset: TabControlDefaults.relativeOffset,
    timeout: TabControlDefaults.timeout,
    retryCount: TabControlDefaults.retryCount,
    retryDelay: TabControlDefaults.retryDelay,
  })) {
    if (isExpression(probe[key])) probe[key] = fallback;
  }
  normalizeTabControlConfig(probe);
  return Object.freeze(structuredClone(value));
}

function validateRawCommon(value) {
  if (
    Object.prototype.hasOwnProperty.call(value, "timeout") &&
    !isExpression(value.timeout) &&
    (!Number.isFinite(Number(value.timeout)) || Number(value.timeout) <= 0)
  ) {
    invalid("Tab Control timeout must be greater than zero.", { field: "timeout" });
  }
  if (
    Object.prototype.hasOwnProperty.call(value, "retryCount") &&
    !isExpression(value.retryCount) &&
    (!Number.isInteger(Number(value.retryCount)) || Number(value.retryCount) < 0)
  ) {
    invalid("retryCount must be a non-negative integer.", { field: "retryCount" });
  }
  if (
    Object.prototype.hasOwnProperty.call(value, "retryDelay") &&
    !isExpression(value.retryDelay) &&
    (!Number.isFinite(Number(value.retryDelay)) || Number(value.retryDelay) < 0)
  ) {
    invalid("retryDelay must be a non-negative number.", { field: "retryDelay" });
  }
  for (const key of [
    "enabled",
    "wrapAround",
    "openInBackground",
    "reuseMatchingTab",
    "confirmBeforeClose",
    "removeAllBookmarkMatches",
  ]) {
    if (
      Object.prototype.hasOwnProperty.call(value, key) &&
      typeof value[key] !== "boolean"
    ) {
      invalid(`${key} must be boolean.`, { field: key });
    }
  }
  for (const key of [
    "displayName",
    "saveTabReferenceAs",
    "bookmarkFolderId",
    "bookmarkId",
    "saveOutputAs",
    "workflowClipboardEntry",
  ]) {
    if (
      Object.prototype.hasOwnProperty.call(value, key) &&
      value[key] !== null &&
      typeof value[key] !== "string"
    ) {
      invalid(`${key} must be text.`, { field: key });
    }
  }
  validateRawEnum(value, "retryStrategy", ["fixed", "increasing"]);
  validateRawEnum(value, "onError", [
    "fail",
    "continue_with_warning",
    "skip",
    "error_port",
  ]);
  validateRawEnum(value, "saveToWorkflowClipboard", [
    "off",
    "replace",
    "append",
    "version",
  ]);
  validateRawEnum(value, "logLevel", ["normal", "verbose"]);
  if (Object.prototype.hasOwnProperty.call(value, "retryOnlyFor")) {
    const reasons = Array.isArray(value.retryOnlyFor)
      ? value.retryOnlyFor
      : [value.retryOnlyFor];
    const allowed = [
      RetryReasons.TargetNotFound,
      RetryReasons.Timeout,
      RetryReasons.AnyError,
    ];
    if (
      reasons.length === 0 ||
      reasons.some((reason) => !allowed.includes(String(reason || "").trim()))
    ) {
      invalid("retryOnlyFor contains an unsupported retry reason.", {
        field: "retryOnlyFor",
        allowed,
      });
    }
  }
}

function validateRawEnum(value, key, allowed) {
  if (
    Object.prototype.hasOwnProperty.call(value, key) &&
    !allowed.includes(String(value[key] || "").trim())
  ) {
    invalid(`${key} is invalid.`, { field: key, allowed });
  }
}

function enumValue(value, allowed, fallback, field) {
  const normalized = value === undefined ? fallback : String(value).trim();
  if (!allowed.includes(normalized)) {
    invalid(`${field} is invalid.`, { field, allowed });
  }
  return normalized;
}

function integerValue(value, fallback, minimum, maximum, field) {
  const candidate = value === undefined ? fallback : value;
  const numeric = Number(candidate);
  if (
    !Number.isInteger(numeric) ||
    numeric < minimum ||
    numeric > maximum
  ) {
    invalid(`${field} must be an integer from ${minimum} to ${maximum}.`, {
      field,
    });
  }
  return numeric;
}

function booleanValue(value, fallback, field) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") invalid(`${field} must be boolean.`, { field });
  return value;
}

function optionalString(value) {
  if (value === undefined || value === null || value === "") return "";
  return String(value).trim();
}

function hasSelectorValue(value) {
  if (value && typeof value === "object") {
    return Number.isInteger(Number(value.id ?? value.tabId));
  }
  return String(value ?? "").trim().length > 0;
}

function invalid(message, details = {}) {
  throw new NodeExecutionError(
    NodeErrorCodes.ConfigInvalid,
    message,
    { ...details, retryable: false },
  );
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function containsExpression(value) {
  return Object.values(value || {}).some(isExpression);
}

function isExpression(value) {
  return typeof value === "string" && /\{\{[^{}]+\}\}/.test(value);
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
