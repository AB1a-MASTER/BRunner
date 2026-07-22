// core/nodeRegistry.js
// Canonical serializable definitions for workflow nodes supported by runtime.

import { Actions, NavigationTargets } from "./constants.js";
import {
  DEFAULT_NATIVE_HOST_REQUIREMENT,
  NativeHostCapabilities,
  NativeHostRequirementModes,
  normalizeNativeHostRequirement,
} from "./nativeHostRequirements.js";
import {
  createTargetEditorSchema,
  normalizeNodeFieldSchema,
} from "./nodeAuthoring.js";

const definitions = [
  {
    type: Actions.BrowserNavigate,
    version: 1,
    category: "Browser",
    label: "Navigate URL",
    icon: "🌐",
    description: "Navigate in the current tab or open a new tab.",
    targetRequired: false,
    config: [
      { key: "url", label: "URL", kind: "text", required: true },
      {
        key: "openIn",
        label: "Open In",
        kind: "select",
        default: NavigationTargets.SameTab,
        options: [NavigationTargets.SameTab, NavigationTargets.NewTab],
      },
    ],
    inputs: ["input"],
    outputs: ["success"],
  },
  {
    type: Actions.ElementClick,
    version: 1,
    category: "Element",
    label: "Click Element",
    icon: "🖱️",
    description: "Resolve and click a page element.",
    nativeHost: {
      mode: NativeHostRequirementModes.Fallback,
      capabilities: [
        NativeHostCapabilities.HostWindow,
        NativeHostCapabilities.HostAction,
        NativeHostCapabilities.HostVisualMatch,
      ],
    },
    targetRequired: true,
    config: [
      visibleHostFallbackField(),
      visibleHostVisualMatchField(),
      visibleHostVerificationSelectorField(),
      visibleHostVerificationTextField(),
    ],
    inputs: ["input"],
    outputs: ["success"],
  },
  {
    type: Actions.BrowserBack,
    version: 1,
    category: "Browser",
    label: "Go Back",
    icon: "←",
    description: "Navigate the current tab backward in its history.",
    targetRequired: false,
    config: [historyUnavailableField()],
    inputs: ["input"],
    outputs: ["success"],
  },
  {
    type: Actions.BrowserSearch,
    version: 1,
    category: "Browser",
    label: "Search with Default Provider",
    icon: "🔎",
    description: "Search using the browser's configured default search provider.",
    targetRequired: false,
    config: [
      { key: "query", label: "Search Query", kind: "text", required: true },
      {
        key: "openIn",
        label: "Open Results In",
        kind: "select",
        default: "currentTab",
        options: ["currentTab", "newTab"],
      },
    ],
    inputs: ["input"],
    outputs: ["success"],
  },
  {
    type: Actions.BrowserForward,
    version: 1,
    category: "Browser",
    label: "Go Forward",
    icon: "→",
    description: "Navigate the current tab forward in its history.",
    targetRequired: false,
    config: [historyUnavailableField()],
    inputs: ["input"],
    outputs: ["success"],
  },
  {
    type: Actions.BrowserReload,
    version: 1,
    category: "Browser",
    label: "Reload Page",
    icon: "🔄",
    description: "Reload the current browser tab.",
    targetRequired: false,
    config: [],
    inputs: ["input"],
    outputs: ["success"],
  },
  {
    type: Actions.BrowserTabOpen,
    version: 1,
    category: "Browser",
    label: "Open Tab",
    icon: "➕",
    description: "Open a URL in a new tracked browser tab.",
    targetRequired: false,
    config: [
      { key: "url", label: "URL", kind: "text", required: true },
      {
        key: "continueIn",
        label: "Continue Workflow In",
        kind: "select",
        default: "newTab",
        options: ["newTab", "currentTab"],
      },
      {
        key: "tabRef",
        label: "New Tab Reference",
        kind: "text",
        default: "",
      },
    ],
    inputs: ["input"],
    outputs: ["success", "tab"],
  },
  {
    type: Actions.BrowserTabClose,
    version: 1,
    category: "Browser",
    label: "Close Current Tab",
    icon: "✕",
    description: "Close the current tab and return to its opener or another safe tab.",
    targetRequired: false,
    config: [
      {
        key: "continueIn",
        label: "After Closing",
        kind: "select",
        default: "openerOrAvailable",
        options: ["openerOrAvailable", "none"],
      },
    ],
    inputs: ["input"],
    outputs: ["success"],
  },
  {
    type: Actions.ElementType,
    version: 1,
    category: "Element",
    label: "Type Text",
    icon: "⌨️",
    description: "Type text or an expression into an element.",
    nativeHost: {
      mode: NativeHostRequirementModes.Fallback,
      capabilities: [
        NativeHostCapabilities.HostWindow,
        NativeHostCapabilities.HostAction,
        NativeHostCapabilities.HostVisualMatch,
      ],
    },
    targetRequired: true,
    config: [
      { key: "value", label: "Text", kind: "text", required: true },
      visibleHostFallbackField(),
      visibleHostVisualMatchField(),
      visibleHostVerificationSelectorField(),
      visibleHostVerificationTextField(),
    ],
    inputs: ["input"],
    outputs: ["success"],
  },
  {
    type: Actions.ElementDoubleClick,
    version: 1,
    category: "Element",
    label: "Double-Click Element",
    icon: "🖱️",
    description: "Double-click a resolved page element.",
    nativeHost: {
      mode: NativeHostRequirementModes.Fallback,
      capabilities: [
        NativeHostCapabilities.HostWindow,
        NativeHostCapabilities.HostAction,
        NativeHostCapabilities.HostVisualMatch,
      ],
    },
    targetRequired: true,
    config: [
      visibleHostFallbackField(),
      visibleHostVisualMatchField(),
      visibleHostVerificationSelectorField(),
      visibleHostVerificationTextField(),
    ],
    inputs: ["input"],
    outputs: ["success"],
  },
  {
    type: Actions.ElementHover,
    version: 1,
    category: "Element",
    label: "Hover Element",
    icon: "☝️",
    description: "Move pointer interaction over a resolved element.",
    targetRequired: true,
    config: [],
    inputs: ["input"],
    outputs: ["success"],
  },
  {
    type: Actions.ElementClear,
    version: 1,
    category: "Element",
    label: "Clear Input",
    icon: "⌫",
    description: "Clear an input, textarea, or editable element.",
    targetRequired: true,
    config: [],
    inputs: ["input"],
    outputs: ["success"],
  },
  {
    type: Actions.ElementScrollIntoView,
    version: 1,
    category: "Element",
    label: "Scroll Element Into View",
    icon: "🎯",
    description: "Scroll until the target element is visible.",
    targetRequired: true,
    config: [
      {
        key: "block",
        label: "Vertical Alignment",
        kind: "select",
        default: "center",
        options: ["start", "center", "end", "nearest"],
      },
    ],
    inputs: ["input"],
    outputs: ["success"],
  },
  {
    type: Actions.BrowserScroll,
    version: 1,
    category: "Browser",
    label: "Scroll Page",
    icon: "↕️",
    description: "Scroll the page by horizontal and vertical pixel offsets.",
    targetRequired: false,
    config: [
      { key: "x", label: "Horizontal Pixels", kind: "number", default: 0 },
      { key: "y", label: "Vertical Pixels", kind: "number", default: 500 },
    ],
    inputs: ["input"],
    outputs: ["success"],
  },
  {
    type: Actions.ElementExtract,
    version: 1,
    category: "Data",
    label: "Extract Data (Legacy)",
    icon: "✂️",
    description: "Extract element text/value into a run variable.",
    targetRequired: true,
    config: [
      {
        key: "variableName",
        label: "Output Variable",
        kind: "text",
        required: true,
      },
    ],
    inputs: ["input"],
    outputs: ["success", "value"],
  },
  {
    type: Actions.KeyboardSendKeys,
    version: 1,
    category: "Keyboard",
    label: "Send Keystroke",
    icon: "🎹",
    description: "Send a key or shortcut through the native host.",
    nativeHost: {
      mode: NativeHostRequirementModes.Required,
      capabilities: [NativeHostCapabilities.OsKeystroke],
    },
    targetRequired: false,
    config: [{ key: "keys", label: "Keys", kind: "text", required: true }],
    inputs: ["input"],
    outputs: ["success"],
  },
  {
    type: Actions.ElementFocus,
    version: 1,
    category: "Element",
    label: "Focus Element",
    icon: "🎯",
    description: "Focus a page element.",
    targetRequired: true,
    config: [],
    inputs: ["input"],
    outputs: ["success"],
  },
  {
    type: Actions.ElementSelect,
    version: 1,
    category: "Element",
    label: "Select Dropdown",
    icon: "📋",
    description: "Select an option in native or ARIA dropdowns.",
    targetRequired: true,
    config: [{ key: "value", label: "Option", kind: "text", required: true }],
    inputs: ["input"],
    outputs: ["success"],
  },
  {
    type: Actions.ElementToggle,
    version: 1,
    category: "Element",
    label: "Toggle Check/Radio",
    icon: "☑️",
    description: "Toggle a checkbox, radio, or ARIA switch.",
    targetRequired: true,
    config: [{ key: "value", label: "State", kind: "boolean" }],
    inputs: ["input"],
    outputs: ["success"],
  },
  {
    type: Actions.LogicWait,
    version: 1,
    category: "Logic",
    label: "Wait / Pause",
    icon: "⏳",
    description: "Pause execution for a fixed duration.",
    targetRequired: false,
    config: [
      {
        key: "mode",
        label: "Wait Mode",
        kind: "select",
        default: "fixed",
        options: ["fixed", "random"],
      },
      { key: "ms", label: "Milliseconds", kind: "number", default: 1000 },
      { key: "minMs", label: "Minimum ms", kind: "number", default: 500 },
      { key: "maxMs", label: "Maximum ms", kind: "number", default: 1500 },
    ],
    inputs: ["input"],
    outputs: ["success"],
  },
  {
    type: Actions.DataExtractText,
    version: 1,
    category: "Data",
    label: "Extract Text",
    icon: "📝",
    description: "Extract visible text from an element into a variable.",
    targetRequired: true,
    config: [outputVariableField()],
    inputs: ["input"],
    outputs: ["success", "value"],
  },
  ...createElementWaitDefinitions(),
  {
    type: Actions.WaitUrl,
    version: 1,
    category: "Wait",
    label: "Wait for URL",
    icon: "🔗",
    description: "Wait until the current URL satisfies a match rule.",
    targetRequired: false,
    config: [
      { key: "expected", label: "Expected URL", kind: "text", required: true },
      {
        key: "matchMode",
        label: "Match Mode",
        kind: "select",
        default: "contains",
        options: ["contains", "exact", "regex"],
      },
      ...waitTimingFields(),
    ],
    inputs: ["input"],
    outputs: ["success"],
  },
  {
    type: Actions.DataExtractAttribute,
    version: 1,
    category: "Data",
    label: "Extract Attribute",
    icon: "🏷️",
    description: "Extract an element attribute into a variable.",
    targetRequired: true,
    config: [
      outputVariableField(),
      {
        key: "attributeName",
        label: "Attribute Name",
        kind: "text",
        required: true,
        default: "href",
        help: "Examples: href, src, title, aria-label, or data-*.",
      },
    ],
    inputs: ["input"],
    outputs: ["success", "value"],
  },
  {
    type: Actions.DataExtractList,
    version: 1,
    category: "Data",
    label: "Extract List",
    icon: "📚",
    description: "Extract text or attributes from repeated descendants.",
    targetRequired: true,
    config: [
      outputVariableField(),
      {
        key: "itemSelector",
        label: "Item CSS Selector",
        kind: "text",
        required: true,
        default: "li",
        help: "Matched inside the Target Element, not across the whole page.",
      },
      {
        key: "valueMode",
        label: "Value Mode",
        kind: "select",
        default: "text",
        options: ["text", "attribute"],
      },
      {
        key: "attributeName",
        label: "Attribute Name",
        kind: "text",
        default: "href",
        help: "Used only when Value Mode is attribute.",
        visibleWhen: { field: "valueMode", equals: "attribute" },
      },
    ],
    inputs: ["input"],
    outputs: ["success", "items"],
  },
  {
    type: Actions.DataExtractTable,
    version: 1,
    category: "Data",
    label: "Extract Table",
    icon: "▦",
    description: "Extract table headers and rows as structured data.",
    targetRequired: true,
    config: [
      outputVariableField(),
      {
        key: "rowSelector",
        label: "Row CSS Selector",
        kind: "text",
        default: "tr",
        help: "Matched inside the Target Element.",
      },
      {
        key: "cellSelector",
        label: "Cell CSS Selector",
        kind: "text",
        default: "th, td",
        help: "Matched inside each extracted row.",
      },
    ],
    inputs: ["input"],
    outputs: ["success", "table"],
  },
  {
    type: Actions.DataExtractPage,
    version: 1,
    category: "Data",
    label: "Extract Page Metadata",
    icon: "🌍",
    description: "Extract page URL, title, or complete page metadata.",
    targetRequired: false,
    config: [
      outputVariableField(),
      {
        key: "field",
        label: "Page Field",
        kind: "select",
        default: "all",
        options: ["all", "title", "url", "origin", "hostname", "path", "search"],
      },
    ],
    inputs: ["input"],
    outputs: ["success", "value"],
  },
  {
    type: Actions.DataSet,
    version: 1,
    category: "Data",
    label: "Set Variable",
    icon: "📌",
    description: "Store a literal or expression result in a variable.",
    targetRequired: false,
    config: [
      outputVariableField(),
      { key: "value", label: "Value", kind: "value", required: true },
    ],
    inputs: ["input"],
    outputs: ["success", "value"],
  },
  {
    type: Actions.DataTemplate,
    version: 1,
    category: "Data",
    label: "Template Text",
    icon: "🧩",
    description: "Render expression-enabled text into a variable.",
    targetRequired: false,
    config: [
      outputVariableField(),
      { key: "template", label: "Template", kind: "text", required: true },
    ],
    inputs: ["input"],
    outputs: ["success", "value"],
  },
  {
    type: Actions.HttpRequest,
    version: 1,
    category: "Network",
    label: "HTTP Request",
    icon: "HTTP",
    description: "Send a cancellable HTTP request without implicit browser cookies.",
    targetRequired: false,
    config: [
      {
        key: "method",
        label: "Method",
        kind: "select",
        default: "GET",
        options: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
      },
      { key: "url", label: "URL", kind: "text", required: true },
      {
        key: "headers",
        label: "Headers (JSON; kept out of logs)",
        kind: "textarea",
        default: "{}",
      },
      {
        key: "body",
        label: "Body (text, JSON, or expression; kept out of logs)",
        kind: "textarea",
        default: "",
      },
      {
        key: "bodyType",
        label: "Body Type",
        kind: "select",
        default: "auto",
        options: ["auto", "json", "text"],
      },
      {
        key: "responseType",
        label: "Response Type",
        kind: "select",
        default: "auto",
        options: ["auto", "json", "text"],
      },
      {
        key: "timeoutMs",
        label: "Timeout ms",
        kind: "number",
        default: 30000,
      },
      {
        key: "httpErrorPolicy",
        label: "Non-2xx Response",
        kind: "select",
        default: "fail",
        options: ["fail", "continue"],
      },
      outputVariableField(),
    ],
    inputs: ["input"],
    outputs: ["success", "response"],
  },
  {
    type: Actions.ClipboardRead,
    version: 1,
    category: "Clipboard",
    label: "Read Clipboard Text",
    icon: "CB",
    description: "Read clipboard text after explicit node-level approval.",
    targetRequired: false,
    config: [
      {
        key: "allowClipboardRead",
        label: "Allow Clipboard Read",
        kind: "select",
        default: "deny",
        options: ["deny", "allow"],
      },
      outputVariableField(),
    ],
    inputs: ["input"],
    outputs: ["success", "text"],
  },
  {
    type: Actions.ClipboardWrite,
    version: 1,
    category: "Clipboard",
    label: "Write Clipboard Text",
    icon: "CB",
    description: "Write expression-enabled text to the system clipboard.",
    targetRequired: false,
    config: [
      {
        key: "value",
        label: "Clipboard Text (kept out of logs)",
        kind: "textarea",
        required: true,
      },
      {
        key: "variableName",
        label: "Optional Result Variable",
        kind: "text",
        default: "",
      },
    ],
    inputs: ["input"],
    outputs: ["success"],
  },
  {
    type: Actions.FileInputUpload,
    version: 1,
    category: "File",
    label: "Upload Virtual File",
    icon: "FILE",
    description: "Create a text/base64 file and assign it to a web file input.",
    targetRequired: true,
    config: [
      {
        key: "sourceType",
        label: "Content Encoding",
        kind: "select",
        default: "text",
        options: ["text", "base64"],
      },
      {
        key: "filename",
        label: "Filename",
        kind: "text",
        required: true,
      },
      {
        key: "mimeType",
        label: "MIME Type",
        kind: "text",
        default: "text/plain",
      },
      {
        key: "content",
        label: "File Content (kept out of logs)",
        kind: "textarea",
        required: true,
      },
      outputVariableField(),
    ],
    inputs: ["input"],
    outputs: ["success", "file"],
  },
  {
    type: Actions.FileLocalUpload,
    version: 1,
    category: "File",
    label: "Upload Allowed Local File",
    icon: "LOCAL",
    description: "Read an allowlisted file through the native host and assign it to a web file input.",
    nativeHost: {
      mode: NativeHostRequirementModes.Required,
      capabilities: [NativeHostCapabilities.LocalFileRead],
    },
    targetRequired: true,
    config: [
      {
        key: "allowLocalFileRead",
        label: "Allow Native File Read",
        kind: "select",
        default: "deny",
        options: ["deny", "allow"],
      },
      {
        key: "path",
        label: "Allowed File Path (kept out of logs)",
        kind: "text",
        required: true,
      },
      outputVariableField(),
    ],
    inputs: ["input"],
    outputs: ["success", "file"],
  },
  {
    type: Actions.ApprovedFilesFind,
    version: 1,
    category: "File",
    label: "Find Approved Files",
    icon: "FIND",
    description: "List safe metadata for files under an approved folder alias.",
    nativeHost: {
      mode: NativeHostRequirementModes.Required,
      capabilities: [NativeHostCapabilities.ApprovedFileFind],
    },
    targetRequired: false,
    config: [
      {
        key: "directoryAlias",
        label: "Approved Folder Alias",
        kind: "text",
        required: true,
      },
      {
        key: "pattern",
        label: "Filename Pattern",
        kind: "text",
        default: "*",
      },
      {
        key: "extensions",
        label: "Extensions",
        kind: "text",
        default: "",
      },
      {
        key: "maxResults",
        label: "Max Results",
        kind: "number",
        default: 50,
      },
      outputVariableField(),
    ],
    inputs: ["input"],
    outputs: ["success", "files"],
  },
  {
    type: Actions.ApprovedFileWrite,
    version: 1,
    category: "File",
    label: "Write Approved File",
    icon: "WRITE",
    description: "Write text or base64 content under an approved folder alias.",
    nativeHost: {
      mode: NativeHostRequirementModes.Required,
      capabilities: [NativeHostCapabilities.ApprovedFileWrite],
    },
    targetRequired: false,
    config: [
      {
        key: "directoryAlias",
        label: "Approved Folder Alias",
        kind: "text",
        required: true,
      },
      {
        key: "relativePath",
        label: "Relative Output Path",
        kind: "text",
        required: true,
      },
      {
        key: "content",
        label: "Content (kept out of logs)",
        kind: "textarea",
        required: true,
      },
      {
        key: "encoding",
        label: "Encoding",
        kind: "select",
        default: "utf-8",
        options: ["utf-8", "utf-8-sig"],
      },
      outputVariableField(),
    ],
    inputs: ["input"],
    outputs: ["success", "file"],
  },
  {
    type: Actions.DataFileExport,
    version: 1,
    category: "File",
    label: "Export Data File",
    icon: "EXPORT",
    description: "Export workflow data as JSON, CSV, or TXT under an approved folder alias.",
    nativeHost: {
      mode: NativeHostRequirementModes.Required,
      capabilities: [NativeHostCapabilities.DataFileExport],
    },
    targetRequired: false,
    config: [
      {
        key: "directoryAlias",
        label: "Approved Folder Alias",
        kind: "text",
        required: true,
      },
      {
        key: "relativePath",
        label: "Relative Output Path",
        kind: "text",
        required: true,
      },
      {
        key: "format",
        label: "Format",
        kind: "select",
        default: "json",
        options: ["json", "csv", "txt"],
      },
      {
        key: "data",
        label: "Data (kept out of logs)",
        kind: "textarea",
        required: true,
      },
      outputVariableField(),
    ],
    inputs: ["input"],
    outputs: ["success", "file"],
  },
  {
    type: Actions.DownloadWait,
    version: 1,
    category: "File",
    label: "Wait for Download",
    icon: "DOWN",
    description: "Wait for a recent browser download and store safe metadata.",
    targetRequired: false,
    config: [
      {
        key: "filenameContains",
        label: "Filename Contains (optional)",
        kind: "text",
        default: "",
      },
      {
        key: "urlContains",
        label: "Source URL Contains (optional; kept out of logs)",
        kind: "text",
        default: "",
      },
      {
        key: "timeoutMs",
        label: "Timeout ms",
        kind: "number",
        default: 30000,
      },
      {
        key: "startedWithinMs",
        label: "Include Downloads Started Within ms",
        kind: "number",
        default: 15000,
      },
      {
        key: "dangerPolicy",
        label: "Dangerous Download",
        kind: "select",
        default: "fail",
        options: ["fail", "allow"],
      },
      outputVariableField(),
    ],
    inputs: ["input"],
    outputs: ["success", "download"],
  },
  {
    type: Actions.ScreenshotCapture,
    version: 1,
    category: "File",
    label: "Capture Screenshot",
    icon: "SHOT",
    description: "Capture the visible workflow tab to memory or Downloads.",
    targetRequired: false,
    config: [
      {
        key: "format",
        label: "Image Format",
        kind: "select",
        default: "png",
        options: ["png", "jpeg"],
      },
      {
        key: "quality",
        label: "JPEG Quality (0-100)",
        kind: "number",
        default: 90,
      },
      {
        key: "outputMode",
        label: "Output",
        kind: "select",
        default: "data",
        options: ["data", "download"],
      },
      {
        key: "filename",
        label: "Download Filename",
        kind: "text",
        default: "brunner-screenshot.png",
      },
      outputVariableField(),
    ],
    inputs: ["input"],
    outputs: ["success", "image"],
  },
  ...createTransformDefinitions(),
];

