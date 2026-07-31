import assert from "node:assert/strict";
import test from "node:test";

import {
  ResolveElementModes,
  ResolveResultCardinalities,
  collectCandidates,
  executeResolveElement,
  normalizeMapperResolution,
  verifyResolveElementBeforeRetry,
} from "../BRunner/nodes/targeting/resolve-element/index.js";
import { NodeErrorCodes } from "../BRunner/nodes/shared/nodeContracts.js";

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

const TAB = Object.freeze({
  id: 42,
  windowId: 3,
  url: "http://127.0.0.1:8765/tests/fixtures/resolve-acceptance.html",
});

function component(id, overrides = {}) {
  return {
    componentId: id,
    componentUid: `uid_${id}`,
    semanticType: "row",
    accessibleName: `Row ${id}`,
    mappingLayer: "static",
    pageProfileKey: "page-key",
    visible: true,
    interactable: true,
    confidence: 100,
    ...overrides,
  };
}

function service(response) {
  const calls = [];
  return {
    calls,
    resolveElement: {
      async perform(request, options) {
        calls.push({ request, options });
        return typeof response === "function" ? response(request) : response;
      },
    },
  };
}

function context(config, bag, target = COMPONENT_REF) {
  return {
    config,
    target,
    tab: TAB,
    services: bag,
  };
}

test("primary mapper resolution publishes the bounded component", async () => {
  const bag = service({
    ok: true,
    value: {
      mapperState: "resolved",
      confidence: 100,
      component: component("component-1"),
      components: [component("component-1")],
      matchCount: 1,
      visible: true,
      interactable: true,
    },
  });

  const result = await executeResolveElement(context({}, bag));

  assert.equal(result.output.mode, ResolveElementModes.ResolveKnown);
  assert.equal(result.output.resolvedComponentId, "component-1");
  assert.equal(result.output.matchCount, 1);
  assert.equal(result.output.component.confidence, 1);
  assert.equal(result.output.targetResolution.resolved, true);
  assert.equal(bag.calls.length, 1);
});

test("fallback resolution keeps the fallback marker in targetResolution", async () => {
  const bag = service({
    ok: true,
    value: {
      mapperState: "resolved_with_fallback",
      confidence: 92,
      component: component("component-1"),
      matchCount: 1,
      visible: true,
      interactable: true,
    },
  });

  const result = await executeResolveElement(context({}, bag));

  assert.equal(result.output.targetResolution.fallbackUsed, true);
  assert.equal(result.output.targetResolution.state, "resolved_with_fallback");
});

test("ambiguity routes to unresolved and is never retried", async () => {
  const bag = service({
    ok: true,
    value: {
      mapperState: "ambiguous",
      reason: "runner_up_margin_too_small",
      matchCount: 2,
    },
  });

  await assert.rejects(
    () => executeResolveElement(context({}, bag)),
    (error) => {
      assert.equal(error.code, NodeErrorCodes.AmbiguousTarget);
      assert.equal(error.diagnostics.mapperState, "ambiguous");
      assert.equal(error.details.retryable, false);
      return true;
    },
  );

  const verdict = await verifyResolveElementBeforeRetry({
    error: { diagnostics: { mapperState: "ambiguous" } },
  });
  assert.equal(verdict.retryable, false);
  assert.equal(verdict.reason, "ambiguity_is_never_retried");
});

test("a stale map is an eligible retry reason", async () => {
  const bag = service({
    ok: true,
    value: { mapperState: "map_stale", reason: "component_missing_after_refresh" },
  });

  await assert.rejects(
    () => executeResolveElement(context({}, bag)),
    (error) => {
      assert.equal(error.code, NodeErrorCodes.TargetNotFound);
      assert.equal(error.diagnostics.mapperState, "map_stale");
      assert.equal(error.details.retryable, true);
      return true;
    },
  );

  const verdict = await verifyResolveElementBeforeRetry({
    error: { diagnostics: { mapperState: "map_stale" } },
  });
  assert.equal(verdict.retryable, true);
});

