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
  AUTOCOMPLETE_SOURCES,
  normalizeNodeFieldSchema,
} from "../../../core/nodeAuthoring.js";

export const NAVIGATE_NODE_TYPE = "browser.navigate";

export const NavigateErrorCodes = Object.freeze({
  NavigationFailed: createNodeSpecificErrorCode(
    NAVIGATE_NODE_TYPE,
    "navigation_failed",
  ),
  NoHistory: createNodeSpecificErrorCode(
    NAVIGATE_NODE_TYPE,
    "no_history",
  ),
});

export const NavigateOperations = Object.freeze({
  GotoUrl: "goto_url",
  Back: "back",
  Forward: "forward",
  Reload: "reload",
});

export const NavigateTabSources = Object.freeze({
  Current: "current",
  Active: "active",
  SavedReference: "saved_reference",
  PreviousNode: "previous_node",
});

export const NavigateDestinations = Object.freeze({
  CurrentTab: "current_tab",
  NewTab: "new_tab",
});

export const NavigateReadiness = Object.freeze({
  None: "none",
  NavigationStart: "navigation_start",
  DomReady: "dom_ready",
  FullLoad: "full_load",
  NetworkIdle: "network_idle",
});

export const NavigateNoHistoryBehaviors = Object.freeze({
  Fail: "fail",
  Skip: "skip",
  Continue: "continue",
});

export const ProtectedPagePolicies = Object.freeze({
  Fail: "fail",
  Skip: "skip",
  AskUser: "ask_user",
  WaitUntilSupported: "wait_until_supported",
});

export const NavigateDefaults = deepFreeze({
  enabled: true,
  displayName: "Navigate",
  operation: NavigateOperations.GotoUrl,
  tabSource: NavigateTabSources.Current,
  tabReference: "",
  url: "",
  openDestinationIn: NavigateDestinations.CurrentTab,
  waitUntil: NavigateReadiness.DomReady,
  timeout: 30000,
  onNoHistory: NavigateNoHistoryBehaviors.Fail,
  saveTabReferenceAs: "",
  protectedPagePolicy: ProtectedPagePolicies.Fail,
  retryCount: 1,
  retryDelay: 0,
  retryStrategy: "fixed",
  retryOnlyFor: [RetryReasons.NavigationFailure],
  onError: "fail",
  saveOutputAs: null,
  saveToWorkflowClipboard: "off",
  logLevel: "normal",
});

