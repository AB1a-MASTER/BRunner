import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { usesLegacyNavigateEditor } from "../BRunner/studio/navigateEditorPolicy.js";

const root = new URL("../", import.meta.url);

test("dormant legacy editor policy remains isolated from Graph Studio", async () => {
  const [source, graphSource] = await Promise.all([
    readFile(new URL("BRunner/studio/app.js", root), "utf8"),
    readFile(
      new URL("BRunner/studio-graph-src/src/GraphStudio.jsx", root),
      "utf8",
    ),
  ]);

  assert.equal(
    usesLegacyNavigateEditor({ action: "browser.navigate", version: 1 }),
    true,
  );
  assert.equal(
    usesLegacyNavigateEditor({ action: "browser.navigate", version: 2 }),
    false,
  );
  assert.equal(
    usesLegacyNavigateEditor({ action: "browser.navigate" }),
    false,
  );
  assert.match(source, /import \{ usesLegacyNavigateEditor \}/);
  assert.equal(
    (source.match(/usesLegacyNavigateEditor\(/g) || []).length >= 4,
    true,
  );
  assert.doesNotMatch(
    source,
    /if \(step\.action === Actions\.BrowserNavigate\) \{\s*html \+=/,
  );
  assert.doesNotMatch(graphSource, /navigateEditorPolicy/);
  assert.doesNotMatch(graphSource, /usesLegacyNavigateEditor/);
});
