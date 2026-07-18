import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  upgradeWorkflowToV2,
  validateGraphWorkflow,
} from "../BRunner/core/workflowSchema.js";
import {
  VariableRegistry,
  resolveStepExpressions,
} from "../BRunner/core/variableRegistry.js";

const workflow = JSON.parse(await readFile(
  new URL(
    "../BRunner_Host/Workflows/extension_host_roundtrip_verification.json",
    import.meta.url,
  ),
  "utf8",
));

test("extension-host round-trip workflow is a valid linear workflow", () => {
  assert.equal(
    workflow.boundDomain,
    "http://127.0.0.1:8765/BRunner_Host/test.html",
  );
  assert.deepEqual(
    workflow.steps.map((step) => step.action),
    [
      "browser.navigate",
      "approved.file.write",
      "approved.files.find",
      "element.type",
    ],
  );
  assert.equal(new Set(workflow.steps.map((step) => step.id)).size, 4);

  const graph = upgradeWorkflowToV2(workflow, {
    id: "extension-host-roundtrip-verification",
  });
  assert.deepEqual(validateGraphWorkflow(graph), { valid: true, errors: [] });
  assert.equal(graph.nodes.length, 4);
  assert.equal(graph.edges.length, 3);
});

test("host replies drive the next request and visible verification value", () => {
  const findStep = workflow.steps.find(
    (step) => step.id === "roundtrip_host_to_extension_find",
  );
  const renderStep = workflow.steps.find(
    (step) => step.id === "roundtrip_render_host_response",
  );
  const registry = new VariableRegistry({
    roundtrip_write: {
      filename: "extension-host-roundtrip.txt",
    },
    roundtrip_find: {
      files: [{ filename: "extension-host-roundtrip.txt" }],
      count: 1,
    },
  });

  const resolvedFind = resolveStepExpressions(findStep, registry);
  const resolvedRender = resolveStepExpressions(renderStep, registry);

  assert.equal(resolvedFind.config.pattern, "extension-host-roundtrip.txt");
  assert.equal(
    resolvedRender.config.value,
    "extension-host-roundtrip.txt | extension-host-roundtrip.txt | 1",
  );
  assert.equal(resolvedRender.config.value, resolvedRender.config.verificationText);
});
