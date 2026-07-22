import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GraphEdgeHandles,
  canonicalWorkflowToSequentialView,
  graphWorkflowToSequential,
  MapperAttentionNodeType,
  upgradeWorkflowToV2,
  upgradeWorkflowToCanonical,
  validateGraphWorkflow,
  sequentialViewToCanonicalWorkflow,
  WorkflowSchemaVersion,
} from "../BRunner/core/workflowSchema.js";
import { getWorkflowSteps, isWorkflowLike, normalizeWorkflow } from "../BRunner/core/workflowUtils.js";

const legacy = {
  name: "Legacy flow",
  description: "Cross-site legacy acceptance flow.",
  boundDomain: "example.com",
  variables: { seed: "ready" },
  datasets: { users: [{ id: 1, name: "Ada" }] },
  dataSources: [{ id: "users_csv", format: "csv", relativePath: "users.csv" }],
  settings: { reuseExistingTabs: true },
  steps: [
    {
      id: "first",
      action: "browser.navigate",
      url: "https://example.com",
      config: { url: "https://example.com" },
      page: { url: "https://example.com/start" },
    },
    {
      id: "second",
      action: "data.set",
      config: { variableName: "result", value: "{{seed}}" },
    },
  ],
};

test("v1 upgrades to a deterministic linear v2 graph", () => {
  const graph = upgradeWorkflowToV2(legacy, { id: "flow-1" });

  assert.equal(graph.schemaVersion, 2);
  assert.equal(graph.id, "flow-1");
  assert.equal(graph.description, legacy.description);
  assert.deepEqual(graph.datasets, legacy.datasets);
  assert.deepEqual(graph.dataSources, legacy.dataSources);
  assert.equal(graph.entryNodeId, "first");
  assert.deepEqual(graph.nodes.map((node) => node.id), ["first", "second"]);
  assert.deepEqual(graph.edges.map((edge) => [edge.source, edge.target]), [["first", "second"]]);
  assert.equal(validateGraphWorkflow(graph).valid, true);
});

test("v2 sequential adapter preserves runtime step fields", () => {
  const graph = upgradeWorkflowToV2(legacy);
  const sequential = graphWorkflowToSequential(graph);

  assert.equal(sequential.steps[0].url, "https://example.com");
  assert.deepEqual(sequential.steps[0].page, legacy.steps[0].page);
  assert.deepEqual(sequential.steps[1].config, legacy.steps[1].config);
  assert.deepEqual(sequential.variables, legacy.variables);
  assert.deepEqual(sequential.datasets, legacy.datasets);
  assert.deepEqual(sequential.dataSources, legacy.dataSources);
  assert.equal(sequential.description, legacy.description);
  assert.equal(normalizeWorkflow(graph).description, legacy.description);
  assert.equal(normalizeWorkflow(graph).settings.reuseExistingTabs, true);
  assert.deepEqual(normalizeWorkflow(graph).datasets, legacy.datasets);
  assert.deepEqual(normalizeWorkflow(graph).dataSources, legacy.dataSources);
  assert.equal(getWorkflowSteps(graph).length, 2);
  assert.equal(isWorkflowLike(graph), true);
});

test("duplicate legacy step ids receive unique graph ids", () => {
  const graph = upgradeWorkflowToV2({
    steps: [
      { id: "same", action: "element.click" },
      { id: "same", action: "element.click" },
    ],
  });

  assert.deepEqual(graph.nodes.map((node) => node.id), ["same", "same-2"]);
});

test("branching and disconnected v2 graphs are rejected", () => {
  const graph = upgradeWorkflowToV2(legacy);
  graph.nodes.push({ id: "third", type: "element.click", config: {}, data: {} });
  graph.edges.push({
    id: "branch",
    source: "first",
    sourceHandle: "success",
    target: "third",
    targetHandle: "input",
  });

  const result = validateGraphWorkflow(graph);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /one linear path/);
  assert.throws(() => graphWorkflowToSequential(graph), /Invalid graph workflow/);
});

test("empty v2 graph remains a valid empty sequential workflow", () => {
  const graph = upgradeWorkflowToV2({ steps: [] });
  assert.equal(validateGraphWorkflow(graph).valid, true);
  assert.deepEqual(graphWorkflowToSequential(graph).steps, []);
});

test("v3 mapper DOM nodes require unresolved routing", () => {
  const graph = {
    schemaVersion: WorkflowSchemaVersion.MapperGraph,
    id: "mapper-flow",
    name: "Mapper Flow",
    entryNodeId: "click",
    nodes: [
      {
        id: "click",
        type: "element.click",
        version: 1,
        position: { x: 0, y: 0 },
        config: {},
        data: {
          componentRef: {
            mapperSchemaVersion: 1,
            id: "component:save",
            name: "Save",
          },
        },
      },
      {
        id: "attention",
        type: MapperAttentionNodeType,
        version: 1,
        position: { x: 240, y: 0 },
        config: {},
        data: {},
      },
    ],
    edges: [],
  };

  let result = validateGraphWorkflow(graph);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /requires an unresolved edge/);

  graph.edges.push({
    id: "edge-click-unresolved-attention",
    source: "click",
    sourceHandle: GraphEdgeHandles.Unresolved,
    target: "attention",
    targetHandle: GraphEdgeHandles.Input,
  });

  result = validateGraphWorkflow(graph);
  assert.equal(result.valid, true);
  assert.throws(
    () => graphWorkflowToSequential(graph),
    /require graph traversal/,
  );
});

