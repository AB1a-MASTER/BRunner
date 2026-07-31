import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  canvasToGraphWorkflow,
  workflowToCanvas,
} from "../BRunner/studio-graph-src/src/graphStudioModel.js";
import {
  collectFieldAutocompleteOptions,
  createNodeAutocompleteContext,
} from "../BRunner/core/nodeAuthoring.js";
import { getNodeDefinitions } from "../BRunner/core/nodeRegistry.js";
import {
  WorkflowExecutionModels,
  WorkflowExecutionPlanVersion,
  WorkflowPreparationCodes,
  prepareWorkflowForExecution,
} from "../BRunner/core/workflowPreparation.js";
import {
  GraphEdgeHandles,
  MapperAttentionNodeType,
  WorkflowSchemaVersion,
  validateGraphWorkflow,
} from "../BRunner/core/workflowSchema.js";
import { validateScrollConfig } from "../BRunner/nodes/navigation/scroll/index.js";

const definitions = getNodeDefinitions();
const scrollDefinition = definitions.find((definition) => (
  definition.type === "browser.scroll" && definition.version === 2
));

function prepareForBackground(workflow) {
  return prepareWorkflowForExecution(workflow, {
    validateFinalizedConfig: (config, context) => (
      context.definition.type === "browser.scroll" &&
      context.definition.version === 2
        ? validateScrollConfig(config, {
            allowExpressions: true,
            node: context.node,
          })
        : { valid: true, config, errors: [] }
    ),
  });
}

test("Scroll survives Graph edit, save, reload, validation, and execution planning", () => {
  const containerTarget = {
    identifierType: "css",
    identifierValue: "#scroll-panel",
    textMatch: {
      mode: "exact",
      caseSensitive: false,
      trimWhitespace: true,
      normalizeWhitespace: true,
      multipleMatchBehavior: "fail",
      strictUnique: true,
    },
  };
  const input = {
    schemaVersion: WorkflowSchemaVersion.MapperGraph,
    id: "scroll-complete-round-trip",
    name: "Scroll complete round trip",
    description: "Node 2 semantic parity fixture.",
    boundDomain: "127.0.0.1",
    variables: {
      distance: 320,
      maxScrolls: 8,
    },
    datasets: {},
    dataSources: [],
    settings: {
      graphLayoutDirection: "horizontal",
      mapper: { enabled: true, captureMode: "static_bounded" },
    },
    entryNodeId: "page-scroll",
    nodes: [
      {
        id: "page-scroll",
        type: "browser.scroll",
        version: 2,
        position: { x: 80, y: 90 },
        config: {
          operation: "by_amount",
          scrollTarget: "page",
          direction: "down",
          amount: "{{ variables.distance }}",
          amountUnit: "pixels",
          smooth: false,
          enabled: false,
          saveOutputAs: "page_scroll",
        },
        data: {},
      },
      {
        id: "container-scroll",
        type: "browser.scroll",
        version: 2,
        position: { x: 430, y: 90 },
        config: {
          operation: "until_condition",
          scrollTarget: "container",
          direction: "down",
          amount: 80,
          amountUnit: "viewport_percent",
          maxAttempts: "{{ variables.maxScrolls }}",
          stopCondition: "text_present",
          stopValue: "Container complete",
          waitForContentAfterEachScroll: true,
          timeout: 5000,
          onError: "error_port",
          saveOutputAs: "container_scroll",
        },
        data: { target: containerTarget },
      },
      {
        id: "attention",
        type: MapperAttentionNodeType,
        version: 1,
        position: { x: 780, y: 250 },
        config: {},
        data: { systemNode: true },
      },
    ],
    edges: [
      {
        id: "page-container",
        source: "page-scroll",
        sourceHandle: GraphEdgeHandles.Success,
        target: "container-scroll",
        targetHandle: GraphEdgeHandles.Input,
      },
      {
        id: "container-error",
        source: "container-scroll",
        sourceHandle: GraphEdgeHandles.Error,
        target: "attention",
        targetHandle: GraphEdgeHandles.Input,
      },
      {
        id: "container-unresolved",
        source: "container-scroll",
        sourceHandle: GraphEdgeHandles.Unresolved,
        target: "attention",
        targetHandle: GraphEdgeHandles.Input,
      },
    ],
    acceptance: {
      schemaVersion: 1,
      catalogOrder: 2,
      synthetic: true,
    },
  };
  const snapshot = structuredClone(input);

  const firstCanvas = workflowToCanvas(input, definitions);
  assert.equal(
    firstCanvas.nodes.every((node) => (
      node.data.configurationIssues.length === 0
    )),
    true,
  );
  assert.equal(
    firstCanvas.nodes.find((node) => node.id === "page-scroll")
      .data.definition.targetSupported,
    true,
  );
  const firstSave = canvasToGraphWorkflow(
    firstCanvas.nodes,
    firstCanvas.edges,
    firstCanvas.metadata,
  );
  const secondCanvas = workflowToCanvas(firstSave, definitions);
  const secondSave = canvasToGraphWorkflow(
    secondCanvas.nodes,
    secondCanvas.edges,
    secondCanvas.metadata,
  );

  assert.deepEqual(secondSave, firstSave);
  assert.deepEqual(input, snapshot);
  assert.equal(validateGraphWorkflow(firstSave).valid, true);
  assert.deepEqual(
    firstSave.nodes.find((node) => node.id === "container-scroll").data.target,
    containerTarget,
  );
  assert.equal(
    firstSave.nodes.find((node) => node.id === "page-scroll").config.enabled,
    false,
  );
  assert.equal(
    firstSave.nodes.find((node) => node.id === "page-scroll").config.amount,
    "{{ variables.distance }}",
  );
  assert.equal(
    firstSave.nodes.find((node) => node.id === "container-scroll")
      .config.maxAttempts,
    "{{ variables.maxScrolls }}",
  );
  assert.deepEqual(
    firstSave.edges.map((edge) => edge.sourceHandle),
    ["success", "error", "unresolved"],
  );

  const autocomplete = createNodeAutocompleteContext({
    currentNodeId: "container-scroll",
    entryNodeId: secondCanvas.metadata.entryNodeId,
    nodes: secondCanvas.nodes,
    edges: secondCanvas.edges,
    variables: secondCanvas.metadata.variables,
  });
  const amountField = scrollDefinition.config.find(
    (field) => field.key === "amount",
  );
  const amountOptions = collectFieldAutocompleteOptions(
    amountField,
    autocomplete,
  );
  assert.equal(amountOptions.includes("{{ variables.distance }}"), true);
  assert.equal(amountOptions.includes("{{ nodes.page-scroll.output }}"), true);
  assert.equal(
    amountOptions.includes("{{ nodes.container-scroll.output }}"),
    false,
  );

  const prepared = prepareForBackground(firstSave);
  assert.equal(
    prepared.executionPlan.planVersion,
    WorkflowExecutionPlanVersion,
  );
  assert.equal(
    prepared.executionPlan.executionModel,
    WorkflowExecutionModels.CanonicalGraph,
  );
  assert.deepEqual(prepared.executionPlan.workflow, firstSave);
  assert.deepEqual(
    prepared.executionPlan.nodeInvocations.map((node) => [
      node.id,
      node.type,
      node.version,
    ]),
    [
      ["page-scroll", "browser.scroll", 2],
      ["container-scroll", "browser.scroll", 2],
      ["attention", MapperAttentionNodeType, 1],
    ],
  );
  assert.equal(
    prepared.executionPlan.nodeInvocations
      .find((node) => node.id === "container-scroll")
      .config.maxAttempts,
    "{{ variables.maxScrolls }}",
  );
});

