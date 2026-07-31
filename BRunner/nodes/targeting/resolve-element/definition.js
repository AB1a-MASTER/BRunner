import {
  HostClassifications,
  RetryReasons,
  RetrySafety,
} from "../../shared/executionPolicy.js";
import {
  NodeErrorCategories,
  createNodeSpecificErrorCode,
} from "../../shared/nodeContracts.js";
import {
  TargetAmbiguityPolicies,
  TargetMapFreshness,
  TargetScopes,
  TargetStates,
} from "../../shared/targetAdapter.js";
import {
  AUTOCOMPLETE_SOURCES,
  normalizeNodeFieldSchema,
} from "../../../core/nodeAuthoring.js";

export const RESOLVE_ELEMENT_NODE_TYPE = "element.resolve";

export const ResolveElementErrorCodes = Object.freeze({
  ResolutionFailed: createNodeSpecificErrorCode(
    RESOLVE_ELEMENT_NODE_TYPE,
    "resolution_failed",
  ),
});

export const ResolveElementModes = Object.freeze({
  ResolveKnown: "resolve_known",
  FindDynamic: "find_dynamic",
  RevalidateComponent: "revalidate_component",
});

export const ResolveResultCardinalities = Object.freeze({
  One: "one",
  First: "first",
  All: "all",
});

export const ResolveVisibilityRequirements = Object.freeze({
  Any: TargetStates.Any,
  Visible: TargetStates.Visible,
  Interactable: TargetStates.Interactable,
});

export const ResolveElementDefaults = deepFreeze({
  enabled: true,
  displayName: "Resolve Element",
  mode: ResolveElementModes.ResolveKnown,
  expectedElementType: "",
  resultCardinality: ResolveResultCardinalities.One,
  searchScope: TargetScopes.AutomaticShadowDom,
  visibilityRequirement: ResolveVisibilityRequirements.Any,
  mapFreshness: TargetMapFreshness.RevalidateIfStale,
  minimumConfidence: 0.75,
  ambiguityPolicy: TargetAmbiguityPolicies.Fail,
  retryCount: 1,
  retryDelay: 250,
  retryStrategy: "fixed",
  retryOnlyFor: RetryReasons.TargetNotFound,
  timeout: 30000,
  onError: "fail",
  saveOutputAs: null,
  saveToWorkflowClipboard: "off",
  logLevel: "normal",
});

