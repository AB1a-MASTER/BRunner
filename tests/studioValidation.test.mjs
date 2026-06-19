import assert from "node:assert/strict";
import { test } from "node:test";

await import("../BRunner/studio/studioValidation.js");

const {
  collectAvailableVariableNames,
  extractExpressionNames,
  getLastRunOutputSample,
  validateWorkflow,
} =
  globalThis.BRunnerStudioValidation;

const definitions = [
  {
    type: "data.set",
    targetRequired: false,
    config: [
      { key: "variableName", label: "Output Variable", required: true },
      { key: "value", label: "Value", required: true },
    ],
  },
  {
    type: "element.type",
    targetRequired: true,
    config: [{ key: "value", label: "Text", required: true }],
  },
];

test("expression extraction visits nested structured values", () => {
  assert.deepEqual(
    extractExpressionNames({ body: ["{{user.name}}", "ID {{ user.id }}"] }),
    ["user.name", "user.id"],
  );
});

test("autocomplete variables include seeds and preceding outputs only", () => {
  const workflow = {
    variables: { seed_name: "BRunner" },
    steps: [
      { action: "data.set", config: { variableName: "first", value: "ready" } },
      { action: "data.set", config: { variableName: "later", value: "pending" } },
    ],
  };

  assert.deepEqual(collectAvailableVariableNames(workflow, 1), ["first", "seed_name"]);
  assert.deepEqual(collectAvailableVariableNames(workflow, 0), ["seed_name"]);
});

test("validation reports required target and field errors", () => {
  const issues = validateWorkflow({
    variables: {},
    steps: [{ id: "type_1", action: "element.type", target: "", value: "" }],
  }, definitions);

  assert.deepEqual(issues.map((issue) => issue.fieldKey), ["target", "value"]);
});

test("validation rejects forward and missing variable references", () => {
  const issues = validateWorkflow({
    variables: { seed: "ok" },
    steps: [
      {
        id: "first",
        action: "data.set",
        config: { variableName: "result", value: "{{later.value}} {{seed}}" },
      },
      {
        id: "second",
        action: "data.set",
        config: { variableName: "later", value: { value: 2 } },
      },
    ],
  }, definitions);

  assert.equal(issues.length, 1);
  assert.equal(issues[0].fieldKey, "value");
  assert.match(issues[0].message, /later\.value/);
});

test("validation accepts nested references from preceding outputs", () => {
  const issues = validateWorkflow({
    variables: {},
    steps: [
      { action: "data.set", config: { variableName: "record", value: { id: 3 } } },
      { action: "data.set", config: { variableName: "result", value: "{{record.id}}" } },
    ],
  }, definitions);

  assert.deepEqual(issues, []);
});

test("validation rejects unsafe output names", () => {
  const issues = validateWorkflow({
    variables: {},
    steps: [
      { action: "data.set", config: { variableName: "bad name", value: "ready" } },
    ],
  }, definitions);

  assert.equal(issues.length, 1);
  assert.equal(issues[0].fieldKey, "variableName");
});

test("last-run output samples preserve falsy values", () => {
  const step = {
    action: "data.set",
    config: { variableName: "count", value: "0" },
  };

  assert.deepEqual(getLastRunOutputSample(step, { count: 0 }), {
    name: "count",
    hasValue: true,
    value: 0,
  });
  assert.equal(getLastRunOutputSample(step, {}).hasValue, false);
});
