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

  // Workflow execution
  RunWorkflowByName: "RUN_WORKFLOW_BY_NAME",
  StartWorkflow: "START_WORKFLOW",
  WorkflowComplete: "WORKFLOW_COMPLETE",
  CheckBridgeStatus: "CHECK_BRIDGE_STATUS",
  BridgeStatus: "BRIDGE_STATUS",

  // Content script execution
  ExecuteStep: "EXECUTE_STEP",

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

  ElementClick: "element.click",
  ElementType: "element.type",
  ElementExtract: "element.extract",
  ElementFocus: "element.focus",
  ElementSelect: "element.select",
  ElementToggle: "element.toggle",

  KeyboardSendKeys: "keyboard.send_keys",

  LogicWait: "logic.wait",
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
  ListWorkflows: "LIST_WORKFLOWS",
  SaveWorkflow: "SAVE_WORKFLOW",
  LoadWorkflow: "LOAD_WORKFLOW",
  DeleteWorkflow: "DELETE_WORKFLOW",
  DuplicateWorkflow: "DUPLICATE_WORKFLOW",
  OsKeystroke: "OS_KEYSTROKE",
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
});
