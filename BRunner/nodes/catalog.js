import { Actions } from "../core/constants.js";

export const NodeImplementationDispositions = Object.freeze({
  Upgrade: "upgrade",
  Rewrite: "rewrite",
  Add: "add",
});

export const NodeImplementationStatuses = Object.freeze({
  Queued: "queued",
});

function finalizedNode(order, name, type, phase, disposition, provisionalTypes = []) {
  return Object.freeze({
    order,
    name,
    type,
    phase,
    disposition,
    provisionalTypes: Object.freeze([...provisionalTypes]),
    status: NodeImplementationStatuses.Queued,
  });
}

const { Upgrade, Rewrite, Add } = NodeImplementationDispositions;

/**
 * Machine-readable inventory of the finalized 94-node blueprint.
 *
 * This is the node-phase implementation catalog, not the current runtime
 * registry. Runtime definitions and executors remain provisional until each
 * queued row completes the blueprint definition of done.
 */
export const FinalizedNodeCatalog = Object.freeze([
  finalizedNode(1, "Navigate", "browser.navigate", 1, Rewrite, [
    Actions.BrowserNavigate,
    Actions.BrowserBack,
    Actions.BrowserForward,
    Actions.BrowserReload,
  ]),
  finalizedNode(2, "Scroll", "browser.scroll", 1, Rewrite, [
    Actions.BrowserScroll,
    Actions.ElementScrollIntoView,
  ]),
  finalizedNode(3, "Tab Control", "browser.tab.control", 1, Rewrite, [
    Actions.BrowserTabSwitch,
    Actions.BrowserTabOpen,
    Actions.BrowserTabClose,
  ]),
  finalizedNode(4, "Resolve Element", "element.resolve", 1, Add),
  finalizedNode(5, "Check Element State", "element.check_state", 1, Add),
  finalizedNode(6, "Wait for Condition", "wait.condition", 1, Rewrite, [
    Actions.WaitElementVisible,
    Actions.WaitElementHidden,
    Actions.WaitElementEnabled,
    Actions.WaitElementText,
    Actions.WaitUrl,
  ]),

  finalizedNode(7, "Click", "element.click", 2, Rewrite, [
    Actions.ElementClick,
    Actions.ElementDoubleClick,
  ]),
  finalizedNode(8, "Hover / Move Pointer", "element.hover", 2, Rewrite, [
    Actions.ElementHover,
  ]),
  finalizedNode(9, "Focus Element", "element.focus", 2, Upgrade, [
    Actions.ElementFocus,
  ]),
  finalizedNode(10, "Select Text", "element.select_text", 2, Add),
  finalizedNode(11, "Drag and Drop", "element.drag_drop", 2, Add),
  finalizedNode(12, "Enter Text", "element.enter_text", 2, Rewrite, [
    Actions.ElementType,
    Actions.ElementClear,
  ]),
  finalizedNode(13, "Press Key", "keyboard.press_key", 2, Rewrite, [
    Actions.KeyboardSendKeys,
  ]),
  finalizedNode(14, "Copy to Clipboard", "clipboard.copy", 2, Rewrite, [
    Actions.ClipboardWrite,
  ]),
  finalizedNode(15, "Paste from Clipboard", "clipboard.paste", 2, Rewrite, [
    Actions.ClipboardRead,
  ]),

  finalizedNode(16, "Select Dropdown Option", "form.select_option", 3, Upgrade, [
    Actions.ElementSelect,
  ]),
  finalizedNode(17, "Set Checkbox / Toggle", "form.set_toggle", 3, Rewrite, [
    Actions.ElementToggle,
  ]),
  finalizedNode(18, "Select Radio Option", "form.select_radio", 3, Rewrite, [
    Actions.ElementToggle,
  ]),
  finalizedNode(19, "Set Date / Time", "form.set_date_time", 3, Add),
  finalizedNode(20, "Set Slider Value", "form.set_slider", 3, Add),
  finalizedNode(
    21,
    "Choose Autocomplete Suggestion",
    "form.choose_autocomplete",
    3,
    Add,
  ),
  finalizedNode(22, "Upload File", "form.upload_file", 3, Rewrite, [
    Actions.FileInputUpload,
    Actions.FileLocalUpload,
  ]),
  finalizedNode(23, "Submit Form", "form.submit", 3, Add),
  finalizedNode(24, "Reset Form", "form.reset", 3, Add),
  finalizedNode(25, "Fill Form from Data", "form.fill_from_data", 3, Add),
  finalizedNode(26, "Open UI / Expand Section", "page.open_ui", 3, Add),
  finalizedNode(27, "Close Overlay / Dismiss UI", "page.dismiss_ui", 3, Add),
  finalizedNode(28, "Handle Browser Dialog", "browser.dialog.handle", 3, Add),
  finalizedNode(29, "Handle Download", "download.handle", 3, Rewrite, [
    Actions.DownloadWait,
  ]),
  finalizedNode(30, "Screen Capture", "capture.screen", 3, Rewrite, [
    Actions.ScreenshotCapture,
  ]),

  finalizedNode(31, "File Input", "file.input", 4, Add),
  finalizedNode(32, "Find Files", "file.find", 4, Upgrade, [
    Actions.ApprovedFilesFind,
  ]),
  finalizedNode(33, "Wait for File", "file.wait", 4, Add),
  finalizedNode(34, "Raw File Input", "file.read_raw", 4, Add),
  finalizedNode(35, "Text Input", "input.text", 4, Add),
  finalizedNode(
    36,
    "CSV / TSV / Delimited Data Input",
    "input.delimited",
    4,
    Add,
  ),
  finalizedNode(37, "JSON Input", "input.json", 4, Add),
  finalizedNode(38, "XML Input", "input.xml", 4, Add),
  finalizedNode(39, "YAML Input", "input.yaml", 4, Add),
  finalizedNode(40, "Spreadsheet Input", "input.spreadsheet", 4, Add),
  finalizedNode(41, "Document Input", "input.document", 4, Add),
  finalizedNode(42, "PDF Input", "input.pdf", 4, Add),
  finalizedNode(43, "Image Input", "input.image", 4, Add),

  finalizedNode(44, "Set Variable", "data.set_variable", 5, Upgrade, [
    Actions.DataSet,
  ]),
  finalizedNode(45, "Template Text", "data.template_text", 5, Upgrade, [
    Actions.DataTemplate,
  ]),
  finalizedNode(46, "Select Data", "data.select", 5, Add),
  finalizedNode(47, "Transform Data", "data.transform", 5, Rewrite, [
    Actions.DataRegexMatch,
    Actions.DataRegexReplace,
    Actions.DataFormatDate,
  ]),
  finalizedNode(48, "Convert Data Type", "data.convert_type", 5, Rewrite, [
    Actions.DataToNumber,
    Actions.DataJsonParse,
    Actions.DataJsonStringify,
  ]),
  finalizedNode(49, "Map Fields", "data.map_fields", 5, Add),
  finalizedNode(50, "Filter List", "data.filter_list", 5, Add),
  finalizedNode(51, "Sort List", "data.sort_list", 5, Add),
  finalizedNode(52, "Remove Duplicates", "data.remove_duplicates", 5, Add),
  finalizedNode(53, "Merge Data", "data.merge", 5, Add),
  finalizedNode(54, "Split Data", "data.split", 5, Add),
  finalizedNode(55, "Aggregate Data", "data.aggregate", 5, Add),
  finalizedNode(56, "Calculate Value", "data.calculate", 5, Add),
  finalizedNode(57, "Compare Values", "data.compare", 5, Add),
  finalizedNode(58, "Validate Data", "data.validate", 5, Add),
  finalizedNode(59, "Function Node", "code.function", 5, Add),
  finalizedNode(60, "Code Node", "code.execute", 5, Add),

  finalizedNode(61, "If / Else", "control.if_else", 6, Add),
  finalizedNode(62, "Switch", "control.switch", 6, Add),
  finalizedNode(63, "Loop Through List", "control.loop_list", 6, Add),
  finalizedNode(64, "Repeat Until", "control.repeat_until", 6, Add),
  finalizedNode(65, "Pagination Loop", "control.pagination", 6, Add),
  finalizedNode(66, "Break Loop", "control.break", 6, Add),
  finalizedNode(67, "Continue Loop", "control.continue", 6, Add),
  finalizedNode(68, "Delay", "control.delay", 6, Upgrade, [
    Actions.LogicWait,
  ]),
  finalizedNode(69, "Try / Catch Scope", "control.try_catch", 6, Add),
  finalizedNode(70, "Join Branches", "control.join", 6, Add),
  finalizedNode(71, "Manual Confirmation", "manual.confirmation", 6, Add),
  finalizedNode(72, "Manual Step Required", "manual.step_required", 6, Add),
  finalizedNode(73, "Stop Workflow", "control.stop", 6, Add),
  finalizedNode(74, "Extract Text", "extract.text", 6, Upgrade, [
    Actions.DataExtractText,
  ]),
  finalizedNode(75, "Extract Attribute", "extract.attribute", 6, Upgrade, [
    Actions.DataExtractAttribute,
  ]),
  finalizedNode(
    76,
    "Extract Element Value",
    "extract.element_value",
    6,
    Rewrite,
    [Actions.ElementExtract],
  ),
  finalizedNode(77, "Extract HTML", "extract.html", 6, Add),
  finalizedNode(
    78,
    "Extract List / Repeating Records",
    "extract.list",
    6,
    Rewrite,
    [Actions.DataExtractList],
  ),
  finalizedNode(79, "Extract Table", "extract.table", 6, Upgrade, [
    Actions.DataExtractTable,
  ]),
  finalizedNode(80, "Extract Links", "extract.links", 6, Add),
  finalizedNode(81, "Extract Images", "extract.images", 6, Add),
  finalizedNode(82, "Extract Form Data", "extract.form", 6, Add),
  finalizedNode(
    83,
    "Extract Page Information",
    "extract.page_info",
    6,
    Upgrade,
    [Actions.DataExtractPage],
  ),
  finalizedNode(
    84,
    "Extract Structured Page Data",
    "extract.structured_page",
    6,
    Add,
  ),
  finalizedNode(
    85,
    "Extract Visible Messages",
    "extract.visible_messages",
    6,
    Add,
  ),
  finalizedNode(86, "Get Element Count", "extract.element_count", 6, Add),
  finalizedNode(87, "Read Selected Text", "extract.selected_text", 6, Add),

  finalizedNode(88, "Save Data", "output.save_data", 7, Add),
  finalizedNode(89, "Export Data", "output.export_data", 7, Rewrite, [
    Actions.ApprovedFileWrite,
    Actions.DataFileExport,
  ]),
  finalizedNode(90, "Show Notification", "output.notification", 7, Add),
  finalizedNode(
    91,
    "Show Workflow Message",
    "output.workflow_message",
    7,
    Add,
  ),
  finalizedNode(92, "Generate Summary", "output.summary", 7, Add),
  finalizedNode(93, "Log Message", "output.log", 7, Add),
  finalizedNode(94, "Create Run Report", "output.run_report", 7, Add),
]);

/**
 * Provisional action types intentionally absent from the finalized blueprint.
 * Remove their registry, editor, executor, and compatibility paths when the
 * corresponding node-phase slice reaches runtime integration.
 */
export const RemovedProvisionalNodeTypes = Object.freeze([
  Actions.BrowserSearch,
  Actions.HttpRequest,
]);

export function getFinalizedNodeByType(type) {
  return FinalizedNodeCatalog.find((node) => node.type === type) || null;
}
