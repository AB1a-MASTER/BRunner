import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AUTOCOMPLETE_SOURCES,
  buildTargetEditorValue,
  collectFieldAutocompleteOptions,
  collectReachablePredecessorNodeIds,
  coerceNodeFieldValue,
  createNodeAutocompleteContext,
  createTargetEditorSchema,
  normalizeFieldDefinition,
  normalizeTargetEditorValue,
  prepareNodeConfiguration,
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

test("shared autocomplete context includes only reachable predecessors", () => {
  const nodes = [
    {
      id: "entry",
      data: {
        config: {
          saveOutputAs: "variables.started",
          saveTabReferenceAs: "origin_tab",
        },
      },
    },
    {
      id: "prior",
      data: {
        config: {
          saveOutputAs: "account_navigation",
          saveToWorkflowClipboard: "replace",
          workflowClipboardEntry: "account",
          saveTabReferenceAs: "account_tab",
        },
      },
    },
    { id: "current", data: { config: {} } },
    {
      id: "downstream",
      data: {
        config: {
          saveOutputAs: "future",
          saveTabReferenceAs: "future_tab",
        },
      },
    },
    {
      id: "unrelated",
      data: {
        config: {
          saveOutputAs: "unrelated",
          saveTabReferenceAs: "unrelated_tab",
        },
      },
    },
  ];
  const edges = [
    { source: "entry", target: "prior" },
    { source: "prior", target: "current" },
    { source: "current", target: "downstream" },
  ];

  const context = createNodeAutocompleteContext({
    currentNodeId: "current",
    entryNodeId: "entry",
    nodes,
    edges,
    variables: { seed: "ready" },
    runtimeVariables: [
      { name: "variables.lastRun" },
      { name: "workflowClipboard.last_clip" },
      { name: "nodes.downstream.output" },
    ],
    workflowClipboardKeys: ["initial_clip", "initial_clip"],
    tabReferences: [{ id: "session_tab" }],
    approvedDirectories: [{ id: "reports", read: true }],
    fileReferences: [{ referenceId: "input_csv" }, "input_csv"],
    dataSources: [{ id: "customers" }],
  });

  assert.deepEqual(context.nodeIds, ["entry", "prior"]);
  assert.deepEqual(context.variables, {
    seed: true,
    lastRun: true,
    customers: true,
    started: true,
    account_navigation: true,
  });
  assert.deepEqual(context.workflowClipboardKeys, [
    "initial_clip",
    "last_clip",
    "account",
  ]);
  assert.deepEqual(context.tabReferences, [
    "session_tab",
    "origin_tab",
    "account_tab",
  ]);
  assert.deepEqual(context.approvedDirectories, [{ id: "reports", read: true }]);
  assert.deepEqual(context.fileReferences, ["input_csv"]);
});

test("reachable predecessor search terminates safely at cycles and current node", () => {
  const nodes = [
    { id: "entry" },
    { id: "prior" },
    { id: "current" },
    { id: "future" },
  ];
  const edges = [
    { source: "entry", target: "prior" },
    { source: "prior", target: "current" },
    { source: "current", target: "future" },
    { source: "future", target: "current" },
  ];

  assert.deepEqual(collectReachablePredecessorNodeIds({
    currentNodeId: "current",
    entryNodeId: "entry",
    nodes,
    edges,
  }), ["entry", "prior"]);
  assert.deepEqual(collectReachablePredecessorNodeIds({
    currentNodeId: "current",
    nodes: [{ id: "current" }, { id: "loop" }],
    edges: [
      { source: "current", target: "loop" },
      { source: "loop", target: "current" },
    ],
  }), []);
});

test("shared configuration preparation applies defaults and canonical field types", () => {
  const definition = {
    unknownConfigPolicy: "reject",
    config: [
      normalizeFieldDefinition({ key: "enabled", kind: "boolean", default: true }),
      normalizeFieldDefinition({ key: "timeout", kind: "number", default: 30000, minimum: 1 }),
      normalizeFieldDefinition({ key: "retries", kind: "number", default: 1, integer: true }),
      normalizeFieldDefinition({ key: "mode", kind: "select", default: "safe", options: ["safe", "fast"] }),
      normalizeFieldDefinition({ key: "label", kind: "text", default: "Run" }),
    ],
  };

  const prepared = prepareNodeConfiguration({
    timeout: "4500",
    retries: "{{ variables.retryCount }}",
    mode: "",
  }, definition);

  assert.deepEqual(prepared.config, {
    enabled: true,
    timeout: 4500,
    retries: "{{ variables.retryCount }}",
    mode: "safe",
    label: "Run",
  });
  assert.deepEqual(prepared.issues, []);
  assert.equal(coerceNodeFieldValue({ kind: "number" }, "12.5"), 12.5);
  assert.equal(coerceNodeFieldValue({ kind: "boolean" }, "false"), "false");
});

test("shared configuration preparation fails closed on invalid and unknown values", () => {
  const definition = {
    unknownConfigPolicy: "reject",
    config: [
      normalizeFieldDefinition({ key: "enabled", kind: "boolean", default: true }),
      normalizeFieldDefinition({ key: "count", kind: "number", integer: true, minimum: 0 }),
      normalizeFieldDefinition({ key: "label", kind: "text" }),
    ],
  };

  const prepared = prepareNodeConfiguration({
    enabled: "yes",
    count: "1.5",
    label: { unsafe: true },
    surprise: true,
  }, definition);

  assert.deepEqual(prepared.config, {
    enabled: "yes",
    count: 1.5,
    label: { unsafe: true },
    surprise: true,
  });
  assert.deepEqual(prepared.issues.map((issue) => issue.fieldKey), [
    "config.surprise",
    "enabled",
    "count",
    "label",
  ]);
});

test("unknown provisional configuration is preserved under the default policy", () => {
  const prepared = prepareNodeConfiguration(
    { known: "value", transitional: { keep: true } },
    { config: [normalizeFieldDefinition({ key: "known", kind: "text" })] },
  );

  assert.deepEqual(prepared.config, {
    known: "value",
    transitional: { keep: true },
  });
  assert.deepEqual(prepared.issues, []);
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
