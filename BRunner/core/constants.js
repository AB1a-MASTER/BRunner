// core/constants.js
// Centralized message/action constants for BRunner.
// Import these instead of scattering raw strings across background, studio, sidebar, and content scripts.

export const Messages = Object.freeze({
  // General
  SystemLog: "SYSTEM_LOG",
  StudioLoaded: "STUDIO_LOADED",

  // Sidebar / Studio UI sync
  RefreshWorkflowLists: "REFRESH_WORKFLOW_LISTS",
  CollapseSidebar: "COLLAPSE_SIDEBAR",
  ExpandSidebar: "EXPAND_SIDEBAR",

  // Native OS workflow operations
  OsSaveWorkflow: "OS_SAVE_WORKFLOW",
  OsListWorkflows: "OS_LIST_WORKFLOWS",
  OsLoadWorkflow: "OS_LOAD_WORKFLOW",
  OsDeleteWorkflow: "OS_DELETE_WORKFLOW",
  OsDuplicateWorkflow: "OS_DUPLICATE_WORKFLOW",
  OsRenameWorkflow: "OS_RENAME_WORKFLOW",
  OsUpgradeWorkflow: "OS_UPGRADE_WORKFLOW",
  OsSaveExecutionLog: "OS_SAVE_EXECUTION_LOG",
  OsReadDataSource: "OS_READ_DATA_SOURCE",
  OsListApprovedDirectories: "OS_LIST_APPROVED_DIRECTORIES",
  OsFindApprovedFiles: "OS_FIND_APPROVED_FILES",
  OsWriteApprovedFile: "OS_WRITE_APPROVED_FILE",
  OsExportDataFile: "OS_EXPORT_DATA_FILE",

  // Workflow execution
  RunWorkflowByName: "RUN_WORKFLOW_BY_NAME",
  StartWorkflow: "START_WORKFLOW",
  WorkflowComplete: "WORKFLOW_COMPLETE",
  StopWorkflow: "STOP_WORKFLOW",
  CheckBridgeStatus: "CHECK_BRIDGE_STATUS",
  BridgeStatus: "BRIDGE_STATUS",
  GetRuntimeState: "GET_RUNTIME_STATE",
  RuntimeStateChanged: "RUNTIME_STATE_CHANGED",
  ClearExecutionLogs: "CLEAR_EXECUTION_LOGS",
  GetNodeDefinitions: "GET_NODE_DEFINITIONS",

  // Content script execution
  ExecuteStep: "EXECUTE_STEP",
  PrepareHostFallback: "PREPARE_HOST_FALLBACK",
  VerifyHostFallback: "VERIFY_HOST_FALLBACK",
  CancelExecution: "CANCEL_EXECUTION",

  // Hardware / OS fallback
  RequestHardwareSimulation: "REQUEST_HARDWARE_SIMULATION",
  RequestHardwareKeystroke: "REQUEST_HARDWARE_KEYSTROKE",

  // Recorder
  ToggleRecording: "TOGGLE_RECORDING",
  GetRecordingState: "GET_RECORDING_STATE",
  SetRecordingState: "SET_RECORDING_STATE",
  RecordedStep: "RECORDED_STEP",
  StudioReceiveStep: "STUDIO_RECEIVE_STEP",
});