test("v3 preserves one stable error route and keeps it out of the linear adapter", () => {
  const graph = {
    schemaVersion: WorkflowSchemaVersion.MapperGraph,
    id: "error-route",
    name: "Error Route",
    entryNodeId: "source",
    nodes: [
      { id: "source", type: "data.set", version: 1, config: {}, data: {} },
      { id: "handler", type: "data.set", version: 1, config: {}, data: {} },
    ],
    edges: [{
      id: "edge-source-error-handler",
      source: "source",
      sourceHandle: GraphEdgeHandles.Error,
      target: "handler",
      targetHandle: GraphEdgeHandles.Input,
    }],
  };

  assert.equal(validateGraphWorkflow(graph).valid, true);
  assert.throws(
    () => graphWorkflowToSequential(graph),
    /non-success routing require graph traversal/,
  );
  graph.edges.push({
    id: "edge-source-error-handler-2",
    source: "source",
    sourceHandle: GraphEdgeHandles.Error,
    target: "handler",
    targetHandle: GraphEdgeHandles.Input,
  });
  assert.match(
    validateGraphWorkflow(graph).errors.join(" "),
    /at most one error edge/,
  );
});

test("graph validation rejects missing or invalid node contract versions", () => {
  const graph = upgradeWorkflowToV2(legacy);
  delete graph.nodes[0].version;
  assert.match(
    validateGraphWorkflow(graph).errors.join(" "),
    /positive integer contract version/,
  );
});

test("Graph to Sequential to Graph preserves canonical routes and node data", () => {
  const canonical = upgradeWorkflowToCanonical({
    ...legacy,
    steps: [{
      id: "click",
      action: "element.click",
      version: 1,
      target: "#save",
      config: { allowVisibleHostFallback: false },
      customData: { keep: true },
    }],
  });
  const view = canonicalWorkflowToSequentialView(canonical);
  view.steps[0].config.allowVisibleHostFallback = true;
  const saved = sequentialViewToCanonicalWorkflow(view);

  assert.equal(saved.schemaVersion, WorkflowSchemaVersion.MapperGraph);
  assert.equal(saved.nodes.find((node) => node.id === "click").version, 1);
  assert.deepEqual(saved.nodes.find((node) => node.id === "click").data.customData, { keep: true });
  assert.equal(saved.nodes.find((node) => node.id === "click").config.allowVisibleHostFallback, true);
  assert.equal(saved.edges.some((edge) => edge.sourceHandle === GraphEdgeHandles.Unresolved), true);
  assert.equal(validateGraphWorkflow(saved).valid, true);
});

test("Sequential to Graph to Sequential keeps versions and ordered semantics", () => {
  const firstView = canonicalWorkflowToSequentialView({
    name: "Sequential",
    steps: [
      { id: "set", action: "data.set", version: 1, config: { variableName: "x", value: 1 } },
      { id: "wait", action: "logic.wait", version: 1, config: { ms: 10 } },
    ],
  });
  const graph = sequentialViewToCanonicalWorkflow(firstView);
  const secondView = canonicalWorkflowToSequentialView(graph);

  assert.deepEqual(secondView.steps.map((step) => [step.id, step.action, step.version]), [
    ["set", "data.set", 1],
    ["wait", "logic.wait", 1],
  ]);
  assert.deepEqual(secondView.steps.map((step) => step.config), firstView.steps.map((step) => step.config));
});

test("Sequential configuration edits preserve explicit error routes and structural edits fail closed", () => {
  const graph = {
    schemaVersion: WorkflowSchemaVersion.MapperGraph,
    id: "routed",
    name: "Routed",
    entryNodeId: "source",
    nodes: [
      { id: "source", type: "data.set", version: 1, position: { x: 0, y: 0 }, config: { value: 1 }, data: {} },
      { id: "handler", type: "data.set", version: 1, position: { x: 200, y: 0 }, config: { value: 2 }, data: {} },
    ],
    edges: [{
      id: "error-route",
      source: "source",
      sourceHandle: GraphEdgeHandles.Error,
      target: "handler",
      targetHandle: GraphEdgeHandles.Input,
    }],
  };
  const view = canonicalWorkflowToSequentialView(graph);
  assert.equal(view.structureLocked, true);
  view.steps[0].config.value = 3;
  const saved = sequentialViewToCanonicalWorkflow(view);
  assert.equal(saved.edges[0].sourceHandle, GraphEdgeHandles.Error);
  assert.equal(saved.nodes.find((node) => node.id === "source").config.value, 3);

  view.steps.reverse();
  assert.throws(
    () => sequentialViewToCanonicalWorkflow(view),
    /route structure must remain unchanged/,
  );
});

test("removing the last DOM node also removes its generated attention node", () => {
  const view = canonicalWorkflowToSequentialView({
    id: "remove-dom",
    name: "Remove DOM",
    steps: [{
      id: "click",
      action: "element.click",
      version: 1,
      target: "#save",
      config: {},
    }],
  });
  view.steps = [];

  const graph = sequentialViewToCanonicalWorkflow(view);
  assert.deepEqual(graph.nodes, []);
  assert.deepEqual(graph.edges, []);
  assert.equal(graph.entryNodeId, "");
});
