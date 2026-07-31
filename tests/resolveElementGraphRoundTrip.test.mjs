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
import { validateResolveElementConfig } from "../BRunner/nodes/targeting/resolve-element/index.js";

const definitions = getNodeDefinitions();
const resolveDefinition = definitions.find((definition) => (
  definition.type === "element.resolve" && definition.version === 1
));

function prepareForBackground(workflow) {
  return prepareWorkflowForExecution(workflow, {
    validateFinalizedConfig: (config, context) => (
      context.definition.type === "element.resolve" &&
      context.definition.version === 1
        ? validateResolveElementConfig(config, {
            allowExpressions: true,
            node: context.node,
          })
        : { valid: true, config, errors: [] }
    ),
  });
}

const TABLE_TARGET = Object.freeze({
  identifierType: "css",
  identifierValue: "#results-table",
  textMatch: {
    mode: "exact",
    caseSensitive: false,
    trimWhitespace: true,
    normalizeWhitespace: true,
    multipleMatchBehavior: "fail",
    strictUnique: true,
  },
});

const ROW_TARGET = Object.freeze({
  identifierType: "css",
  identifierValue: "#results-table tbody tr",
});

test("Resolve Element is registered as an exact finalized contract", () => {
  assert.ok(resolveDefinition, "element.resolve@1 must be registered");
  assert.equal(resolveDefinition.contractKind, "finalized");
  assert.equal(resolveDefinition.catalogNumber, 4);
  assert.equal(resolveDefinition.category, "Targeting");
  assert.ok(
    resolveDefinition.targetSchema,
    "the shared target editor schema must be attached",
  );
  assert.deepEqual(
    resolveDefinition.outputPorts.map((port) => port.id),
    ["success", "error", "unresolved"],
  );
  assert.equal(
    definitions.filter((definition) => definition.type === "element.resolve")
      .length,
    1,
  );
});

test("Resolve Element survives Graph edit, save, reload, validation, and planning", () => {
  const input = {
    schemaVersion: WorkflowSchemaVersion.MapperGraph,
    id: "resolve-complete-round-trip",
    name: "Resolve Element complete round trip",
    description: "Node 4 semantic parity fixture.",
    boundDomain: "127.0.0.1",
    variables: { requiredConfidence: 0.9, elementType: "table" },
    datasets: {},
    dataSources: [],
    settings: {
      graphLayoutDirection: "horizontal",
      mapper: { enabled: true, captureMode: "static_bounded" },
    },
    entryNodeId: "resolve-table",
    nodes: [
      {
        id: "resolve-table",
        type: "element.resolve",
        version: 1,
        position: { x: 80, y: 90 },
        config: {
          mode: "resolve_known",
          resultCardinality: "one",
          visibilityRequirement: "visible",
          expectedElementType: "{{ variables.elementType }}",
          minimumConfidence: "{{ variables.requiredConfidence }}",
          saveOutputAs: "results_table",
        },
        data: { target: TABLE_TARGET },
      },
      {
        id: "resolve-rows",
        type: "element.resolve",
        version: 1,
        position: { x: 430, y: 90 },
        config: {
          mode: "find_dynamic",
          resultCardinality: "all",
          visibilityRequirement: "any",
          searchScope: "whole_page",
          enabled: false,
          onError: "error_port",
          saveOutputAs: "result_rows",
        },
        data: { target: ROW_TARGET },
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
        id: "table-rows",
        source: "resolve-table",
        sourceHandle: GraphEdgeHandles.Success,
        target: "resolve-rows",
        targetHandle: GraphEdgeHandles.Input,
      },
      {
        id: "rows-error",
        source: "resolve-rows",
        sourceHandle: GraphEdgeHandles.Error,
        target: "attention",
        targetHandle: GraphEdgeHandles.Input,
      },
      {
        id: "rows-unresolved",
        source: "resolve-rows",
        sourceHandle: GraphEdgeHandles.Unresolved,
        target: "attention",
        targetHandle: GraphEdgeHandles.Input,
      },
    ],
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
    firstCanvas.nodes.find((node) => node.id === "resolve-table")
      .data.definition.targetRequired,
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
    firstSave.nodes.find((node) => node.id === "resolve-table").data.target,
    TABLE_TARGET,
  );
  assert.equal(
    firstSave.nodes.find((node) => node.id === "resolve-table")
      .config.minimumConfidence,
    "{{ variables.requiredConfidence }}",
  );
  assert.equal(
    firstSave.nodes.find((node) => node.id === "resolve-rows").config.enabled,
    false,
  );
  assert.deepEqual(
    firstSave.edges.map((edge) => edge.sourceHandle),
    ["success", "error", "unresolved"],
  );

  const autocomplete = createNodeAutocompleteContext({
    currentNodeId: "resolve-rows",
    entryNodeId: secondCanvas.metadata.entryNodeId,
    nodes: secondCanvas.nodes,
    edges: secondCanvas.edges,
    variables: secondCanvas.metadata.variables,
  });
  const typeField = resolveDefinition.config.find(
    (field) => field.key === "expectedElementType",
  );
  const typeOptions = collectFieldAutocompleteOptions(typeField, autocomplete);
  assert.equal(
    typeOptions.includes("{{ variables.elementType }}"),
    true,
  );
  assert.equal(
    typeOptions.includes("{{ nodes.resolve-table.output }}"),
    true,
  );
  assert.equal(
    typeOptions.includes("{{ nodes.resolve-rows.output }}"),
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
      ["resolve-table", "element.resolve", 1],
      ["resolve-rows", "element.resolve", 1],
      ["attention", MapperAttentionNodeType, 1],
    ],
  );
});

