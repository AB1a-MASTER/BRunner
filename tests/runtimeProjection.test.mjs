import assert from "node:assert/strict";
import { test } from "node:test";

import {
  projectRuntimeState,
  summarizeExecution,
} from "../BRunner/studio-graph-src/src/runtimeProjection.js";

const nodes = ["one", "two", "three"].map((id) => ({ id, data: {} }));

test("runtime projection distinguishes completed, skipped, and running nodes", () => {
  const projected = projectRuntimeState(nodes, {
    status: "running",
    currentNodeId: "three",
    completedNodeIds: ["one"],
    skippedNodeIds: ["two"],
  });

  assert.deepEqual(
    projected.map((node) => node.data.runtimeStatus),
    ["completed", "skipped", "running"],
  );
  assert.equal(projected.every((node) => node.data.executionLocked), true);
});

test("failed and cancelled current nodes receive distinct states", () => {
  assert.equal(projectRuntimeState(nodes, {
    status: "failed",
    currentNodeId: "two",
  })[1].data.runtimeStatus, "failed");

  assert.equal(projectRuntimeState(nodes, {
    status: "cancelled",
    currentNodeId: "two",
  })[1].data.runtimeStatus, "cancelled");
});

test("execution summaries include completed and bypassed counts", () => {
  assert.equal(summarizeExecution({
    status: "completed",
    completedNodeIds: ["one", "three"],
    skippedNodeIds: ["two"],
  }), "Completed 2 · bypassed 1");
  assert.equal(summarizeExecution({ status: "failed", error: "Target missing" }), "Target missing");
});