test("Scroll Graph validation requires targets conditionally and rejects v3", () => {
  const base = {
    schemaVersion: WorkflowSchemaVersion.MapperGraph,
    id: "scroll-invalid",
    name: "Scroll invalid",
    variables: {},
    datasets: {},
    dataSources: [],
    settings: {},
    entryNodeId: "scroll",
    nodes: [{
      id: "scroll",
      type: "browser.scroll",
      version: 2,
      position: { x: 80, y: 90 },
      config: {
        operation: "by_amount",
        scrollTarget: "page",
        direction: "down",
        amount: 100,
        amountUnit: "pixels",
      },
      data: {},
    }],
    edges: [],
  };

  assert.doesNotThrow(() => prepareForBackground(base));

  const missingContainer = structuredClone(base);
  missingContainer.nodes[0].config.scrollTarget = "container";
  assert.throws(
    () => prepareForBackground(missingContainer),
    (error) => error.code === WorkflowPreparationCodes.ConfigInvalid,
  );

  const missingElement = structuredClone(base);
  missingElement.nodes[0].config.operation = "to_element";
  assert.throws(
    () => prepareForBackground(missingElement),
    (error) => error.code === WorkflowPreparationCodes.ConfigInvalid,
  );

  const unsupported = structuredClone(base);
  unsupported.nodes[0].version = 3;
  assert.throws(
    () => prepareForBackground(unsupported),
    (error) => error.code === WorkflowPreparationCodes.ContractInvalid,
  );
});

test("checked-in Scroll acceptance round-trips with error and unresolved routes", async () => {
  const source = JSON.parse(await readFile(new URL(
    "../BRunner_Host/Workflows/node_acceptance/002_scroll_acceptance.json",
    import.meta.url,
  ), "utf8"));
  const canvas = workflowToCanvas(source, definitions);
  const saved = canvasToGraphWorkflow(
    canvas.nodes,
    canvas.edges,
    canvas.metadata,
  );
  const prepared = prepareForBackground(saved);

  assert.deepEqual(saved.acceptance, source.acceptance);
  assert.equal(saved.entryNodeId, "scroll-fixture-panel");
  assert.equal(
    saved.nodes.find((node) => node.id === "scroll-fixture-panel")
      .data.target.identifierValue,
    "#acceptance-scroll-panel",
  );
  assert.deepEqual(
    saved.edges.map((edge) => edge.sourceHandle).sort(),
    [GraphEdgeHandles.Error, GraphEdgeHandles.Unresolved].sort(),
  );
  assert.deepEqual(prepared.executionPlan.workflow, saved);
});
