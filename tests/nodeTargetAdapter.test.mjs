import assert from "node:assert/strict";
import { test } from "node:test";

import {
  TargetAmbiguityPolicies,
  TargetFallbackPolicies,
  TargetIdentifierTypes,
  TargetMapFreshness,
  TargetScopes,
  TargetStates,
  assertValidTargetConfig,
  normalizeTargetConfig,
  normalizeTargetResolutionOutput,
  resolveTarget,
  targetResolutionRequirements,
  validateTargetConfig,
} from "../BRunner/nodes/shared/targetAdapter.js";

const componentRef = Object.freeze({
  schema: "mapper.component_ref.v1",
  mapperSchemaVersion: 1,
  id: "page:submit",
  workflowId: "workflow-1",
  componentId: "submit",
  componentUid: "uid-submit",
  pageProfileKey: "page",
  capturedMapVersionId: "map-1",
});

test("target adapter normalizes every finalized identifier type", () => {
  const cases = [
    ["auto", TargetIdentifierTypes.Auto],
    ["css_selector", TargetIdentifierTypes.Css],
    ["xpath", TargetIdentifierTypes.XPath],
    ["element_id", TargetIdentifierTypes.Id],
    ["name", TargetIdentifierTypes.Name],
    ["label_text", TargetIdentifierTypes.Label],
    ["text", TargetIdentifierTypes.VisibleText],
    ["accessible_role", TargetIdentifierTypes.Role],
    ["placeholder", TargetIdentifierTypes.Placeholder],
    ["attribute", TargetIdentifierTypes.Attribute],
    ["coordinates", TargetIdentifierTypes.Coordinates],
  ];

  for (const [input, expected] of cases) {
    assert.equal(normalizeTargetConfig({
      identifierType: input,
      identifierValue: input === "coordinates" ? { x: 1, y: 2 } : "value",
      attributeName: input === "attribute" ? "data-id" : "",
      roleName: input === "accessible_role" ? "Submit" : "",
    }).identifierType, expected);
  }
});

test("ComponentRef is authoritative and shared policies are normalized", () => {
  const target = assertValidTargetConfig({
    componentRef,
    matchMode: "contains",
    scope: {
      mode: "container",
      containerRef: componentRef,
    },
    targetState: "visible",
    mapFreshness: "refresh_before_resolution",
    fallbackPolicy: "semantic_only",
    ambiguityPolicy: "review",
    minimumConfidence: 92,
    tabSource: { mode: "saved", reference: "checkout" },
  });

  assert.equal(target.identifierType, TargetIdentifierTypes.ComponentRef);
  assert.equal(target.scope.mode, TargetScopes.SelectedContainer);
  assert.equal(target.targetState, TargetStates.Visible);
  assert.equal(target.mapFreshness, TargetMapFreshness.RefreshBeforeResolution);
  assert.equal(target.fallbackPolicy, TargetFallbackPolicies.SemanticOnly);
  assert.equal(target.ambiguityPolicy, TargetAmbiguityPolicies.UserReview);
  assert.equal(target.minimumConfidence, 0.92);
  assert.equal(target.tabSource.reference, "checkout");
  assert.equal(target.textMatch.matchMode, "contains");
});

test("target validation rejects incomplete authoring and scope inputs", () => {
  const invalidAttribute = validateTargetConfig({
    identifierType: "attribute",
    identifierValue: "customer",
  });
  assert.equal(invalidAttribute.valid, false);
  assert.match(invalidAttribute.errors.join(" "), /attributeName/);

  const invalidFrame = validateTargetConfig({
    identifierType: "css",
    identifierValue: "#submit",
    scope: "frame",
  });
  assert.equal(invalidFrame.valid, false);
  assert.match(invalidFrame.errors.join(" "), /frameReference/);

  assert.throws(
    () => assertValidTargetConfig({ componentRef: { componentId: "broken" } }),
    /ComponentRef/,
  );

  const invalidPolicy = validateTargetConfig({
    identifierType: "css",
    identifierValue: "#submit",
    fallbackPolicy: "guess_first",
  });
  assert.equal(invalidPolicy.valid, false);
  assert.match(invalidPolicy.errors.join(" "), /fallbackPolicy/);
});

