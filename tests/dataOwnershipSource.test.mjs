import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

test("extension logging and mapper diagnostics retain ordinary local user data", async () => {
  const sources = await Promise.all([
    "BRunner/background.js",
    "BRunner/content/mapper.js",
    "BRunner/core/mapperCoordinator.js",
    "BRunner/core/screenshot.js",
    "BRunner/mapper/core.js",
    "BRunner/mapper-inspector/app.js",
  ].map((path) => readFile(new URL(path, root), "utf8")));

  for (const source of sources) {
    assert.doesNotMatch(source, /\[REDACTED(?: URL)?\]/i);
    assert.doesNotMatch(source, /redactSensitive|sensitiveSite|redactMapper/i);
  }
  assert.match(sources[0], /Executing step[\s\S]{0,220}nodeId:/);
  assert.doesNotMatch(
    sources[0],
    /Executing step[\s\S]{0,140},\s*resolvedStep\s*,?\s*\)/,
  );
});
