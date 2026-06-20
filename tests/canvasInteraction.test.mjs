import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CanvasTool,
  getCanvasInteraction,
  getMiniMapNodeColor,
  isCanvasShortcutTarget,
} from "../BRunner/studio-graph-src/src/canvasInteraction.js";

test("Hand mode permits navigation while guarding every canvas edit", () => {
  assert.deepEqual(getCanvasInteraction({
    tool: CanvasTool.Hand,
    canvasHasFocus: true,
  }), {
    effectiveTool: "hand",
    canSelect: false,
    canEdit: false,
    panOnDrag: true,
    selectionOnDrag: false,
    elementsSelectable: false,
    nodesDraggable: false,
    nodesConnectable: false,
    edgesReconnectable: false,
    deleteKeyCode: null,
  });
});

test("Selector supports marquee and guarded deletion, with temporary Hand override", () => {
  const selector = getCanvasInteraction({
    tool: CanvasTool.Select,
    canvasHasFocus: true,
  });
  assert.equal(selector.selectionOnDrag, true);
  assert.equal(selector.nodesDraggable, true);
  assert.deepEqual(selector.deleteKeyCode, ["Backspace", "Delete"]);

  const unfocused = getCanvasInteraction({ tool: CanvasTool.Select });
  assert.equal(unfocused.deleteKeyCode, null);

  const temporaryHand = getCanvasInteraction({
    tool: CanvasTool.Select,
    temporaryPan: true,
    canvasHasFocus: true,
  });
  assert.equal(temporaryHand.effectiveTool, CanvasTool.Hand);
  assert.equal(temporaryHand.canEdit, false);
  assert.equal(temporaryHand.panOnDrag, true);
});

test("minimap colors prioritize live runtime state over ordinary selection", () => {
  assert.equal(getMiniMapNodeColor({ selected: true, data: { runtimeStatus: "running" } }), "#60a5fa");
  assert.equal(getMiniMapNodeColor({ selected: true, data: { runtimeStatus: "failed" } }), "#ef4444");
  assert.equal(getMiniMapNodeColor({ selected: true, data: { runtimeStatus: "idle" } }), "#a78bfa");
  assert.equal(getMiniMapNodeColor({ selected: false, data: {} }), "#3b82f6");
});

test("canvas shortcuts ignore editable and interactive controls", () => {
  assert.equal(isCanvasShortcutTarget({ tagName: "INPUT" }), true);
  assert.equal(isCanvasShortcutTarget({ tagName: "BUTTON" }), true);
  assert.equal(isCanvasShortcutTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isCanvasShortcutTarget({ tagName: "DIV" }), false);
});
