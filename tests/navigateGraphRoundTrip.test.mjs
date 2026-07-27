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
import { validateNavigateConfig } from "../BRunner/nodes/navigation/navigate/index.js";

const definitions = getNodeDefinitions();
const navigateDefinition = definitions.find((definition) => (
  definition.type === "browser.navigate" && definition.version === 2
));

function prepareForBackground(workflow) {
  return prepareWorkflowForExecution(workflow, {
    validateFinalizedConfig: (config, context) => (
      context.definition.type === "browser.navigate" &&
      context.definition.version === 2
        ? validateNavigateConfig(config, { allowExpressions: true })
        : { valid: true, config, errors: [] }
    ),
  });
}

test("Navigate survives Graph edit, save, reload, validation, autocomplete, and execution planning", () => {
  const input = {
    schemaVersion: WorkflowSchemaVersion.MapperGraph,
    id: "navigate-complete-round-trip",
    name: "Navigate complete round trip",
    description: "B12 semantic parity fixture.",
    boundDomain: "example.com",
    variables: {
      accountId: 42,
      retryDelay: 250,
      timeoutMs: 4500,
    },
    datasets: { accounts: [{ id: 42 }] },
    dataSources: [{
      id: "accounts",
      format: "json",
      relativePath: "accounts.json",
    }],
    settings: {
      reuseExistingTabs: false,
      graphLayoutDirection: "horizontal",
      mapper: {
        enabled: true,
        captureMode: "static_bounded",
      },
      customRuntimeSetting: { mode: "synthetic" },
    },
    entryNodeId: "open",
    nodes: [
      {
        id: "follow",
        type: "browser.navigate",
        version: 2,
        position: { x: 420, y: 90 },
        config: {
          operation: "reload",
          tabSource: "saved_reference",
          tabReference: "account_tab",
          timeout: 3200,
          onError: "error_port",
          saveOutputAs: "follow_navigation",
        },
        data: {},
      },
      {
        id: "attention",
        type: MapperAttentionNodeType,
        version: 1,
        position: { x: 760, y: 260 },
        config: {},
        data: { systemNode: true },
      },
      {
        id: "open",
        type: "browser.navigate",
        version: 2,
        position: { x: 80, y: 90 },
        config: {
          operation: "goto_url",
          url: "https://example.com/accounts/{{ variables.accountId }}",
          openDestinationIn: "new_tab",
          timeout: "4500",
          retryCount: "2",
          retryDelay: "{{ variables.retryDelay }}",
          saveTabReferenceAs: "account_tab",
          saveOutputAs: "open_navigation",
          onError: "fail",
        },
        data: { auditTag: "entry" },
      },
    ],
    edges: [
      {
        id: "open-follow",
        source: "open",
        sourceHandle: GraphEdgeHandles.Success,
        target: "follow",
        targetHandle: GraphEdgeHandles.Input,
      },
      {
        id: "follow-attention",
        source: "follow",
        sourceHandle: GraphEdgeHandles.Error,
        target: "attention",
        targetHandle: GraphEdgeHandles.Input,
      },
    ],
    acceptance: {
      schemaVersion: 1,
      catalogOrder: 1,
      synthetic: true,
    },
    customMetadata: { owner: "B12" },
  };
  const inputSnapshot = structuredClone(input);

  const firstCanvas = workflowToCanvas(input, definitions);
  assert.equal(
    firstCanvas.nodes.every((node) => (
      node.data.configurationIssues.length === 0
    )),
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
  assert.deepEqual(input, inputSnapshot);
  assert.equal(firstSave.schemaVersion, WorkflowSchemaVersion.MapperGraph);
  assert.equal(firstSave.entryNodeId, "open");
  assert.equal(validateGraphWorkflow(firstSave).valid, true);
  assert.deepEqual(firstSave.acceptance, input.acceptance);
  assert.deepEqual(firstSave.customMetadata, input.customMetadata);
  assert.equal(firstSave.settings.graphLayoutDirection, "horizontal");
  assert.deepEqual(
    firstSave.settings.customRuntimeSetting,
    { mode: "synthetic" },
  );
  assert.deepEqual(
    firstSave.nodes.map((node) => [
      node.id,
      node.type,
      node.version,
      node.position,
    ]),
    [
      ["follow", "browser.navigate", 2, { x: 420, y: 90 }],
      ["attention", MapperAttentionNodeType, 1, { x: 760, y: 260 }],
      ["open", "browser.navigate", 2, { x: 80, y: 90 }],
    ],
  );
  assert.deepEqual(firstSave.edges, input.edges);
  assert.deepEqual(
    firstSave.nodes.find((node) => node.id === "open").data,
    { auditTag: "entry" },
  );
  assert.deepEqual(
    firstSave.nodes.find((node) => node.id === "follow").data,
    {},
  );
  assert.equal(
    firstSave.nodes.find((node) => node.id === "open").config.timeout,
    4500,
  );
  assert.equal(
    firstSave.nodes.find((node) => node.id === "open").config.retryCount,
    2,
  );
  assert.equal(
    firstSave.nodes.find((node) => node.id === "open").config.retryDelay,
    "{{ variables.retryDelay }}",
  );

  const autocomplete = createNodeAutocompleteContext({
    currentNodeId: "follow",
    entryNodeId: secondCanvas.metadata.entryNodeId,
    nodes: secondCanvas.nodes,
    edges: secondCanvas.edges,
    variables: secondCanvas.metadata.variables,
    dataSources: secondCanvas.metadata.dataSources,
  });
  assert.deepEqual(autocomplete.nodeIds, ["open"]);
  assert.equal(autocomplete.variables.accountId, true);
  assert.equal(autocomplete.variables.open_navigation, true);
  assert.deepEqual(autocomplete.tabReferences, ["account_tab"]);

  const urlField = navigateDefinition.config.find((field) => field.key === "url");
  const tabReferenceField = navigateDefinition.config.find(
    (field) => field.key === "tabReference",
  );
  const urlOptions = collectFieldAutocompleteOptions(urlField, autocomplete);
  const tabOptions = collectFieldAutocompleteOptions(
    tabReferenceField,
    autocomplete,
  );
  assert.equal(urlOptions.includes("{{ variables.accountId }}"), true);
  assert.equal(urlOptions.includes("{{ nodes.open.output }}"), true);
  assert.equal(urlOptions.includes("{{ nodes.follow.output }}"), false);
  assert.equal(tabOptions.includes("account_tab"), true);

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
    structuredClone(prepared.executionPlan),
    prepared.executionPlan,
  );
  assert.deepEqual(
    prepared.executionPlan.nodeInvocations.map((node) => [
      node.id,
      node.type,
      node.version,
    ]),
    [
      ["follow", "browser.navigate", 2],
      ["attention", MapperAttentionNodeType, 1],
      ["open", "browser.navigate", 2],
    ],
  );
  assert.equal(
    prepared.executionPlan.nodeInvocations
      .find((node) => node.id === "open")
      .config.retryDelay,
    "{{ variables.retryDelay }}",
  );
  assert.deepEqual(
    prepared.executionPlan.nodeInvocations
      .find((node) => node.id === "follow")
      .config.retryOnlyFor,
    ["navigation_failure"],
  );

  const invalid = structuredClone(firstSave);
  invalid.nodes.find((node) => node.id === "open").config.url =
    "search words";
  const invalidCanvas = workflowToCanvas(invalid, definitions);
  assert.equal(
    invalidCanvas.nodes
      .find((node) => node.id === "open")
      .data.configurationIssues
      .some((issue) => issue.fieldKey === "url"),
    true,
  );
  assert.throws(
    () => canvasToGraphWorkflow(
      invalidCanvas.nodes,
      invalidCanvas.edges,
      invalidCanvas.metadata,
    ),
    /absolute URL/,
  );
  assert.throws(
    () => prepareForBackground(invalid),
    (error) => error.code === WorkflowPreparationCodes.ConfigInvalid,
  );
});

