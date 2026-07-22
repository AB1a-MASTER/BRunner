import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

test("Sequential Studio uses shared identity, density, and one command bar", async () => {
  const html = await readFile(new URL("BRunner/studio/index.html", root), "utf8");
  const css = await readFile(new URL("BRunner/studio/style.css", root), "utf8");

  assert.match(html, /icon2\.png/);
  assert.match(html, /Sequential Studio/);
  assert.match(html, /id="connection-status"[^>]*host-connection/);
  assert.match(html, /id="studio-density"/);
  assert.match(html, /id="workflow-description"/);
  assert.match(html, /id="btn-toggle-palette"/);
  assert.match(html, /id="btn-collapse-palette"/);
  assert.equal(html.includes('class="status-bar"'), false);
  assert.match(css, /var\(--studio-panel-width-scale\)/);
  assert.match(css, /var\(--studio-control-height\)/);
  assert.match(css, /var\(--studio-density-scale\)/);
  assert.match(css, /\.palette\.collapsed/);
  assert.match(css, /\.workflow-manager\.collapsed/);
  assert.match(css, /\.node-guidance/);
});

test("sidebar keeps workflow failures out of extension-level error styling", async () => {
  const [source, html] = await Promise.all([
    readFile(new URL("BRunner/sidebar/sidebar.js", root), "utf8"),
    readFile(new URL("BRunner/sidebar/sidebar.html", root), "utf8"),
  ]);

  assert.match(source, /Workflow failed\. See Studio diagnostics\/logs\./);
  assert.match(source, /isWorkflowExecutionFailure/);
  assert.match(source, /GetNativePairing/);
  assert.match(source, /PairNativeProfile/);
  assert.match(source, /UnpairNativeProfile/);
  assert.match(html, /host-pairing-status/);
  assert.match(html, /host-profile-instance-id/);
  assert.match(html, /btn-pair-profile/);
  assert.match(html, /btn-unpair-profile/);
  assert.doesNotMatch(source, /setSelectedLabel\(`Failed: \$\{execution\.error\}`, true\)/);
});

test("Sequential Studio preserves description and dirty save state", async () => {
  const source = await readFile(new URL("BRunner/studio/app.js", root), "utf8");

  assert.match(source, /workflowDescriptionInput/);
  assert.match(source, /STUDIO_SESSION_KEY/);
  assert.match(source, /wireStudioSessionSync/);
  assert.match(source, /saveStudioSession/);
  assert.match(source, /applyInitialStudioSession/);
  assert.match(source, /setPanelPreference/);
  assert.match(source, /workflowManagerExpanded/);
  assert.match(source, /getNodeGuidanceHtml/);
  assert.match(source, /How to use/);
  assert.match(source, /workflow\.description = workflowDescriptionInput/);
  assert.match(source, /isWorkflowDirty/);
  assert.match(source, /No unsaved workflow changes/);
  assert.doesNotMatch(source, /workflowNameInput\.value\s*=\s*savedFilename/);
  const runStart = source.indexOf("async function runCurrentWorkflow");
  const runEnd = source.indexOf("function addStepToWorkflow", runStart);
  const runSource = source.slice(runStart, runEnd);
  assert.ok(runStart >= 0 && runEnd > runStart);
  assert.ok(
    runSource.indexOf("validateCurrentWorkflow") < runSource.indexOf("Messages.StartWorkflow"),
    "Sequential Studio must validate before dispatching a workflow",
  );
  assert.match(source, /sequentialViewToCanonicalWorkflow/);
  assert.match(source, /nodeDefinitionsByContract/);
  assert.match(source, /BRunnerNodeAuthoring/);
  assert.equal(/[🔴▶⏹⏳📂📋🗑]/u.test(source), false);
});
