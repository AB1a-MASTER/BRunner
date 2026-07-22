import {
  NodeErrorCodes,
  NodeExecutionError,
  normalizeCommonNodeConfig,
} from "../../shared/nodeContracts.js";
import {
  NavigateDefaults,
  NavigateDestinations,
  NavigateNoHistoryBehaviors,
  NavigateOperations,
  NavigateReadiness,
  NavigateTabSources,
  ProtectedPagePolicies,
} from "./definition.js";

const ALLOWED_PROTOCOLS = new Set([
  "http:",
  "https:",
  "file:",
  "about:",
  "chrome:",
  "chrome-extension:",
  "edge:",
]);

export function normalizeNavigateConfig(value = {}) {
  if (!isPlainObject(value)) {
    invalid("Navigate configuration must be an object.");
  }

  validateOptionalRawValues(value);
  const common = normalizeCommonNodeConfig(value, NavigateDefaults);
  const config = {
    ...common,
    operation: enumValue(
      value.operation,
      Object.values(NavigateOperations),
      NavigateDefaults.operation,
      "operation",
    ),
    tabSource: enumValue(
      value.tabSource,
      Object.values(NavigateTabSources),
      NavigateDefaults.tabSource,
      "tabSource",
    ),
    tabReference:
      value.tabReference === undefined
        ? NavigateDefaults.tabReference
        : clone(value.tabReference),
    url: String(value.url ?? NavigateDefaults.url).trim(),
    openDestinationIn: enumValue(
      value.openDestinationIn,
      Object.values(NavigateDestinations),
      NavigateDefaults.openDestinationIn,
      "openDestinationIn",
    ),
    waitUntil: enumValue(
      value.waitUntil,
      Object.values(NavigateReadiness),
      NavigateDefaults.waitUntil,
      "waitUntil",
    ),
    onNoHistory: enumValue(
      value.onNoHistory,
      Object.values(NavigateNoHistoryBehaviors),
      NavigateDefaults.onNoHistory,
      "onNoHistory",
    ),
    saveTabReferenceAs: optionalString(
      value.saveTabReferenceAs,
      NavigateDefaults.saveTabReferenceAs,
    ),
    protectedPagePolicy: enumValue(
      value.protectedPagePolicy,
      Object.values(ProtectedPagePolicies),
      NavigateDefaults.protectedPagePolicy,
      "protectedPagePolicy",
    ),
  };

  if (!Number.isFinite(config.timeout) || config.timeout <= 0) {
    invalid("Navigate timeout must be greater than zero.", { field: "timeout" });
  }
  if (
    config.tabSource === NavigateTabSources.SavedReference &&
    !hasReference(config.tabReference)
  ) {
    invalid("A saved tab reference is required for saved_reference.", {
      field: "tabReference",
    });
  }
  if (config.operation === NavigateOperations.GotoUrl) {
    config.url = normalizeStrictNavigationUrl(config.url);
  } else if (config.openDestinationIn === NavigateDestinations.NewTab) {
    invalid("Only goto_url can open a destination in a new tab.", {
      field: "openDestinationIn",
    });
  }

  return Object.freeze(config);
}

export function validateNavigateConfig(value = {}) {
  try {
    return { valid: true, config: normalizeNavigateConfig(value), errors: [] };
  } catch (error) {
    if (error instanceof NodeExecutionError) {
      return { valid: false, config: null, errors: [error.message] };
    }
    throw error;
  }
}

export function normalizeStrictNavigationUrl(value) {
  const input = String(value ?? "").trim();
  if (!input) {
    invalid("URL is required for goto_url.", { field: "url" });
  }

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    invalid("Navigate requires an absolute URL and never treats text as a search.", {
      field: "url",
      value: input,
    });
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    invalid("URL protocol is not supported for browser navigation.", {
      field: "url",
      protocol: parsed.protocol,
    });
  }
  if (
    ["http:", "https:"].includes(parsed.protocol) &&
    !String(parsed.hostname || "").trim()
  ) {
    invalid("HTTP navigation requires a hostname.", { field: "url" });
  }
  return parsed.href;
}

function validateOptionalRawValues(value) {
  if (
    Object.prototype.hasOwnProperty.call(value, "timeout") &&
    (!Number.isFinite(Number(value.timeout)) || Number(value.timeout) <= 0)
  ) {
    invalid("Navigate timeout must be greater than zero.", { field: "timeout" });
  }
  if (
    Object.prototype.hasOwnProperty.call(value, "retryCount") &&
    (!Number.isInteger(Number(value.retryCount)) || Number(value.retryCount) < 0)
  ) {
    invalid("retryCount must be a non-negative integer.", {
      field: "retryCount",
    });
  }
  for (const key of ["enabled"]) {
    if (
      Object.prototype.hasOwnProperty.call(value, key) &&
      typeof value[key] !== "boolean"
    ) {
      invalid(key + " must be boolean.", { field: key });
    }
  }
}

function enumValue(value, allowed, fallback, field) {
  const normalized =
    value === undefined || value === null || value === ""
      ? fallback
      : String(value).trim().toLowerCase();
  if (!allowed.includes(normalized)) {
    invalid("Unsupported Navigate " + field + ": " + String(value), {
      field,
      allowed,
    });
  }
  return normalized;
}

function optionalString(value, fallback = "") {
  if (value === undefined || value === null) return String(fallback || "");
  return String(value).trim();
}

function hasReference(value) {
  if (typeof value === "string") return Boolean(value.trim());
  return Boolean(value && typeof value === "object");
}

function invalid(message, details = {}) {
  throw new NodeExecutionError(
    NodeErrorCodes.ConfigInvalid,
    message,
    details,
  );
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
