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

export const TAB_CONTROL_NODE_TYPE = "browser.tab.control";

export const TabControlErrorCodes = Object.freeze({
  OperationFailed: createNodeSpecificErrorCode(
    TAB_CONTROL_NODE_TYPE,
    "operation_failed",
  ),
  AmbiguousSelector: createNodeSpecificErrorCode(
    TAB_CONTROL_NODE_TYPE,
    "ambiguous_selector",
  ),
  BookmarkPermissionUnavailable: createNodeSpecificErrorCode(
    TAB_CONTROL_NODE_TYPE,
    "bookmark_permission_unavailable",
  ),
  CloseConfirmationUnavailable: createNodeSpecificErrorCode(
    TAB_CONTROL_NODE_TYPE,
    "close_confirmation_unavailable",
  ),
  CloseNotConfirmed: createNodeSpecificErrorCode(
    TAB_CONTROL_NODE_TYPE,
    "close_not_confirmed",
  ),
});

export const TabControlOperations = Object.freeze({
  OpenBrowserNewTab: "open_browser_new_tab",
  OpenUrlInNewTab: "open_url_in_new_tab",
  SwitchTab: "switch_tab",
  SwitchRelativeTab: "switch_relative_tab",
  ReturnToOriginTab: "return_to_origin_tab",
  CloseTab: "close_tab",
  FocusTab: "focus_tab",
  PinTab: "pin_tab",
  UnpinTab: "unpin_tab",
  MuteTab: "mute_tab",
  UnmuteTab: "unmute_tab",
  ToggleMute: "toggle_mute",
  BookmarkPage: "bookmark_page",
  RemoveBookmark: "remove_bookmark",
});

export const TabSelectorKinds = Object.freeze({
  Current: "current",
  SavedReference: "saved_reference",
  Id: "id",
  Index: "index",
  Title: "title",
  Url: "url",
  MostRecentlyOpened: "most_recently_opened",
  First: "first",
  Last: "last",
});

export const TabMatchModes = Object.freeze({
  Exact: "exact",
  Contains: "contains",
  Wildcard: "wildcard",
});

export const MultipleMatchBehaviors = Object.freeze({
  Fail: "fail",
  FirstMatching: "first_matching",
  MostRecentlyOpened: "most_recently_opened",
});

export const RelativeDirections = Object.freeze({
  Left: "left",
  Right: "right",
  Next: "next",
  Previous: "previous",
});

export const CloseBehaviors = Object.freeze({
  Opener: "opener",
  Left: "left",
  Right: "right",
  MostRecent: "most_recent",
  None: "none",
});

export const TabNotFoundBehaviors = Object.freeze({
  Fail: "fail",
  Skip: "skip",
  ErrorPort: "error_port",
});

export const BookmarkFolderModes = Object.freeze({
  DefaultBar: "default_bar",
  FolderId: "folder_id",
});

export const BookmarkSelectorKinds = Object.freeze({
  CurrentPageUrl: "current_page_url",
  BookmarkId: "bookmark_id",
});

export const TabReadiness = Object.freeze({
  None: "none",
  NavigationStart: "navigation_start",
  DomReady: "dom_ready",
  FullLoad: "full_load",
  NetworkIdle: "network_idle",
});

export const TabControlDefaults = deepFreeze({
  enabled: true,
  displayName: "Tab Control",
  operation: TabControlOperations.SwitchTab,
  tabSelectorKind: TabSelectorKinds.Current,
  tabSelectorValue: "",
  tabMatchMode: TabMatchModes.Exact,
  multipleMatchBehavior: MultipleMatchBehaviors.Fail,
  relativeDirection: RelativeDirections.Right,
  relativeOffset: 1,
  wrapAround: false,
  url: "",
  openInBackground: false,
  reuseMatchingTab: false,
  closeBehavior: CloseBehaviors.Opener,
  ifNotFound: TabNotFoundBehaviors.Fail,
  waitUntil: TabReadiness.NavigationStart,
  saveTabReferenceAs: "",
  confirmBeforeClose: false,
  bookmarkFolderMode: BookmarkFolderModes.DefaultBar,
  bookmarkFolderId: "",
  bookmarkSelectorKind: BookmarkSelectorKinds.CurrentPageUrl,
  bookmarkId: "",
  removeAllBookmarkMatches: false,
  retryCount: 1,
  retryDelay: 0,
  retryStrategy: "fixed",
  retryOnlyFor: [RetryReasons.TargetNotFound, RetryReasons.AnyError],
  timeout: 30000,
  onError: "fail",
  saveOutputAs: null,
  saveToWorkflowClipboard: "off",
  logLevel: "normal",
});

