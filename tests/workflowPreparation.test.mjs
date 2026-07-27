import assert from "node:assert/strict";
import { test } from "node:test";

import {
  WorkflowExecutionModels,
  WorkflowExecutionPlanVersion,
  WorkflowPreparationCodes,
  createWorkflowExecutionPlan,
  createWorkflowVariableState,
  prepareWorkflowForExecution,
} from "../BRunner/core/workflowPreparation.js";
import {
  WorkflowSchemaVersion,
} from "../BRunner/core/workflowSchema.js";
import { validateNavigateConfig } from "../BRunner/nodes/navigation/navigate/index.js";

function navigateNode(overrides = {}) {
  return {
    id: "navigate",
    type: "browser.navigate",
    version: 2,
    position: { x: 40, y: 80 },
    config: {
      operation: "goto_url",
      url: "https://example.com/",
      timeout: "4500",
      ...overrides,
    },
    data: {},
  };
}

test("canonical v3 preparation preserves metadata without mutating input", () => {
  const input = {
    schemaVersion: WorkflowSchemaVersion.MapperGraph,
    id: "navigate-v3",
    name: "Navigate v3",
    description: "Prepared once.",
    boundDomain: "example.com",
    variables: { accountId: "42" },
    datasets: { examples: [1, 2] },
    dataSources: [],
    settings: { reuseExistingTabs: true, mapper: { enabled: true } },
    entryNodeId: "navigate",
    nodes: [navigateNode()],
    edges: [],
    acceptance: { synthetic: true },
  };
  const snapshot = structuredClone(input);
  const prepared = prepareWorkflowForExecution(input);

  assert.equal(prepared.executionModel, WorkflowExecutionModels.CanonicalGraph);
  assert.equal(prepared.containsFinalizedNodes, true);
  assert.equal(prepared.workflow.schemaVersion, WorkflowSchemaVersion.MapperGraph);
  assert.equal(prepared.workflow.nodes[0].config.timeout, 4500);
  assert.equal(prepared.workflow.nodes[0].version, 2);
  assert.deepEqual(prepared.workflow.nodes[0].position, { x: 40, y: 80 });
  assert.deepEqual(prepared.workflow.acceptance, { synthetic: true });
  assert.equal(
    prepared.executionPlan.planVersion,
    WorkflowExecutionPlanVersion,
  );
  assert.deepEqual(prepared.executionPlan.workflow, prepared.workflow);
  assert.deepEqual(prepared.executionPlan.nodeInvocations, prepared.steps);
  assert.deepEqual(input, snapshot);
});

test("Graph v2 is upgraded to canonical v3 even without a finalized node", () => {
  const prepared = prepareWorkflowForExecution({
    schemaVersion: WorkflowSchemaVersion.Graph,
    id: "wait-v2",
    name: "Wait v2",
    variables: {},
    settings: {},
    entryNodeId: "wait",
    nodes: [{
      id: "wait",
      type: "logic.wait",
      version: 1,
      position: { x: 1, y: 2 },
      config: { ms: 10 },
      data: {},
    }],
    edges: [],
  });

  assert.equal(prepared.executionModel, WorkflowExecutionModels.CanonicalGraph);
  assert.equal(prepared.containsFinalizedNodes, false);
  assert.equal(prepared.workflow.schemaVersion, WorkflowSchemaVersion.MapperGraph);
  assert.deepEqual(prepared.workflow.nodes[0].position, { x: 1, y: 2 });
});

test("sequential input with a finalized contract is upgraded before execution", () => {
  const prepared = prepareWorkflowForExecution({
    name: "Finalized sequential compatibility input",
    variables: {},
    steps: [{
      id: "navigate",
      action: "browser.navigate",
      version: 2,
      config: {
        operation: "goto_url",
        url: "https://example.com/",
      },
    }],
  });

  assert.equal(prepared.sourceSchema, WorkflowSchemaVersion.Sequential);
  assert.equal(prepared.executionModel, WorkflowExecutionModels.CanonicalGraph);
  assert.equal(prepared.workflow.entryNodeId, "navigate");
  assert.equal(prepared.workflow.nodes[0].type, "browser.navigate");
  assert.equal(prepared.workflow.nodes[0].version, 2);
});

test("purely provisional sequential input retains the legacy linear model", () => {
  const prepared = prepareWorkflowForExecution({
    variables: { seed: "ready" },
    steps: [{
      id: "wait",
      action: "logic.wait",
      version: 1,
      config: { ms: 10 },
    }],
  });

  assert.equal(prepared.executionModel, WorkflowExecutionModels.LegacyLinear);
  assert.equal(prepared.containsFinalizedNodes, false);
  assert.equal(prepared.workflow.steps[0].action, "logic.wait");
  assert.deepEqual(
    prepared.executionPlan.nodeInvocations,
    prepared.workflow.steps,
  );
});

