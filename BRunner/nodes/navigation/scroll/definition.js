import {
  HostClassifications,
  HostFallbackTriggers,
  RetryReasons,
  RetrySafety,
} from "../../shared/executionPolicy.js";
import {
  NodeErrorCategories,
  createNodeSpecificErrorCode,
} from "../../shared/nodeContracts.js";
import {
  AUTOCOMPLETE_SOURCES,
  normalizeNodeFieldSchema,
} from "../../../core/nodeAuthoring.js";

export const SCROLL_NODE_TYPE = "browser.scroll";

export const ScrollErrorCodes = Object.freeze({
  ContainerNotReady: createNodeSpecificErrorCode(
    SCROLL_NODE_TYPE,
    "container_not_ready",
  ),
  ScrollFailed: createNodeSpecificErrorCode(
    SCROLL_NODE_TYPE,
    "scroll_failed",
  ),
});

export const ScrollOperations = Object.freeze({
  ByAmount: "by_amount",
  ToTop: "to_top",
  ToBottom: "to_bottom",
  ToElement: "to_element",
  UntilCondition: "until_condition",
});

export const ScrollTargets = Object.freeze({
  Page: "page",
  Container: "container",
});

export const ScrollDirections = Object.freeze({
  Up: "up",
  Down: "down",
  Left: "left",
  Right: "right",
});

export const ScrollAmountUnits = Object.freeze({
  Pixels: "pixels",
  ViewportPercent: "viewport_percent",
  Screen: "screen",
});

export const ScrollAlignments = Object.freeze({
  Top: "top",
  Center: "center",
  Bottom: "bottom",
  Nearest: "nearest",
});

export const ScrollStopConditions = Object.freeze({
  ScrollEnd: "scroll_end",
  PositionUnchanged: "position_unchanged",
  SelectorVisible: "selector_visible",
  TextPresent: "text_present",
});

export const ScrollStopReasons = Object.freeze({
  AmountComplete: "amount_complete",
  TopReached: "top_reached",
  BottomReached: "bottom_reached",
  TargetAligned: "target_aligned",
  ConditionMet: "condition_met",
  ScrollEnd: "scroll_end",
  PositionUnchanged: "position_unchanged",
  MaxAttempts: "max_attempts",
  NoMovement: "no_movement",
});

export const ScrollExecutionMethods = Object.freeze({
  Browser: "browser",
  Host: "host",
});

export const ScrollDefaults = deepFreeze({
  enabled: true,
  displayName: "Scroll",
  operation: ScrollOperations.ByAmount,
  scrollTarget: ScrollTargets.Page,
  direction: ScrollDirections.Down,
  amount: 500,
  amountUnit: ScrollAmountUnits.Pixels,
  alignment: ScrollAlignments.Center,
  smooth: false,
  maxAttempts: 10,
  pauseBetweenScrolls: 250,
  stopCondition: ScrollStopConditions.ScrollEnd,
  stopValue: "",
  waitForContentAfterEachScroll: false,
  timeout: 30000,
  useHostFallback: false,
  ifHostUnavailable: "fail",
  retryCount: 1,
  retryDelay: 250,
  retryStrategy: "fixed",
  retryOnlyFor: [RetryReasons.ContainerNotReady],
  onError: "fail",
  saveOutputAs: null,
  saveToWorkflowClipboard: "off",
  workflowClipboardEntry: "",
  logLevel: "normal",
});

