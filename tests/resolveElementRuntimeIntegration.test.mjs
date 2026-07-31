import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FinalizedNodeRoutes,
  executeFinalizedNode,
} from "../BRunner/nodes/runtime/executeFinalizedNode.js";
import {
  NodeErrorCodes,
  NodeExecutionError,
  NodeStatuses,
} from "../BRunner/nodes/shared/nodeContracts.js";
import {
  executeResolveElement,
  resolveElementNodeDefinition,
  validateResolveElementConfig,
  verifyResolveElementBeforeRetry,
} from "../BRunner/nodes/targeting/resolve-element/index.js";

const TABLE_TARGET = Object.freeze({
  identifierType: "css",
  identifierValue: "#results-table",
});

function createHarness(overrides = {}) {
  const values = {};
  const logs = [];
  return {
    values,
    logs,
    services: {
      registry: {
        set(path, value) {
          values[path] = structuredClone(value);
        },
      },
      logger(event) {
        logs.push(structuredClone(event));
      },
      async delay() {},
      async withTimeout(task) {
        return await task();
      },
      ...overrides,
    },
  };
}

function resolveConfig(overrides = {}) {
  return {
    mode: "resolve_known",
    resultCardinality: "one",
    visibilityRequirement: "any",
    retryCount: 1,
    retryOnlyFor: "target_not_found",
    timeout: 2000,
    ...overrides,
  };
}

function facts(id = "component-1", overrides = {}) {
  return {
    componentId: id,
    componentUid: `uid_${id}`,
    semanticType: "table",
    accessibleName: "Results",
    mappingLayer: "static",
    pageProfileKey: "page-key",
    visible: true,
    interactable: true,
    confidence: 100,
    ...overrides,
  };
}

function resolution(overrides = {}) {
  return {
    mapperState: "resolved",
    confidence: 100,
    component: facts(),
    matchCount: 1,
    visible: true,
    interactable: true,
    ...overrides,
  };
}

function runResolve({
  nodeId = "resolve",
  config = resolveConfig(),
  tab = { id: 12, url: "https://example.test/fixture" },
  target = TABLE_TARGET,
  resolveElement,
  harness,
  selectFailureRoute,
}) {
  return executeFinalizedNode({
    node: {
      id: nodeId,
      type: "element.resolve",
      version: 1,
      config,
      data: target ? { target } : {},
    },
    nodeId,
    nodeType: "element.resolve",
    nodeVersion: 1,
    definition: resolveElementNodeDefinition,
    config,
    validateConfig: (preparedConfig) => validateResolveElementConfig(
      preparedConfig,
      { target },
    ),
    executor: (context) => executeResolveElement({
      ...context,
      tab,
      target,
    }),
    verifyBeforeRetry: ({ error }) => verifyResolveElementBeforeRetry({ error }),
    selectFailureRoute,
  }, {
    ...harness.services,
    resolveElement,
  });
}

test("finalized Resolve Element publishes typed output and structural logs", async () => {
  const harness = createHarness();
  let calls = 0;
  const outcome = await runResolve({
    harness,
    resolveElement: {
      async perform() {
        calls += 1;
        return { ok: true, value: resolution() };
      },
    },
  });

  assert.equal(calls, 1);
  assert.equal(outcome.route, FinalizedNodeRoutes.Success);
  assert.equal(outcome.result.status, NodeStatuses.Completed);

  const published = harness.values["nodes.resolve.output"];
  assert.equal(published.mode, "resolve_known");
  assert.equal(published.resolvedComponentId, "component-1");
  assert.equal(published.matchCount, 1);
  assert.equal(published.component.confidence, 1);

  assert.equal(harness.logs[0].event, "node_started");
  assert.equal(harness.logs.at(-1).event, "node_completed");
  for (const key of [
    "mode",
    "resolvedComponentId",
    "component",
    "components",
    "matchCount",
    "targetResolution",
  ]) {
    assert.equal(
      harness.logs.at(-1).output.keys.includes(key),
      true,
      `completion log must report ${key}`,
    );
  }
});

test("a disabled node and a protected page never invoke resolution", async () => {
  for (const [nodeId, config, tab, expectedStatus, expectedCode] of [
    [
      "disabled-resolve",
      resolveConfig({ enabled: false }),
      { id: 12, url: "https://example.test/fixture" },
      NodeStatuses.SkippedDisabled,
      null,
    ],
    [
      "protected-resolve",
      resolveConfig(),
      { id: 12, url: "chrome://settings/" },
      NodeStatuses.Failed,
      NodeErrorCodes.ProtectedPage,
    ],
  ]) {
    const harness = createHarness();
    let calls = 0;
    const outcome = await runResolve({
      nodeId,
      config,
      tab,
      harness,
      resolveElement: {
        async perform() {
          calls += 1;
          return { ok: true, value: resolution() };
        },
      },
    });

    assert.equal(calls, 0, `${nodeId} must not resolve`);
    assert.equal(outcome.result.status, expectedStatus);
    if (expectedCode) {
      assert.equal(outcome.result.errors[0].code, expectedCode);
      assert.equal(outcome.route, FinalizedNodeRoutes.Fail);
    } else {
      assert.equal(outcome.route, FinalizedNodeRoutes.Success);
    }
  }
});

test("a stale map retries once and succeeds on the verified second attempt", async () => {
  const harness = createHarness();
  let calls = 0;
  const outcome = await runResolve({
    harness,
    resolveElement: {
      async perform() {
        calls += 1;
        return calls === 1
          ? { ok: true, value: { mapperState: "map_stale", reason: "stale" } }
          : { ok: true, value: resolution() };
      },
    },
  });

  assert.equal(calls, 2);
  assert.equal(outcome.route, FinalizedNodeRoutes.Success);
  assert.equal(outcome.result.status, NodeStatuses.Completed);
  assert.equal(
    harness.values["nodes.resolve.output"].resolvedComponentId,
    "component-1",
  );
});