export const resolveElementNodeDefinition = deepFreeze({
  type: RESOLVE_ELEMENT_NODE_TYPE,
  stableType: RESOLVE_ELEMENT_NODE_TYPE,
  version: 1,
  contractKind: "finalized",
  catalogNumber: 4,
  displayName: "Resolve Element",
  label: "Resolve Element",
  category: "Targeting",
  icon: "target",
  description:
    "Resolve a mapped component, discover a dynamic element, or revalidate a saved component without changing the page.",
  inputPorts: [
    { id: "input", label: "Input", kind: "flow", required: false },
  ],
  outputPorts: [
    { id: "success", label: "Success", kind: "flow" },
    { id: "error", label: "Error", kind: "error" },
    { id: "unresolved", label: "Unresolved", kind: "resolution" },
  ],
  inputs: ["input"],
  outputs: ["success", "error", "unresolved"],
  targetRequired: true,
  targetSupported: true,
  unknownConfigPolicy: "reject",
  capabilities: ["browser-dom", "target-resolution", "retry-safe", "async"],
  requiredServices: ["tabs", "scripting", "mapper"],
  optionalServices: [],
  retrySafety: RetrySafety.Safe,
  defaultRetryCount: 1,
  defaultRetryDelay: 250,
  retryOnlyFor: [RetryReasons.TargetNotFound, RetryReasons.Timeout],
  hostClassification: HostClassifications.None,
  hostStatusTag: "Host fallback: off",
  protectedPageBehavior: {
    tabActionsAllowed: true,
    domAutomationAllowed: false,
    pageCapability: "tab_control_only",
  },
  errorCodes: {
    [ResolveElementErrorCodes.ResolutionFailed]: NodeErrorCategories.Target,
  },
  commonConfigDefaults: ResolveElementDefaults,
  configSchema: normalizeNodeFieldSchema([
    field("enabled", "Enabled", "boolean", ResolveElementDefaults.enabled, {
      help: "Turn this node off to skip resolution without changing the page.",
      example: "true",
      expressionMode: "none",
      advanced: true,
    }),
    field(
      "displayName",
      "Display Name",
      "text",
      ResolveElementDefaults.displayName,
      {
        help: "Friendly name shown in Graph Studio and execution logs.",
        example: "Find the results table",
        expressionMode: "none",
        advanced: true,
      },
    ),
    field("mode", "Mode", "select", ResolveElementDefaults.mode, {
      required: true,
      options: Object.values(ResolveElementModes),
      help: "Resolve a known component, discover a dynamic element, or revalidate a saved component.",
      example: ResolveElementModes.ResolveKnown,
      expressionMode: "none",
    }),
    field("expectedElementType", "Expected Element Type", "text", "", {
      help: "Optional semantic type the resolved element must match, such as button or table.",
      example: "table",
      autocompleteSources: [
        AUTOCOMPLETE_SOURCES.Variables,
        AUTOCOMPLETE_SOURCES.NodeOutputs,
      ],
    }),
    field(
      "resultCardinality",
      "Result Cardinality",
      "select",
      ResolveElementDefaults.resultCardinality,
      {
        options: Object.values(ResolveResultCardinalities),
        help: "Require exactly one match, take the first after collecting every candidate, or return all matches.",
        example: ResolveResultCardinalities.One,
        expressionMode: "none",
      },
    ),
    field(
      "searchScope",
      "Search Scope",
      "select",
      ResolveElementDefaults.searchScope,
      {
        options: Object.values(TargetScopes),
        help: "Limit resolution to the whole page, a frame, a selected container, or automatic shadow DOM.",
        example: TargetScopes.AutomaticShadowDom,
        expressionMode: "none",
      },
    ),
    field(
      "visibilityRequirement",
      "Visibility Requirement",
      "select",
      ResolveElementDefaults.visibilityRequirement,
      {
        options: Object.values(ResolveVisibilityRequirements),
        help: "Accept any match, require a visible element, or require an interactable element.",
        example: ResolveVisibilityRequirements.Visible,
        expressionMode: "none",
      },
    ),
    field(
      "mapFreshness",
      "Map Freshness",
      "select",
      ResolveElementDefaults.mapFreshness,
      {
        options: Object.values(TargetMapFreshness),
        help: "Use the cached map, revalidate only when stale, or refresh before resolving.",
        example: TargetMapFreshness.RevalidateIfStale,
        expressionMode: "none",
      },
    ),
    field(
      "minimumConfidence",
      "Minimum Confidence",
      "number",
      ResolveElementDefaults.minimumConfidence,
      {
        minimum: 0,
        maximum: 1,
        help: "Reject a match scoring below this confidence between 0 and 1.",
        example: "0.75",
      },
    ),
    field(
      "ambiguityPolicy",
      "If Ambiguous",
      "select",
      ResolveElementDefaults.ambiguityPolicy,
      {
        options: Object.values(TargetAmbiguityPolicies),
        help: "Fail safely or require explicit user review; ambiguity is never resolved by guessing.",
        example: TargetAmbiguityPolicies.Fail,
        expressionMode: "none",
      },
    ),
    field("timeout", "Timeout (ms)", "number", ResolveElementDefaults.timeout, {
      minimum: 1,
      help: "Maximum time for map refresh, resolution, and verification.",
      example: "30000",
      advanced: true,
    }),
    field(
      "retryCount",
      "Retry Count",
      "number",
      ResolveElementDefaults.retryCount,
      {
        integer: true,
        minimum: 0,
        maximum: 10,
        help: "Retries for a stale map or a not-yet-ready target; ambiguity is never retried.",
        example: "1",
        advanced: true,
      },
    ),
    field(
      "retryDelay",
      "Retry Delay (ms)",
      "number",
      ResolveElementDefaults.retryDelay,
      {
        minimum: 0,
        help: "Delay before an eligible retry.",
        example: "250",
        advanced: true,
      },
    ),
    field("retryStrategy", "Retry Strategy", "select", "fixed", {
      options: ["fixed", "increasing"],
      help: "Use a fixed delay or increase it with each attempt.",
      example: "fixed",
      expressionMode: "none",
      advanced: true,
    }),
    field(
      "retryOnlyFor",
      "Retry Only For",
      "select",
      ResolveElementDefaults.retryOnlyFor,
      {
        options: [RetryReasons.TargetNotFound, RetryReasons.Timeout],
        help: "Restrict retries to a stable eligible failure category.",
        example: RetryReasons.TargetNotFound,
        expressionMode: "none",
        advanced: true,
      },
    ),
    field("onError", "On Error", "select", "fail", {
      options: ["fail", "continue_with_warning", "skip", "error_port"],
      help: "Fail, continue with a warning, skip, or use the Graph error route.",
      example: "fail",
      expressionMode: "none",
      advanced: true,
    }),
    field("saveOutputAs", "Save Output As", "text", "", {
      help: "Optional variable alias for the full Resolve Element output.",
      example: "results_table",
      expressionMode: "none",
      advanced: true,
    }),
    field("saveToWorkflowClipboard", "Workflow Clipboard", "select", "off", {
      options: ["off", "replace", "append", "version"],
      help: "Optionally publish the output to the run-local Workflow Clipboard.",
      example: "off",
      expressionMode: "none",
      advanced: true,
    }),
    field("workflowClipboardEntry", "Clipboard Entry Name", "text", "", {
      help: "Entry name used when Workflow Clipboard output is enabled.",
      example: "results_table",
      expressionMode: "none",
      advanced: true,
    }),
    field("logLevel", "Log Level", "select", "normal", {
      options: ["normal", "verbose"],
      help: "Normal logs structural summaries; verbose includes local values.",
      example: "normal",
      expressionMode: "none",
      advanced: true,
    }),
  ]),
  outputSchema: {
    type: "object",
    required: [
      "mode",
      "resolvedComponentId",
      "component",
      "components",
      "matchCount",
      "targetResolution",
    ],
    properties: {
      mode: { enum: Object.values(ResolveElementModes) },
      resolvedComponentId: { type: ["string", "null"] },
      component: boundedComponentSchema(true),
      components: {
        type: "array",
        items: boundedComponentSchema(false),
      },
      matchCount: { type: "integer", minimum: 0 },
      targetResolution: { type: "object" },
    },
  },
  examples: [
    {
      name: "Resolve a known mapped component",
      config: {
        mode: ResolveElementModes.ResolveKnown,
        resultCardinality: ResolveResultCardinalities.One,
        visibilityRequirement: ResolveVisibilityRequirements.Visible,
        saveOutputAs: "results_table",
      },
    },
    {
      name: "Collect every matching dynamic row",
      config: {
        mode: ResolveElementModes.FindDynamic,
        resultCardinality: ResolveResultCardinalities.All,
        expectedElementType: "row",
      },
    },
  ],
});

function boundedComponentSchema(nullable = false) {
  return {
    type: nullable ? ["object", "null"] : "object",
    required: [
      "componentId",
      "componentUid",
      "semanticType",
      "mappingLayer",
      "pageProfileKey",
      "frameContext",
      "state",
      "confidence",
    ],
    properties: {
      componentId: { type: "string" },
      componentUid: { type: ["string", "null"] },
      semanticType: { type: ["string", "null"] },
      accessibleName: { type: ["string", "null"] },
      mappingLayer: { type: ["string", "null"] },
      pageProfileKey: { type: ["string", "null"] },
      frameContext: { type: ["object", "null"] },
      state: { type: "object" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
  };
}

function field(key, label, kind, defaultValue, extra = {}) {
  return { key, label, kind, default: defaultValue, ...extra };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
