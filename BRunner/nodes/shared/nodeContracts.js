/**
 * Finalized shared node contracts.
 *
 * This module is deliberately independent from the workflow runner. Node
 * packages and adapters can import it without creating a dependency on the
 * background service, registry implementation, or editor.
 */

const nodeStatuses = {
  QUEUED: "queued",
  WAITING_FOR_DEPENDENCIES: "waiting_for_dependencies",
  RUNNING: "running",
  WAITING_ASYNC: "waiting_async",
  COMPLETED: "completed",
  FAILED: "failed",
  TIMED_OUT: "timed_out",
  CANCELLED: "cancelled",
  SKIPPED_DISABLED: "skipped_disabled",
};

defineAliases(nodeStatuses, {
  Queued: "QUEUED",
  WaitingForDependencies: "WAITING_FOR_DEPENDENCIES",
  Running: "RUNNING",
  WaitingAsync: "WAITING_ASYNC",
  Completed: "COMPLETED",
  Failed: "FAILED",
  TimedOut: "TIMED_OUT",
  Cancelled: "CANCELLED",
  SkippedDisabled: "SKIPPED_DISABLED",
});

export const NodeStatuses = Object.freeze(nodeStatuses);

const nodeErrorCodes = {
  CONFIG_INVALID: "CONFIG_INVALID",
  DEPENDENCY_NOT_READY: "DEPENDENCY_NOT_READY",
  TARGET_NOT_FOUND: "TARGET_NOT_FOUND",
  AMBIGUOUS_TARGET: "AMBIGUOUS_TARGET",
  TARGET_NOT_INTERACTABLE: "TARGET_NOT_INTERACTABLE",
  TARGET_NOT_VISIBLE: "TARGET_NOT_VISIBLE",
  PROTECTED_PAGE: "PROTECTED_PAGE",
  TAB_NOT_FOUND: "TAB_NOT_FOUND",
  HOST_UNAVAILABLE: "HOST_UNAVAILABLE",
  HOST_FOREGROUND_REQUIRED: "HOST_FOREGROUND_REQUIRED",
  HOST_COORDINATE_LOW_CONFIDENCE: "HOST_COORDINATE_LOW_CONFIDENCE",
  TIMEOUT: "TIMEOUT",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  FILE_ACCESS_DENIED: "FILE_ACCESS_DENIED",
  FILE_PARSE_FAILED: "FILE_PARSE_FAILED",
  DOWNLOAD_NOT_FOUND: "DOWNLOAD_NOT_FOUND",
  DIALOG_NOT_FOUND: "DIALOG_NOT_FOUND",
  MISSING_REQUIRED_OUTPUT: "MISSING_REQUIRED_OUTPUT",
  CODE_EXECUTION_FAILED: "CODE_EXECUTION_FAILED",
  FUNCTION_EXECUTION_FAILED: "FUNCTION_EXECUTION_FAILED",
  CANCELLED: "CANCELLED",
};

defineAliases(nodeErrorCodes, {
  ConfigInvalid: "CONFIG_INVALID",
  DependencyNotReady: "DEPENDENCY_NOT_READY",
  TargetNotFound: "TARGET_NOT_FOUND",
  AmbiguousTarget: "AMBIGUOUS_TARGET",
  TargetNotInteractable: "TARGET_NOT_INTERACTABLE",
  TargetNotVisible: "TARGET_NOT_VISIBLE",
  ProtectedPage: "PROTECTED_PAGE",
  TabNotFound: "TAB_NOT_FOUND",
  HostUnavailable: "HOST_UNAVAILABLE",
  HostForegroundRequired: "HOST_FOREGROUND_REQUIRED",
  HostCoordinateLowConfidence: "HOST_COORDINATE_LOW_CONFIDENCE",
  Timeout: "TIMEOUT",
  ValidationFailed: "VALIDATION_FAILED",
  FileNotFound: "FILE_NOT_FOUND",
  FileAccessDenied: "FILE_ACCESS_DENIED",
  FileParseFailed: "FILE_PARSE_FAILED",
  DownloadNotFound: "DOWNLOAD_NOT_FOUND",
  DialogNotFound: "DIALOG_NOT_FOUND",
  MissingRequiredOutput: "MISSING_REQUIRED_OUTPUT",
  CodeExecutionFailed: "CODE_EXECUTION_FAILED",
  FunctionExecutionFailed: "FUNCTION_EXECUTION_FAILED",
  Cancelled: "CANCELLED",
});

export const NodeErrorCodes = Object.freeze(nodeErrorCodes);

export const NODE_STATUS_VALUES = Object.freeze(Object.values(NodeStatuses));
export const NODE_ERROR_CODE_VALUES = Object.freeze(Object.values(NodeErrorCodes));

export const CommonNodeConfigDefaults = Object.freeze({
  enabled: true,
  displayName: "Node",
  retryCount: 0,
  retryDelay: 0,
  retryStrategy: "fixed",
  retryOnlyFor: Object.freeze([]),
  timeout: null,
  onError: "fail",
  saveOutputAs: null,
  saveToWorkflowClipboard: "off",
  logLevel: "normal",
});

const RETRY_STRATEGIES = new Set(["fixed", "increasing"]);
const LOG_LEVELS = new Set(["normal", "verbose"]);
const ON_ERROR_ALIASES = Object.freeze({
  fail: "fail",
  "continue with warning": "continue_with_warning",
  continue_with_warning: "continue_with_warning",
  skip: "skip",
  "route to error port": "error_port",
  route_to_error_port: "error_port",
  error_port: "error_port",
});
const WORKFLOW_CLIPBOARD_ALIASES = Object.freeze({
  off: "off",
  "replace entry": "replace",
  replace: "replace",
  replace_entry: "replace",
  "append entry": "append",
  append: "append",
  append_entry: "append",
  "create version": "version",
  version: "version",
  create_version: "version",
});