function outputVariableField() {
  return {
    key: "variableName",
    label: "Output Variable",
    kind: "text",
    required: true,
  };
}

function createElementWaitDefinitions() {
  return [
    [Actions.WaitElementVisible, "Wait for Visible", "Wait until the target becomes visible."],
    [Actions.WaitElementHidden, "Wait for Hidden", "Wait until the target disappears or becomes hidden."],
    [Actions.WaitElementEnabled, "Wait for Enabled", "Wait until the target becomes enabled."],
    [Actions.WaitElementText, "Wait for Text", "Wait until the target contains expected text."],
  ].map(([type, label, description]) => ({
    type,
    version: 1,
    category: "Wait",
    label,
    icon: "⏱️",
    description,
    targetRequired: true,
    config: [
      ...(type === Actions.WaitElementText
        ? [{ key: "expectedText", label: "Expected Text", kind: "text", required: true }]
        : []),
      ...waitTimingFields(),
    ],
    inputs: ["input"],
    outputs: ["success"],
  }));
}

function waitTimingFields() {
  return [
    { key: "timeoutMs", label: "Timeout ms", kind: "number", default: 10000 },
    { key: "pollingMs", label: "Polling ms", kind: "number", default: 250 },
  ];
}

function createTransformDefinitions() {
  const base = {
    version: 1,
    category: "Transform",
    icon: "🔧",
    targetRequired: false,
    inputs: ["input"],
    outputs: ["success", "value"],
  };

  return [
    {
      ...base,
      type: Actions.DataJsonParse,
      label: "Parse JSON",
      description: "Parse JSON text into an object or list.",
      config: [outputVariableField(), inputValueField("JSON Input")],
    },
    {
      ...base,
      type: Actions.DataJsonStringify,
      label: "Stringify JSON",
      description: "Convert a value into JSON text.",
      config: [
        outputVariableField(),
        inputValueField("Input Value"),
        {
          key: "pretty",
          label: "Pretty Print",
          kind: "select",
          default: "false",
          options: ["false", "true"],
        },
      ],
    },
    {
      ...base,
      type: Actions.DataRegexMatch,
      label: "Regex Match",
      description: "Return regular-expression matches from text.",
      config: [
        outputVariableField(),
        inputValueField("Input Text"),
        { key: "pattern", label: "Pattern", kind: "text", required: true },
        { key: "flags", label: "Flags", kind: "text", default: "" },
      ],
    },
    {
      ...base,
      type: Actions.DataRegexReplace,
      label: "Regex Replace",
      description: "Replace matching text using a regular expression.",
      config: [
        outputVariableField(),
        inputValueField("Input Text"),
        { key: "pattern", label: "Pattern", kind: "text", required: true },
        { key: "replacement", label: "Replacement", kind: "text", default: "" },
        { key: "flags", label: "Flags", kind: "text", default: "g" },
      ],
    },
    {
      ...base,
      type: Actions.DataToNumber,
      label: "Convert to Number",
      description: "Convert a value to a finite number.",
      config: [outputVariableField(), inputValueField("Input Value")],
    },
    {
      ...base,
      type: Actions.DataFormatDate,
      label: "Format Date",
      description: "Convert a date into ISO, locale, or timestamp form.",
      config: [
        outputVariableField(),
        inputValueField("Date Input"),
        {
          key: "format",
          label: "Output Format",
          kind: "select",
          default: "iso",
          options: ["iso", "locale", "timestamp"],
        },
      ],
    },
  ];
}

