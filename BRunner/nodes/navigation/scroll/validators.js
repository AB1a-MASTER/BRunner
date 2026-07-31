import {
  NodeErrorCodes,
  NodeExecutionError,
  normalizeCommonNodeConfig,
} from "../../shared/nodeContracts.js";
import {
  TargetIdentifierTypes,
  normalizeTargetConfig,
  validateTargetConfig,
} from "../../shared/targetAdapter.js";
import { RetryReasons } from "../../shared/executionPolicy.js";
import {
  ScrollAlignments,
  ScrollAmountUnits,
  ScrollDefaults,
  ScrollDirections,
  ScrollOperations,
  ScrollStopConditions,
  ScrollTargets,
} from "./definition.js";

export function normalizeScrollConfig(value = {}, options = {}) {
  if (!isPlainObject(value)) {
    invalid("Scroll configuration must be an object.");
  }

  validateOptionalRawValues(value);
  const common = normalizeCommonNodeConfig(value, ScrollDefaults);
  const config = {
    ...common,
    operation: enumValue(
      value.operation,
      Object.values(ScrollOperations),
      ScrollDefaults.operation,
      "operation",
    ),
    scrollTarget: enumValue(
      value.scrollTarget,
      Object.values(ScrollTargets),
      ScrollDefaults.scrollTarget,
      "scrollTarget",
    ),
    direction: enumValue(
      value.direction,
      Object.values(ScrollDirections),
      ScrollDefaults.direction,
      "direction",
    ),
    amount: boundedNumber(value.amount, ScrollDefaults.amount, 0, 1_000_000, "amount"),
    amountUnit: enumValue(
      value.amountUnit,
      Object.values(ScrollAmountUnits),
      ScrollDefaults.amountUnit,
      "amountUnit",
    ),
    alignment: enumValue(
      value.alignment,
      Object.values(ScrollAlignments),
      ScrollDefaults.alignment,
      "alignment",
    ),
    smooth: booleanValue(value.smooth, ScrollDefaults.smooth, "smooth"),
    maxAttempts: boundedInteger(
      value.maxAttempts,
      ScrollDefaults.maxAttempts,
      1,
      100,
      "maxAttempts",
    ),
    pauseBetweenScrolls: boundedNumber(
      value.pauseBetweenScrolls,
      ScrollDefaults.pauseBetweenScrolls,
      0,
      60_000,
      "pauseBetweenScrolls",
    ),
    stopCondition: enumValue(
      value.stopCondition,
      Object.values(ScrollStopConditions),
      ScrollDefaults.stopCondition,
      "stopCondition",
    ),
    stopValue: optionalString(value.stopValue, ScrollDefaults.stopValue),
    waitForContentAfterEachScroll: booleanValue(
      value.waitForContentAfterEachScroll,
      ScrollDefaults.waitForContentAfterEachScroll,
      "waitForContentAfterEachScroll",
    ),
    useHostFallback: booleanValue(
      value.useHostFallback,
      ScrollDefaults.useHostFallback,
      "useHostFallback",
    ),
    ifHostUnavailable: enumValue(
      value.ifHostUnavailable,
      ["fail", "skip", "error_path"],
      ScrollDefaults.ifHostUnavailable,
      "ifHostUnavailable",
    ),
    retryOnlyFor: [RetryReasons.ContainerNotReady],
  };

  if (!Number.isFinite(config.timeout) || config.timeout <= 0) {
    invalid("Scroll timeout must be greater than zero.", { field: "timeout" });
  }
  if (
    config.operation === ScrollOperations.UntilCondition &&
    [
      ScrollStopConditions.SelectorVisible,
      ScrollStopConditions.TextPresent,
    ].includes(config.stopCondition) &&
    !config.stopValue
  ) {
    invalid("The selected Scroll stop condition requires Stop Value.", {
      field: "stopValue",
    });
  }
  if (
    config.stopCondition === ScrollStopConditions.SelectorVisible &&
    config.stopValue.length > 1000
  ) {
    invalid("Scroll stop selector is too long.", { field: "stopValue" });
  }

  validateScrollTarget(config, options);
  return Object.freeze(config);
}

export function validateScrollConfig(value = {}, options = {}) {
  try {
    const config = options.allowExpressions === true && containsExpression(value)
      ? validateScrollExpressionConfig(value, options)
      : normalizeScrollConfig(value, options);
    return { valid: true, config, errors: [] };
  } catch (error) {
    if (error instanceof NodeExecutionError) {
      return { valid: false, config: null, errors: [error.message] };
    }
    throw error;
  }
}

export function scrollRequiresTarget(config = {}) {
  return config.scrollTarget === ScrollTargets.Container ||
    config.operation === ScrollOperations.ToElement;
}

export function extractScrollTarget(options = {}) {
  const node = options.node || {};
  return options.target ??
    node.target ??
    node.data?.target ??
    node.componentRef ??
    node.data?.componentRef ??
    null;
}

function validateScrollTarget(config, options) {
  const source = extractScrollTarget(options);
  const required = scrollRequiresTarget(config);
  if (!hasTargetValue(source)) {
    if (required) {
      invalid(
        config.operation === ScrollOperations.ToElement
          ? "Scroll to_element requires a target element."
          : "Container scrolling requires a target container.",
        { field: "target" },
      );
    }
    return;
  }

  const input = isComponentRefLike(source)
    ? { componentRef: source }
    : source;
  const validation = validateTargetConfig(input);
  if (!validation.valid) {
    invalid(`Scroll target is invalid: ${validation.errors.join(" ")}`, {
      field: "target",
      validationErrors: validation.errors,
    });
  }
}