export const Actions = Object.freeze({
  BrowserNavigate: "browser.navigate",
  BrowserTabSwitch: "browser.tab.switch",
  BrowserBack: "browser.back",
  BrowserForward: "browser.forward",
  BrowserReload: "browser.reload",
  BrowserTabOpen: "browser.tab.open",
  BrowserTabClose: "browser.tab.close",
  BrowserSearch: "browser.search",

  ElementClick: "element.click",
  ElementType: "element.type",
  ElementExtract: "element.extract",
  ElementFocus: "element.focus",
  ElementSelect: "element.select",
  ElementToggle: "element.toggle",
  ElementDoubleClick: "element.double_click",
  ElementHover: "element.hover",
  ElementClear: "element.clear",
  ElementScrollIntoView: "element.scroll_into_view",
  BrowserScroll: "browser.scroll",

  DataExtractText: "data.extract.text",
  DataExtractAttribute: "data.extract.attribute",
  DataExtractList: "data.extract.list",
  DataExtractTable: "data.extract.table",
  DataExtractPage: "data.extract.page",
  DataSet: "data.set",
  DataTemplate: "data.template",
  DataJsonParse: "data.json.parse",
  DataJsonStringify: "data.json.stringify",
  DataRegexMatch: "data.regex.match",
  DataRegexReplace: "data.regex.replace",
  DataToNumber: "data.number.convert",
  DataFormatDate: "data.date.format",

  HttpRequest: "http.request",

  ClipboardRead: "clipboard.read",
  ClipboardWrite: "clipboard.write",

  FileInputUpload: "file.input.upload",
  FileLocalUpload: "file.local.upload",
  ApprovedFilesFind: "approved.files.find",
  ApprovedFileWrite: "approved.file.write",
  DataFileExport: "data.file.export",

  DownloadWait: "download.wait",

  ScreenshotCapture: "screenshot.capture",

  KeyboardSendKeys: "keyboard.send_keys",

  LogicWait: "logic.wait",
  WaitElementVisible: "wait.element.visible",
  WaitElementHidden: "wait.element.hidden",
  WaitElementEnabled: "wait.element.enabled",
  WaitElementText: "wait.element.text",
  WaitUrl: "wait.url",
});

export const TargetStrategies = Object.freeze({
  Id: "id",
  Name: "name",
  AriaLabel: "ariaLabel",
  DataTestId: "data-testid",
  DataTest: "data-test",
  DataQa: "data-qa",
  LabelText: "labelText",
  Text: "text",
  CssSelector: "css_selector",
  CtrlHash: "ctrlHash",
  FallbackHash: "fallback_hash",
});

export const NavigationTargets = Object.freeze({
  SameTab: "sameTab",
  NewTab: "newTab",
});

export const NativeCommands = Object.freeze({
  Auth: "AUTH",
  HostHello: "HOST_HELLO",
  HostWindow: "HOST_WINDOW",
  HostAction: "HOST_ACTION",
  HostVisualMatch: "HOST_VISUAL_MATCH",
  ListWorkflows: "LIST_WORKFLOWS",
  SaveWorkflow: "SAVE_WORKFLOW",
  LoadWorkflow: "LOAD_WORKFLOW",
  DeleteWorkflow: "DELETE_WORKFLOW",
  DuplicateWorkflow: "DUPLICATE_WORKFLOW",
  RenameWorkflow: "RENAME_WORKFLOW",
  UpgradeWorkflow: "UPGRADE_WORKFLOW",
  SaveExecutionLog: "SAVE_EXECUTION_LOG",
  OsKeystroke: "OS_KEYSTROKE",
  ReadFile: "READ_FILE",
  ReadDataSource: "READ_DATA_SOURCE",
  ListApprovedDirectories: "LIST_APPROVED_DIRECTORIES",
  FindApprovedFiles: "FIND_APPROVED_FILES",
  WriteApprovedFile: "WRITE_APPROVED_FILE",
  ExportDataFile: "EXPORT_DATA_FILE",
});

export const Defaults = Object.freeze({
  NativeHostUrl: "ws://127.0.0.1:8999",

  // Keep this in source only for local dev.
  // Later this should move into chrome.storage or a pairing flow.
  PairingKey: "ac1890957e38af28cd5d0961e6d0d530",

  WorkflowFileExtension: ".json",
  DefaultWorkflowName: "Untitled",
  StepDelayMs: 500,
  PageSettleDelayMs: 1000,
  TabSwitchWaitMs: 2000,
});
