import {
  HostClassifications,
  RetryReasons,
  RetrySafety,
} from "../../shared/executionPolicy.js";

export const NAVIGATE_NODE_TYPE = "browser.navigate";

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
  version: 1,
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
  capabilities: ["browser-tab", "side-effect", "retry-safe", "async"],
  requiredServices: ["tabs"],
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
  commonConfigDefaults: NavigateDefaults,
  configSchema: [
    field("operation", "Operation", "select", NavigateDefaults.operation, {
      required: true,
      options: Object.values(NavigateOperations),
      help: "Go to an exact URL, go back, go forward, or reload.",
    }),
    field("tabSource", "Tab Source", "select", NavigateDefaults.tabSource, {
      required: true,
      options: Object.values(NavigateTabSources),
      help: "Choose the tab from current runtime state or a saved reference.",
    }),
    field("tabReference", "Saved Tab Reference", "text", "", {
      visibleWhen: { field: "tabSource", equals: NavigateTabSources.SavedReference },
      help: "Reference name or reference object saved by an earlier node.",
    }),
    field("url", "URL", "text", "", {
      requiredWhen: { field: "operation", equals: NavigateOperations.GotoUrl },
      help: "An absolute URL. Invalid input is never converted into a web search.",
    }),
    field(
      "openDestinationIn",
      "Open Destination In",
      "select",
      NavigateDefaults.openDestinationIn,
      {
        options: Object.values(NavigateDestinations),
        visibleWhen: { field: "operation", equals: NavigateOperations.GotoUrl },
      },
    ),
    field("waitUntil", "Wait Until", "select", NavigateDefaults.waitUntil, {
      options: Object.values(NavigateReadiness),
      help: "Readiness applies to the resulting destination.",
    }),
    field("timeout", "Timeout (ms)", "number", NavigateDefaults.timeout, {
      minimum: 1,
      advanced: true,
    }),
    field(
      "onNoHistory",
      "When History Is Unavailable",
      "select",
      NavigateDefaults.onNoHistory,
      {
        options: Object.values(NavigateNoHistoryBehaviors),
        advanced: true,
      },
    ),
    field("saveTabReferenceAs", "Save Tab Reference As", "text", "", {
      advanced: true,
    }),
    field(
      "protectedPagePolicy",
      "Protected Page Policy",
      "select",
      NavigateDefaults.protectedPagePolicy,
      {
        options: Object.values(ProtectedPagePolicies),
        advanced: true,
      },
    ),
  ],
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
      tab: { type: "object" },
      navigationState: { type: "string" },
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
