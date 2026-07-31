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
  prepareNodeConfiguration,
} from "../BRunner/core/nodeAuthoring.js";
import {
  getNodeDefinition,
  getNodeDefinitions,
  resolveNodeDefinition,
} from "../BRunner/core/nodeRegistry.js";
import {
  WorkflowExecutionModels,
  prepareWorkflowForExecution,
} from "../BRunner/core/workflowPreparation.js";
import {
  GraphEdgeHandles,
  MapperAttentionNodeType,
  WorkflowSchemaVersion,
  validateGraphWorkflow,
} from "../BRunner/core/workflowSchema.js";
import {
  validateTabControlConfig,
} from "../BRunner/nodes/navigation/tab-control/index.js";

const definitions = getNodeDefinitions();
const definition = getNodeDefinition("browser.tab.control", 1);

function prepare(workflow) {
  return prepareWorkflowForExecution(workflow, {
    validateFinalizedConfig(config, context) {
      return context.definition.type === "browser.tab.control"
        ? validateTabControlConfig(config, { allowExpressions: true })
        : { valid: true, config, errors: [] };
    },
  });
}

test("Tab Control exact v1 replaces provisional tab authoring contracts", () => {
  assert.equal(definition?.contractKind, "finalized");
  assert.equal(resolveNodeDefinition({
    type: "browser.tab.control",
    version: 1,
  }).catalogNumber, 3);
  for (const type of [
    "browser.tab.switch",
    "browser.tab.open",
    "browser.tab.close",
  ]) {
    assert.equal(getNodeDefinition(type, 1), null);
    assert.throws(
      () => resolveNodeDefinition({ type, version: 1 }),
      (error) => error.code === "NODE_TYPE_UNSUPPORTED",
    );
  }
  assert.throws(
    () => resolveNodeDefinition({
      type: "browser.tab.control",
      version: 2,
    }),
    (error) => error.code === "NODE_VERSION_UNSUPPORTED",
  );
});

test("Tab Control survives Graph edit, save, reload, autocomplete, and background preparation", () => {
  const workflow = {
    schemaVersion: WorkflowSchemaVersion.MapperGraph,
    id: "tab-control-round-trip",
    name: "Tab Control round trip",
    description: "Synthetic exact-contract fixture.",
    boundDomain: "",
    variables: {
      articleUrl: "https://example.com/article",
    },
    datasets: {},
    dataSources: [],
    settings: {
      reuseExistingTabs: false,
      graphLayoutDirection: "horizontal",
      mapper: { enabled: true },
    },
    entryNodeId: "open",
    nodes: [
      {
        id: "open",
        type: "browser.tab.control",
        version: 1,
        position: { x: 80, y: 100 },
        config: {
          operation: "open_url_in_new_tab",
          url: "{{ variables.articleUrl }}",
          openInBackground: true,
          waitUntil: "dom_ready",
          saveTabReferenceAs: "article_tab",
          saveOutputAs: "opened_tab",
        },
        data: { auditTag: "open" },
      },
      {
        id: "switch",
        type: "browser.tab.control",
        version: 1,
        position: { x: 420, y: 100 },
        config: {
          operation: "switch_tab",
          tabSelectorKind: "saved_reference",
          tabSelectorValue: "article_tab",
          ifNotFound: "error_port",
          onError: "error_port",
          saveOutputAs: "switched_tab",
        },
        data: {},
      },
      {
        id: "close",
        type: "browser.tab.control",
        version: 1,
        position: { x: 760, y: 100 },
        config: {
          operation: "close_tab",
          tabSelectorKind: "current",
          closeBehavior: "opener",
          confirmBeforeClose: false,
          onError: "error_port",
        },
        data: {},
      },
      {
        id: "attention",
        type: MapperAttentionNodeType,
        version: 1,
        position: { x: 760, y: 300 },
        config: {},
        data: { systemNode: true },
      },
    ],
    edges: [
      edge("open-switch", "open", "success", "switch"),
      edge("switch-close", "switch", "success", "close"),
      edge("switch-error", "switch", "error", "attention"),
      edge("close-error", "close", "error", "attention"),
    ],
    acceptance: {
      schemaVersion: 1,
      catalogOrder: 3,
      synthetic: true,
    },
  };

  const canvas = workflowToCanvas(workflow, definitions);
  assert.equal(
    canvas.nodes.every((node) => node.data.configurationIssues.length === 0),
    true,
  );
  const saved = canvasToGraphWorkflow(
    canvas.nodes,
    canvas.edges,
    canvas.metadata,
  );
  const reopened = workflowToCanvas(saved, definitions);
  const resaved = canvasToGraphWorkflow(
    reopened.nodes,
    reopened.edges,
    reopened.metadata,
  );
  assert.deepEqual(resaved, saved);
  assert.equal(validateGraphWorkflow(saved).valid, true);
  assert.equal(saved.nodes.find((node) => node.id === "open").data.auditTag, "open");

  const context = createNodeAutocompleteContext({
    currentNodeId: "switch",
    entryNodeId: saved.entryNodeId,
    nodes: reopened.nodes,
    edges: reopened.edges,
    variables: saved.variables,
  });
  assert.deepEqual(context.tabReferences, ["article_tab"]);
  const selectorField = definition.config.find(
    (field) => field.key === "tabSelectorValue",
  );
  assert.equal(
    collectFieldAutocompleteOptions(selectorField, context)
      .includes("article_tab"),
    true,
  );

  const prepared = prepare(saved);
  assert.equal(prepared.executionModel, WorkflowExecutionModels.CanonicalGraph);
  assert.deepEqual(prepared.executionPlan.workflow, saved);
  assert.equal(
    prepared.executionPlan.nodeInvocations
      .find((node) => node.id === "switch")
      .config.tabSelectorValue,
    "article_tab",
  );
});