export const scrollNodeDefinition = deepFreeze({
  type: SCROLL_NODE_TYPE,
  stableType: SCROLL_NODE_TYPE,
  version: 2,
  contractKind: "finalized",
  catalogNumber: 2,
  displayName: "Scroll",
  label: "Scroll",
  category: "Navigation",
  icon: "scroll",
  description:
    "Scroll a page or resolved container by amount, to a boundary or element, or until a bounded condition is met.",
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
  targetRequired: false,
  targetSupported: true,
  targetRequiredWhen: [
    { field: "scrollTarget", equals: ScrollTargets.Container },
    { field: "operation", equals: ScrollOperations.ToElement },
  ],
  unknownConfigPolicy: "reject",
  capabilities: [
    "browser-tab",
    "dom-automation",
    "target-resolution",
    "side-effect",
    "retry-verified",
    "async",
    "host-fallback-optional",
  ],
  requiredServices: ["tabs", "scripting", "mapper"],
  retrySafety: RetrySafety.VerifyBeforeRetry,
  defaultRetryCount: 1,
  defaultRetryDelay: 250,
  retryOnlyFor: [RetryReasons.ContainerNotReady],
  hostClassification: HostClassifications.Assisted,
  hostCapabilities: ["host.window", "host.action"],
  nativeHost: {
    mode: "fallback",
    capabilities: ["host.window", "host.action"],
  },
  fallbackTrigger: HostFallbackTriggers.BrowserActionFailed,
  hostStatusTag: "Host fallback: off",
  protectedPageBehavior: {
    tabActionsAllowed: false,
    domAutomationAllowed: false,
    navigateAwayAllowed: false,
    policies: ["fail"],
  },
  errorCodes: {
    [ScrollErrorCodes.ContainerNotReady]: NodeErrorCategories.Target,
    [ScrollErrorCodes.ScrollFailed]: NodeErrorCategories.NodeSpecific,
  },
  commonConfigDefaults: ScrollDefaults,
  configSchema: normalizeNodeFieldSchema([
    field("enabled", "Enabled", "boolean", ScrollDefaults.enabled, {
      help: "Turn this node off to skip it without scrolling.",
      example: "true",
      expressionMode: "none",
      advanced: true,
    }),
    field("displayName", "Display Name", "text", ScrollDefaults.displayName, {
      help: "Friendly name shown in Graph Studio and execution logs.",
      example: "Load more results",
      expressionMode: "none",
      advanced: true,
    }),
    field("operation", "Operation", "select", ScrollDefaults.operation, {
      required: true,
      options: Object.values(ScrollOperations),
      help: "Choose a fixed movement, boundary, element, or bounded condition operation.",
      example: ScrollOperations.ByAmount,
      expressionMode: "none",
    }),
    field("scrollTarget", "Scroll Target", "select", ScrollDefaults.scrollTarget, {
      required: true,
      options: Object.values(ScrollTargets),
      help: "Scroll the page or the resolved target container.",
      example: ScrollTargets.Page,
      expressionMode: "none",
    }),
    field("direction", "Direction", "select", ScrollDefaults.direction, {
      required: true,
      options: Object.values(ScrollDirections),
      help: "Direction used by amount and until-condition movement.",
      example: ScrollDirections.Down,
      expressionMode: "none",
    }),
    field("amount", "Amount", "number", ScrollDefaults.amount, {
      minimum: 0,
      help: "Non-negative movement magnitude interpreted by Amount Unit.",
      example: "500",
      autocompleteSources: valueAutocomplete(),
    }),
    field("amountUnit", "Amount Unit", "select", ScrollDefaults.amountUnit, {
      required: true,
      options: Object.values(ScrollAmountUnits),
      help: "Use pixels, a percentage of the viewport, or viewport-sized screens.",
      example: ScrollAmountUnits.Pixels,
      expressionMode: "none",
    }),
    field("alignment", "Element Alignment", "select", ScrollDefaults.alignment, {
      required: true,
      options: Object.values(ScrollAlignments),
      help: "Alignment used by to_element within its nearest scroll root.",
      example: ScrollAlignments.Center,
      expressionMode: "none",
    }),
    field("smooth", "Smooth Scrolling", "boolean", ScrollDefaults.smooth, {
      help: "Request browser smooth scrolling instead of immediate movement.",
      example: "false",
      expressionMode: "none",
    }),
    field("maxAttempts", "Maximum Attempts", "number", ScrollDefaults.maxAttempts, {
      integer: true,
      minimum: 1,
      maximum: 100,
      help: "Hard limit for until-condition scroll actions.",
      example: "10",
      autocompleteSources: valueAutocomplete(),
      advanced: true,
    }),
    field(
      "pauseBetweenScrolls",
      "Pause Between Scrolls (ms)",
      "number",
      ScrollDefaults.pauseBetweenScrolls,
      {
        minimum: 0,
        maximum: 60000,
        help: "Delay between bounded until-condition attempts.",
        example: "250",
        autocompleteSources: valueAutocomplete(),
        advanced: true,
      },
    ),
    field(
      "stopCondition",
      "Stop Condition",
      "select",
      ScrollDefaults.stopCondition,
      {
        required: true,
        options: Object.values(ScrollStopConditions),
        help: "Safe condition checked after each until-condition scroll; arbitrary JavaScript is never evaluated.",
        example: ScrollStopConditions.ScrollEnd,
        expressionMode: "none",
      },
    ),
    field("stopValue", "Stop Value", "text", ScrollDefaults.stopValue, {
      help: "CSS selector or visible text required by the corresponding stop condition.",
      example: "#results-complete",
      autocompleteSources: valueAutocomplete(),
    }),
    field(
      "waitForContentAfterEachScroll",
      "Wait For Content After Each Scroll",
      "boolean",
      ScrollDefaults.waitForContentAfterEachScroll,
      {
        help: "Observe bounded page/container content changes before the next attempt.",
        example: "true",
        expressionMode: "none",
        advanced: true,
      },
    ),
    field("timeout", "Timeout (ms)", "number", ScrollDefaults.timeout, {
      minimum: 1,
      help: "Maximum time for all movement, waits, verification, and fallback.",
      example: "30000",
      autocompleteSources: valueAutocomplete(),
      advanced: true,
    }),
    field(
      "useHostFallback",
      "Use Visible Host Fallback",
      "boolean",
      ScrollDefaults.useHostFallback,
      {
        help: "Allow one foreground-verified physical scroll only after a definite browser failure.",
        example: "false",
        expressionMode: "none",
        advanced: true,
      },
    ),
    field(
      "ifHostUnavailable",
      "If Host Is Unavailable",
      "select",
      ScrollDefaults.ifHostUnavailable,
      {
        options: ["fail", "skip", "error_path"],
        help: "Choose the route when an enabled host fallback cannot run.",
        example: "fail",
        expressionMode: "none",
        advanced: true,
      },
    ),
    field("retryCount", "Retry Count", "number", ScrollDefaults.retryCount, {
      integer: true,
      minimum: 0,
      maximum: 10,
      help: "Retries only a container-not-ready failure before movement starts.",
      example: "1",
      advanced: true,
    }),
    field("retryDelay", "Retry Delay (ms)", "number", ScrollDefaults.retryDelay, {
      minimum: 0,
      help: "Delay before an eligible container-ready retry.",
      example: "250",
      advanced: true,
    }),
    field("retryStrategy", "Retry Strategy", "select", ScrollDefaults.retryStrategy, {
      options: ["fixed", "increasing"],
      help: "Use a fixed delay or increase it with each eligible retry.",
      example: "fixed",
      expressionMode: "none",
      advanced: true,
    }),
    field(
      "retryOnlyFor",
      "Retry Only For",
      "select",
      RetryReasons.ContainerNotReady,
      {
        options: [RetryReasons.ContainerNotReady],
        help: "Scroll retries are restricted to container_not_ready before movement.",
        example: RetryReasons.ContainerNotReady,
        expressionMode: "none",
        advanced: true,
      },
    ),
    field("onError", "On Error", "select", ScrollDefaults.onError, {
      options: ["fail", "continue_with_warning", "skip", "error_port"],
      help: "Fail the run, continue with a warning, skip, or use the Graph error route.",
      example: "fail",
      expressionMode: "none",
      advanced: true,
    }),
    field("saveOutputAs", "Save Output As", "text", "", {
      help: "Optional variable alias for the complete Scroll output object.",
      example: "results_scroll",
      expressionMode: "none",
      advanced: true,
    }),
    field(
      "saveToWorkflowClipboard",
      "Workflow Clipboard",
      "select",
      ScrollDefaults.saveToWorkflowClipboard,
      {
        options: ["off", "replace", "append", "version"],
        help: "Optionally publish the output to the run-local Workflow Clipboard.",
        example: "off",
        expressionMode: "none",
        advanced: true,
      },
    ),
    field("workflowClipboardEntry", "Clipboard Entry Name", "text", "", {
      help: "Entry name used when Workflow Clipboard output is enabled.",
      example: "results_scroll",
      expressionMode: "none",
      advanced: true,
    }),
    field("logLevel", "Log Level", "select", ScrollDefaults.logLevel, {
      options: ["normal", "verbose"],
      help: "Normal logs structural summaries; verbose logs local input and output values.",
      example: "normal",
      expressionMode: "none",
      advanced: true,
    }),
  ]),
  outputSchema: {
    type: "object",
    required: [
      "operation",
      "scrollCount",
      "finalPosition",
      "stopReason",
      "executionMethod",
    ],
    properties: {
      operation: { enum: Object.values(ScrollOperations) },
      scrollCount: { type: "integer", minimum: 0 },
      finalPosition: {
        type: "object",
        required: ["x", "y", "maxX", "maxY", "atStart", "atEnd"],
        properties: {
          x: { type: "number", minimum: 0 },
          y: { type: "number", minimum: 0 },
          maxX: { type: "number", minimum: 0 },
          maxY: { type: "number", minimum: 0 },
          atStart: { type: "boolean" },
          atEnd: { type: "boolean" },
        },
      },
      stopReason: { enum: Object.values(ScrollStopReasons) },
      executionMethod: { enum: Object.values(ScrollExecutionMethods) },
    },
  },
  examples: [
    {
      name: "Scroll one viewport down",
      config: {
        operation: ScrollOperations.ByAmount,
        direction: ScrollDirections.Down,
        amount: 1,
        amountUnit: ScrollAmountUnits.Screen,
      },
    },
    {
      name: "Load results until the page ends",
      config: {
        operation: ScrollOperations.UntilCondition,
        direction: ScrollDirections.Down,
        amount: 80,
        amountUnit: ScrollAmountUnits.ViewportPercent,
        stopCondition: ScrollStopConditions.ScrollEnd,
        maxAttempts: 20,
      },
    },
  ],
});

function valueAutocomplete() {
  return [
    AUTOCOMPLETE_SOURCES.Variables,
    AUTOCOMPLETE_SOURCES.NodeOutputs,
    AUTOCOMPLETE_SOURCES.WorkflowClipboard,
    AUTOCOMPLETE_SOURCES.LoopValues,
  ];
}

function field(key, label, kind, defaultValue, extra = {}) {
  return { key, label, kind, default: defaultValue, ...extra };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