export const navigateNodeDefinition = deepFreeze({
  type: NAVIGATE_NODE_TYPE,
  stableType: NAVIGATE_NODE_TYPE,
  version: 2,
  contractKind: "finalized",
  catalogNumber: 1,
  displayName: "Navigate",
  label: "Navigate",
  category: "Navigation",
  icon: "navigate",
  description:
    "Navigate a selected tab to an exact URL, move through tab history, or reload.",
  inputPorts: [
    { id: "input", label: "Input", kind: "flow", required: false },
  ],
  outputPorts: [
    { id: "success", label: "Success", kind: "flow" },
    { id: "error", label: "Error", kind: "error" },
  ],
  inputs: ["input"],
  outputs: ["success", "error"],
  targetRequired: false,
  unknownConfigPolicy: "reject",
  capabilities: [
    "browser-tab",
    "browser-navigation",
    "side-effect",
    "retry-safe",
    "async",
  ],
  requiredServices: ["tabs", "scripting"],
  retrySafety: RetrySafety.VerifyBeforeRetry,
  defaultRetryCount: 1,
  defaultRetryDelay: 0,
  retryOnlyFor: [RetryReasons.NavigationFailure],
  hostClassification: HostClassifications.None,
  hostStatusTag: "Host fallback: off",
  protectedPageBehavior: {
    tabActionsAllowed: true,
    domAutomationAllowed: false,
    navigateAwayAllowed: true,
    policies: Object.values(ProtectedPagePolicies),
  },
  errorCodes: {
    [NavigateErrorCodes.NavigationFailed]: NodeErrorCategories.Navigation,
    [NavigateErrorCodes.NoHistory]: NodeErrorCategories.Navigation,
  },
  commonConfigDefaults: NavigateDefaults,
  configSchema: normalizeNodeFieldSchema([
    field("enabled", "Enabled", "boolean", NavigateDefaults.enabled, {
      help: "Turn this node off to skip it without changing any browser tab.",
      example: "true",
      expressionMode: "none",
      advanced: true,
    }),
    field("displayName", "Display Name", "text", NavigateDefaults.displayName, {
      help: "Friendly name shown in Graph Studio and execution logs.",
      example: "Open account page",
      expressionMode: "none",
      advanced: true,
    }),
    field("operation", "Operation", "select", NavigateDefaults.operation, {
      required: true,
      options: Object.values(NavigateOperations),
      help: "Go to an exact URL, go back, go forward, or reload.",
      example: NavigateOperations.GotoUrl,
      expressionMode: "none",
    }),
    field("tabSource", "Tab Source", "select", NavigateDefaults.tabSource, {
      required: true,
      options: Object.values(NavigateTabSources),
      help: "Choose the tab from current runtime state or a saved reference.",
      example: NavigateTabSources.Current,
      expressionMode: "none",
    }),
    field("tabReference", "Saved Tab Reference", "text", "", {
      visibleWhen: { field: "tabSource", equals: NavigateTabSources.SavedReference },
      requiredWhen: { field: "tabSource", equals: NavigateTabSources.SavedReference },
      help: "Reference name or reference object saved by an earlier node.",
      example: "account_tab",
      autocompleteSources: [AUTOCOMPLETE_SOURCES.TabReferences],
    }),
    field("url", "URL", "text", "", {
      requiredWhen: { field: "operation", equals: NavigateOperations.GotoUrl },
      help: "An absolute URL. Invalid input is never converted into a web search.",
      example: "https://example.com/accounts/{{ variables.accountId }}",
      format: "absolute_url_template",
      allowedProtocols: [
        "http:",
        "https:",
        "file:",
        "about:",
        "chrome:",
        "chrome-extension:",
        "edge:",
      ],
      autocompleteSources: [
        AUTOCOMPLETE_SOURCES.Variables,
        AUTOCOMPLETE_SOURCES.NodeOutputs,
        AUTOCOMPLETE_SOURCES.WorkflowClipboard,
        AUTOCOMPLETE_SOURCES.LoopValues,
      ],
    }),
    field(
      "openDestinationIn",
      "Open Destination In",
      "select",
      NavigateDefaults.openDestinationIn,
      {
        options: Object.values(NavigateDestinations),
        visibleWhen: { field: "operation", equals: NavigateOperations.GotoUrl },
        help: "Reuse the selected tab or create a new active destination tab.",
        example: NavigateDestinations.CurrentTab,
        expressionMode: "none",
      },
    ),
    field("waitUntil", "Wait Until", "select", NavigateDefaults.waitUntil, {
      options: Object.values(NavigateReadiness),
      help: "Readiness applies to the resulting destination.",
      example: NavigateReadiness.DomReady,
      expressionMode: "none",
    }),
    field("timeout", "Timeout (ms)", "number", NavigateDefaults.timeout, {
      minimum: 1,
      help: "Maximum time for the navigation action and configured readiness wait.",
      example: "30000",
      advanced: true,
    }),
    field(
      "onNoHistory",
      "When History Is Unavailable",
      "select",
      NavigateDefaults.onNoHistory,
      {
        options: Object.values(NavigateNoHistoryBehaviors),
        help: "Choose whether missing back/forward history fails, skips, or continues.",
        example: NavigateNoHistoryBehaviors.Fail,
        expressionMode: "none",
        advanced: true,
      },
    ),
    field("saveTabReferenceAs", "Save Tab Reference As", "text", "", {
      help: "Optional name that later nodes can use to select the resulting tab.",
      example: "account_tab",
      expressionMode: "none",
      advanced: true,
    }),
    field(
      "protectedPagePolicy",
      "Protected Page Policy",
      "select",
      NavigateDefaults.protectedPagePolicy,
      {
        options: Object.values(ProtectedPagePolicies),
        help: "Control DOM-readiness behavior when the destination is browser-protected.",
        example: ProtectedPagePolicies.Fail,
        expressionMode: "none",
        advanced: true,
      },
    ),
    field("retryCount", "Retry Count", "number", NavigateDefaults.retryCount, {
      integer: true,
      minimum: 0,
      maximum: 10,
      help: "Eligible navigation retries after the first attempt.",
      example: "1",
      advanced: true,
    }),
    field("retryDelay", "Retry Delay (ms)", "number", NavigateDefaults.retryDelay, {
      minimum: 0,
      help: "Delay before an eligible retry.",
      example: "500",
      advanced: true,
    }),
    field("retryStrategy", "Retry Strategy", "select", NavigateDefaults.retryStrategy, {
      options: ["fixed", "increasing"],
      help: "Use a fixed delay or increase it with each attempt.",
      example: "fixed",
      expressionMode: "none",
      advanced: true,
    }),
    field("retryOnlyFor", "Retry Only For", "select", RetryReasons.NavigationFailure, {
      options: [RetryReasons.NavigationFailure, RetryReasons.AnyError],
      help: "Restrict retries to verified navigation failures or allow any eligible error.",
      example: RetryReasons.NavigationFailure,
      expressionMode: "none",
      advanced: true,
    }),
    field("onError", "On Error", "select", NavigateDefaults.onError, {
      options: ["fail", "continue_with_warning", "skip", "error_port"],
      help: "Fail the run, continue with a warning, skip, or use the Graph error route.",
      example: "fail",
      expressionMode: "none",
      advanced: true,
    }),
    field("saveOutputAs", "Save Output As", "text", "", {
      help: "Optional variable alias for the complete Navigate output object.",
      example: "account_navigation",
      expressionMode: "none",
      advanced: true,
    }),
    field(
      "saveToWorkflowClipboard",
      "Workflow Clipboard",
      "select",
      NavigateDefaults.saveToWorkflowClipboard,
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
      example: "account_navigation",
      expressionMode: "none",
      advanced: true,
    }),
    field("logLevel", "Log Level", "select", NavigateDefaults.logLevel, {
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
      "previousUrl",
      "currentUrl",
      "tab",
      "navigationState",
      "durationMs",
    ],
    properties: {
      operation: { enum: Object.values(NavigateOperations) },
      previousUrl: { type: ["string", "null"] },
      currentUrl: { type: ["string", "null"] },
      tab: {
        type: "object",
        required: [
          "id",
          "windowId",
          "index",
          "url",
          "title",
          "active",
          "status",
          "pageCapability",
        ],
        properties: {
          id: { type: "integer" },
          windowId: { type: ["integer", "null"] },
          index: { type: ["integer", "null"] },
          url: { type: ["string", "null"] },
          title: { type: ["string", "null"] },
          active: { type: "boolean" },
          status: { type: ["string", "null"] },
          pageCapability: {
            enum: ["dom_supported", "tab_control_only"],
          },
        },
      },
      navigationState: {
        enum: [
          ...Object.values(NavigateReadiness),
          "protected_page_skipped",
          "no_history_skipped",
          "no_history_continued",
        ],
      },
      durationMs: { type: "number", minimum: 0 },
    },
  },
  examples: [
    {
      name: "Open a page",
      config: {
        operation: NavigateOperations.GotoUrl,
        url: "https://example.com/",
        waitUntil: NavigateReadiness.DomReady,
      },
    },
    {
      name: "Go back when possible",
      config: {
        operation: NavigateOperations.Back,
        onNoHistory: NavigateNoHistoryBehaviors.Continue,
      },
    },
  ],
});

function field(key, label, kind, defaultValue, extra = {}) {
  return { key, label, kind, default: defaultValue, ...extra };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
