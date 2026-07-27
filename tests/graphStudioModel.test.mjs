import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canvasToGraphWorkflow,
  createNewWorkflowMetadata,
  ensureWorkflowFilename,
  layoutCanvasNodes,
  workflowToCanvas,
} from "../BRunner/studio-graph-src/src/graphStudioModel.js";
import {
  GraphEdgeHandles,
  MapperAttentionNodeType,
  upgradeWorkflowToV2,
  WorkflowSchemaVersion,
} from "../BRunner/core/workflowSchema.js";
import { createPlaceholderComponentRef } from "../BRunner/mapper/core.js";
import { getNodeDefinitions } from "../BRunner/core/nodeRegistry.js";
import { prepareNodeConfiguration } from "../BRunner/core/nodeAuthoring.js";

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

test("editable Graph v2 saves and reloads as canonical v3 without semantic drift", () => {
  const registry = getNodeDefinitions();
  const input = {
    schemaVersion: WorkflowSchemaVersion.Graph,
    id: "navigate-v2-upgrade",
    name: "Navigate v2 upgrade",
    description: "Canonical model gate.",
    boundDomain: "example.com",
    variables: { accountId: 42 },
    datasets: { rows: [{ id: 1 }] },
    dataSources: [{ id: "rows", format: "json", relativePath: "rows.json" }],
    settings: { reuseExistingTabs: true },
    entryNodeId: "open",
    nodes: [
      {
        id: "open",
        type: "browser.navigate",
        version: 2,
        position: { x: 41, y: 82 },
        config: {
          operation: "goto_url",
          url: "https://example.com/accounts/{{ variables.accountId }}",
          timeout: "4500",
          retryCount: "2",
        },
        data: { auditTag: "first" },
      },
      {
        id: "reload",
        type: "browser.navigate",
        version: 2,
        position: { x: 381, y: 82 },
        config: { operation: "reload" },
        data: {},
      },
    ],
    edges: [{
      id: "open-reload",
      source: "open",
      sourceHandle: GraphEdgeHandles.Success,
      target: "reload",
      targetHandle: GraphEdgeHandles.Input,
    }],
    acceptance: { synthetic: true, catalogOrder: 1 },
    customMetadata: { owner: "round-trip-test" },
  };
  const snapshot = structuredClone(input);

  const model = workflowToCanvas(input, registry);
  assert.equal(model.sourceSchema, WorkflowSchemaVersion.Graph);
  assert.equal(model.metadata.schemaVersion, WorkflowSchemaVersion.MapperGraph);
  assert.equal(model.metadata.entryNodeId, "open");
  assert.deepEqual(model.metadata.passthrough.acceptance, input.acceptance);

  const saved = canvasToGraphWorkflow(
    [...model.nodes].reverse(),
    model.edges,
    model.metadata,
  );
  assert.equal(saved.schemaVersion, WorkflowSchemaVersion.MapperGraph);
  assert.equal(saved.entryNodeId, "open");
  assert.deepEqual(saved.acceptance, input.acceptance);
  assert.deepEqual(saved.customMetadata, input.customMetadata);
  assert.deepEqual(saved.edges, input.edges);
  assert.deepEqual(
    saved.nodes.map((node) => [node.id, node.position]),
    [
      ["reload", { x: 381, y: 82 }],
      ["open", { x: 41, y: 82 }],
    ],
  );
  assert.deepEqual(saved.nodes.find((node) => node.id === "open").data, {
    auditTag: "first",
  });
  assert.deepEqual(saved.nodes.find((node) => node.id === "reload").data, {});
  assert.equal(
    saved.nodes.find((node) => node.id === "open").config.timeout,
    4500,
  );
  assert.equal(
    saved.nodes.find((node) => node.id === "open").config.retryCount,
    2,
  );

  const reloaded = workflowToCanvas(saved, registry);
  const savedAgain = canvasToGraphWorkflow(
    reloaded.nodes,
    reloaded.edges,
    reloaded.metadata,
  );
  assert.deepEqual(savedAgain, saved);
  assert.deepEqual(input, snapshot);
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
    { x: 770, y: 120 },
  ]);
  assert.equal(horizontal[0].data.layoutDirection, "horizontal");
});