function inputValueField(label) {
  return {
    key: "input",
    label,
    kind: "text",
    required: true,
  };
}

function historyUnavailableField() {
  return {
    key: "ifUnavailable",
    label: "If History Is Unavailable",
    kind: "select",
    default: "continue",
    options: ["continue", "fail"],
  };
}

function visibleHostFallbackField() {
  return {
    key: "allowVisibleHostFallback",
    label: "Allow Visible Host Fallback",
    kind: "boolean",
    default: false,
  };
}

function visibleHostVisualMatchField() {
  return {
    key: "allowVisualMatchFallback",
    label: "Allow Visual Match Fallback",
    kind: "boolean",
    default: false,
  };
}

function visibleHostVerificationSelectorField() {
  return {
    key: "verificationSelector",
    label: "Verification Selector",
    kind: "text",
    default: "",
  };
}

function visibleHostVerificationTextField() {
  return {
    key: "verificationText",
    label: "Verification Text",
    kind: "text",
    default: "",
  };
}

export const NodeContractResolutionCodes = Object.freeze({
  MissingType: "NODE_TYPE_REQUIRED",
  MissingVersion: "NODE_VERSION_REQUIRED",
  UnsupportedType: "NODE_TYPE_UNSUPPORTED",
  UnsupportedVersion: "NODE_VERSION_UNSUPPORTED",
  MigrationUnavailable: "NODE_MIGRATION_UNAVAILABLE",
});

