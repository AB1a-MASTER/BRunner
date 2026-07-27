import assert from "node:assert/strict";
import test from "node:test";

import { NativeBridgeClient } from "../BRunner/core/nativeBridge.js";
import {
  ensureJsonFilename,
  ensureJsonWorkflowReference,
} from "../BRunner/core/workflowUtils.js";

test("workflow references preserve nested repository paths", () => {
  assert.equal(
    ensureJsonWorkflowReference("node_acceptance/001_navigate_acceptance"),
    "node_acceptance/001_navigate_acceptance.json",
  );
  assert.equal(
    ensureJsonWorkflowReference(
      String.raw`node_acceptance\001_navigate_acceptance.json`,
    ),
    "node_acceptance/001_navigate_acceptance.json",
  );
  assert.equal(
    ensureJsonFilename("node_acceptance/001_navigate_acceptance"),
    "node_acceptance_001_navigate_acceptance.json",
  );
});

test("native workflow operations retain source references and sanitize new names", async () => {
  const client = new NativeBridgeClient();
  const requests = [];
  client.request = async (command, payload) => {
    requests.push({ command, payload });
    return payload;
  };

  await client.loadWorkflow("node_acceptance/001_navigate_acceptance");
  await client.saveWorkflow(
    "node_acceptance/001_navigate_acceptance.json",
    { schemaVersion: 3 },
  );
  await client.duplicateWorkflow(
    "node_acceptance/001_navigate_acceptance.json",
    "node_acceptance/copy",
  );
  await client.renameWorkflow(
    "node_acceptance/001_navigate_acceptance.json",
    "renamed",
    { schemaVersion: 3 },
  );

  assert.equal(
    requests[0].payload.filename,
    "node_acceptance/001_navigate_acceptance.json",
  );
  assert.equal(
    requests[1].payload.filename,
    "node_acceptance/001_navigate_acceptance.json",
  );
  assert.equal(
    requests[2].payload.filename,
    "node_acceptance/001_navigate_acceptance.json",
  );
  assert.equal(requests[2].payload.newFilename, "node_acceptance_copy.json");
  assert.equal(
    requests[3].payload.filename,
    "node_acceptance/001_navigate_acceptance.json",
  );
  assert.equal(requests[3].payload.newFilename, "renamed.json");
});
