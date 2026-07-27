import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { isStudioUrl } from "../BRunner/core/workflowUtils.js";

const root = new URL("../", import.meta.url);

test("Graph and retired Studio pages are never automation targets", () => {
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: {
      getURL(path) {
        return `chrome-extension://brunner/${path}`;
      },
    },
  };

  try {
    assert.equal(
      isStudioUrl("chrome-extension://brunner/studio-graph/index.html"),
      true,
    );
    assert.equal(
      isStudioUrl("chrome-extension://brunner/studio-graph/index.html#workflow"),
      true,
    );
    assert.equal(
      isStudioUrl("chrome-extension://brunner/studio/index.html"),
      true,
    );
    assert.equal(
      isStudioUrl("chrome-extension://brunner/studio/legacy-index.html.disabled"),
      true,
    );
    assert.equal(
      isStudioUrl("chrome-extension://brunner/mapper-inspector/index.html"),
      false,
    );
    assert.equal(isStudioUrl("https://example.com/studio/index.html"), false);
  } finally {
    if (previousChrome === undefined) {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = previousChrome;
    }
  }
});

test("sidebar opens and focuses Graph Studio exclusively", async () => {
  const [source, html] = await Promise.all([
    readFile(new URL("BRunner/sidebar/sidebar.js", root), "utf8"),
    readFile(new URL("BRunner/sidebar/sidebar.html", root), "utf8"),
  ]);

  assert.match(
    source,
    /const GRAPH_STUDIO_PATH = "studio-graph\/index\.html";/,
  );
  assert.match(
    source,
    /addEventListener\("click", openGraphStudio\)/,
  );
  assert.match(source, /async function openGraphStudio\(\)/);
  assert.match(source, /tab\?\.url\?\.startsWith\(graphStudioRoot\)/);
  assert.match(source, /chrome\.tabs\.create\(\{\s*url: graphStudioUrl,/);
  assert.match(source, /const STUDIO_CONTROL_ROOTS[\s\S]*"studio-graph\/"[\s\S]*"studio\/"/);
  assert.doesNotMatch(source, /async function openStudio\(\)/);
  assert.match(html, /Open Graph Studio/);
  assert.match(html, /Graph Studio Active/);
});

test("Graph Studio exposes no Sequential navigation or session switching", async () => {
  const source = await readFile(
    new URL("BRunner/studio-graph-src/src/GraphStudio.jsx", root),
    "utf8",
  );

  assert.doesNotMatch(source, /onOpenSequential/);
  assert.doesNotMatch(source, /openSequentialStudio/);
  assert.doesNotMatch(source, /\.\.\/studio\/index\.html/);
  assert.doesNotMatch(source, /StudioKind\.Sequential/);
  assert.doesNotMatch(source, /STUDIO_SESSION_KEY/);
  assert.doesNotMatch(source, /SequenceIcon/);
  assert.match(source, /Change the Graph Studio display size/);
});

test("retired Sequential entry redirects without loading authoring code", async () => {
  const [entryHtml, dormantHtml, manifestText] = await Promise.all([
    readFile(new URL("BRunner/studio/index.html", root), "utf8"),
    readFile(
      new URL("BRunner/studio/legacy-index.html.disabled", root),
      "utf8",
    ),
    readFile(new URL("BRunner/manifest.json", root), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  const resources = manifest.web_accessible_resources.flatMap(
    (entry) => entry.resources || [],
  );

  assert.match(
    entryHtml,
    /http-equiv="refresh" content="0; url=\.\.\/studio-graph\/index\.html"/,
  );
  assert.match(entryHtml, /Sequential Studio is retired/);
  assert.match(entryHtml, /href="\.\.\/studio-graph\/index\.html"/);
  assert.doesNotMatch(entryHtml, /<script\b/i);
  assert.doesNotMatch(entryHtml, /id="btn-(run|record|save)"/);
  assert.doesNotMatch(entryHtml, /src="app\.js"/);

  assert.match(dormantHtml, /Dormant Sequential Studio shell/);
  assert.match(dormantHtml, /Sequential Studio/);
  assert.match(dormantHtml, /id="btn-run"/);
  assert.match(dormantHtml, /src="app\.js"/);

  assert.equal(
    resources.some((resource) => resource.startsWith("studio/")),
    false,
  );
  assert.equal(resources.includes("studio-graph/index.html"), true);
  assert.equal(resources.includes("studio-graph/assets/*"), true);
});