export class NodeContractResolutionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "NodeContractResolutionError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

const normalizedDefinitions = definitions.map((definition) => (
  deepFreeze(normalizeNodeDefinition(definition))
));
const definitionsByContract = new Map();
const definitionVersionsByType = new Map();

for (const definition of normalizedDefinitions) {
  const key = nodeDefinitionKey(definition.type, definition.version);
  if (definitionsByContract.has(key)) {
    throw new Error(`Duplicate node definition contract: ${key}`);
  }
  definitionsByContract.set(key, definition);
  const versions = definitionVersionsByType.get(definition.type) || [];
  versions.push(definition);
  versions.sort((left, right) => left.version - right.version);
  definitionVersionsByType.set(definition.type, versions);
}

const latestDefinitions = [...definitionVersionsByType.values()]
  .map((versions) => versions.at(-1));

// Migrations are intentionally explicit. Add reviewed adjacent-version
// migrations here; an absent migration always fails closed.
const nodeContractMigrations = new Map();

export function nodeDefinitionKey(type, version) {
  return `${String(type || "").trim()}@${String(version ?? "").trim()}`;
}

export function getNodeDefinition(type, version) {
  const normalizedVersion = normalizeContractVersion(version);
  if (!String(type || "").trim() || normalizedVersion === null) return null;
  return definitionsByContract.get(
    nodeDefinitionKey(type, normalizedVersion),
  ) || null;
}

