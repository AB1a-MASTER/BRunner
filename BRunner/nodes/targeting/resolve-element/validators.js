import {
  NodeErrorCodes,
  NodeExecutionError,
  normalizeCommonNodeConfig,
} from "../../shared/nodeContracts.js";
import {
  TargetAmbiguityPolicies,
  TargetIdentifierTypes,
  TargetMapFreshness,
  TargetScopes,
  normalizeTargetConfig,
  validateTargetConfig,
} from "../../shared/targetAdapter.js";
import { RetryReasons } from "../../shared/executionPolicy.js";
import {
  ResolveElementDefaults,
  ResolveElementModes,
  ResolveResultCardinalities,
  ResolveVisibilityRequirements,
} from "./definition.js";

const ELIGIBLE_RETRY_REASONS = Object.freeze([
  RetryReasons.TargetNotFound,
  RetryReasons.Timeout,
]);

export function normalizeResolveElementConfig(value = {}, options = {}) {
  if (!isPlainObject(value)) {
    invalid("Resolve Element configuration must be an object.");
  }

  validateOptionalRawValues(value);
  const common = normalizeCommonNodeConfig(value, ResolveElementDefaults);
  const config = {
    ...common,
    mode: enumValue(
      value.mode,
      Object.values(ResolveElementModes),
      ResolveElementDefaults.mode,
      "mode",
    ),
    expectedElementType: optionalString(
      value.expectedElementType,
      ResolveElementDefaults.expectedElementType,
      "expectedElementType",
    ),
    resultCardinality: enumValue(
      value.resultCardinality,
      Object.values(ResolveResultCardinalities),
      ResolveElementDefaults.resultCardinality,
      "resultCardinality",
    ),
    searchScope: enumValue(
      value.searchScope,
      Object.values(TargetScopes),
      ResolveElementDefaults.searchScope,
      "searchScope",
    ),
    visibilityRequirement: enumValue(
      value.visibilityRequirement,
      Object.values(ResolveVisibilityRequirements),
      ResolveElementDefaults.visibilityRequirement,
      "visibilityRequirement",
    ),
    mapFreshness: enumValue(
      value.mapFreshness,
      Object.values(TargetMapFreshness),
      ResolveElementDefaults.mapFreshness,
      "mapFreshness",
    ),
    minimumConfidence: boundedNumber(
      value.minimumConfidence,
      ResolveElementDefaults.minimumConfidence,
      0,
      1,
      "minimumConfidence",
    ),
    ambiguityPolicy: enumValue(
      value.ambiguityPolicy,
      Object.values(TargetAmbiguityPolicies),
      ResolveElementDefaults.ambiguityPolicy,
      "ambiguityPolicy",
    ),
    retryOnlyFor: normalizeRetryReasons(value.retryOnlyFor),
  };

  if (!Number.isFinite(config.timeout) || config.timeout <= 0) {
    invalid("Resolve Element timeout must be greater than zero.", {
      field: "timeout",
    });
  }
  if (config.expectedElementType.length > 200) {
    invalid("expectedElementType is too long.", {
      field: "expectedElementType",
    });
  }

  validateResolveElementTarget(config, options);
  return Object.freeze(config);
}

export function validateResolveElementConfig(value = {}, options = {}) {
  try {
    const config = options.allowExpressions === true && containsExpression(value)
      ? validateResolveElementExpressionConfig(value, options)
      : normalizeResolveElementConfig(value, options);
    return { valid: true, config, errors: [] };
  } catch (error) {
    if (error instanceof NodeExecutionError) {
      return { valid: false, config: null, errors: [error.message] };
    }
    throw error;
  }
}

export function extractResolveElementTarget(options = {}) {
  const node = options.node || {};
  return options.target ??
    node.target ??
    node.data?.target ??
    node.componentRef ??
    node.data?.componentRef ??
    null;
}

export function resolveElementRequiresComponentRef(config = {}) {
  return config.mode === ResolveElementModes.RevalidateComponent;
}

