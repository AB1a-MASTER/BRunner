import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { computeStudioBuildFingerprint } from "../studioBuildFingerprint.mjs";

const root = new URL("../", import.meta.url);

test("graph Studio dependencies are pinned exactly", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));

  assert.equal(pkg.dependencies.react, "19.2.7");
  assert.equal(pkg.dependencies["react-dom"], "19.2.7");
  assert.equal(pkg.dependencies["@xyflow/react"], "12.11.0");
  assert.equal(pkg.devDependencies.vite, "8.0.16");
});

test("production graph build uses extension-safe relative assets", async () => {
  const indexUrl = new URL("BRunner/studio-graph/index.html", root);
  const index = await readFile(indexUrl, "utf8");
  const assets = await readdir(new URL("BRunner/studio-graph/assets/", root));

  assert.match(index, /src="\.\/assets\//);
  assert.match(index, /href="\.\/assets\//);
  assert.equal(/<script(?![^>]*src=)/i.test(index), false);
  assert.equal(assets.some((name) => name.endsWith(".js")), true);
  assert.equal(assets.some((name) => name.endsWith(".css")), true);

  const localReferences = Array.from(
    index.matchAll(/(?:src|href)="(\.\/[^"?#]+)(?:[?#][^"]*)?"/g),
    (match) => match[1],
  );
  assert.ok(localReferences.length >= 2);
  for (const reference of localReferences) {
    await access(new URL(reference, indexUrl));
    if (reference.startsWith("./assets/")) {
      assert.equal(
        assets.includes(decodeURIComponent(reference.slice("./assets/".length))),
        true,
        `missing emitted asset referenced by index: ${reference}`,
      );
    }
  }
});

test("production graph build matches its complete source fingerprint", async () => {
  const expected = await computeStudioBuildFingerprint();
  const actual = JSON.parse(await readFile(
    new URL("BRunner/studio-graph/build-meta.json", root),
    "utf8",
  ));

  assert.deepEqual(actual, expected);
  assert.equal(
    actual.inputs.includes("BRunner/studio-graph-src/src/GraphStudio.jsx"),
    true,
  );
  for (const transitiveInput of [
    "BRunner/icons/icon2.png",
    "BRunner/mapper/core.js",
    "BRunner/core/workflowSchema.js",
    "BRunner/core/constants.js",
    "BRunner/core/variableInspector.js",
    "BRunner/shared/studio-tokens.css",
    "BRunner/core/studioPreferencesBootstrap.js",
    "BRunner/core/studioPreferences.js",
  ]) {
    assert.equal(actual.inputs.includes(transitiveInput), true, transitiveInput);
  }
});

test("production graph bundle contains mapper graph v3 routing", async () => {
  const assetsUrl = new URL("BRunner/studio-graph/assets/", root);
  const scripts = (await readdir(assetsUrl)).filter((name) => name.endsWith(".js"));
  const bundle = (await Promise.all(
    scripts.map((name) => readFile(new URL(name, assetsUrl), "utf8")),
  )).join("\n");

  assert.match(bundle, /workflow\.needs_attention/);
  assert.match(bundle, /Needs attention/);
  assert.match(bundle, /unresolved/);
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
  assert.match(source, /loadStudioSession/);
  assert.match(source, /saveStudioSession/);
  assert.match(source, /getRecordedStepKey/);
  assert.match(source, /recording\.recordedSteps\.forEach/);
  assert.match(source, /MapperAttentionNodeType/);
  assert.match(source, /getOrCreateMapperAttentionNode/);
  assert.match(source, /sourceHandle:\s*"unresolved"/);
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
  assert.match(source, /applyStudioDensity/);
  assert.match(source, /onDensity=\{\(density\) => updateUiPreferences\(\{ density \}\)\}/);
  assert.match(source, /NodeGuidancePanel/);
  assert.match(source, /How to use/);
  assert.match(source, /Skip to graph canvas/);
  assert.match(source, /aria-keyshortcuts="V"/);
  assert.match(source, /aria-keyshortcuts="H"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /react-flow__pane/);
  assert.match(source, /selected:\s*true/);
  assert.match(source, /selectCanvasNode/);
  assert.match(source, /definitionsByContract/);
  assert.match(source, /collectFieldAutocompleteOptions/);
  assert.match(source, /createNodeAutocompleteContext/);
  assert.match(source, /coerceNodeFieldValue/);
  assert.match(source, /prepareNodeConfiguration/);
  assert.match(source, /edges=\{edges\}/);
  assert.match(source, /configurationIssues/);
  assert.match(source, /TargetEditor/);
  assert.doesNotMatch(source, /onOpenSequential/);
  assert.doesNotMatch(source, /\.\.\/studio\/index\.html/);
  assert.doesNotMatch(source, /StudioKind\.Sequential/);
  assert.doesNotMatch(source, /STUDIO_SESSION_KEY/);
  assert.match(source, /Change the Graph Studio display size/);

  const graphNodeSource = await readFile(
    new URL("BRunner/studio-graph-src/src/GraphNode.jsx", root),
    "utf8",
  );
  assert.match(graphNodeSource, /definition\.inputPorts/);
  assert.match(graphNodeSource, /definition\.outputPorts/);
  assert.match(graphNodeSource, /node-handle-error/);
});

test("palette and properties panels have bounded scrolling", async () => {
  const css = await readFile(
    new URL("BRunner/studio-graph-src/src/studio.css", root),
    "utf8",
  );

  assert.match(css, /\.graph-sidebar[^}]*min-height:\s*0/);
  assert.match(css, /var\(--studio-density-scale\)/);
  assert.match(css, /var\(--studio-panel-width-scale\)/);
  assert.match(css, /var\(--studio-control-height\)/);
  assert.match(css, /--graph-font-sm:\s*calc\(10px \* var\(--studio-font-scale\)\)/);
  assert.match(css, /--graph-control-square-md:\s*calc\(30px \* var\(--studio-density-scale\)\)/);
  assert.match(css, /\.graph-node \{[\s\S]*width:\s*var\(--graph-node-width\)/);
  assert.match(css, /\.execution-log-entry \{[\s\S]*grid-template-columns:\s*calc\(70px \* var\(--studio-panel-width-scale\)\)/);
  assert.match(css, /\.node-guidance/);
  assert.match(css, /\.palette-scroll, \.properties-scroll[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.graph-canvas\.tool-hand \.react-flow__node[\s\S]*pointer-events:\s*none/);
  assert.match(css, /\.canvas-tool-bar button\.is-active/);
  assert.match(css, /\.skip-link:focus/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /@media \(max-height: 600px\)/);
});