export function getLatestNodeDefinition(type) {
  return definitionVersionsByType.get(String(type || "").trim())?.at(-1) || null;
}

export function getNodeDefinitionVersions(type) {
  return (definitionVersionsByType.get(String(type || "").trim()) || [])
    .map((definition) => definition.version);
}

export function getNodeDefinitions(options = {}) {
  const source = options.includeAllVersions
    ? normalizedDefinitions
    : latestDefinitions;
  return source.map((definition) => structuredClone(definition));
}

export function isSupportedNodeType(type, version = undefined) {
  if (version === undefined) {
    return definitionVersionsByType.has(String(type || "").trim());
  }
  return Boolean(getNodeDefinition(type, version));
}

export function resolveNodeDefinition(node = {}) {
  const type = String(node.type || node.action || "").trim();
  if (!type) {
    throw new NodeContractResolutionError(
      NodeContractResolutionCodes.MissingType,
      "Node contract requires a type.",
    );
  }
  const version = normalizeContractVersion(node.version);
  if (version === null) {
    throw new NodeContractResolutionError(
      NodeContractResolutionCodes.MissingVersion,
      `Node contract ${type} requires an explicit positive integer version.`,
      { type, version: node.version ?? null },
    );
  }
  const definition = getNodeDefinition(type, version);
  if (definition) return definition;
  const supportedVersions = getNodeDefinitionVersions(type);
  if (!supportedVersions.length) {
    throw new NodeContractResolutionError(
      NodeContractResolutionCodes.UnsupportedType,
      `Unsupported node type: ${type}.`,
      { type, version },
    );
  }
  throw new NodeContractResolutionError(
    NodeContractResolutionCodes.UnsupportedVersion,
    `Unsupported ${type} node version ${version}.`,
    { type, version, supportedVersions },
  );
}

