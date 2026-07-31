import assert from "node:assert/strict";
import test from "node:test";

import {
  RESOLVE_ELEMENT_NODE_TYPE,
  ResolveElementDefaults,
  ResolveElementErrorCodes,
  ResolveElementModes,
  ResolveResultCardinalities,
  ResolveVisibilityRequirements,
  boundedComponent,
  buildResolveElementOutput,
  extractResolveElementTarget,
  normalizeResolveElementConfig,
  resolveElementNodeDefinition,
  validateResolveElementConfig,
} from "../BRunner/nodes/targeting/resolve-element/index.js";
import { NodeErrorCodes } from "../BRunner/nodes/shared/nodeContracts.js";
import { RetryReasons } from "../BRunner/nodes/shared/executionPolicy.js";

const COMPONENT_REF = Object.freeze({
  schema: "mapper.component_ref.v1",
  mapperSchemaVersion: 1,
  id: "page-key:component-1",
  workflowId: "wf-resolve",
  componentId: "component-1",
  componentUid: "uid_component_1",
  mappingLayer: "static",
  siteKey: "site-key",
  pageProfileKey: "page-key",
  capturedMapVersionId: "map_v1",
});

const CSS_TARGET = Object.freeze({
  identifierType: "css",
  identifierValue: "#results-table",
});

function options(target = CSS_TARGET) {
  return { target };
}

test("definition freezes the finalized Resolve Element contract", () => {
  assert.equal(resolveElementNodeDefinition.type, RESOLVE_ELEMENT_NODE_TYPE);
  assert.equal(resolveElementNodeDefinition.type, "element.resolve");
  assert.equal(resolveElementNodeDefinition.version, 1);
  assert.equal(resolveElementNodeDefinition.catalogNumber, 4);
  assert.equal(resolveElementNodeDefinition.contractKind, "finalized");
  assert.equal(resolveElementNodeDefinition.targetRequired, true);
  assert.deepEqual(resolveElementNodeDefinition.outputs, [
    "success",
    "error",
    "unresolved",
  ]);
  assert.deepEqual(resolveElementNodeDefinition.capabilities, [
    "browser-dom",
    "target-resolution",
    "retry-safe",
    "async",
  ]);
  assert.deepEqual(resolveElementNodeDefinition.requiredServices, [
    "tabs",
    "scripting",
    "mapper",
  ]);
  assert.equal(
    resolveElementNodeDefinition.protectedPageBehavior.domAutomationAllowed,
    false,
  );
});

test("definition declares the required bounded output keys", () => {
  assert.deepEqual(resolveElementNodeDefinition.outputSchema.required, [
    "mode",
    "resolvedComponentId",
    "component",
    "components",
    "matchCount",
    "targetResolution",
  ]);
});

test("every configuration field carries help and an example", () => {
  const schema = resolveElementNodeDefinition.configSchema;
  assert.ok(schema.length > 0);
  for (const field of schema) {
    assert.ok(field.key, "field requires a key");
    assert.ok(field.label, `${field.key} requires a label`);
    assert.ok(field.help, `${field.key} requires help text`);
    assert.ok(
      field.example !== undefined && field.example !== "",
      `${field.key} requires an example`,
    );
  }
});

test("mode, cardinality, scope, and visibility use explicit dropdowns", () => {
  const byKey = new Map(
    resolveElementNodeDefinition.configSchema.map((field) => [field.key, field]),
  );
  for (const key of [
    "mode",
    "resultCardinality",
    "searchScope",
    "visibilityRequirement",
    "mapFreshness",
    "ambiguityPolicy",
  ]) {
    assert.equal(byKey.get(key)?.kind, "select", `${key} must be a dropdown`);
    assert.ok(byKey.get(key)?.options?.length, `${key} requires options`);
  }
});

test("defaults normalize to the frozen contract values", () => {
  const config = normalizeResolveElementConfig({}, options());
  assert.equal(config.mode, ResolveElementModes.ResolveKnown);
  assert.equal(config.resultCardinality, ResolveResultCardinalities.One);
  assert.equal(
    config.visibilityRequirement,
    ResolveVisibilityRequirements.Any,
  );
  assert.equal(config.minimumConfidence, 0.75);
  assert.equal(config.ambiguityPolicy, "fail");
  assert.deepEqual(config.retryOnlyFor, [RetryReasons.TargetNotFound]);
  assert.equal(config.timeout, ResolveElementDefaults.timeout);
});

test("a missing target is rejected because resolution requires one", () => {
  const result = validateResolveElementConfig({}, { target: null });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /requires a target element/);
});

test("revalidate_component requires a saved mapper ComponentRef", () => {
  const withoutRef = validateResolveElementConfig(
    { mode: ResolveElementModes.RevalidateComponent },
    options(),
  );
  assert.equal(withoutRef.valid, false);
  assert.match(withoutRef.errors.join(" "), /ComponentRef/);

  const withRef = validateResolveElementConfig(
    { mode: ResolveElementModes.RevalidateComponent },
    options(COMPONENT_REF),
  );
  assert.equal(withRef.valid, true);
});