test("generic authoring validation enforces Tab Control conditional fields", () => {
  const missingSelector = prepareNodeConfiguration({
    operation: "switch_tab",
    tabSelectorKind: "title",
    tabSelectorValue: "",
  }, definition);
  assert.equal(
    missingSelector.issues.some((issue) => issue.fieldKey === "tabSelectorValue"),
    true,
  );

  const missingFolder = prepareNodeConfiguration({
    operation: "bookmark_page",
    tabSelectorKind: "current",
    bookmarkFolderMode: "folder_id",
    bookmarkFolderId: "",
  }, definition);
  assert.equal(
    missingFolder.issues.some((issue) => issue.fieldKey === "bookmarkFolderId"),
    true,
  );

  const irrelevantFolder = prepareNodeConfiguration({
    operation: "switch_tab",
    tabSelectorKind: "current",
    bookmarkFolderMode: "folder_id",
    bookmarkFolderId: "",
  }, definition);
  assert.equal(
    irrelevantFolder.issues.some((issue) => issue.fieldKey === "bookmarkFolderId"),
    false,
  );
});

test("Graph Studio requests optional bookmarks only from a visible click handler", async () => {
  const [source, manifest, recorder, background] = await Promise.all([
    readFile(new URL(
      "../BRunner/studio-graph-src/src/GraphStudio.jsx",
      import.meta.url,
    ), "utf8"),
    readFile(new URL("../BRunner/manifest.json", import.meta.url), "utf8"),
    readFile(new URL(
      "../BRunner/core/recordingController.js",
      import.meta.url,
    ), "utf8"),
    readFile(new URL("../BRunner/background.js", import.meta.url), "utf8"),
  ]);
  const parsedManifest = JSON.parse(manifest);
  assert.equal(parsedManifest.permissions.includes("bookmarks"), false);
  assert.deepEqual(parsedManifest.optional_permissions, ["bookmarks"]);
  assert.match(source, /onClick=\{\(\) => requestPermission\(entry\.permission\)\}/);
  assert.match(source, /globalThis\.chrome\.permissions\.request/);
  assert.match(source, /fieldIsVisible/);
  assert.match(source, /visibleWhenAll/);
  assert.match(recorder, /action: "browser\.tab\.control"/);
  assert.match(recorder, /operation: "switch_tab"/);
  assert.doesNotMatch(recorder, /action: Actions\.BrowserTabSwitch/);
  assert.match(background, /activeRun\.originTab/);
  assert.match(background, /activeRun\.tabCreationSequence/);
  assert.match(background, /executeFinalizedTabControlWorkflowNode/);
  assert.match(background, /\$\{nodeLabel\} execution timed out\./);
});

function edge(id, source, sourceHandle, target) {
  return {
    id,
    source,
    sourceHandle,
    target,
    targetHandle: GraphEdgeHandles.Input,
  };
}
