import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

import { FinalizedNodeCatalog } from "../BRunner/nodes/catalog.js";
import {
  GraphEdgeHandles,
  MapperAttentionNodeType,
} from "../BRunner/core/workflowSchema.js";
import {
  expectedNodeAcceptanceFilename,
  validateNodeAcceptanceWorkflow,
} from "../BRunner/nodes/acceptanceWorkflow.js";

const root = new URL("../", import.meta.url);
const acceptanceDirectory = new URL(
  "BRunner_Host/Workflows/node_acceptance/",
  root,
);

function validWorkflow(catalogNode = FinalizedNodeCatalog[0]) {
  return {
    schemaVersion: 3,
    id: `acceptance-${catalogNode.order}`,
    name: `${catalogNode.name} Acceptance`,
    description: "Synthetic focused node acceptance.",
    boundDomain: "",
    settings: { mapper: { enabled: true } },
    variables: {},
    datasets: {},
    dataSources: [],
    entryNodeId: "subject",
    nodes: [{
      id: "subject",
      type: catalogNode.type,
      version: catalogNode.version,
      position: { x: 120, y: 100 },
      config: {},
      data: {},
    }],
    edges: [],
    acceptance: {
      schemaVersion: 1,
      catalogOrder: catalogNode.order,
      nodeType: catalogNode.type,
      nodeVersion: catalogNode.version,
      synthetic: true,
      primaryBehavior: "Exercise the primary behavior.",
      expectedOutputKeys: ["success"],
      safeFailureOrAlternate: "Exercise a safe error route.",
      fixturePaths: ["tests/fixtures/acceptance.html"],
    },
  };
}

test("acceptance workflow contract binds filename, catalog identity, and exact node version", () => {
  const catalogNode = FinalizedNodeCatalog[0];
  const filename = expectedNodeAcceptanceFilename(catalogNode);
  const result = validateNodeAcceptanceWorkflow({
    filename,
    workflow: validWorkflow(catalogNode),
    catalogNode,
  });

  assert.equal(filename, "001_navigate_acceptance.json");
  assert.deepEqual(result, { valid: true, errors: [] });
});