test("a protected mapper surface reports a protected-page failure", async () => {
  const bag = service({
    ok: true,
    value: {
      mapperState: "protected_unsupported",
      reason: "cross_origin_frame_unreachable",
    },
  });

  await assert.rejects(
    () => executeResolveElement(context({}, bag)),
    (error) => {
      assert.equal(error.code, NodeErrorCodes.ProtectedPage);
      assert.equal(error.details.retryable, false);
      return true;
    },
  );
});

test("cardinality one fails when the mapper verifies several matches", async () => {
  const bag = service({
    ok: true,
    value: {
      mapperState: "resolved",
      confidence: 100,
      component: component("component-1"),
      matchCount: 3,
      visible: true,
      interactable: true,
    },
  });

  await assert.rejects(
    () => executeResolveElement(
      context({ resultCardinality: ResolveResultCardinalities.One }, bag),
    ),
    (error) => {
      assert.equal(error.code, NodeErrorCodes.AmbiguousTarget);
      assert.equal(error.details.matchCount, 3);
      assert.equal(error.details.retryable, false);
      return true;
    },
  );
});

test("cardinality all publishes every bounded candidate", async () => {
  const bag = service({
    ok: true,
    value: {
      mapperState: "resolved",
      confidence: 100,
      component: component("component-1"),
      components: [component("component-1"), component("component-2")],
      matchCount: 2,
      visible: true,
      interactable: true,
    },
  });

  const result = await executeResolveElement(
    context(
      {
        mode: ResolveElementModes.FindDynamic,
        resultCardinality: ResolveResultCardinalities.All,
      },
      bag,
      CSS_TARGET,
    ),
  );

  assert.equal(result.output.components.length, 2);
  assert.equal(result.output.matchCount, 2);
  assert.equal(result.output.components[1].componentId, "component-2");
});

test("cardinality first selects one match after the set is collected", async () => {
  const bag = service({
    ok: true,
    value: {
      mapperState: "resolved",
      confidence: 100,
      component: component("component-1"),
      components: [component("component-1"), component("component-2")],
      matchCount: 2,
      visible: true,
      interactable: true,
    },
  });

  const result = await executeResolveElement(
    context(
      {
        mode: ResolveElementModes.FindDynamic,
        resultCardinality: ResolveResultCardinalities.First,
      },
      bag,
      CSS_TARGET,
    ),
  );

  assert.equal(result.output.components.length, 1);
  assert.equal(result.output.component.componentId, "component-1");
  assert.equal(result.output.matchCount, 2);
});

test("revalidate_component asks the service for a revalidation", async () => {
  const bag = service({
    ok: true,
    value: {
      mapperState: "resolved",
      confidence: 100,
      component: component("component-1"),
      matchCount: 1,
      visible: true,
      interactable: true,
    },
  });

  const result = await executeResolveElement(
    context({ mode: ResolveElementModes.RevalidateComponent }, bag),
  );

  assert.equal(bag.calls[0].request.revalidate, true);
  assert.equal(result.output.mode, ResolveElementModes.RevalidateComponent);
});

test("a missing resolution service fails closed", async () => {
  await assert.rejects(
    () => executeResolveElement({
      config: {},
      target: COMPONENT_REF,
      tab: TAB,
      services: {},
    }),
    (error) => error.code === NodeErrorCodes.DependencyNotReady,
  );
});

test("a confidence below the configured minimum is not accepted", async () => {
  const bag = service({
    ok: true,
    value: {
      mapperState: "resolved",
      confidence: 60,
      component: component("component-1", { confidence: 60 }),
      matchCount: 1,
      visible: true,
      interactable: true,
    },
  });

  await assert.rejects(
    () => executeResolveElement(context({ minimumConfidence: 0.9 }, bag)),
    (error) => {
      assert.equal(error.diagnostics.mapperState, "below_minimum_confidence");
      assert.equal(
        error.code,
        "element.resolve/RESOLUTION_FAILED",
      );
      return true;
    },
  );
});

