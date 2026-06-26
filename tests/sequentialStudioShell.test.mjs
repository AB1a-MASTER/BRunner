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
  assert.equal(html.includes('class="status-bar"'), false);
  assert.match(css, /var\(--studio-panel-width-scale\)/);
  assert.match(css, /var\(--studio-control-height\)/);
  assert.match(css, /\.node-guidance/);
});

test("Sequential Studio preserves description and dirty save state", async () => {
  const source = await readFile(new URL("BRunner/studio/app.js", root), "utf8");

  assert.match(source, /workflowDescriptionInput/);
  assert.match(source, /STUDIO_SESSION_KEY/);
  assert.match(source, /wireStudioSessionSync/);
  assert.match(source, /saveStudioSession/);
  assert.match(source, /applyInitialStudioSession/);
  assert.match(source, /getNodeGuidanceHtml/);
  assert.match(source, /How to use/);
  assert.match(source, /workflow\.description = workflowDescriptionInput/);
  assert.match(source, /isWorkflowDirty/);
  assert.match(source, /No unsaved workflow changes/);
  assert.equal(/[🔴▶⏹⏳📂📋🗑]/u.test(source), false);
});