test("acceptance workflow validation fails closed on identity, fixture, and metadata errors", () => {
  const catalogNode = FinalizedNodeCatalog[0];
  const workflow = validWorkflow(catalogNode);
  workflow.acceptance.nodeVersion = 1;
  workflow.acceptance.synthetic = false;
  workflow.acceptance.fixturePaths = ["../private.txt"];

  const result = validateNodeAcceptanceWorkflow({
    filename: "001_wrong_acceptance.json",
    workflow,
    catalogNode,
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /Filename must be 001_navigate/);
  assert.match(result.errors.join(" "), /nodeVersion must be 2/);
  assert.match(result.errors.join(" "), /synthetic must be true/);
  assert.match(result.errors.join(" "), /cannot traverse upward/);
});

test("every checked-in node acceptance workflow matches its catalog row and schema", async () => {
  const filenames = (await readdir(acceptanceDirectory))
    .filter((name) => name.endsWith("_acceptance.json"))
    .sort();

  for (const filename of filenames) {
    const order = Number(filename.slice(0, 3));
    const catalogNode = FinalizedNodeCatalog.find((entry) => entry.order === order);
    assert.ok(catalogNode, `${filename} has no finalized catalog row`);
    const workflow = JSON.parse(
      await readFile(new URL(filename, acceptanceDirectory), "utf8"),
    );
    const result = validateNodeAcceptanceWorkflow({ filename, workflow, catalogNode });
    assert.deepEqual(result.errors, [], `${filename}: ${result.errors.join(" ")}`);
    for (const fixturePath of workflow.acceptance.fixturePaths) {
      await readFile(new URL(fixturePath, root));
    }
  }
});

test("Navigate acceptance failure uses the executable Graph attention route", async () => {
  const workflow = JSON.parse(await readFile(
    new URL("001_navigate_acceptance.json", acceptanceDirectory),
    "utf8",
  ));
  const errorEdge = workflow.edges.find(
    (edge) => edge.sourceHandle === GraphEdgeHandles.Error,
  );
  const target = workflow.nodes.find((node) => node.id === errorEdge?.target);

  assert.equal(errorEdge?.source, "navigate-fixture");
  assert.equal(target?.type, MapperAttentionNodeType);
  assert.equal(target?.data?.systemNode, true);
});

test("Scroll acceptance is bounded, target-specific, and routes safe failures", async () => {
  const [workflow, fixture] = await Promise.all([
    readFile(
      new URL("002_scroll_acceptance.json", acceptanceDirectory),
      "utf8",
    ).then(JSON.parse),
    readFile(new URL(
      "tests/fixtures/scroll-acceptance.html",
      root,
    ), "utf8"),
  ]);
  const subject = workflow.nodes.find(
    (node) => node.id === "scroll-fixture-panel",
  );
  const routedHandles = workflow.edges
    .filter((edge) => edge.source === subject?.id)
    .map((edge) => edge.sourceHandle)
    .sort();
  const routeTargets = workflow.edges.map((edge) => (
    workflow.nodes.find((node) => node.id === edge.target)
  ));

  assert.equal(subject?.type, "browser.scroll");
  assert.equal(subject?.version, 2);
  assert.equal(subject?.config.operation, "until_condition");
  assert.equal(subject?.config.scrollTarget, "container");
  assert.equal(subject?.config.maxAttempts, 12);
  assert.equal(subject?.config.stopCondition, "scroll_end");
  assert.equal(subject?.config.useHostFallback, false);
  assert.equal(
    subject?.data.target.identifierValue,
    "#acceptance-scroll-panel",
  );
  assert.deepEqual(routedHandles, [
    GraphEdgeHandles.Error,
    GraphEdgeHandles.Unresolved,
  ].sort());
  assert.equal(
    routeTargets.every((target) => (
      target?.type === MapperAttentionNodeType &&
      target?.data?.systemNode === true
    )),
    true,
  );
  assert.match(fixture, /data-acceptance="scroll"/);
  assert.match(fixture, /id="acceptance-scroll-panel"/);
  assert.match(fixture, /Scroll acceptance complete/);
});

test("Tab Control acceptance is reversible, origin-safe, and ends with a deliberate skip", async () => {
  const workflow = JSON.parse(await readFile(
    new URL("003_tab_control_acceptance.json", acceptanceDirectory),
    "utf8",
  ));
  const nodes = new Map(workflow.nodes.map((node) => [node.id, node]));
  const subjectNodes = workflow.nodes.filter(
    (node) => node.type === "browser.tab.control",
  );
  const operations = subjectNodes.map((node) => node.config.operation);

  assert.deepEqual(operations, [
    "open_url_in_new_tab",
    "switch_tab",
    "pin_tab",
    "unpin_tab",
    "mute_tab",
    "unmute_tab",
    "close_tab",
    "return_to_origin_tab",
    "switch_tab",
  ]);
  assert.equal(
    nodes.get("open-background-fixture").config.openInBackground,
    true,
  );
  assert.equal(
    nodes.get("open-background-fixture").config.saveTabReferenceAs,
    "tab_control_acceptance",
  );
  assert.equal(
    nodes.get("switch-saved-fixture").config.tabSelectorValue,
    "tab_control_acceptance",
  );
  assert.equal(nodes.get("close-fixture").config.closeBehavior, "opener");
  assert.equal(nodes.get("close-fixture").config.confirmBeforeClose, false);
  assert.equal(nodes.get("safe-missing-tab").config.ifNotFound, "skip");
  assert.equal(nodes.get("safe-missing-tab").config.retryCount, 0);
  assert.equal(
    workflow.acceptance.safeFailureOrAlternate.includes("persistent browser data"),
    true,
  );
  const errorTargets = workflow.edges
    .filter((edge) => edge.sourceHandle === GraphEdgeHandles.Error)
    .map((edge) => nodes.get(edge.target));
  assert.equal(
    errorTargets.every((node) => (
      node?.type === MapperAttentionNodeType &&
      node?.data?.systemNode === true
    )),
    true,
  );
});

test("Resolve Element acceptance is read-only, bounded, and routes an absent target", async () => {
  const workflow = JSON.parse(await readFile(
    new URL("004_resolve_element_acceptance.json", acceptanceDirectory),
    "utf8",
  ));
  const nodes = new Map(workflow.nodes.map((node) => [node.id, node]));
  const subjectNodes = workflow.nodes.filter(
    (node) => node.type === "element.resolve",
  );

  assert.deepEqual(
    subjectNodes.map((node) => [node.config.mode, node.config.resultCardinality]),
    [
      ["resolve_known", "one"],
      ["find_dynamic", "all"],
      ["find_dynamic", "one"],
    ],
  );

  // Every subject node must carry an explicit target; this node never runs
  // without one.
  assert.equal(
    subjectNodes.every((node) => (
      typeof node.data?.target?.identifierValue === "string" &&
      node.data.target.identifierValue.trim().length > 0
    )),
    true,
  );

  // Enumerating cardinalities require an explicit CSS or XPath selector so the
  // complete candidate set is knowable.
  assert.equal(
    subjectNodes
      .filter((node) => node.config.resultCardinality !== "one")
      .every((node) => ["css", "xpath"].includes(node.data.target.identifierType)),
    true,
  );

  assert.equal(
    nodes.get("resolve-results-table").data.target.identifierValue,
    "#results-table",
  );
  assert.equal(
    nodes.get("resolve-result-rows").data.target.identifierValue,
    "#results-table tbody tr.result-row",
  );
  assert.equal(
    nodes.get("resolve-absent-element").data.target.identifierValue,
    "#absent-element",
  );
  assert.equal(nodes.get("resolve-absent-element").config.retryCount, 0);

  // Ambiguity is never resolved by guessing, in any node.
  assert.equal(
    subjectNodes.every((node) => node.config.ambiguityPolicy === "fail"),
    true,
  );

  // Both the error and unresolved handles must reach Needs Attention.
  for (const handle of [GraphEdgeHandles.Error, GraphEdgeHandles.Unresolved]) {
    const targets = workflow.edges
      .filter((edge) => edge.sourceHandle === handle)
      .map((edge) => nodes.get(edge.target));
    assert.equal(targets.length, subjectNodes.length);
    assert.equal(
      targets.every((node) => (
        node?.type === MapperAttentionNodeType &&
        node?.data?.systemNode === true
      )),
      true,
    );
  }
});
