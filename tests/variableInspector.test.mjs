import assert from "node:assert/strict";
import { test } from "node:test";

import {
  inferOutputVariableName,
  summarizeValue,
  summarizeVariables,
} from "../BRunner/core/variableInspector.js";

test("runtime summaries omit raw string values", () => {
  const entries = summarizeVariables({ token: "sensitive-value" });

  assert.equal(entries[0].type, "string");
  assert.equal(entries[0].preview, "15 characters");
  assert.equal(JSON.stringify(entries).includes("sensitive-value"), false);
});

test("object arrays are classified as tables", () => {
  const summary = summarizeValue([
    { id: 1, name: "one" },
    { id: 2, name: "two" },
  ]);

  assert.deepEqual(summary, {
    type: "table",
    size: 2,
    preview: "2 rows",
  });
});

test("image data is summarized without payload", () => {
  const entries = summarizeVariables({
    screenshot: "data:image/png;base64,SECRET",
  });

  assert.equal(entries[0].type, "image");
  assert.equal(entries[0].preview, "image data available");
  assert.equal(JSON.stringify(entries).includes("SECRET"), false);
});

test("node origin is preserved for inspector", () => {
  const entries = summarizeVariables(
    { result: { ok: true } },
    {
      result: {
        source: "node",
        nodeId: "step_1",
        action: "http.request",
      },
    },
  );

  assert.equal(entries[0].origin.nodeId, "step_1");
  assert.equal(entries[0].origin.action, "http.request");
});

test("output variable inference supports config and legacy fields", () => {
  assert.equal(
    inferOutputVariableName({ config: { variableName: "new_shape" } }),
    "new_shape",
  );
  assert.equal(
    inferOutputVariableName({ variableName: "legacy_shape" }),
    "legacy_shape",
  );
});
