import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

import { FinalizedNodeCatalog } from "../BRunner/nodes/catalog.js";
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
