import test from "node:test";
import assert from "node:assert/strict";
import {
  matchSemanticFields,
  scoreSemanticField,
} from "../BRunner/core/semanticFieldMatcher.js";

test("semantic field matcher maps common aliases to unique controls", () => {
  const result = matchSemanticFields({
    data: {
      first_name: "Ada",
      last_name: "Lovelace",
      postal_code: "SW1A 1AA",
    },
    controls: [
      control("given", { labelText: "Given name", inputType: "text" }),
      control("surname", { placeholder: "Family name", inputType: "text" }),
      control("zip", { accessibleName: "ZIP code", inputType: "text" }),
    ],
  });

  assert.deepEqual(
    result.mappings.map((mapping) => [mapping.dataKey, mapping.controlId]),
    [["first_name", "given"], ["last_name", "surname"], ["postal_code", "zip"]],
  );
  assert.deepEqual(result.unmatchedDataKeys, []);
});

test("semantic field matcher uses field metadata descriptions", () => {
  const result = matchSemanticFields({
    data: { contact_detail: "ada@example.com" },
    metadata: { contact_detail: { description: "Email address" } },
    controls: [control("email", { labelText: "Email address", inputType: "email" })],
  });

  assert.equal(result.mappings[0].dataKey, "contact_detail");
  assert.equal(result.mappings[0].controlId, "email");
});

test("semantic field matcher refuses non-password data for password fields", () => {
  const result = matchSemanticFields({
    data: { message: "not a secret" },
    controls: [control("password", { labelText: "Password", inputType: "password" })],
  });

  assert.equal(result.mappings.length, 0);
  assert.deepEqual(result.unmatchedDataKeys, ["message"]);
});

test("semantic field matcher reports duplicate semantic controls as ambiguous", () => {
  const result = matchSemanticFields({
    data: { email: "ada@example.com" },
    controls: [
      control("billing-email", { labelText: "Email", inputType: "email" }),
      control("shipping-email", { labelText: "Email", inputType: "email" }),
    ],
  });

  assert.equal(result.mappings.length, 0);
  assert.equal(result.ambiguous[0].dataKey, "email");
  assert.equal(result.ambiguous[0].reason, "semantic_margin_too_small");
});

test("semantic field matcher keeps one-to-one field assignments", () => {
  const result = matchSemanticFields({
    data: { full_name: "Ada Lovelace", email: "ada@example.com" },
    controls: [
      control("name", { labelText: "Your name", inputType: "text" }),
      control("email", { labelText: "Email", inputType: "email" }),
    ],
  });

  assert.equal(new Set(result.mappings.map((mapping) => mapping.controlId)).size, 2);
});

test("semantic field scoring accepts title and subject aliases", () => {
  const result = scoreSemanticField(
    { key: "subject", value: "Mapper reliability" },
    control("title", { accessibleName: "Title", inputType: "text" }),
  );

  assert.ok(result.score >= 90);
  assert.ok(result.evidence.includes("canonical_alias"));
});

function control(id, semantic) {
  return {
    id,
    componentId: `component_${id}`,
    fingerprint: {
      semantic,
      technical: { tag: semantic.inputType ? "input" : "" },
    },
  };
}