test("preparation rejects unsupported contracts and invalid finalized config", () => {
  assert.throws(
    () => prepareWorkflowForExecution({
      schemaVersion: WorkflowSchemaVersion.MapperGraph,
      id: "unsupported",
      name: "Unsupported",
      settings: {},
      variables: {},
      entryNodeId: "navigate",
      nodes: [{ ...navigateNode(), version: 99 }],
      edges: [],
    }),
    (error) => error.code === WorkflowPreparationCodes.ContractInvalid,
  );

  assert.throws(
    () => prepareWorkflowForExecution({
      schemaVersion: WorkflowSchemaVersion.MapperGraph,
      id: "invalid-config",
      name: "Invalid config",
      settings: {},
      variables: {},
      entryNodeId: "navigate",
      nodes: [navigateNode({ unexpected: true })],
      edges: [],
    }),
    (error) => (
      error.code === WorkflowPreparationCodes.ConfigInvalid &&
      error.details.issues[0].fieldKey === "config.unexpected"
    ),
  );
});

test("finalized validation normalizes Navigate before execution and rejects invalid URLs", () => {
  const prepared = prepareWorkflowForExecution({
    schemaVersion: WorkflowSchemaVersion.MapperGraph,
    id: "normalize-navigate",
    name: "Normalize Navigate",
    settings: {},
    variables: {},
    entryNodeId: "navigate",
    nodes: [navigateNode({ url: "https://example.com" })],
    edges: [],
  }, {
    validateFinalizedConfig: (config) => validateNavigateConfig(config),
  });
  assert.equal(prepared.workflow.nodes[0].config.url, "https://example.com");
  assert.equal(
    prepared.executionPlan.nodeInvocations[0].config.url,
    "https://example.com/",
  );
  assert.deepEqual(
    prepared.executionPlan.nodeInvocations[0].config.retryOnlyFor,
    ["navigation_failure"],
  );

  assert.throws(
    () => prepareWorkflowForExecution({
      schemaVersion: WorkflowSchemaVersion.MapperGraph,
      id: "bad-url",
      name: "Bad URL",
      settings: {},
      variables: {},
      entryNodeId: "navigate",
      nodes: [navigateNode({ url: "not a URL" })],
      edges: [],
    }, {
      validateFinalizedConfig: (config) => validateNavigateConfig(config),
    }),
    (error) => (
      error.code === WorkflowPreparationCodes.ConfigInvalid &&
      /absolute URL/.test(error.message)
    ),
  );
});

test("finalized error-port policy requires a real error route", () => {
  const missingRoute = {
    schemaVersion: WorkflowSchemaVersion.MapperGraph,
    id: "missing-error-route",
    name: "Missing error route",
    settings: {},
    variables: {},
    entryNodeId: "navigate",
    nodes: [navigateNode({ onError: "error_port" })],
    edges: [],
  };
  assert.throws(
    () => prepareWorkflowForExecution(missingRoute),
    (error) => error.code === WorkflowPreparationCodes.RouteInvalid,
  );

  const withRoute = structuredClone(missingRoute);
  withRoute.id = "with-error-route";
  withRoute.name = "With error route";
  withRoute.nodes.push({
    id: "attention",
    type: "workflow.needs_attention",
    version: 1,
    position: { x: 300, y: 80 },
    config: {},
    data: { systemNode: true },
  });
  withRoute.edges.push({
    id: "navigate-error-attention",
    source: "navigate",
    sourceHandle: "error",
    target: "attention",
    targetHandle: "input",
  });
  const prepared = prepareWorkflowForExecution(withRoute);
  assert.equal(prepared.workflow.edges[0].sourceHandle, "error");
});

test("canonical variable state exposes namespaced seeds with legacy read aliases", () => {
  const canonical = createWorkflowVariableState(
    { accountId: "42", retryDelay: 250 },
    WorkflowExecutionModels.CanonicalGraph,
  );
  assert.deepEqual(canonical.values.variables, {
    accountId: "42",
    retryDelay: 250,
  });
  assert.equal(canonical.values.accountId, "42");
  assert.deepEqual(canonical.values.nodes, {});
  assert.deepEqual(canonical.values.workflowClipboard, {});
  assert.equal(
    canonical.origins["variables.accountId"].source,
    "workflow",
  );

  const legacy = createWorkflowVariableState(
    { accountId: "42" },
    WorkflowExecutionModels.LegacyLinear,
  );
  assert.deepEqual(legacy.values, { accountId: "42" });
  assert.equal("variables" in legacy.values, false);
});

test("execution plan rejects invocation identity drift", () => {
  assert.throws(
    () => createWorkflowExecutionPlan({
      sourceSchema: WorkflowSchemaVersion.MapperGraph,
      executionModel: WorkflowExecutionModels.CanonicalGraph,
      workflow: {
        schemaVersion: WorkflowSchemaVersion.MapperGraph,
        entryNodeId: "navigate",
        nodes: [navigateNode()],
        edges: [],
      },
      nodeInvocations: [{
        ...navigateNode(),
        version: 99,
      }],
    }),
    (error) => error.code === WorkflowPreparationCodes.GraphInvalid,
  );
});
