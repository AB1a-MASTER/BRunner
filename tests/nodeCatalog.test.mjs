import test from "node:test";
import assert from "node:assert/strict";

import { Actions } from "../BRunner/core/constants.js";
import {
  FinalizedNodeCatalog,
  NodeImplementationDispositions,
  NodeImplementationStatuses,
  RemovedProvisionalNodeTypes,
  getFinalizedNodeByType,
} from "../BRunner/nodes/catalog.js";

test("finalized node catalog contains all 94 blueprint nodes in contiguous order", () => {
  const blueprintNames = [
    "Navigate",
    "Scroll",
    "Tab Control",
    "Resolve Element",
    "Check Element State",
    "Wait for Condition",
    "Click",
    "Hover / Move Pointer",
    "Focus Element",
    "Select Text",
    "Drag and Drop",
    "Enter Text",
    "Press Key",
    "Copy to Clipboard",
    "Paste from Clipboard",
    "Select Dropdown Option",
    "Set Checkbox / Toggle",
    "Select Radio Option",
    "Set Date / Time",
    "Set Slider Value",
    "Choose Autocomplete Suggestion",
    "Upload File",
    "Submit Form",
    "Reset Form",
    "Fill Form from Data",
    "Open UI / Expand Section",
    "Close Overlay / Dismiss UI",
    "Handle Browser Dialog",
    "Handle Download",
    "Screen Capture",
    "File Input",
    "Find Files",
    "Wait for File",
    "Raw File Input",
    "Text Input",
    "CSV / TSV / Delimited Data Input",
    "JSON Input",
    "XML Input",
    "YAML Input",
    "Spreadsheet Input",
    "Document Input",
    "PDF Input",
    "Image Input",
    "Set Variable",
    "Template Text",
    "Select Data",
    "Transform Data",
    "Convert Data Type",
    "Map Fields",
    "Filter List",
    "Sort List",
    "Remove Duplicates",
    "Merge Data",
    "Split Data",
    "Aggregate Data",
    "Calculate Value",
    "Compare Values",
    "Validate Data",
    "Function Node",
    "Code Node",
    "If / Else",
    "Switch",
    "Loop Through List",
    "Repeat Until",
    "Pagination Loop",
    "Break Loop",
    "Continue Loop",
    "Delay",
    "Try / Catch Scope",
    "Join Branches",
    "Manual Confirmation",
    "Manual Step Required",
    "Stop Workflow",
    "Extract Text",
    "Extract Attribute",
    "Extract Element Value",
    "Extract HTML",
    "Extract List / Repeating Records",
    "Extract Table",
    "Extract Links",
    "Extract Images",
    "Extract Form Data",
    "Extract Page Information",
    "Extract Structured Page Data",
    "Extract Visible Messages",
    "Get Element Count",
    "Read Selected Text",
    "Save Data",
    "Export Data",
    "Show Notification",
    "Show Workflow Message",
    "Generate Summary",
    "Log Message",
    "Create Run Report",
  ];

  assert.equal(FinalizedNodeCatalog.length, 94);
  assert.deepEqual(
    FinalizedNodeCatalog.map((node) => node.order),
    Array.from({ length: 94 }, (_, index) => index + 1),
  );
  assert.deepEqual(
    FinalizedNodeCatalog.map((node) => node.name),
    blueprintNames,
  );
});

test("finalized stable type IDs are unique and every inventory record is frozen", () => {
  const types = FinalizedNodeCatalog.map((node) => node.type);
  assert.equal(new Set(types).size, types.length);
  assert.ok(Object.isFrozen(FinalizedNodeCatalog));

  for (const node of FinalizedNodeCatalog) {
    assert.match(node.type, /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/);
    assert.ok(Object.isFrozen(node));
    assert.ok(Object.isFrozen(node.provisionalTypes));
    assert.equal(node.status, NodeImplementationStatuses.Queued);
    assert.equal(getFinalizedNodeByType(node.type), node);
  }

  assert.equal(getFinalizedNodeByType("not.a.finalized.node"), null);
});

test("phase assignments follow the blueprint implementation order", () => {
  const expectedPhaseRanges = [
    [1, 6, 1],
    [7, 15, 2],
    [16, 30, 3],
    [31, 43, 4],
    [44, 60, 5],
    [61, 87, 6],
    [88, 94, 7],
  ];

  for (const [start, end, phase] of expectedPhaseRanges) {
    assert.ok(
      FinalizedNodeCatalog.slice(start - 1, end).every(
        (node) => node.phase === phase,
      ),
      `catalog orders ${start}-${end} must be assigned to phase ${phase}`,
    );
  }

  for (let index = 1; index < FinalizedNodeCatalog.length; index += 1) {
    assert.ok(
      FinalizedNodeCatalog[index].phase >=
        FinalizedNodeCatalog[index - 1].phase,
      "phase order must never move backward",
    );
  }
});

test("phase 1 and Fill Form from Data use their finalized stable IDs", () => {
  assert.deepEqual(
    FinalizedNodeCatalog.slice(0, 6).map((node) => node.type),
    [
      "browser.navigate",
      "browser.scroll",
      "browser.tab.control",
      "element.resolve",
      "element.check_state",
      "wait.condition",
    ],
  );
  assert.equal(FinalizedNodeCatalog[24].type, "form.fill_from_data");
});

test("every finalized node has an allowed inventory disposition", () => {
  const allowed = new Set(Object.values(NodeImplementationDispositions));

  for (const node of FinalizedNodeCatalog) {
    assert.ok(
      allowed.has(node.disposition),
      `${node.type} has unsupported disposition ${node.disposition}`,
    );
    if (node.disposition === NodeImplementationDispositions.Add) {
      assert.deepEqual(node.provisionalTypes, []);
    } else {
      assert.ok(
        node.provisionalTypes.length > 0,
        `${node.type} must cite its provisional implementation reference`,
      );
    }
  }

  const counts = FinalizedNodeCatalog.reduce((result, node) => {
    result[node.disposition] = (result[node.disposition] || 0) + 1;
    return result;
  }, {});
  assert.deepEqual(counts, {
    rewrite: 20,
    add: 64,
    upgrade: 10,
  });
});

test("every provisional Actions value is mapped or explicitly removed", () => {
  const mappedTypes = FinalizedNodeCatalog.flatMap(
    (node) => node.provisionalTypes,
  );
  const removedTypes = [...RemovedProvisionalNodeTypes];
  const accountedFor = [...mappedTypes, ...removedTypes];
  const currentActionTypes = Object.values(Actions);

  assert.equal(new Set(removedTypes).size, removedTypes.length);
  assert.deepEqual(
    [...new Set(accountedFor)].sort(),
    [...new Set(currentActionTypes)].sort(),
  );
  assert.equal(
    mappedTypes.filter((type) => type === Actions.ElementToggle).length,
    2,
    "the provisional combined toggle is deliberately split into checkbox and radio nodes",
  );
  const nonSplitMappedTypes = mappedTypes.filter(
    (type) => type !== Actions.ElementToggle,
  );
  assert.equal(
    nonSplitMappedTypes.length,
    new Set(nonSplitMappedTypes).size,
  );
  assert.ok(
    removedTypes.every((type) => !mappedTypes.includes(type)),
    "removed provisional types cannot also be implementation references",
  );
  assert.deepEqual(removedTypes.sort(), ["browser.search", "http.request"]);

  const exportData = getFinalizedNodeByType("output.export_data");
  assert.ok(exportData.provisionalTypes.includes(Actions.ApprovedFileWrite));
  assert.ok(exportData.provisionalTypes.includes(Actions.DataFileExport));
});