test("checked-in Navigate acceptance workflow retains its bounded error route", async () => {
  const source = JSON.parse(await readFile(new URL(
    "../BRunner_Host/Workflows/node_acceptance/001_navigate_acceptance.json",
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
  assert.equal(saved.entryNodeId, "navigate-fixture");
  assert.equal(
    saved.edges.some((edge) => (
      edge.source === "navigate-fixture" &&
      edge.sourceHandle === GraphEdgeHandles.Error &&
      edge.target === "navigate-error-attention"
    )),
    true,
  );
  assert.deepEqual(prepared.executionPlan.workflow, saved);
});

test("Navigate acceptance launcher is root-aware, no-store, and rejects a wrong server", async () => {
  const [launcher, server, workflow, catalog, provisionalCatalog] = await Promise.all([
    readFile(new URL("../start_acceptance_server.ps1", import.meta.url), "utf8"),
    readFile(new URL("../acceptance_fixture_server.py", import.meta.url), "utf8"),
    readFile(new URL(
      "../BRunner_Host/Workflows/node_acceptance/001_navigate_acceptance.json",
      import.meta.url,
    ), "utf8"),
    readFile(new URL("../docs/NODE_USER_CATALOG.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/specs/04_NODE_CATALOG.md", import.meta.url), "utf8"),
  ]);

  assert.match(launcher, /tests\/fixtures\/navigate-acceptance\.html/);
  assert.match(launcher, /\?acceptance=001-navigate-v2/);
  assert.match(launcher, /Test-Path -LiteralPath \$fixturePath -PathType Leaf/);
  assert.match(launcher, /Test-Path -LiteralPath \$serverPath -PathType Leaf/);
  assert.match(launcher, /Get-NetTCPConnection[\s\S]*-LocalPort \$port/);
  assert.match(launcher, /Test-ExpectedFixtureServer -Url \$fixtureUrl/);
  assert.match(
    launcher,
    /data-acceptance="navigate"/,
  );
  assert.match(
    launcher,
    /\$serverPath --port \$port --bind \$bindAddress --directory \$root/,
  );
  assert.match(launcher, /Cache-Control/);
  assert.match(launcher, /no-store/);
  assert.match(server, /class NoStoreHTTPRequestHandler/);
  assert.match(server, /Cache-Control/);
  assert.match(server, /no-store, no-cache, must-revalidate/);
  assert.match(
    workflow,
    /navigate-acceptance\.html\?acceptance=001-navigate-v2/,
  );
  assert.match(catalog, /start_acceptance_server\.ps1/);
  assert.doesNotMatch(
    catalog,
    /python -m http\.server 8765 --bind 127\.0\.0\.1/,
  );
  assert.match(provisionalCatalog, /start_acceptance_server\.ps1/);
  assert.match(
    provisionalCatalog,
    /Do not start[\s\S]*python -m http\.server 8765[\s\S]*wrong directory/,
  );
});