test("collapsed state persists but layout direction remains UI metadata", () => {
  const graph = upgradeWorkflowToV2({
    steps: [{ id: "one", action: "element.click", target: "#one" }],
  });
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

test("new graph metadata defaults to mapper-capable v3 settings", () => {
  const metadata = createNewWorkflowMetadata({ id: "flow-1" });

  assert.equal(metadata.schemaVersion, WorkflowSchemaVersion.MapperGraph);
  assert.equal(metadata.settings.mapper.enabled, true);
  assert.equal(metadata.settings.mapper.captureMode, "static_bounded");
});

test("v3 mapper component refs and unresolved edges survive round trip", () => {
  const componentRef = createPlaceholderComponentRef("click-save", "element.click");
  const graph = {
    schemaVersion: WorkflowSchemaVersion.MapperGraph,
    id: "mapper-flow",
    name: "Mapper Flow",
    description: "",
    boundDomain: "",
    settings: { mapper: { queryAllowlist: ["tab"] } },
    variables: {},
    datasets: {},
    dataSources: [],
    entryNodeId: "click",
    nodes: [
      {
        id: "click",
        type: "element.click",
        version: 1,
        position: { x: 10, y: 20 },
        config: {},
        data: { componentRef },
      },
      {
        id: "attention",
        type: MapperAttentionNodeType,
        version: 1,
        position: { x: 300, y: 20 },
        config: {},
        data: {},
      },
    ],
    edges: [{
      id: "edge-click-unresolved-attention",
      source: "click",
      sourceHandle: GraphEdgeHandles.Unresolved,
      target: "attention",
      targetHandle: GraphEdgeHandles.Input,
    }],
  };

  const model = workflowToCanvas(graph, definitions);
  const saved = canvasToGraphWorkflow(model.nodes, model.edges, model.metadata);

  assert.equal(model.metadata.schemaVersion, WorkflowSchemaVersion.MapperGraph);
  assert.deepEqual(saved.nodes[0].data.componentRef, componentRef);
  assert.equal(saved.edges[0].sourceHandle, GraphEdgeHandles.Unresolved);
  assert.deepEqual(saved.settings.mapper, model.metadata.settings.mapper);
  assert.deepEqual(saved.settings.mapper.queryAllowlist, ["tab"]);
});

test("unsupported graph node contract stays read-only and cannot be saved", () => {
  const graph = upgradeWorkflowToV2({
    steps: [{ id: "click", action: "element.click", target: "#save" }],
  });
  graph.nodes[0].version = 99;

  const model = workflowToCanvas(graph, definitions);
  assert.equal(model.nodes[0].data.readOnly, true);
  assert.throws(
    () => canvasToGraphWorkflow(model.nodes, model.edges, model.metadata),
    /unsupported contract element\.click@99/,
  );
});

test("Graph Studio edits and saves the shared finalized Navigate v2 contract", () => {
  const graph = {
    schemaVersion: WorkflowSchemaVersion.MapperGraph,
    id: "navigate-v2",
    name: "Navigate v2",
    variables: {},
    datasets: {},
    dataSources: [],
    settings: {},
    entryNodeId: "navigate",
    nodes: [{
      id: "navigate",
      type: "browser.navigate",
      version: 2,
      position: { x: 80, y: 120 },
      config: {
        operation: "goto_url",
        tabSource: "current",
        url: "https://example.com/",
        waitUntil: "dom_ready",
        saveOutputAs: "navigation",
      },
      data: {},
    }],
    edges: [],
  };
  const registry = getNodeDefinitions();
  const definition = registry.find((entry) => entry.type === "browser.navigate");
  const model = workflowToCanvas(graph, registry);
  const saved = canvasToGraphWorkflow(model.nodes, model.edges, model.metadata);

  assert.equal(definition.version, 2);
  assert.equal(definition.config.some((field) => field.key === "operation"), true);
  assert.equal(definition.config.some((field) => field.key === "retryCount"), true);
  assert.equal(model.nodes[0].data.readOnly, false);
  assert.equal(model.nodes[0].data.definition.version, 2);
  assert.deepEqual(
    saved.nodes[0].config,
    prepareNodeConfiguration(graph.nodes[0].config, definition).config,
  );
  assert.deepEqual(model.nodes[0].data.configurationIssues, []);
});

test("Graph Studio loads and saves canonical field value types", () => {
  const registry = getNodeDefinitions();
  const graph = {
    schemaVersion: WorkflowSchemaVersion.MapperGraph,
    id: "navigate-typed",
    name: "Navigate typed values",
    variables: {},
    datasets: {},
    dataSources: [],
    settings: {},
    entryNodeId: "navigate",
    nodes: [{
      id: "navigate",
      type: "browser.navigate",
      version: 2,
      position: { x: 25, y: 50 },
      config: {
        operation: "goto_url",
        url: "https://example.com/",
        timeout: "4500",
        retryCount: "2",
        retryDelay: "{{ variables.retryDelay }}",
      },
      data: {},
    }],
    edges: [],
  };

  const model = workflowToCanvas(graph, registry);
  assert.equal(model.nodes[0].data.config.timeout, 4500);
  assert.equal(model.nodes[0].data.config.retryCount, 2);
  assert.equal(
    model.nodes[0].data.config.retryDelay,
    "{{ variables.retryDelay }}",
  );
  assert.equal(model.nodes[0].data.config.enabled, true);

  const saved = canvasToGraphWorkflow(model.nodes, model.edges, model.metadata);
  assert.equal(saved.nodes[0].config.timeout, 4500);
  assert.equal(saved.nodes[0].config.retryCount, 2);
  assert.equal(
    saved.nodes[0].config.retryDelay,
    "{{ variables.retryDelay }}",
  );
  assert.equal(saved.nodes[0].version, 2);
});

test("Graph Studio exposes invalid prepared configuration and refuses to save it", () => {
  const registry = getNodeDefinitions();
  const graph = {
    schemaVersion: WorkflowSchemaVersion.MapperGraph,
    id: "navigate-invalid",
    name: "Navigate invalid values",
    variables: {},
    datasets: {},
    dataSources: [],
    settings: {},
    entryNodeId: "navigate",
    nodes: [{
      id: "navigate",
      type: "browser.navigate",
      version: 2,
      position: { x: 25, y: 50 },
      config: {
        enabled: "yes",
        operation: "goto_url",
        url: "https://example.com/",
        unexpected: true,
      },
      data: {},
    }],
    edges: [],
  };

  const model = workflowToCanvas(graph, registry);
  assert.deepEqual(
    model.nodes[0].data.configurationIssues.map((issue) => issue.fieldKey),
    ["config.unexpected", "enabled"],
  );
  assert.throws(
    () => canvasToGraphWorkflow(model.nodes, model.edges, model.metadata),
    /Unsupported configuration field: unexpected.*Enabled must be checked or unchecked/,
  );
});
