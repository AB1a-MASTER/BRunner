import assert from "node:assert/strict";
import { test } from "node:test";

import { getNodeDefinition, getNodeDefinitions } from "../BRunner/core/nodeRegistry.js";

test("every node definition exposes Inspector guidance", () => {
  for (const definition of getNodeDefinitions()) {
    assert.ok(definition.guidance, definition.type);
    assert.equal(typeof definition.guidance.description, "string");
    assert.equal(typeof definition.guidance.whenToUse, "string");
    assert.equal(typeof definition.guidance.example, "string");
    assert.equal(typeof definition.guidance.configuration, "string");
    assert.equal(typeof definition.guidance.safety, "string");
    assert.deepEqual(definition.guidance.inputs, definition.inputs);
    assert.deepEqual(definition.guidance.outputs, definition.outputs);
  }
});

test("guidance includes useful examples and safety notes", () => {
  assert.match(
    getNodeDefinition("element.select").guidance.example,
    /visible option text/i,
  );
  assert.match(
    getNodeDefinition("file.local.upload").guidance.safety,
    /native host/i,
  );
});