test("resolution requirements serialize policy without becoming a resolver", () => {
  const requirements = targetResolutionRequirements({
    componentRef,
    targetState: "interactable",
    fallbackPolicy: "disabled",
    minimumConfidence: 0.8,
  }, {
    action: "element.click",
    expectedElementType: "button",
  });

  assert.equal(requirements.action, "element.click");
  assert.equal(requirements.expectedElementType, "button");
  assert.equal(requirements.allowFallback, false);
  assert.equal(requirements.minimumConfidence, 0.8);
  assert.equal(requirements.minimumConfidenceScore, 80);
});

test("standard target output distinguishes primary and fallback resolution", () => {
  const primary = normalizeTargetResolutionOutput({
    state: "resolved",
    reason: "primary_locator_unique",
    confidence: 100,
    visible: true,
    interactable: true,
  }, { componentRef });
  assert.equal(primary.resolved, true);
  assert.equal(primary.primaryMatchStatus, "matched");
  assert.equal(primary.fallbackUsed, false);
  assert.equal(primary.matchCount, 1);

  const fallback = normalizeTargetResolutionOutput({
    state: "resolved_with_fallback",
    reason: "fingerprint_unique",
    confidence: 96,
  }, { componentRef });
  assert.equal(fallback.resolved, true);
  assert.equal(fallback.primaryMatchStatus, "not_found");
  assert.equal(fallback.fallbackUsed, true);
  assert.equal(fallback.confidence, 0.96);
});

test("resolution enforces confidence and target state after mapper selection", async () => {
  const lowConfidence = await resolveTarget({ componentRef, minimumConfidence: 0.9 }, {
    mapper: {
      async resolveComponent() {
        return {
          state: "resolved_with_fallback",
          confidence: 80,
          visible: true,
          interactable: true,
        };
      },
    },
  });
  assert.equal(lowConfidence.ok, false);
  assert.equal(
    lowConfidence.targetResolution.state,
    "below_minimum_confidence",
  );

  const hidden = await resolveTarget({
    componentRef,
    targetState: "visible",
  }, {
    mapper: {
      async resolveComponent() {
        return {
          state: "resolved",
          confidence: 100,
          visible: false,
        };
      },
    },
  });
  assert.equal(hidden.ok, false);
  assert.equal(hidden.error.code, "TARGET_NOT_VISIBLE");
});

test("stale resolution refreshes once and returns a reusable ComponentRef", async () => {
  let resolutions = 0;
  let refreshes = 0;
  const result = await resolveTarget({
    componentRef,
    mapFreshness: "revalidate_if_stale",
  }, {
    mapper: {
      async resolveComponent() {
        resolutions += 1;
        return resolutions === 1
          ? { state: "map_stale", reason: "map_changed" }
          : {
              state: "resolved",
              confidence: 100,
              visible: true,
              interactable: true,
              component: { componentId: "submit" },
            };
      },
      async refreshPageMap() {
        refreshes += 1;
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(resolutions, 2);
  assert.equal(refreshes, 1);
  assert.deepEqual(result.componentRef, componentRef);
});

test("manual identifiers must be converted by the mapper before resolution", async () => {
  const withoutMapperConversion = await resolveTarget({
    identifierType: "css",
    identifierValue: "#submit",
  }, {
    mapper: { async resolveComponent() {} },
  });
  assert.equal(withoutMapperConversion.ok, false);
  assert.equal(withoutMapperConversion.error.code, "DEPENDENCY_NOT_READY");

  let resolvedRequest = null;
  const converted = await resolveTarget({
    identifierType: "visible_text",
    identifierValue: "Submit",
  }, {
    async mapAuthoringTarget() {
      return { componentRef };
    },
    mapper: {
      async resolveComponent(request) {
        resolvedRequest = request;
        return {
          state: "resolved",
          confidence: 100,
          visible: true,
          interactable: true,
        };
      },
    },
  });
  assert.equal(converted.ok, true);
  assert.deepEqual(resolvedRequest.componentRef, componentRef);
  assert.deepEqual(converted.targetResolution.primaryIdentifier, {
    type: "visible_text",
    value: "Submit",
  });
});

test("ambiguity never silently chooses the first candidate", async () => {
  const result = await resolveTarget({
    componentRef,
    ambiguityPolicy: "user_review",
  }, {
    mapper: {
      async resolveComponent() {
        return {
          state: "ambiguous",
          reason: "runner_up_margin_too_small",
          candidates: [{}, {}],
        };
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "AMBIGUOUS_TARGET");
  assert.equal(result.targetResolution.reviewRequired, true);
  assert.equal(result.targetResolution.matchCount, 2);
});