function hasTargetValue(source) {
  if (!source) return false;
  if (isComponentRefLike(source)) return true;
  if (!isPlainObject(source)) return Boolean(String(source).trim());
  const target = normalizeTargetConfig(source);
  if (target.componentRef || target.coordinates) return true;
  if (target.identifierType === TargetIdentifierTypes.ComponentRef) return false;
  const value = target.identifierValue;
  return value !== undefined &&
    value !== null &&
    (typeof value !== "string" || Boolean(value.trim()));
}

function validateScrollExpressionConfig(value, options) {
  const probe = structuredClone(value);
  for (const [key, fallback] of Object.entries({
    amount: ScrollDefaults.amount,
    maxAttempts: ScrollDefaults.maxAttempts,
    pauseBetweenScrolls: ScrollDefaults.pauseBetweenScrolls,
    timeout: ScrollDefaults.timeout,
    retryCount: ScrollDefaults.retryCount,
    retryDelay: ScrollDefaults.retryDelay,
  })) {
    if (isExpression(probe[key])) probe[key] = fallback;
  }
  if (isExpression(probe.stopValue)) {
    probe.stopValue = probe.stopCondition === ScrollStopConditions.SelectorVisible
      ? "#expression-target"
      : "expression text";
  }
  normalizeScrollConfig(probe, options);
  return Object.freeze(structuredClone(value));
}

function validateOptionalRawValues(value) {
  for (const key of [
    "enabled",
    "smooth",
    "waitForContentAfterEachScroll",
    "useHostFallback",
  ]) {
    if (
      Object.prototype.hasOwnProperty.call(value, key) &&
      typeof value[key] !== "boolean"
    ) {
      invalid(`${key} must be boolean.`, { field: key });
    }
  }
  for (const key of [
    "amount",
    "pauseBetweenScrolls",
    "timeout",
    "retryDelay",
  ]) {
    if (
      Object.prototype.hasOwnProperty.call(value, key) &&
      (!Number.isFinite(Number(value[key])) || Number(value[key]) < 0)
    ) {
      invalid(`${key} must be a non-negative number.`, { field: key });
    }
  }
  for (const key of ["maxAttempts", "retryCount"]) {
    if (
      Object.prototype.hasOwnProperty.call(value, key) &&
      (!Number.isInteger(Number(value[key])) || Number(value[key]) < 0)
    ) {
      invalid(`${key} must be a non-negative integer.`, { field: key });
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(value, "displayName") &&
    (typeof value.displayName !== "string" || !value.displayName.trim())
  ) {
    invalid("displayName must be a non-empty string.", {
      field: "displayName",
    });
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
    if (
      reasons.length !== 1 ||
      reasons[0] !== RetryReasons.ContainerNotReady
    ) {
      invalid("Scroll retries are restricted to container_not_ready.", {
        field: "retryOnlyFor",
      });
    }
  }
}

function boundedNumber(value, fallback, minimum, maximum, field) {
  const number = value === undefined || value === null || value === ""
    ? fallback
    : Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    invalid(`${field} must be between ${minimum} and ${maximum}.`, { field });
  }
  return number;
}

function boundedInteger(value, fallback, minimum, maximum, field) {
  const number = boundedNumber(value, fallback, minimum, maximum, field);
  if (!Number.isInteger(number)) {
    invalid(`${field} must be an integer.`, { field });
  }
  return number;
}

function booleanValue(value, fallback, field) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "boolean") {
    invalid(`${field} must be boolean.`, { field });
  }
  return value;
}

function enumValue(value, allowed, fallback, field) {
  const normalized = value === undefined || value === null || value === ""
    ? fallback
    : String(value).trim().toLowerCase();
  if (!allowed.includes(normalized)) {
    invalid(`Unsupported Scroll ${field}: ${String(value)}`, {
      field,
      allowed,
    });
  }
  return normalized;
}

function validateRawEnum(value, key, allowed) {
  if (!Object.prototype.hasOwnProperty.call(value, key)) return;
  if (!allowed.includes(String(value[key] ?? "").trim().toLowerCase())) {
    invalid(`${key} contains an unsupported option.`, { field: key, allowed });
  }
}

function optionalString(value, fallback = "") {
  if (value === undefined || value === null) return String(fallback || "");
  if (typeof value !== "string") {
    invalid("stopValue must be text.", { field: "stopValue" });
  }
  return value.trim();
}

function isComponentRefLike(value) {
  return isPlainObject(value) &&
    Boolean(value.componentId || (value.mapperSchemaVersion && value.id));
}

function invalid(message, details = {}) {
  throw new NodeExecutionError(NodeErrorCodes.ConfigInvalid, message, details);
}

function containsExpression(value) {
  if (typeof value === "string") return isExpression(value);
  if (Array.isArray(value)) return value.some(containsExpression);
  if (isPlainObject(value)) return Object.values(value).some(containsExpression);
  return false;
}

function isExpression(value) {
  return typeof value === "string" && /\{\{[^{}]+\}\}/.test(value);
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
