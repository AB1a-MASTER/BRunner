import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

test("recorder captures dropdowns as semantic select steps", async () => {
  const source = await readFile(
    new URL("BRunner/content/mapper.js", root),
    "utf8",
  );

  assert.match(source, /Actions\.ElementSelect/);
  assert.match(source, /getSelectedOptionText/);
  assert.match(source, /optionText/);
  assert.match(source, /optionValue/);
  assert.match(source, /optionIndex/);
  assert.match(source, /value:\s*this\.getSelectedOptionText\(element\) \|\| value/);
});

test("recorded targets prefer user-facing semantics before structural selectors", async () => {
  const source = await readFile(
    new URL("BRunner/content/targetResolver.js", root),
    "utf8",
  );

  assert.match(source, /TargetStrategies\.AriaLabel[\s\S]*110/);
  assert.match(source, /TargetStrategies\.LabelText[\s\S]*108/);
  assert.match(source, /TargetStrategies\.Text[\s\S]*104/);
  assert.match(source, /"role_text"[\s\S]*102/);
  assert.match(source, /TargetStrategies\.Id[\s\S]*92/);
  assert.match(source, /TargetStrategies\.CssSelector[\s\S]*68/);
});
