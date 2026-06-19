import assert from "node:assert/strict";
import { test } from "node:test";

import {
  graphWorkflowToSequential,
  upgradeWorkflowToV2,
  validateGraphWorkflow,
} from "../BRunner/core/workflowSchema.js";
import { getWorkflowSteps, isWorkflowLike, normalizeWorkflow } from "../BRunner/core/workflowUtils.js";

const legacy = {
  name: "Legacy flow",
  boundDomain: "example.com",
  variables: { seed: "ready" },
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
  assert.equal(normalizeWorkflow(graph).settings.reuseExistingTabs, true);
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
