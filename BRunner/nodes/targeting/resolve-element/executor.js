import {
  NodeErrorCategories,
  NodeErrorCodes,
  NodeExecutionError,
} from "../../shared/nodeContracts.js";
import { RetryReasons } from "../../shared/executionPolicy.js";
import {
  ResolveElementErrorCodes,
  ResolveElementModes,
  ResolveResultCardinalities,
} from "./definition.js";
import { buildResolveElementOutput } from "./outputs.js";
import {
  normalizeMapperResolution,
  selectPublishedComponents,
} from "./mapperResolveAdapter.js";
import {
  extractResolveElementTarget,
  normalizeResolveElementConfig,
} from "./validators.js";

const RETRYABLE_STATES = Object.freeze([
  "map_stale",
  "not_found",
  "dynamic_deferred",
]);

export async function executeResolveElement(context = {}) {
  const target = context.target ??
    context.dependencies?.target ??
    extractResolveElementTarget({ node: context.node || {} });
  const config = normalizeResolveElementConfig(context.config || {}, { target });
  const service = requireResolveService(context.services?.resolveElement);
  const tab = context.tab || context.dependencies?.tab || null;
  if (!tab || !Number.isInteger(Number(tab.id))) {
    throw new NodeExecutionError(
      NodeErrorCodes.TabNotFound,
      "Resolve Element could not resolve the requested browser tab.",
      { retryable: false },
    );
  }
  if (isProtectedBrowserUrl(tab.url)) {
    throw new NodeExecutionError(
      NodeErrorCodes.ProtectedPage,
      "Resolve Element requires DOM access and cannot run on a protected browser page.",
      { tabId: Number(tab.id), url: String(tab.url || ""), retryable: false },
    );
  }

  const result = await service.perform({
    config,
    target,
    tab: structuredClone(tab),
    revalidate: config.mode === ResolveElementModes.RevalidateComponent,
  }, serviceOptions(context));

  if (result?.ok === false) {
    throw serviceFailure(result, config, target);
  }

  const source = result?.value ?? result?.output ?? result ?? {};
  const resolution = normalizeMapperResolution(source, config, target);
  if (!resolution.ok) {
    throw resolutionFailure(resolution, config);
  }

  const components = selectPublishedComponents(config, resolution);
  const matchCount = Math.max(resolution.matchCount, components.length);
  if (
    config.resultCardinality === ResolveResultCardinalities.One &&
    matchCount !== 1
  ) {
    throw cardinalityFailure(config, resolution, matchCount);
  }

  const output = buildResolveElementOutput({
    mode: config.mode,
    component: components[0] || resolution.component,
    components,
    matchCount,
    targetResolution: resolution.targetResolution,
  });

  return {
    output,
    warnings: Array.isArray(result?.warnings) ? result.warnings : [],
    executionMethod: "browser",
  };
}

export async function verifyResolveElementBeforeRetry({ error = null } = {}) {
  const state = String(error?.diagnostics?.mapperState || "").trim();
  if (state === "ambiguous") {
    return { retryable: false, reason: "ambiguity_is_never_retried" };
  }
  if (RETRYABLE_STATES.includes(state)) {
    return { retryable: true, reason: state };
  }
  return { retryable: false, reason: state || "unknown" };
}

function serviceFailure(result, config, target) {
  const error = result?.error || {};
  if (error instanceof NodeExecutionError) return error;
  if (error.code === NodeErrorCodes.ConfigInvalid) {
    return new NodeExecutionError(
      NodeErrorCodes.ConfigInvalid,
      error.message || "Resolve Element configuration is invalid.",
      { ...(error.details || {}), retryable: false },
    );
  }
  const resolution = normalizeMapperResolution(
    { ...(error.details || {}), mapperState: error.state || error.mapperState },
    config,
    target,
  );
  return resolutionFailure(resolution, config, error.message);
}

function resolutionFailure(resolution, config, message = "") {
  const state = resolution.state;
  const code = failureCode(state);
  const retryable = RETRYABLE_STATES.includes(state);
  const error = new NodeExecutionError(
    code,
    message || failureMessage(state),
    {
      mode: config.mode,
      state,
      retryable,
      retryReason: retryable ? RetryReasons.TargetNotFound : undefined,
    },
    { category: errorCategory(code) },
  );
  error.diagnostics = mapperDiagnostics(resolution, state);
  return error;
}

function cardinalityFailure(config, resolution, matchCount) {
  const ambiguous = matchCount > 1;
  const error = new NodeExecutionError(
    ambiguous ? NodeErrorCodes.AmbiguousTarget : NodeErrorCodes.TargetNotFound,
    ambiguous
      ? "Resolve Element required exactly one match but the target was ambiguous."
      : "Resolve Element required exactly one match but found none.",
    {
      mode: config.mode,
      resultCardinality: config.resultCardinality,
      matchCount,
      retryable: !ambiguous,
      retryReason: ambiguous ? undefined : RetryReasons.TargetNotFound,
    },
    { category: NodeErrorCategories.Target },
  );
  error.diagnostics = mapperDiagnostics(
    resolution,
    ambiguous ? "ambiguous" : "not_found",
  );
  return error;
}

function failureCode(state) {
  if (state === "ambiguous") return NodeErrorCodes.AmbiguousTarget;
  if (state === "protected_unsupported") return NodeErrorCodes.ProtectedPage;
  if (state === "target_not_visible") return NodeErrorCodes.TargetNotVisible;
  if (state === "target_not_interactable") {
    return NodeErrorCodes.TargetNotInteractable;
  }
  if (state === "below_minimum_confidence") {
    return ResolveElementErrorCodes.ResolutionFailed;
  }
  return NodeErrorCodes.TargetNotFound;
}

function failureMessage(state) {
  const messages = {
    ambiguous: "Resolve Element found a materially ambiguous target.",
    protected_unsupported:
      "The target is on a protected or unsupported browser surface.",
    target_not_visible: "The resolved element is not visible.",
    target_not_interactable: "The resolved element is not interactable.",
    below_minimum_confidence:
      "The resolved element scored below the configured minimum confidence.",
    map_stale: "The saved component map is stale for this page.",
  };
  return messages[state] || "Resolve Element could not resolve the target.";
}

function errorCategory(code) {
  if (code === NodeErrorCodes.ProtectedPage) {
    return NodeErrorCategories.ProtectedPage;
  }
  return NodeErrorCategories.Target;
}

function mapperDiagnostics(resolution, state) {
  const targetResolution = resolution.targetResolution || {};
  return {
    action: "resolve",
    mapperState: state,
    mapperReason: targetResolution.reason || "",
    componentId: resolution.componentRef?.componentId || "",
    pageProfileKey: resolution.componentRef?.pageProfileKey || "",
    mapVersionId: resolution.componentRef?.capturedMapVersionId || "",
    confidence: Number.isFinite(targetResolution.confidence)
      ? targetResolution.confidence
      : undefined,
    finalReason: `mapper_${state}`,
  };
}

function requireResolveService(service) {
  if (!service || typeof service.perform !== "function") {
    throw new NodeExecutionError(
      NodeErrorCodes.DependencyNotReady,
      "Resolve Element mapper resolution service is unavailable.",
      { dependency: "resolveElement.perform", retryable: false },
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
