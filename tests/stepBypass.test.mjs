import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveStepBypass } from "../BRunner/core/stepBypass.js";
import { VariableRegistry } from "../BRunner/core/variableRegistry.js";

test("disabled steps bypass without resolving their unused configuration", () => {
  const registry = new VariableRegistry({});
  const decision = resolveStepBypass({
    id: "disabled",
    executionMode: "disabled",
    config: { value: "{{missing}}" },
  }, registry);

  assert.equal(decision.skip, true);
  assert.equal(decision.mode, "disabled");
});

test("conditional bypass accepts typed and string boolean values", () => {
  assert.equal(resolveStepBypass({
    id: "typed",
    executionMode: "conditional",
    skipWhen: "{{flags.skip}}",
  }, new VariableRegistry({ flags: { skip: true } })).skip, true);

  assert.equal(resolveStepBypass({
    id: "string",
    executionMode: "conditional",
    skipWhen: "{{skip}}",
  }, new VariableRegistry({ skip: "no" })).skip, false);
});

test("conditional bypass fails clearly for missing or ambiguous values", () => {
  const registry = new VariableRegistry({ ambiguous: "perhaps" });

  assert.throws(() => resolveStepBypass({
    id: "missing",
    executionMode: "conditional",
    skipWhen: "{{missing}}",
  }, registry), /Variable "missing" was not found/);

  assert.throws(() => resolveStepBypass({
    id: "ambiguous",
    executionMode: "conditional",
    skipWhen: "{{ambiguous}}",
  }, registry), /must resolve to true\/false/);
});

test("legacy disabled flag remains supported", () => {
  const decision = resolveStepBypass(
    { disabled: true },
    new VariableRegistry({}),
  );
  assert.equal(decision.skip, true);
});
