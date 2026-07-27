import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

test("retired Sequential source remains dormant for C12 cleanup", async () => {
  const [entry, dormantShell, app, css] = await Promise.all([
    readFile(new URL("BRunner/studio/index.html", root), "utf8"),
    readFile(
      new URL("BRunner/studio/legacy-index.html.disabled", root),
      "utf8",
    ),
    readFile(new URL("BRunner/studio/app.js", root), "utf8"),
    readFile(new URL("BRunner/studio/style.css", root), "utf8"),
  ]);

  assert.match(entry, /Sequential Studio is retired/);
  assert.match(entry, /\.\.\/studio-graph\/index\.html/);
  assert.doesNotMatch(entry, /src="app\.js"/);
  assert.match(dormantShell, /Dormant Sequential Studio shell/);
  assert.match(dormantShell, /src="app\.js"/);
  assert.match(app, /async function runCurrentWorkflow/);
  assert.match(css, /var\(--studio-panel-width-scale\)/);
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
  assert.doesNotMatch(
    source,
    /setSelectedLabel\(`Failed: \$\{execution\.error\}`, true\)/,
  );
});