export function buildTargetOverrides(config = {}, target = null) {
  const source = isComponentRefLike(target) ? { componentRef: target } : target;
  const base = isPlainObject(source) ? source : {};
  const normalized = normalizeTargetConfig(base);
  return {
    ...normalized,
    scope: {
      ...normalized.scope,
      mode: config.searchScope || normalized.scope.mode,
    },
    targetState: config.visibilityRequirement || normalized.targetState,
    mapFreshness: config.mapFreshness || normalized.mapFreshness,
    ambiguityPolicy: config.ambiguityPolicy || normalized.ambiguityPolicy,
    minimumConfidence: Number.isFinite(config.minimumConfidence)
      ? config.minimumConfidence
      : normalized.minimumConfidence,
  };
}

function validateResolveElementTarget(config, options) {
  const source = extractResolveElementTarget(options);
  if (!hasTargetValue(source)) {
    invalid("Resolve Element requires a target element.", { field: "target" });
  }

  const input = isComponentRefLike(source) ? { componentRef: source } : source;
  const validation = validateTargetConfig(input, {
    requireComponentRef: resolveElementRequiresComponentRef(config),
  });
  if (!validation.valid) {
    invalid(
      `Resolve Element target is invalid: ${validation.errors.join(" ")}`,
      { field: "target", validationErrors: validation.errors },
    );
  }

  if (
    config.searchScope === TargetScopes.Frame &&
    !validation.target.scope.frameReference
  ) {
    invalid("Frame search scope requires a frame reference on the target.", {
      field: "searchScope",
    });
  }
  if (
    config.searchScope === TargetScopes.SelectedContainer &&
    !validation.target.scope.containerRef
  ) {
    invalid(
      "Selected-container search scope requires a container ComponentRef on the target.",
      { field: "searchScope" },
    );
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

function normalizeRetryReasons(value) {
  if (value === undefined || value === null || value === "") {
    return [ResolveElementDefaults.retryOnlyFor];
  }
  const reasons = Array.isArray(value) ? value : [value];
  const normalized = reasons.map((reason) => String(reason || "").trim());
  if (!normalized.length || !normalized.every(isEligibleRetryReason)) {
    invalid(
      "Resolve Element retries are restricted to target_not_found and timeout.",
      { field: "retryOnlyFor", allowed: ELIGIBLE_RETRY_REASONS },
    );
  }
  return normalized;
}

function isEligibleRetryReason(reason) {
  return ELIGIBLE_RETRY_REASONS.includes(reason);
}

function validateResolveElementExpressionConfig(value, options) {
  const probe = structuredClone(value);
  for (const [key, fallback] of Object.entries({
    minimumConfidence: ResolveElementDefaults.minimumConfidence,
    timeout: ResolveElementDefaults.timeout,
    retryCount: ResolveElementDefaults.retryCount,
    retryDelay: ResolveElementDefaults.retryDelay,
  })) {
    if (isExpression(probe[key])) probe[key] = fallback;
  }
  if (isExpression(probe.expectedElementType)) {
    probe.expectedElementType = "expression_type";
  }
  normalizeResolveElementConfig(probe, options);
  return Object.freeze(structuredClone(value));
}

function validateOptionalRawValues(value) {
  if (
    Object.prototype.hasOwnProperty.call(value, "enabled") &&
    typeof value.enabled !== "boolean"
  ) {
    invalid("enabled must be boolean.", { field: "enabled" });
  }
  for (const key of ["minimumConfidence", "timeout", "retryDelay"]) {
    if (
      Object.prototype.hasOwnProperty.call(value, key) &&
      (!Number.isFinite(Number(value[key])) || Number(value[key]) < 0)
    ) {
      invalid(`${key} must be a non-negative number.`, { field: key });
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(value, "retryCount") &&
    (!Number.isInteger(Number(value.retryCount)) ||
      Number(value.retryCount) < 0)
  ) {
    invalid("retryCount must be a non-negative integer.", {
      field: "retryCount",
    });
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

function enumValue(value, allowed, fallback, field) {
  const normalized = value === undefined || value === null || value === ""
    ? fallback
    : String(value).trim().toLowerCase();
  if (!allowed.includes(normalized)) {
    invalid(`Unsupported Resolve Element ${field}: ${String(value)}`, {
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

function optionalString(value, fallback = "", field = "value") {
  if (value === undefined || value === null) return String(fallback || "");
  if (typeof value !== "string") {
    invalid(`${field} must be text.`, { field });
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