test("Resolve Element Graph validation requires a target and rejects v2", () => {
  const base = {
    schemaVersion: WorkflowSchemaVersion.MapperGraph,
    id: "resolve-invalid",
    name: "Resolve invalid",
    variables: {},
    datasets: {},
    dataSources: [],
    settings: {},
    entryNodeId: "resolve",
    nodes: [{
      id: "resolve",
      type: "element.resolve",
      version: 1,
      position: { x: 80, y: 90 },
      config: { mode: "resolve_known", resultCardinality: "one" },
      data: { target: TABLE_TARGET },
    }],
    edges: [],
  };

  assert.doesNotThrow(() => prepareForBackground(base));

  const missingTarget = structuredClone(base);
  missingTarget.nodes[0].data = {};
  assert.throws(
    () => prepareForBackground(missingTarget),
    (error) => error.code === WorkflowPreparationCodes.ConfigInvalid,
  );

  const frameWithoutReference = structuredClone(base);
  frameWithoutReference.nodes[0].config.searchScope = "frame";
  assert.throws(
    () => prepareForBackground(frameWithoutReference),
    (error) => error.code === WorkflowPreparationCodes.ConfigInvalid,
  );

  const revalidateWithoutRef = structuredClone(base);
  revalidateWithoutRef.nodes[0].config.mode = "revalidate_component";
  assert.throws(
    () => prepareForBackground(revalidateWithoutRef),
    (error) => error.code === WorkflowPreparationCodes.ConfigInvalid,
  );

  const unsupported = structuredClone(base);
  unsupported.nodes[0].version = 2;
  assert.throws(
    () => prepareForBackground(unsupported),
    (error) => error.code === WorkflowPreparationCodes.ContractInvalid,
  );
});

test("checked-in Resolve Element acceptance round-trips with both safe routes", async () => {
  const source = JSON.parse(await readFile(new URL(
    "../BRunner_Host/Workflows/node_acceptance/004_resolve_element_acceptance.json",
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
  assert.equal(saved.entryNodeId, "resolve-results-table");
  assert.equal(
    canvas.nodes.every((node) => node.data.configurationIssues.length === 0),
    true,
  );
  assert.equal(
    saved.nodes.find((node) => node.id === "resolve-result-rows")
      .data.target.identifierValue,
    "#results-table tbody tr.result-row",
  );
  assert.deepEqual(
    [...new Set(saved.edges.map((edge) => edge.sourceHandle))].sort(),
    [
      GraphEdgeHandles.Error,
      GraphEdgeHandles.Success,
      GraphEdgeHandles.Unresolved,
    ].sort(),
  );
  assert.deepEqual(prepared.executionPlan.workflow, saved);
  assert.deepEqual(
    prepared.executionPlan.nodeInvocations
      .filter((node) => node.type === "element.resolve")
      .map((node) => node.version),
    [1, 1, 1],
  );
});
