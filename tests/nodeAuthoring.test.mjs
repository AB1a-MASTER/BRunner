import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AUTOCOMPLETE_SOURCES,
  buildTargetEditorValue,
  collectFieldAutocompleteOptions,
  createTargetEditorSchema,
  normalizeFieldDefinition,
  normalizeTargetEditorValue,
  validateNodeConfiguration,
} from "../BRunner/core/nodeAuthoring.js";

test("field metadata standardizes examples, expression modes, and autocomplete", () => {
  const field = normalizeFieldDefinition({
    key: "url",
    label: "URL",
    kind: "text",
    required: true,
  });
  assert.equal(field.example, "https://example.com/");
  assert.equal(field.placeholder, field.example);
  assert.equal(field.expressionMode, "template");
  assert.ok(field.autocompleteSources.includes(AUTOCOMPLETE_SOURCES.Variables));
  assert.ok(field.autocompleteSources.includes(AUTOCOMPLETE_SOURCES.NodeOutputs));
  assert.ok(field.help);

  const choice = normalizeFieldDefinition({
    key: "mode",
    kind: "select",
    default: "safe",
    options: ["safe", "fast"],
  });
  assert.equal(choice.example, "safe");
  assert.throws(
    () => normalizeFieldDefinition({
      key: "mode",
      kind: "select",
      options: ["safe"],
      example: "unsupported",
    }),
    /example must be one of its options/,
  );
});

test("target editor requires explicit identifier and matching selectors", () => {
  const schema = createTargetEditorSchema(true);
  const byKey = new Map(schema.fields.map((field) => [field.key, field]));
  assert.ok(byKey.get("identifierType").options.includes("component_id"));
  assert.ok(byKey.get("identifierType").options.includes("css"));
  assert.deepEqual(byKey.get("matchMode").options, [
    "exact",
    "contains",
    "starts_with",
    "ends_with",
    "wildcard",
    "regex",
  ]);
  assert.deepEqual(byKey.get("multipleMatchBehavior").options, [
    "fail",
    "first",
    "highest_confidence",
    "return_all",
  ]);
});

test("target editor normalizes legacy selectors and builds canonical target data", () => {
  const state = normalizeTargetEditorValue({
    strategy: "css_selector",
    value: "#save",
  });
  assert.equal(state.identifierType, "css");
  assert.equal(state.identifierValue, "#save");
  const target = buildTargetEditorValue({
    ...state,
    matchMode: "exact",
    caseSensitive: true,
  });
  assert.equal(target.identifierType, "css");
  assert.equal(target.textMatch.caseSensitive, true);
  assert.equal(target.textMatch.multipleMatchBehavior, "fail");

  const coordinates = buildTargetEditorValue({
    identifierType: "coordinates",
    identifierValue: "120, 240",
  });
  assert.deepEqual(coordinates.coordinates, {
    x: 120,
    y: 240,
    coordinateSpace: "viewport",
  });
  assert.equal(normalizeTargetEditorValue(coordinates).identifierValue, "120, 240");
});

test("shared autocomplete combines valid context sources without duplicates", () => {
  const field = normalizeFieldDefinition({
    key: "value",
    kind: "text",
    autocompleteSources: [
      AUTOCOMPLETE_SOURCES.Variables,
      AUTOCOMPLETE_SOURCES.NodeOutputs,
      AUTOCOMPLETE_SOURCES.TabReferences,
    ],
  });
  assert.deepEqual(collectFieldAutocompleteOptions(field, {
    variables: { customer: true },
    nodeIds: ["open-customer"],
    tabReferences: ["results_tab", "results_tab"],
  }), [
    "{{ variables.customer }}",
    "{{ nodes.open-customer.output }}",
    "results_tab",
  ]);
});

test("shared validation covers target, required, select, boolean, and number fields", () => {
  const definition = {
    targetRequired: true,
    config: [
      normalizeFieldDefinition({ key: "mode", kind: "select", required: true, options: ["a", "b"] }),
      normalizeFieldDefinition({ key: "enabledOption", kind: "boolean" }),
      normalizeFieldDefinition({ key: "timeout", kind: "number", minimum: 1 }),
    ],
  };
  const issues = validateNodeConfiguration({
    target: "",
    config: { mode: "c", enabledOption: "yes", timeout: 0 },
  }, definition);
  assert.deepEqual(issues.map((issue) => issue.fieldKey), [
    "target",
    "mode",
    "enabledOption",
    "timeout",
  ]);

  const coordinateIssues = validateNodeConfiguration({
    target: { identifierType: "coordinates", identifierValue: "invalid" },
    config: { mode: "a", enabledOption: false, timeout: 1 },
  }, definition);
  assert.equal(coordinateIssues[0].fieldKey, "target");
});