test("ambiguity is never retried and takes the unresolved route", async () => {
  const harness = createHarness();
  let calls = 0;
  const outcome = await runResolve({
    config: resolveConfig({ retryCount: 3 }),
    harness,
    resolveElement: {
      async perform() {
        calls += 1;
        return {
          ok: true,
          value: { mapperState: "ambiguous", reason: "runner_up_margin", matchCount: 4 },
        };
      },
    },
    selectFailureRoute: (error) => (
      error?.diagnostics?.mapperState &&
      !["resolved", "resolved_with_fallback"].includes(
        error.diagnostics.mapperState,
      )
        ? FinalizedNodeRoutes.Unresolved
        : null
    ),
  });

  assert.equal(calls, 1, "ambiguity must not be retried");
  assert.equal(outcome.route, FinalizedNodeRoutes.Unresolved);
  assert.equal(outcome.result.errors[0].code, NodeErrorCodes.AmbiguousTarget);
});

test("a not-found resolution routes to unresolved after exhausting retries", async () => {
  const harness = createHarness();
  let calls = 0;
  const outcome = await runResolve({
    config: resolveConfig({ retryCount: 2 }),
    harness,
    resolveElement: {
      async perform() {
        calls += 1;
        return { ok: true, value: { mapperState: "not_found", reason: "no_match" } };
      },
    },
    selectFailureRoute: () => FinalizedNodeRoutes.Unresolved,
  });

  assert.equal(calls, 3, "one initial attempt plus two eligible retries");
  assert.equal(outcome.route, FinalizedNodeRoutes.Unresolved);
  assert.equal(outcome.result.errors[0].code, NodeErrorCodes.TargetNotFound);
});

test("a timeout is reported without publishing an output", async () => {
  const harness = createHarness({
    async withTimeout() {
      throw new NodeExecutionError(
        NodeErrorCodes.Timeout,
        "Resolve Element execution timed out.",
        { retryable: false },
      );
    },
  });
  const outcome = await runResolve({
    harness,
    resolveElement: {
      async perform() {
        return { ok: true, value: resolution() };
      },
    },
  });

  assert.equal(outcome.result.status, NodeStatuses.TimedOut);
  assert.equal(outcome.result.errors[0].code, NodeErrorCodes.Timeout);
  // A non-completed node publishes an explicit null so downstream expressions
  // cannot read a stale component from an earlier run.
  assert.equal(harness.values["nodes.resolve.output"], null);
});

test("cancellation stops the node without publishing an output", async () => {
  const harness = createHarness();
  const outcome = await runResolve({
    harness,
    resolveElement: {
      async perform() {
        throw new NodeExecutionError(
          NodeErrorCodes.Cancelled,
          "The workflow was cancelled.",
          { retryable: false },
        );
      },
    },
  });

  assert.equal(outcome.result.status, NodeStatuses.Cancelled);
  assert.equal(outcome.result.errors[0].code, NodeErrorCodes.Cancelled);
  assert.equal(harness.values["nodes.resolve.output"], null);
});

test("the shadow-aware default scope reaches the resolution service unchanged", async () => {
  const harness = createHarness();
  let seenScope = null;
  await runResolve({
    harness,
    resolveElement: {
      async perform(request) {
        seenScope = request.config.searchScope;
        return { ok: true, value: resolution() };
      },
    },
  });

  assert.equal(seenScope, "automatic_shadow_dom");
});

test("cardinality all publishes a bounded reusable component set downstream", async () => {
  const harness = createHarness();
  const outcome = await runResolve({
    config: resolveConfig({
      mode: "find_dynamic",
      resultCardinality: "all",
      saveOutputAs: "result_rows",
    }),
    harness,
    resolveElement: {
      async perform() {
        return {
          ok: true,
          value: resolution({
            components: [facts("row-1"), facts("row-2"), facts("row-3")],
            matchCount: 3,
          }),
        };
      },
    },
  });

  assert.equal(outcome.route, FinalizedNodeRoutes.Success);
  const published = harness.values["nodes.resolve.output"];
  assert.equal(published.components.length, 3);
  assert.equal(published.matchCount, 3);
  assert.deepEqual(
    published.components.map((entry) => entry.componentId),
    ["row-1", "row-2", "row-3"],
  );
  assert.deepEqual(
    harness.values["variables.result_rows"].components.map(
      (entry) => entry.componentId,
    ),
    ["row-1", "row-2", "row-3"],
  );
});

test("a fallback resolution still completes and records the fallback marker", async () => {
  const harness = createHarness();
  const outcome = await runResolve({
    harness,
    resolveElement: {
      async perform() {
        return {
          ok: true,
          value: resolution({
            mapperState: "resolved_with_fallback",
            confidence: 88,
          }),
        };
      },
    },
  });

  assert.equal(outcome.route, FinalizedNodeRoutes.Success);
  assert.equal(
    harness.values["nodes.resolve.output"].targetResolution.fallbackUsed,
    true,
  );
});

test("a missing target fails validation before any resolution call", async () => {
  const harness = createHarness();
  let calls = 0;
  const outcome = await runResolve({
    target: null,
    harness,
    resolveElement: {
      async perform() {
        calls += 1;
        return { ok: true, value: resolution() };
      },
    },
  });

  assert.equal(calls, 0);
  assert.equal(outcome.result.status, NodeStatuses.Failed);
  assert.equal(outcome.result.errors[0].code, NodeErrorCodes.ConfigInvalid);
});