const SELECTOR_OPERATIONS = Object.freeze([
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

export const tabControlNodeDefinition = deepFreeze({
  type: TAB_CONTROL_NODE_TYPE,
  stableType: TAB_CONTROL_NODE_TYPE,
  version: 1,
  contractKind: "finalized",
  catalogNumber: 3,
  displayName: "Tab Control",
  label: "Tab Control",
  category: "Navigation",
  icon: "tabs",
  description:
    "Open, select, switch, close, focus, pin, mute, or bookmark a browser tab.",
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
  capabilities: ["browser-tab", "side-effect", "async"],
  requiredServices: ["tabs", "windows"],
  optionalServices: ["bookmarks", "permissions", "interactive-confirmation"],
  optionalPermissions: [{
    permission: "bookmarks",
    label: "Bookmarks access",
    description: "Required only for bookmark_page and remove_bookmark.",
    operations: [
      TabControlOperations.BookmarkPage,
      TabControlOperations.RemoveBookmark,
    ],
  }],
  retrySafety: RetrySafety.VerifyBeforeRetry,
  defaultRetryCount: 1,
  defaultRetryDelay: 0,
  retryOnlyFor: [RetryReasons.TargetNotFound, RetryReasons.AnyError],
  hostClassification: HostClassifications.None,
  hostStatusTag: "Host fallback: off",
  protectedPageBehavior: {
    tabActionsAllowed: true,
    domAutomationAllowed: false,
    pageCapability: "tab_control_only",
  },
  errorCodes: {
    [TabControlErrorCodes.OperationFailed]: NodeErrorCategories.Tab,
    [TabControlErrorCodes.AmbiguousSelector]: NodeErrorCategories.Tab,
    [TabControlErrorCodes.BookmarkPermissionUnavailable]:
      NodeErrorCategories.Dependency,
    [TabControlErrorCodes.CloseConfirmationUnavailable]:
      NodeErrorCategories.Dependency,
    [TabControlErrorCodes.CloseNotConfirmed]: NodeErrorCategories.Cancelled,
  },
  commonConfigDefaults: TabControlDefaults,
  configSchema: normalizeNodeFieldSchema([
    field("enabled", "Enabled", "boolean", TabControlDefaults.enabled, {
      help: "Turn this node off to skip it without changing any browser tab.",
      example: "true",
      expressionMode: "none",
      advanced: true,
    }),
    field("displayName", "Display Name", "text", TabControlDefaults.displayName, {
      help: "Friendly name shown in Graph Studio and execution logs.",
      example: "Switch to article tab",
      expressionMode: "none",
      advanced: true,
    }),
    field("operation", "Operation", "select", TabControlDefaults.operation, {
      required: true,
      options: Object.values(TabControlOperations),
      help: "Choose the exact tab operation to perform.",
      example: TabControlOperations.SwitchTab,
      expressionMode: "none",
    }),
    field(
      "tabSelectorKind",
      "Tab Selector",
      "select",
      TabControlDefaults.tabSelectorKind,
      {
        options: Object.values(TabSelectorKinds),
        visibleWhenAny: SELECTOR_OPERATIONS.map((operation) => ({
          field: "operation",
          equals: operation,
        })),
        help: "Select tabs explicitly; ambiguous title or URL matches fail.",
        example: TabSelectorKinds.SavedReference,
        expressionMode: "none",
      },
    ),
    field("tabSelectorValue", "Selector Value", "text", "", {
      visibleWhenAny: SELECTOR_OPERATIONS.map((operation) => ({
        field: "operation",
        equals: operation,
      })),
      requiredWhenAny: [
        TabSelectorKinds.SavedReference,
        TabSelectorKinds.Id,
        TabSelectorKinds.Index,
        TabSelectorKinds.Title,
        TabSelectorKinds.Url,
      ].map((kind) => ({
        field: "tabSelectorKind",
        equals: kind,
      })),
      help: "Value for a saved reference, ID, index, title, or URL selector.",
      example: "wikipedia_tab",
      autocompleteSources: [
        AUTOCOMPLETE_SOURCES.TabReferences,
        AUTOCOMPLETE_SOURCES.Variables,
        AUTOCOMPLETE_SOURCES.NodeOutputs,
        AUTOCOMPLETE_SOURCES.WorkflowClipboard,
        AUTOCOMPLETE_SOURCES.LoopValues,
      ],
    }),
    field("tabMatchMode", "Title / URL Match", "select", TabMatchModes.Exact, {
      options: Object.values(TabMatchModes),
      visibleWhenAny: [
        { field: "tabSelectorKind", equals: TabSelectorKinds.Title },
        { field: "tabSelectorKind", equals: TabSelectorKinds.Url },
      ],
      help: "Choose exact, contains, or shared * and ? wildcard matching for title or URL selectors.",
      example: TabMatchModes.Exact,
      expressionMode: "none",
    }),
    field(
      "multipleMatchBehavior",
      "Multiple Matches",
      "select",
      MultipleMatchBehaviors.Fail,
      {
        options: Object.values(MultipleMatchBehaviors),
        visibleWhenAny: [
          { field: "tabSelectorKind", equals: TabSelectorKinds.Title },
          { field: "tabSelectorKind", equals: TabSelectorKinds.Url },
        ],
        help: "Fail safely, choose the first ordered match, or use run-tracked creation recency.",
        example: MultipleMatchBehaviors.Fail,
        expressionMode: "none",
      },
    ),
    field(
      "relativeDirection",
      "Relative Direction",
      "select",
      TabControlDefaults.relativeDirection,
      {
        options: Object.values(RelativeDirections),
        visibleWhen: {
          field: "operation",
          equals: TabControlOperations.SwitchRelativeTab,
        },
        help: "Move left/previous or right/next from the current tab.",
        example: RelativeDirections.Right,
        expressionMode: "none",
      },
    ),
    field("relativeOffset", "Relative Offset", "number", 1, {
      integer: true,
      minimum: 1,
      visibleWhen: {
        field: "operation",
        equals: TabControlOperations.SwitchRelativeTab,
      },
      help: "Number of tab positions to move.",
      example: "1",
    }),
    field("wrapAround", "Wrap Around", "boolean", false, {
      visibleWhen: {
        field: "operation",
        equals: TabControlOperations.SwitchRelativeTab,
      },
      help: "Continue from the opposite edge when the requested offset crosses an edge.",
      example: "false",
      expressionMode: "none",
    }),
    field("url", "URL", "text", "", {
      requiredWhen: {
        field: "operation",
        equals: TabControlOperations.OpenUrlInNewTab,
      },
      visibleWhen: {
        field: "operation",
        equals: TabControlOperations.OpenUrlInNewTab,
      },
      help: "Absolute URL to open. Plain search text is rejected.",
      example: "https://example.com/{{ variables.path }}",
      format: "absolute_url_template",
      autocompleteSources: [
        AUTOCOMPLETE_SOURCES.Variables,
        AUTOCOMPLETE_SOURCES.NodeOutputs,
        AUTOCOMPLETE_SOURCES.WorkflowClipboard,
        AUTOCOMPLETE_SOURCES.LoopValues,
      ],
    }),
    field("openInBackground", "Open In Background", "boolean", false, {
      visibleWhenAny: [
        {
          field: "operation",
          equals: TabControlOperations.OpenBrowserNewTab,
        },
        {
          field: "operation",
          equals: TabControlOperations.OpenUrlInNewTab,
        },
      ],
      help: "Create the tab without making it active.",
      example: "false",
      expressionMode: "none",
    }),
    field("reuseMatchingTab", "Reuse Matching Tab", "boolean", false, {
      visibleWhen: {
        field: "operation",
        equals: TabControlOperations.OpenUrlInNewTab,
      },
      help: "Reuse one exact-URL tab; multiple exact matches fail safely.",
      example: "false",
      expressionMode: "none",
    }),
    field(
      "closeBehavior",
      "After Close",
      "select",
      TabControlDefaults.closeBehavior,
      {
        options: Object.values(CloseBehaviors),
        visibleWhen: {
          field: "operation",
          equals: TabControlOperations.CloseTab,
        },
        help: "Choose the deterministic tab to activate after closing.",
        example: CloseBehaviors.Opener,
        expressionMode: "none",
      },
    ),
    field(
      "ifNotFound",
      "If Tab Is Not Found",
      "select",
      TabControlDefaults.ifNotFound,
      {
        options: Object.values(TabNotFoundBehaviors),
        help: "Fail, complete with a warning, or route through the error port.",
        example: TabNotFoundBehaviors.Fail,
        expressionMode: "none",
        advanced: true,
      },
    ),
    field("waitUntil", "Wait Until", "select", TabControlDefaults.waitUntil, {
      options: Object.values(TabReadiness),
      visibleWhenAny: [
        {
          field: "operation",
          equals: TabControlOperations.OpenBrowserNewTab,
        },
        {
          field: "operation",
          equals: TabControlOperations.OpenUrlInNewTab,
        },
      ],
      help: "Readiness to wait for after creating or reusing a tab.",
      example: TabReadiness.DomReady,
      expressionMode: "none",
    }),
    field("saveTabReferenceAs", "Save Tab Reference As", "text", "", {
      help: "Optional name for the resulting selected or created tab.",
      example: "article_tab",
      expressionMode: "none",
      advanced: true,
    }),
    field("confirmBeforeClose", "Confirm Before Close", "boolean", false, {
      visibleWhen: {
        field: "operation",
        equals: TabControlOperations.CloseTab,
      },
      help: "Require an explicit interactive approval before closing.",
      example: "false",
      expressionMode: "none",
      advanced: true,
    }),
    field(
      "bookmarkFolderMode",
      "Bookmark Folder",
      "select",
      BookmarkFolderModes.DefaultBar,
      {
        options: Object.values(BookmarkFolderModes),
        visibleWhen: {
          field: "operation",
          equals: TabControlOperations.BookmarkPage,
        },
        help: "Use Chrome's default bookmark bar or an explicit folder ID.",
        example: BookmarkFolderModes.DefaultBar,
        expressionMode: "none",
      },
    ),
    field("bookmarkFolderId", "Bookmark Folder ID", "text", "", {
      visibleWhenAll: [
        {
          field: "operation",
          equals: TabControlOperations.BookmarkPage,
        },
        {
          field: "bookmarkFolderMode",
          equals: BookmarkFolderModes.FolderId,
        },
      ],
      requiredWhenAll: [
        {
          field: "operation",
          equals: TabControlOperations.BookmarkPage,
        },
        {
          field: "bookmarkFolderMode",
          equals: BookmarkFolderModes.FolderId,
        },
      ],
      help: "Chrome bookmark folder ID used by bookmark_page.",
      example: "1",
      advanced: true,
    }),
    field(
      "bookmarkSelectorKind",
      "Bookmark Selector",
      "select",
      BookmarkSelectorKinds.CurrentPageUrl,
      {
        options: Object.values(BookmarkSelectorKinds),
        visibleWhen: {
          field: "operation",
          equals: TabControlOperations.RemoveBookmark,
        },
        help: "Remove by exact selected-page URL or one explicit bookmark ID.",
        example: BookmarkSelectorKinds.CurrentPageUrl,
        expressionMode: "none",
      },
    ),
    field("bookmarkId", "Bookmark ID", "text", "", {
      visibleWhenAll: [
        {
          field: "operation",
          equals: TabControlOperations.RemoveBookmark,
        },
        {
          field: "bookmarkSelectorKind",
          equals: BookmarkSelectorKinds.BookmarkId,
        },
      ],
      requiredWhenAll: [
        {
          field: "operation",
          equals: TabControlOperations.RemoveBookmark,
        },
        {
          field: "bookmarkSelectorKind",
          equals: BookmarkSelectorKinds.BookmarkId,
        },
      ],
      help: "Exact Chrome bookmark ID to remove.",
      example: "42",
      advanced: true,
    }),
    field(
      "removeAllBookmarkMatches",
      "Remove All URL Matches",
      "boolean",
      false,
      {
        visibleWhenAll: [
          {
            field: "operation",
            equals: TabControlOperations.RemoveBookmark,
          },
          {
            field: "bookmarkSelectorKind",
            equals: BookmarkSelectorKinds.CurrentPageUrl,
          },
        ],
        help: "Remove every exact URL bookmark; otherwise duplicates fail safely.",
        example: "false",
        expressionMode: "none",
        advanced: true,
      },
    ),
    field("timeout", "Timeout (ms)", "number", TabControlDefaults.timeout, {
      minimum: 1,
      help: "Maximum time for selection, action, and configured readiness.",
      example: "30000",
      advanced: true,
    }),
    field("retryCount", "Retry Count", "number", TabControlDefaults.retryCount, {
      integer: true,
      minimum: 0,
      maximum: 10,
      help: "Retries only when verification proves the operation did not complete.",
      example: "1",
      advanced: true,
    }),
    field("retryDelay", "Retry Delay (ms)", "number", 0, {
      minimum: 0,
      help: "Delay before a verified-safe retry.",
      example: "250",
      advanced: true,
    }),
    field("retryStrategy", "Retry Strategy", "select", "fixed", {
      options: ["fixed", "increasing"],
      help: "Use a fixed delay or increase it with each attempt.",
      example: "fixed",
      expressionMode: "none",
      advanced: true,
    }),
    field("retryOnlyFor", "Retry Only For", "select", RetryReasons.AnyError, {
      options: [
        RetryReasons.TargetNotFound,
        RetryReasons.Timeout,
        RetryReasons.AnyError,
      ],
      help: "Restrict retries to a stable eligible failure category.",
      example: RetryReasons.AnyError,
      expressionMode: "none",
      advanced: true,
    }),
    field("onError", "On Error", "select", "fail", {
      options: ["fail", "continue_with_warning", "skip", "error_port"],
      help: "Fail, continue with a warning, skip, or use the Graph error route.",
      example: "fail",
      expressionMode: "none",
      advanced: true,
    }),
    field("saveOutputAs", "Save Output As", "text", "", {
      help: "Optional variable alias for the full Tab Control output.",
      example: "article_tab_result",
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
      example: "article_tab_result",
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
      "operation",
      "originTab",
      "tab",
      "createdTab",
      "pageCapability",
      "matchedBy",
      "pinned",
      "muted",
      "bookmarked",
    ],
    properties: {
      operation: { enum: Object.values(TabControlOperations) },
      originTab: tabSchema(true),
      tab: tabSchema(true),
      createdTab: tabSchema(true),
      pageCapability: {
        type: ["string", "null"],
        enum: ["dom_supported", "tab_control_only", null],
      },
      matchedBy: { type: ["string", "null"] },
      pinned: { type: ["boolean", "null"] },
      muted: { type: ["boolean", "null"] },
      bookmarked: { type: ["boolean", "null"] },
    },
  },
  examples: [
    {
      name: "Open and save an article tab",
      config: {
        operation: TabControlOperations.OpenUrlInNewTab,
        url: "https://example.com/article",
        waitUntil: TabReadiness.DomReady,
        saveTabReferenceAs: "article_tab",
      },
    },
    {
      name: "Return to the workflow origin tab",
      config: {
        operation: TabControlOperations.ReturnToOriginTab,
      },
    },
  ],
});

function tabSchema(nullable = false) {
  return {
    type: nullable ? ["object", "null"] : "object",
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