export function migrateNodeContract(node = {}, options = {}) {
  const source = structuredClone(node);
  const type = String(source.type || source.action || "").trim();
  const currentVersion = normalizeContractVersion(source.version);
  if (!type || currentVersion === null) {
    resolveNodeDefinition(source);
  }
  const versions = getNodeDefinitionVersions(type);
  if (!versions.length) resolveNodeDefinition(source);
  const targetVersion = normalizeContractVersion(
    options.targetVersion ?? versions.at(-1),
  );
  if (targetVersion === null || !versions.includes(targetVersion)) {
    throw new NodeContractResolutionError(
      NodeContractResolutionCodes.UnsupportedVersion,
      `Unsupported migration target ${type} version ${String(options.targetVersion)}.`,
      { type, version: options.targetVersion, supportedVersions: versions },
    );
  }
  if (currentVersion === targetVersion) {
    resolveNodeDefinition(source);
    return source;
  }
  if (currentVersion > targetVersion) {
    throw new NodeContractResolutionError(
      NodeContractResolutionCodes.MigrationUnavailable,
      `Node contract downgrade is not supported for ${type}.`,
      { type, fromVersion: currentVersion, toVersion: targetVersion },
    );
  }

  let migrated = source;
  for (let version = currentVersion; version < targetVersion; version += 1) {
    const migrationKey = `${nodeDefinitionKey(type, version)}->${version + 1}`;
    const migration = nodeContractMigrations.get(migrationKey);
    if (typeof migration !== "function") {
      throw new NodeContractResolutionError(
        NodeContractResolutionCodes.MigrationUnavailable,
        `No reviewed migration exists for ${type} version ${version} to ${version + 1}.`,
        { type, fromVersion: version, toVersion: version + 1 },
      );
    }
    migrated = migration(structuredClone(migrated));
    migrated.version = version + 1;
  }
  resolveNodeDefinition(migrated);
  return migrated;
}

