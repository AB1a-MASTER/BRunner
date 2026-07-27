import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

test("service worker gates events on runtime-session rehydration", async () => {
  const background = await readFile(new URL("BRunner/background.js", root), "utf8");

  assert.match(background, /createRuntimeSessionCoordinator/);
  assert.match(background, /runtimeSessionReady = initializeRuntimeLifecycle\(\)/);
  assert.match(background, /await runtimeSessionReady/);
  assert.match(background, /runtimeState\.replaceState/);
  assert.match(background, /recordingController\.restore/);
  assert.match(background, /NativeBridge\.subscribeStatus/);
  assert.match(background, /stale_recording_session/);
  assert.match(background, /stale_execution_session/);
});

test("recording session identity round-trips through content scripts", async () => {
  const [content, controller] = await Promise.all([
    readFile(new URL("BRunner/content/mapper.js", root), "utf8"),
    readFile(new URL("BRunner/core/recordingController.js", root), "utf8"),
  ]);

  assert.match(content, /this\.recordingSessionId/);
  assert.match(content, /sessionId:\s*this\.recordingSessionId/);
  assert.match(content, /recording\?\.sessionId/);
  assert.match(controller, /normalizeRecordingCheckpoint/);
  assert.match(controller, /sessionId,\s*\n\s*boundDomain/);
});

test("runtime checkpoints use session storage and gate host readiness on hello plus pairing", async () => {
  const source = await readFile(
    new URL("BRunner/core/runtimeSession.js", root),
    "utf8",
  );

  assert.match(source, /chrome\?\.storage\?\.session/);
  assert.match(source, /connected && helloAccepted && pairedProfileAccepted/);
  assert.match(source, /service_worker_restart/);
  assert.match(source, /status:\s*"interrupted"/);
});

test("supported execution UIs identify the run they intend to stop", async () => {
  const sources = await Promise.all([
    readFile(new URL("BRunner/sidebar/sidebar.js", root), "utf8"),
    readFile(new URL("BRunner/studio-graph-src/src/GraphStudio.jsx", root), "utf8"),
  ]);

  for (const source of sources) {
    assert.match(source, /type:\s*Messages\.StopWorkflow,[\s\S]{0,100}runId:/);
  }
});
