import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NodeContractResolutionCodes,
  getLatestNodeDefinition,
  getNodeDefinition,
  getNodeDefinitionVersions,
  getNodeDefinitions,
  migrateNodeContract,
  resolveNodeDefinition,
} from "../BRunner/core/nodeRegistry.js";

test("registry resolves definitions by exact type and version", () => {
  const definition = getNodeDefinition("element.click", 1);
  assert.equal(definition.type, "element.click");
  assert.equal(definition.version, 1);
  assert.equal(getNodeDefinition("element.click"), null);
  assert.equal(getLatestNodeDefinition("element.click"), definition);
  assert.deepEqual(getNodeDefinitionVersions("element.click"), [1]);
  assert.equal(Object.isFrozen(definition), true);
  assert.equal(Object.isFrozen(definition.config), true);
});

test("registry fails closed on missing and unsupported node versions", () => {
  assert.throws(
    () => resolveNodeDefinition({ type: "element.click" }),
    (error) => error.code === NodeContractResolutionCodes.MissingVersion,
  );
  assert.throws(
    () => resolveNodeDefinition({ type: "element.click", version: 2 }),
    (error) =>
      error.code === NodeContractResolutionCodes.UnsupportedVersion &&
      error.details.supportedVersions[0] === 1,
  );
  assert.throws(
    () => resolveNodeDefinition({ type: "unknown.node", version: 1 }),
    (error) => error.code === NodeContractResolutionCodes.UnsupportedType,
  );
});

test("contract migrations require an explicit reviewed migration", () => {
  const current = { id: "click", type: "element.click", version: 1, config: {} };
  assert.deepEqual(migrateNodeContract(current), current);
  assert.throws(
    () => migrateNodeContract(current, { targetVersion: 2 }),
    (error) => error.code === NodeContractResolutionCodes.UnsupportedVersion,
  );
});

test("serialized definitions expose stable labeled machine ports", () => {
  const definitions = getNodeDefinitions({ includeAllVersions: true });
  assert.ok(definitions.length > 0);
  for (const definition of definitions) {
    for (const ports of [definition.inputPorts, definition.outputPorts]) {
      assert.ok(ports.length > 0);
      assert.equal(new Set(ports.map((port) => port.id)).size, ports.length);
      ports.forEach((port) => {
        assert.match(port.id, /^[a-z][a-z0-9_]*$/);
        assert.ok(port.label);
        assert.ok(["flow", "data", "error", "resolution"].includes(port.kind));
      });
    }
  }
  const extraction = definitions.find((definition) => definition.type === "data.extract.text");
  assert.equal(extraction.outputPorts.find((port) => port.id === "value").kind, "data");
});
