export const CanvasTool = Object.freeze({
  Select: "select",
  Hand: "hand",
});

export function getCanvasInteraction({
  tool = CanvasTool.Select,
  temporaryPan = false,
  editingLocked = false,
  canvasHasFocus = false,
} = {}) {
  const effectiveTool = temporaryPan ? CanvasTool.Hand : tool;
  const selecting = effectiveTool === CanvasTool.Select;
  const canEdit = selecting && !editingLocked;

  return {
    effectiveTool,
    canSelect: selecting,
    canEdit,
    panOnDrag: selecting ? [1, 2] : true,
    selectionOnDrag: selecting,
    elementsSelectable: selecting,
    nodesDraggable: canEdit,
    nodesConnectable: canEdit,
    edgesReconnectable: canEdit,
    deleteKeyCode: canEdit && canvasHasFocus ? ["Backspace", "Delete"] : null,
  };
}

export function getMiniMapNodeColor(node = {}) {
  const runtimeStatus = node.data?.runtimeStatus || "idle";
  const runtimeColors = {
    running: "#60a5fa",
    completed: "#22c55e",
    skipped: "#94a3b8",
    failed: "#ef4444",
    cancelled: "#f59e0b",
  };
  if (runtimeColors[runtimeStatus]) return runtimeColors[runtimeStatus];
  return node.selected ? "#a78bfa" : "#3b82f6";
}

export function isCanvasShortcutTarget(target) {
  const tagName = String(target?.tagName || "").toLowerCase();
  return target?.isContentEditable === true
    || ["input", "textarea", "select", "button", "a"].includes(tagName);
}
