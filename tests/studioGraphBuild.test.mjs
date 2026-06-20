import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

test("graph Studio dependencies are pinned exactly", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));

  assert.equal(pkg.dependencies.react, "19.2.7");
  assert.equal(pkg.dependencies["react-dom"], "19.2.7");
  assert.equal(pkg.dependencies["@xyflow/react"], "12.11.0");
  assert.equal(pkg.devDependencies.vite, "8.0.16");
});

test("production graph build uses extension-safe relative assets", async () => {
  const index = await readFile(
    new URL("BRunner/studio-graph/index.html", root),
    "utf8",
  );
  const assets = await readdir(new URL("BRunner/studio-graph/assets/", root));

  assert.match(index, /src="\.\/assets\//);
  assert.match(index, /href="\.\/assets\//);
  assert.equal(/<script(?![^>]*src=)/i.test(index), false);
  assert.equal(assets.some((name) => name.endsWith(".js")), true);
  assert.equal(assets.some((name) => name.endsWith(".css")), true);
});

test("graph Studio wires persistence and execution controls", async () => {
  const source = await readFile(
    new URL("BRunner/studio-graph-src/src/GraphStudio.jsx", root),
    "utf8",
  );

  assert.match(source, /GET_NODE_DEFINITIONS/);
  assert.match(source, /OS_SAVE_WORKFLOW/);
  assert.match(source, /OS_UPGRADE_WORKFLOW/);
  assert.match(source, /START_WORKFLOW/);
  assert.match(source, /STOP_WORKFLOW/);
  assert.match(source, /edgeTypes=\{EDGE_TYPES\}/);
  assert.match(source, /inspector-layout-direction/);
  assert.match(source, />Save Changes<\/button>/);
  assert.match(source, /props\.executionActive \? "Stop" : "Run"/);
  assert.match(source, /StudioCommandBar/);
  assert.match(source, /Connected to Host/);
  assert.match(source, /Recording tab policy/);
  assert.match(source, /OS_DUPLICATE_WORKFLOW/);
  assert.match(source, /OS_DELETE_WORKFLOW/);
  assert.match(source, /STUDIO_RECEIVE_STEP/);
  assert.match(source, /CLEAR_EXECUTION_LOGS/);
  assert.match(source, /OS_SAVE_EXECUTION_LOG/);
  assert.match(source, /Clear &amp; save after run/);
  assert.equal(source.includes("<WorkflowBar"), false);
  assert.match(source, /ExecutionLogPanel/);
  assert.match(source, /execution-log-filter/);
  assert.match(source, /selectionOnDrag=\{canvasInteraction\.selectionOnDrag\}/);
  assert.match(source, /multiSelectionKeyCode/);
  assert.match(source, /getMiniMapNodeColor/);
  assert.match(source, /CanvasToolBar/);
  assert.match(source, /Skip to graph canvas/);
  assert.match(source, /aria-keyshortcuts="V"/);
  assert.match(source, /aria-keyshortcuts="H"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /react-flow__pane/);
  assert.match(source, /selected:\s*true/);
  assert.match(source, /selectCanvasNode/);
});

test("palette and properties panels have bounded scrolling", async () => {
  const css = await readFile(
    new URL("BRunner/studio-graph-src/src/studio.css", root),
    "utf8",
  );

  assert.match(css, /\.graph-sidebar[^}]*min-height:\s*0/);
  assert.match(css, /\.palette-scroll, \.properties-scroll[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.graph-canvas\.tool-hand \.react-flow__node[\s\S]*pointer-events:\s*none/);
  assert.match(css, /\.canvas-tool-bar button\.is-active/);
  assert.match(css, /\.skip-link:focus/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /@media \(max-height: 600px\)/);
});