function normalizeNodeDefinition(definition) {
  const version = normalizeContractVersion(definition.version);
  if (!String(definition.type || "").trim() || version === null) {
    throw new Error("Every node definition requires a type and positive integer version.");
  }
  const config = normalizeNodeFieldSchema(
    definition.config || definition.configSchema || [],
  );
  const inputPorts = normalizePorts(
    definition.inputPorts,
    definition.inputs,
    "input",
  );
  const outputPorts = normalizePorts(
    definition.outputPorts,
    definition.outputs,
    "output",
  );
  const normalized = {
    nativeHost: DEFAULT_NATIVE_HOST_REQUIREMENT,
    ...definition,
    version,
    config,
    configSchema: structuredClone(config),
    inputPorts,
    outputPorts,
    targetSchema: definition.targetRequired
      ? structuredClone(definition.targetSchema || createTargetEditorSchema(true))
      : null,
    inputs: inputPorts.map((port) => port.id),
    outputs: outputPorts.map((port) => port.id),
    nativeHost: normalizeNativeHostRequirement(definition.nativeHost),
  };
  normalized.guidance = normalizeNodeGuidance(normalized);
  return normalized;
}

function normalizePorts(portDefinitions, legacyIds, direction) {
  const source = Array.isArray(portDefinitions) && portDefinitions.length
    ? portDefinitions
    : Array.isArray(legacyIds) && legacyIds.length
      ? legacyIds
      : direction === "input"
        ? ["input"]
        : ["success"];
  const seen = new Set();
  return source.map((port) => {
    const value = typeof port === "string" ? { id: port } : port || {};
    const id = String(value.id || "").trim();
    if (!/^[a-z][a-z0-9_]*$/.test(id) || seen.has(id)) {
      throw new Error(`Invalid or duplicate ${direction} port id: ${id || "<empty>"}.`);
    }
    seen.add(id);
    return {
      id,
      label: String(value.label || formatPortLabel(id)),
      kind: String(value.kind || inferPortKind(id, direction)),
      required: value.required === true,
    };
  });
}

