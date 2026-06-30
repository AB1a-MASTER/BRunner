import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canvasToGraphWorkflow,
  ensureWorkflowFilename,
  layoutCanvasNodes,
  workflowToCanvas,
} from "../BRunner/studio-graph-src/src/graphStudioModel.js";
import { upgradeWorkflowToV2 } from "../BRunner/core/workflowSchema.js";

const definitions = [{
  type: "element.click",
  version: 1,
  category: "Element",
  label: "Click Element",
  targetRequired: true,
  config: [],
}];

test("legacy workflows open read-only and preserve structured targets", () => {
  const target = {
    primary: { strategy: "css_selector", value: "#submit" },
    fallbacks: [{ strategy: "text", value: "Submit" }],
  };
  const model = workflowToCanvas({
    name: "Legacy",
    steps: [{ id: "click", action: "element.click", target }],
  }, definitions);

  assert.equal(model.readOnly, true);
  assert.equal(model.nodes[0].data.target, "#submit");
  assert.equal(model.nodes[0].data.readOnly, true);

  const graph = canvasToGraphWorkflow(model.nodes, model.edges, model.metadata);
  assert.deepEqual(graph.nodes[0].data.target, target);
});

test("legacy nodes receive non-overlapping deterministic layout", () => {
  const model = workflowToCanvas({
    steps: [
      { id: "one", action: "element.click" },
      { id: "two", action: "element.click" },
      { id: "three", action: "element.click" },
    ],
  }, definitions);

  assert.deepEqual(model.nodes.map((node) => node.position), [
    { x: 120, y: 70 },
    { x: 120, y: 370 },
    { x: 120, y: 670 },
  ]);
});

test("v2 graph positions, edges, configuration, and bypass survive round trip", () => {
  const graph = upgradeWorkflowToV2({
    name: "Graph",
    description: "A graph workflow description.",
    steps: [{
      id: "click",
      action: "element.click",
      target: "#save",
      executionMode: "conditional",
      skipWhen: "{{skip_save}}",
    }],
  });
  graph.nodes[0].position = { x: 321, y: 654 };
  graph.datasets = { sample: ["one", "two"] };
  graph.dataSources = [{ id: "sample_json", format: "json", relativePath: "sample.json" }];

  const model = workflowToCanvas(graph, definitions);
  const saved = canvasToGraphWorkflow(model.nodes, model.edges, model.metadata);

  assert.equal(model.readOnly, false);
  assert.equal(model.metadata.description, "A graph workflow description.");
  assert.equal(saved.description, "A graph workflow description.");
  assert.deepEqual(model.metadata.datasets, graph.datasets);
  assert.deepEqual(saved.datasets, graph.datasets);
  assert.deepEqual(saved.dataSources, graph.dataSources);
  assert.deepEqual(saved.nodes[0].position, { x: 321, y: 654 });
  assert.equal(saved.nodes[0].data.executionMode, "conditional");
  assert.equal(saved.nodes[0].data.skipWhen, "{{skip_save}}");
  assert.equal("definition" in saved.nodes[0].data, false);
  assert.equal("readOnly" in saved.nodes[0].data, false);
});

test("horizontal layout changes positions and handle direction metadata", () => {
  const graph = upgradeWorkflowToV2({
    steps: [
      { id: "one", action: "element.click" },
      { id: "two", action: "element.click" },
    ],
  });
  const model = workflowToCanvas(graph, definitions);
  const horizontal = layoutCanvasNodes(model.nodes, model.edges, "horizontal");

  assert.deepEqual(horizontal.map((node) => node.position), [
    { x: 90, y: 120 },
    { x: 430, y: 120 },
  ]);
  assert.equal(horizontal[0].data.layoutDirection, "horizontal");
});

test("collapsed state persists but layout direction remains UI metadata", () => {
  const graph = upgradeWorkflowToV2({ steps: [{ id: "one", action: "element.click" }] });
  const model = workflowToCanvas(graph, definitions);
  model.nodes[0].data.collapsed = true;
  model.nodes[0].data.layoutDirection = "horizontal";
  model.nodes[0].data.runtimeStatus = "completed";
  model.nodes[0].data.executionLocked = true;
  model.nodes[0].data.navigationLocked = true;
  const saved = canvasToGraphWorkflow(model.nodes, model.edges, {
    ...model.metadata,
    settings: { graphLayoutDirection: "horizontal" },
  });

  assert.equal(saved.nodes[0].data.collapsed, true);
  assert.equal("layoutDirection" in saved.nodes[0].data, false);
  assert.equal("runtimeStatus" in saved.nodes[0].data, false);
  assert.equal("executionLocked" in saved.nodes[0].data, false);
  assert.equal("navigationLocked" in saved.nodes[0].data, false);
  assert.equal(saved.settings.graphLayoutDirection, "horizontal");
});

test("disconnected canvas cannot be persisted as a linear graph", () => {
  const graph = upgradeWorkflowToV2({
    steps: [
      { id: "one", action: "element.click" },
      { id: "two", action: "element.click" },
    ],
  });
  const model = workflowToCanvas(graph, definitions);

  assert.throws(
    () => canvasToGraphWorkflow(model.nodes, [], model.metadata),
    /Cannot save graph/,
  );
});

test("workflow filenames are sanitized and normalized", () => {
  assert.equal(ensureWorkflowFilename("My: Flow.json"), "My_ Flow.json");
  assert.equal(ensureWorkflowFilename(""), "Untitled.json");
});
