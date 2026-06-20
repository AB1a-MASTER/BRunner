import assert from "node:assert/strict";
import { test } from "node:test";

import {
  filterExecutionLogs,
  projectRuntimeState,
  summarizeExecution,
  summarizeExecutionLogs,
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

test("runtime projection carries transient navigation edit locks", () => {
  const projected = projectRuntimeState(nodes, { status: "idle" }, false, true);
  assert.equal(projected.every((node) => node.data.navigationLocked), true);
  assert.equal(projected.every((node) => node.data.executionLocked === false), true);
});

test("execution summaries include completed and bypassed counts", () => {
  assert.equal(summarizeExecution({
    status: "completed",
    completedNodeIds: ["one", "three"],
    skippedNodeIds: ["two"],
  }), "Completed 2 · bypassed 1");
  assert.equal(summarizeExecution({ status: "failed", error: "Target missing" }), "Target missing");
});

test("execution history supports node filtering and clear summaries", () => {
  const logs = [
    { id: "1", scope: "node", nodeId: "one", status: "completed" },
    { id: "2", scope: "node", nodeId: "two", status: "skipped" },
    { id: "3", scope: "run", nodeId: "", status: "completed" },
  ];

  assert.deepEqual(filterExecutionLogs(logs, "two"), [logs[1]]);
  assert.deepEqual(summarizeExecutionLogs(logs), {
    events: 3,
    completed: 1,
    skipped: 1,
    failed: 0,
  });
});