function inferPortKind(id, direction) {
  if (direction === "input") return id === "input" ? "flow" : "data";
  if (id === "error") return "error";
  if (id === "unresolved") return "resolution";
  return id === "success" ? "flow" : "data";
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function formatPortLabel(id) {
  return id.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeContractVersion(value) {
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : null;
}

function normalizeNodeGuidance(definition = {}) {
  const label = definition.label || definition.type || "node";
  const category = definition.category || "Node";
  const requiredFields = (definition.config || [])
    .filter((field) => field.required)
    .map((field) => field.label || field.key);
  const requiredText = requiredFields.length
    ? `Configure ${formatList(requiredFields)}.`
    : "No required configuration fields.";
  const targetText = definition.targetRequired
    ? "Select or record the target element before running."
    : "Runs without a target element.";

  return {
    description: definition.description || `Run ${label}.`,
    whenToUse: definition.whenToUse ||
      `Use ${label} when a workflow needs this ${category.toLowerCase()} behavior.`,
    example: definition.example || createUsageExample(definition),
    inputs: Array.isArray(definition.inputs) ? definition.inputs : ["input"],
    outputs: Array.isArray(definition.outputs) ? definition.outputs : ["success"],
    configuration: `${targetText} ${requiredText}`,
    safety: definition.safety || createSafetyNote(definition),
  };
}

function createUsageExample(definition = {}) {
  const label = definition.label || definition.type || "this node";
  const type = definition.type || "";

  const examples = {
    [Actions.BrowserNavigate]: "Open https://example.com in the current tab, then continue to the next node.",
    [Actions.ElementClick]: "Click a recorded Submit button after required form fields are filled.",
    [Actions.ElementType]: "Type {{email}} into a recorded email input.",
    [Actions.ElementSelect]: "Choose the visible option text \"United States\" from a recorded dropdown.",
    [Actions.LogicWait]: "Pause for 1000 ms before checking that a result appears.",
    [Actions.DataSet]: "Set `status` to `ready` for later expressions like {{status}}.",
    [Actions.HttpRequest]: "Fetch JSON from an API and save the parsed response into `api_response`.",
    [Actions.FileLocalUpload]: "Read an approved local file through the native host and upload it to a file input.",
    [Actions.KeyboardSendKeys]: "Send Ctrl+L through the native host when page-level automation is not enough.",
  };

  return examples[type] ||
    `Add ${label}, configure its required fields, and connect its success output to the next node.`;
}

function createSafetyNote(definition = {}) {
  const category = definition.category || "";
  const nativeMode = normalizeNativeHostRequirement(definition.nativeHost).mode;

  if (nativeMode === NativeHostRequirementModes.Required) {
    return "Requires the native host when reached; fails clearly if the host or capability is unavailable.";
  }
  if (category === "Clipboard") {
    return "Clipboard contents can be sensitive; reads require explicit node approval and logs avoid raw contents.";
  }
  if (category === "Network") {
    return "Headers and bodies are kept out of logs; non-2xx and timeout behavior is controlled by node options.";
  }
  if (category === "File") {
    return "File payloads, local paths, and large binary content are bounded and kept out of execution logs.";
  }
  if (definition.targetRequired) {
    return "Target resolution uses semantic candidates first and reports diagnostics if the target cannot be found.";
  }
  return "Safe to run without native host access; failures report bounded diagnostics.";
}

function formatList(values = []) {
  if (values.length <= 1) return values[0] || "";
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}