export class NodeExecutionError extends Error {
  constructor(code, message, details = null, options = undefined) {
    if (!NODE_ERROR_CODE_VALUES.includes(code)) {
      throw new TypeError(`Unknown node error code: ${String(code)}`);
    }

    super(String(message || code), options);
    this.name = "NodeExecutionError";
    this.code = code;
    this.details = details ?? null;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export function isNodeStatus(value) {
  return NODE_STATUS_VALUES.includes(value);
}

export function isNodeErrorCode(value) {
  return NODE_ERROR_CODE_VALUES.includes(value);
}

/**
 * Apply the common finalized node configuration without discarding
 * node-specific properties.
 *
 * Invalid optional values fall back to the supplied node defaults. Definition
 * validators remain responsible for reporting invalid author input; this
 * normalizer gives executors a predictable shape after validation.
 */
export function normalizeCommonNodeConfig(config = {}, defaults = {}) {
  const source = isPlainObject(config) ? config : {};
  const fallback = {
    ...CommonNodeConfigDefaults,
    ...(isPlainObject(defaults) ? defaults : {}),
  };

  return {
    ...source,
    enabled: normalizeBoolean(source.enabled, fallback.enabled),
    displayName: normalizeNonEmptyString(
      source.displayName,
      normalizeNonEmptyString(fallback.displayName, CommonNodeConfigDefaults.displayName),
    ),
    retryCount: normalizeNonNegativeInteger(source.retryCount, fallback.retryCount),
    retryDelay: normalizeNonNegativeNumber(source.retryDelay, fallback.retryDelay),
    retryStrategy: normalizeEnum(
      source.retryStrategy,
      RETRY_STRATEGIES,
      normalizeEnum(
        fallback.retryStrategy,
        RETRY_STRATEGIES,
        CommonNodeConfigDefaults.retryStrategy,
      ),
    ),
    retryOnlyFor: normalizeRetryOnlyFor(source.retryOnlyFor, fallback.retryOnlyFor),
    timeout: normalizeNullableNonNegativeNumber(source.timeout, fallback.timeout),
    onError: normalizeOnError(source.onError, fallback.onError),
    saveOutputAs: normalizeOptionalString(source.saveOutputAs, fallback.saveOutputAs),
    saveToWorkflowClipboard: normalizeWorkflowClipboardMode(
      source.saveToWorkflowClipboard,
      fallback.saveToWorkflowClipboard,
    ),
    logLevel: normalizeEnum(
      source.logLevel,
      LOG_LEVELS,
      normalizeEnum(fallback.logLevel, LOG_LEVELS, CommonNodeConfigDefaults.logLevel),
    ),
  };
}

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback !== false;
}

function normalizeNonEmptyString(value, fallback) {
  if (typeof value === "string" && value.trim()) return value.trim();
  return String(fallback || "").trim();
}

function normalizeOptionalString(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    if (fallback === null || fallback === undefined || fallback === "") return null;
    return String(fallback).trim() || null;
  }
  return String(value).trim() || null;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  if (Number.isInteger(number) && number >= 0) return number;

  const fallbackNumber = Number(fallback);
  return Number.isInteger(fallbackNumber) && fallbackNumber >= 0 ? fallbackNumber : 0;
}

function normalizeNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  if (Number.isFinite(number) && number >= 0) return number;

  const fallbackNumber = Number(fallback);
  return Number.isFinite(fallbackNumber) && fallbackNumber >= 0 ? fallbackNumber : 0;
}

function normalizeNullableNonNegativeNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    if (fallback === null || fallback === undefined || fallback === "") return null;
    return normalizeNonNegativeNumber(fallback, 0);
  }
  return normalizeNonNegativeNumber(value, fallback);
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizeOnError(value, fallback) {
  const normalized = normalizePhrase(value);
  if (normalized && ON_ERROR_ALIASES[normalized]) return ON_ERROR_ALIASES[normalized];

  const normalizedFallback = normalizePhrase(fallback);
  return ON_ERROR_ALIASES[normalizedFallback] || normalizedFallback || "fail";
}

function normalizeWorkflowClipboardMode(value, fallback) {
  const raw = isPlainObject(value) ? value.mode : value;
  const normalized = normalizePhrase(raw);
  if (normalized && WORKFLOW_CLIPBOARD_ALIASES[normalized]) {
    return WORKFLOW_CLIPBOARD_ALIASES[normalized];
  }

  const fallbackRaw = isPlainObject(fallback) ? fallback.mode : fallback;
  return WORKFLOW_CLIPBOARD_ALIASES[normalizePhrase(fallbackRaw)] || "off";
}

function normalizeRetryOnlyFor(value, fallback) {
  const source = value === undefined || value === null ? fallback : value;
  const values = Array.isArray(source) ? source : source === "" ? [] : [source];
  return [...new Set(
    values
      .map((item) => normalizePhrase(item).replaceAll(" ", "_"))
      .filter(Boolean),
  )];
}

function normalizePhrase(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_")
    .replace(/\s+/g, " ");
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function defineAliases(target, aliases) {
  for (const [alias, canonicalKey] of Object.entries(aliases)) {
    Object.defineProperty(target, alias, {
      value: target[canonicalKey],
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
}