test("unsupported enum values fail closed instead of falling back", () => {
  for (const [key, value] of Object.entries({
    mode: "guess",
    resultCardinality: "any",
    searchScope: "everything",
    visibilityRequirement: "maybe",
    mapFreshness: "whenever",
    ambiguityPolicy: "first",
  })) {
    const result = validateResolveElementConfig({ [key]: value }, options());
    assert.equal(result.valid, false, `${key} must reject ${value}`);
  }
});

test("retry configuration is restricted to safe resolution reasons", () => {
  const rejected = validateResolveElementConfig(
    { retryOnlyFor: ["any_error"] },
    options(),
  );
  assert.equal(rejected.valid, false);
  assert.match(rejected.errors.join(" "), /target_not_found and timeout/);

  const accepted = normalizeResolveElementConfig(
    { retryOnlyFor: [RetryReasons.Timeout] },
    options(),
  );
  assert.deepEqual(accepted.retryOnlyFor, [RetryReasons.Timeout]);
});

test("minimum confidence stays inside the zero-to-one band", () => {
  assert.equal(
    validateResolveElementConfig({ minimumConfidence: 1.5 }, options()).valid,
    false,
  );
  assert.equal(
    normalizeResolveElementConfig({ minimumConfidence: 0 }, options())
      .minimumConfidence,
    0,
  );
});

test("frame and container scopes require their explicit reference", () => {
  const frame = validateResolveElementConfig(
    { searchScope: "frame" },
    options(),
  );
  assert.equal(frame.valid, false);
  assert.match(frame.errors.join(" "), /frame reference/);

  const container = validateResolveElementConfig(
    { searchScope: "selected_container" },
    options(),
  );
  assert.equal(container.valid, false);
  assert.match(container.errors.join(" "), /container ComponentRef/);
});

test("timeout must be greater than zero", () => {
  const result = validateResolveElementConfig({ timeout: 0 }, options());
  assert.equal(result.valid, false);
});

test("extractResolveElementTarget reads authoring and node data shapes", () => {
  assert.deepEqual(
    extractResolveElementTarget({ node: { data: { target: CSS_TARGET } } }),
    CSS_TARGET,
  );
  assert.deepEqual(
    extractResolveElementTarget({ node: { componentRef: COMPONENT_REF } }),
    COMPONENT_REF,
  );
  assert.equal(extractResolveElementTarget({ node: {} }), null);
});

test("output builder publishes the bounded finalized shape", () => {
  const output = buildResolveElementOutput({
    mode: ResolveElementModes.ResolveKnown,
    component: {
      componentId: "component-1",
      componentUid: "uid_component_1",
      semanticType: "table",
      accessibleName: "Results",
      mappingLayer: "static",
      pageProfileKey: "page-key",
      visible: true,
      interactable: true,
      confidence: 96,
    },
    components: [],
    matchCount: 1,
    targetResolution: { state: "resolved", confidence: 0.96 },
  });

  assert.deepEqual(Object.keys(output), [
    "mode",
    "resolvedComponentId",
    "component",
    "components",
    "matchCount",
    "targetResolution",
  ]);
  assert.equal(output.resolvedComponentId, "component-1");
  assert.equal(output.component.confidence, 0.96);
  assert.equal(output.component.state.visible, true);
  assert.equal(output.matchCount, 1);
  assert.ok(Object.isFrozen(output));
});

test("output rejects an unknown mode and unbounded component arrays", () => {
  assert.throws(
    () => buildResolveElementOutput({ mode: "invented" }),
    (error) => error.code === NodeErrorCodes.ValidationFailed,
  );
  assert.throws(
    () => buildResolveElementOutput({
      mode: ResolveElementModes.FindDynamic,
      components: Array.from({ length: 201 }, (_, index) => ({
        componentId: `component-${index}`,
      })),
    }),
    (error) => error.code === NodeErrorCodes.ValidationFailed,
  );
});

test("bounded component drops raw DOM evidence and keeps mapper identity", () => {
  const component = boundedComponent({
    componentId: "component-9",
    componentUid: "uid_9",
    domNode: { outerHTML: "<div>secret</div>" },
    evidence: Array.from({ length: 50 }, (_, index) => `fact-${index}`),
    fingerprint: {
      semantic: { semanticType: "row", accessibleName: "Row 9" },
      structural: { frameScope: { framePath: "main", access: "same_origin" } },
    },
    score: 88,
  });

  assert.deepEqual(Object.keys(component), [
    "componentId",
    "componentUid",
    "semanticType",
    "accessibleName",
    "mappingLayer",
    "pageProfileKey",
    "frameContext",
    "state",
    "confidence",
  ]);
  assert.equal(component.semanticType, "row");
  assert.equal(component.frameContext.access, "same_origin");
  assert.equal(component.confidence, 0.88);
});

test("a component without an identifier is rejected", () => {
  assert.throws(
    () => boundedComponent({ semanticType: "row" }),
    (error) => error.code === NodeErrorCodes.ValidationFailed,
  );
});

test("the namespaced resolution error is registered with a target category", () => {
  assert.equal(
    ResolveElementErrorCodes.ResolutionFailed,
    "element.resolve/RESOLUTION_FAILED",
  );
  assert.equal(
    resolveElementNodeDefinition.errorCodes[
      ResolveElementErrorCodes.ResolutionFailed
    ],
    "target",
  );
});
