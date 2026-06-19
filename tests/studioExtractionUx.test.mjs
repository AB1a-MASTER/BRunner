import assert from "node:assert/strict";
import { test } from "node:test";

import { getNodeDefinition } from "../BRunner/core/nodeRegistry.js";

test("list extraction exposes registry-driven contextual attribute controls", () => {
  const definition = getNodeDefinition("data.extract.list");
  const itemSelector = definition.config.find((field) => field.key === "itemSelector");
  const attributeName = definition.config.find((field) => field.key === "attributeName");

  assert.match(itemSelector.help, /inside the Target Element/);
  assert.deepEqual(attributeName.visibleWhen, {
    field: "valueMode",
    equals: "attribute",
  });
});

test("table extraction explains selector scope", () => {
  const definition = getNodeDefinition("data.extract.table");
  const rowSelector = definition.config.find((field) => field.key === "rowSelector");
  const cellSelector = definition.config.find((field) => field.key === "cellSelector");

  assert.match(rowSelector.help, /inside the Target Element/);
  assert.match(cellSelector.help, /inside each extracted row/);
});
