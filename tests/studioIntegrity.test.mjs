import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  createRecoverableGraphDraft,
  createSerializedSaveQueue,
  hashWorkflowSnapshot,
  reconcileGraphSaveResponse,
  savedSnapshotIsCurrent,
} from "../BRunner/studio-graph-src/src/workflowIntegrity.js";

const root = new URL("../", import.meta.url);

test("workflow fingerprints are stable and revision-aware", () => {
  const first = hashWorkflowSnapshot({ name: "Flow", content: { steps: [], alpha: 1 } });
  const reordered = hashWorkflowSnapshot({ content: { alpha: 1, steps: [] }, name: "Flow" });

  assert.equal(first, reordered);
  assert.equal(savedSnapshotIsCurrent(
    { revision: 3, fingerprint: first },
    { revision: 3, fingerprint: reordered },
  ), true);
  assert.equal(savedSnapshotIsCurrent(
    { revision: 3, fingerprint: first },
    { revision: 4, fingerprint: reordered },
  ), false);
});

test("normalized filenames do not overwrite graph metadata names", () => {
  const submitted = {
    revision: 8,
    workflowName: "Human Name",
    fingerprint: hashWorkflowSnapshot({
      workflowName: "Human Name",
      content: { name: "Human Name", nodes: [], edges: [] },
    }),
  };
  const current = { revision: submitted.revision, fingerprint: submitted.fingerprint };

  const normalized = reconcileGraphSaveResponse({
    submitted,
    current,
    savedFilename: "human-name.json",
  });
  assert.equal(normalized.submittedStillCurrent, true);
  assert.equal(normalized.normalizedWorkflowName, "Human Name");
  assert.equal(normalized.applyResponseWorkflowName, false);
  assert.equal(normalized.responseChangesWorkflowName, false);
  assert.equal(normalized.clearDirty, true);
  assert.equal(normalized.reason, "saved");

  const explicitUnchangedName = reconcileGraphSaveResponse({
    submitted,
    current,
    savedFilename: "human-name.json",
    responseWorkflowName: "Human Name",
  });
  assert.equal(explicitUnchangedName.clearDirty, true);

  const explicitChangedName = reconcileGraphSaveResponse({
    submitted,
    current,
    savedFilename: "human-name.json",
    responseWorkflowName: "Host Name",
  });
  assert.equal(explicitChangedName.applyResponseWorkflowName, true);
  assert.equal(explicitChangedName.responseChangesWorkflowName, true);
  assert.equal(explicitChangedName.clearDirty, false);
  assert.equal(explicitChangedName.reason, "response_normalized_name");

  const newerEdits = reconcileGraphSaveResponse({
    submitted,
    current: { revision: 9, fingerprint: submitted.fingerprint },
    savedFilename: "human-name.json",
  });
  assert.equal(newerEdits.applyResponseWorkflowName, false);
  assert.equal(newerEdits.clearDirty, false);
  assert.equal(newerEdits.reason, "newer_edits");
});

test("save queue serializes tasks and continues after a failed task", async () => {
  const queue = createSerializedSaveQueue();
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });

  const first = queue.enqueue(async () => {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
  });
  const failed = queue.enqueue(async () => {
    events.push("failed:start");
    throw new Error("host unavailable");
  });
  const third = queue.enqueue(async () => {
    events.push("third:start");
  });

  await Promise.resolve();
  assert.deepEqual(events, ["first:start"]);
  assert.equal(queue.pending, 3);
  releaseFirst();
  await first;
  await assert.rejects(failed, /host unavailable/);
  await third;
  assert.deepEqual(events, ["first:start", "first:end", "failed:start", "third:start"]);
  assert.equal(queue.pending, 0);
});

test("recoverable graph drafts omit callbacks but retain generic graph state", () => {
  const draft = createRecoverableGraphDraft({
    revision: 7,
    loadedFilename: "Flow.json",
    workflowName: "Flow",
    metadata: { description: "Draft" },
    nodes: [{
      id: "one",
      data: {
        type: "element.click",
        definition: { type: "element.click", label: "large registry metadata" },
        config: { value: "x" },
        onMutate() {},
      },
    }],
    edges: [{ id: "edge", data: { onMutate() {} } }],
    updatedAt: "2026-07-14T00:00:00.000Z",
  });

  assert.equal(draft.revision, 7);
  assert.equal(draft.nodes[0].data.config.value, "x");
  assert.deepEqual(draft.nodes[0].data.definition, { type: "element.click" });
  assert.equal("onMutate" in draft.nodes[0].data, false);
  assert.equal("onMutate" in draft.edges[0].data, false);
});

test("Graph Studio guards drafts and exposes controls on narrow screens", async () => {
  const [graph, graphCss] = await Promise.all([
    readFile(new URL("BRunner/studio-graph-src/src/GraphStudio.jsx", root), "utf8"),
    readFile(new URL("BRunner/studio-graph-src/src/studio.css", root), "utf8"),
  ]);

  assert.match(graph, /beforeunload/);
  assert.match(graph, /Recover unsaved/);
  assert.match(graph, /hashWorkflowSnapshot/);
  assert.match(graph, /revision/);
  assert.match(graph, /createSerializedSaveQueue/);
  assert.match(graph, /reconcileGraphSaveResponse/);
  assert.match(
    graph,
    /if \(reconciliation\.responseChangesWorkflowName\) \{\s*mutationRevisionRef\.current \+= 1;/,
  );
  assert.match(
    graph,
    /if \(reconciliation\.clearDirty\) \{\s*dirtyRef\.current = false;/,
  );
  assert.match(graph, /dirtyRef\.current = false;[\s\S]{0,180}clearRecoverableDraft/);
  assert.match(
    graph,
    /if \(loadedFilename === selectedFile\) \{\s*setLoadedFilename\(""\);\s*markDirty\(\);/,
  );
  assert.match(
    graph,
    /if \(readOnly && loadedFilename === selectedFile\) \{[\s\S]{0,220}Upgrade this legacy workflow before deleting/,
  );
  assert.match(graphCss, /\.properties-panel[\s\S]*position:\s*absolute/);
  assert.match(graph, /aria-label="Save workflow changes"/);
  assert.doesNotMatch(graph, /onOpenSequential/);
});
