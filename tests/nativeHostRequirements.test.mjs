import assert from "node:assert/strict";
import { test } from "node:test";

import { getNodeDefinition, getNodeDefinitions } from "../BRunner/core/nodeRegistry.js";
import {
  NativeHostCapabilities,
  NativeHostRequirementModes,
  evaluateNativeHostRequirement,
  formatNativeCapabilities,
} from "../BRunner/core/nativeHostRequirements.js";

test("every node definition has serializable native-host metadata", () => {
  const definitions = getNodeDefinitions();
  assert.ok(definitions.length > 0);

  for (const definition of definitions) {
    assert.ok(definition.nativeHost);
    assert.ok(Object.values(NativeHostRequirementModes).includes(definition.nativeHost.mode));
    assert.equal(Array.isArray(definition.nativeHost.capabilities), true);
  }
});

test("native host required nodes declare exact capabilities", () => {
  assert.deepEqual(getNodeDefinition("keyboard.send_keys").nativeHost, {
    mode: NativeHostRequirementModes.Required,
    capabilities: [NativeHostCapabilities.OsKeystroke],
  });
  assert.deepEqual(getNodeDefinition("file.local.upload").nativeHost, {
    mode: NativeHostRequirementModes.Required,
    capabilities: [NativeHostCapabilities.LocalFileRead],
  });
  assert.equal(getNodeDefinition("element.click").nativeHost.mode, NativeHostRequirementModes.None);
});

test("native host requirement fails only required reached nodes", () => {
  assert.equal(evaluateNativeHostRequirement(
    { mode: NativeHostRequirementModes.None },
    { connected: false, capabilities: [] },
  ).ok, true);

  const disconnected = evaluateNativeHostRequirement(
    { mode: NativeHostRequirementModes.Required, capabilities: [NativeHostCapabilities.LocalFileRead] },
    { connected: false, capabilities: [] },
  );
  assert.equal(disconnected.ok, false);
  assert.equal(disconnected.finalReason, "native_host_unavailable");

  const missingCapability = evaluateNativeHostRequirement(
    { mode: NativeHostRequirementModes.Required, capabilities: [NativeHostCapabilities.LocalFileRead] },
    { connected: true, capabilities: [NativeHostCapabilities.OsKeystroke] },
  );
  assert.equal(missingCapability.ok, false);
  assert.equal(missingCapability.finalReason, "native_capability_unavailable");
  assert.deepEqual(missingCapability.missingCapabilities, [NativeHostCapabilities.LocalFileRead]);

  const available = evaluateNativeHostRequirement(
    { mode: NativeHostRequirementModes.Required, capabilities: [NativeHostCapabilities.LocalFileRead] },
    { connected: true, capabilities: [NativeHostCapabilities.LocalFileRead] },
  );
  assert.equal(available.ok, true);
});

test("native capability labels are human readable", () => {
  assert.equal(
    formatNativeCapabilities([
      NativeHostCapabilities.OsKeystroke,
      NativeHostCapabilities.LocalFileRead,
    ]),
    "OS keystroke and local file read",
  );
});