test("visibility requirements reject a resolved but hidden element", async () => {
  const bag = service({
    ok: true,
    value: {
      mapperState: "resolved",
      confidence: 100,
      component: component("component-1", { visible: false }),
      matchCount: 1,
      visible: false,
      interactable: false,
    },
  });

  await assert.rejects(
    () => executeResolveElement(
      context({ visibilityRequirement: "visible" }, bag),
    ),
    (error) => {
      assert.equal(error.code, NodeErrorCodes.TargetNotVisible);
      return true;
    },
  );
});

test("a service configuration failure surfaces as CONFIG_INVALID", async () => {
  const bag = service({
    ok: false,
    error: {
      code: NodeErrorCodes.ConfigInvalid,
      message:
        "Result cardinality first and all require an explicit CSS or XPath target selector.",
    },
  });

  await assert.rejects(
    () => executeResolveElement(
      context({ resultCardinality: ResolveResultCardinalities.All }, bag),
    ),
    (error) => {
      assert.equal(error.code, NodeErrorCodes.ConfigInvalid);
      assert.equal(error.details.retryable, false);
      return true;
    },
  );
});

test("a service resolution failure keeps its mapper state", async () => {
  const bag = service({
    ok: false,
    error: { state: "not_found", message: "Mapper could not resolve target" },
  });

  await assert.rejects(
    () => executeResolveElement(context({}, bag)),
    (error) => {
      assert.equal(error.code, NodeErrorCodes.TargetNotFound);
      assert.equal(error.diagnostics.mapperState, "not_found");
      assert.equal(error.details.retryable, true);
      return true;
    },
  );
});

test("a protected browser page is rejected before any resolution call", async () => {
  const bag = service({ ok: true, value: { mapperState: "resolved" } });

  await assert.rejects(
    () => executeResolveElement({
      config: {},
      target: COMPONENT_REF,
      tab: { id: 7, url: "chrome://settings" },
      services: bag,
    }),
    (error) => error.code === NodeErrorCodes.ProtectedPage,
  );
  assert.equal(bag.calls.length, 0);
});

test("a missing tab fails without contacting the resolution service", async () => {
  const bag = service({ ok: true, value: { mapperState: "resolved" } });

  await assert.rejects(
    () => executeResolveElement({
      config: {},
      target: COMPONENT_REF,
      tab: null,
      services: bag,
    }),
    (error) => error.code === NodeErrorCodes.TabNotFound,
  );
  assert.equal(bag.calls.length, 0);
});

test("normalizeMapperResolution applies the node minimum confidence", () => {
  const low = normalizeMapperResolution(
    { mapperState: "resolved", confidence: 70, component: component("a") },
    { minimumConfidence: 0.9 },
    COMPONENT_REF,
  );
  assert.equal(low.ok, false);
  assert.equal(low.targetResolution.state, "below_minimum_confidence");

  const high = normalizeMapperResolution(
    { mapperState: "resolved", confidence: 95, component: component("a") },
    { minimumConfidence: 0.9 },
    COMPONENT_REF,
  );
  assert.equal(high.ok, true);
});

test("collectCandidates normalizes component, match, and scored shapes", () => {
  assert.deepEqual(collectCandidates(null), []);
  assert.deepEqual(
    collectCandidates({ components: [{ componentId: "a" }] }),
    [{ componentId: "a" }],
  );
  assert.deepEqual(
    collectCandidates({ candidates: [{ candidate: { componentId: "b" }, score: 90 }] }),
    [{ componentId: "b", score: 90 }],
  );
  assert.deepEqual(
    collectCandidates({ matches: [{ componentId: "c" }] }),
    [{ componentId: "c" }],
  );
});
