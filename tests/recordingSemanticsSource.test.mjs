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

test("recorder emits mapper component refs from live DOM facts", async () => {
  const source = await readFile(
    new URL("BRunner/content/mapper.js", root),
    "utf8",
  );

  assert.match(source, /enumerateStaticCandidateElements/);
  assert.match(source, /getOpenDomRoots/);
  assert.match(source, /event\.composedPath/);
  assert.match(source, /buildMapperComponentFact/);
  assert.match(source, /createComponentRef/);
  assert.match(source, /componentRef/);
  assert.match(source, /mapperFact/);
  assert.match(source, /capturedMapVersionId/);
});

test("content execution resolves mapper context before legacy targets", async () => {
  const source = await readFile(
    new URL("BRunner/content/mapper.js", root),
    "utf8",
  );

  assert.match(source, /resolveStepTarget/);
  assert.match(source, /resolveMapperComponentTarget/);
  assert.match(source, /mapperState/);
  assert.match(source, /dynamic_deferred/);
  assert.match(source, /primary_locator_ambiguous/);
  assert.match(source, /mapper_resolved_with_fallback|resolved_with_fallback/);
});

test("wait conditions return mapper diagnostics before generic timeouts", async () => {
  const source = await readFile(
    new URL("BRunner/content/mapper.js", root),
    "utf8",
  );

  assert.match(source, /const waitResult = this\.isWaitConditionSatisfied\(action, step\)/);
  assert.match(source, /Mapper could not resolve wait target/);
  assert.match(source, /this\.createExecutionDiagnostics\(\s*step,\s*waitResult\.resolved,\s*`mapper_\$\{waitResult\.mapperState\}`/);
  assert.match(source, /const resolved = this\.resolveStepTarget\(step, action\)/);
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
