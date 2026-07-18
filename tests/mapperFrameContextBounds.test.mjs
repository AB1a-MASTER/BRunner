import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const backgroundSource = await readFile(
  new URL("BRunner/background.js", root),
  "utf8",
);

function sourceBetween(startMarker, endMarker) {
  const start = backgroundSource.indexOf(startMarker);
  const end = backgroundSource.indexOf(`\n${endMarker}`, start);
  assert.notEqual(start, -1, `Missing ${startMarker}`);
  assert.notEqual(end, -1, `Missing boundary ${endMarker}`);
  return backgroundSource.slice(start, end).trim();
}

const FRAME_CONTEXT_BUDGET = 100;
const selectBoundedMapperFrameResolutionContexts = Function(
  "MAPPER_FRAME_CONTEXT_BUDGET",
  `${sourceBetween(
    "function selectBoundedMapperFrameResolutionContexts(",
    "function createMapperFrameContextOverflowError(",
  )}; return selectBoundedMapperFrameResolutionContexts;`,
)(FRAME_CONTEXT_BUDGET);
const decorateAccessibleMapperFrameScopes = Function(
  `${sourceBetween(
    "function decorateAccessibleMapperFrameScopes(",
    "function attachMapperFrameScope(",
  )}; return decorateAccessibleMapperFrameScopes;`,
)();
const createMapperFrameContextOverflowError = Function(
  "MAPPER_FRAME_CONTEXT_BUDGET",
  `${sourceBetween(
    "function createMapperFrameContextOverflowError(",
    "function createUnreachableMapperFrameError(",
  )}; return createMapperFrameContextOverflowError;`,
)(FRAME_CONTEXT_BUDGET);
const createUnreachableMapperFrameError = Function(
  `${sourceBetween(
    "function createUnreachableMapperFrameError(",
    "function createAmbiguousMapperFrameError(",
  )}; return createUnreachableMapperFrameError;`,
)();
const createAmbiguousMapperFrameError = Function(
  `${sourceBetween(
    "function createAmbiguousMapperFrameError(",
    "async function injectMapperContentScripts(",
  )}; return createAmbiguousMapperFrameError;`,
)();

function createFrameResult(frameId, frameScope = {}) {
  return {
    frameId,
    result: {
      path: frameId === 0 ? "top" : `top > iframe:nth(${frameId})`,
      access: "same_origin",
      extensionAccessible: true,
      ...frameScope,
    },
  };
}

function createResolver(results, counters = {}) {
  counters.executeCount = 0;
  counters.injectCount = 0;
  const chrome = {
    scripting: {
      async executeScript() {
        counters.executeCount += 1;
        return results;
      },
    },
  };
  const injectMapperContentScripts = async () => {
    counters.injectCount += 1;
  };
  return Function(
    "chrome",
    "MAPPER_FRAME_CONTEXT_BUDGET",
    "selectBoundedMapperFrameResolutionContexts",
    "decorateAccessibleMapperFrameScopes",
    "createMapperFrameContextOverflowError",
    "createUnreachableMapperFrameError",
    "createAmbiguousMapperFrameError",
    "injectMapperContentScripts",
    `${sourceBetween(
      "async function resolveMapperFrameId(",
      "function selectBoundedMapperFrameResolutionContexts(",
    )}; return resolveMapperFrameId;`,
  )(
    chrome,
    FRAME_CONTEXT_BUDGET,
    selectBoundedMapperFrameResolutionContexts,
    decorateAccessibleMapperFrameScopes,
    createMapperFrameContextOverflowError,
    createUnreachableMapperFrameError,
    createAmbiguousMapperFrameError,
    injectMapperContentScripts,
  );
}

test("frame-context selection is capped, deterministic, and prioritizes exact identity", () => {
  const results = Array.from({ length: 150 }, (_, frameId) => createFrameResult(frameId));
  const expectedScope = {
    path: "top > iframe:nth(99)",
    frameIdHint: 99,
  };
  const forward = selectBoundedMapperFrameResolutionContexts(
    results,
    expectedScope,
    1000,
  );
  const repeat = selectBoundedMapperFrameResolutionContexts(
    results,
    expectedScope,
    1000,
  );

  assert.equal(forward.contexts.length, FRAME_CONTEXT_BUDGET);
  assert.equal(forward.diagnostics.maxFrameContexts, FRAME_CONTEXT_BUDGET);
  assert.equal(forward.diagnostics.discoveredFrameContextCount, 150);
  assert.equal(forward.diagnostics.inspectedResultCount, FRAME_CONTEXT_BUDGET + 1);
  assert.equal(forward.diagnostics.frameContextOverflow, true);
  assert.equal(forward.contexts[0].frameId, 99);
  assert.deepEqual(
    forward.contexts.map((entry) => entry.frameId),
    repeat.contexts.map((entry) => entry.frameId),
  );
  assert.equal(forward.diagnostics.firstOmittedFrameId, 100);
});

test("top-frame resolution remains constant-time and does not enumerate frames", async () => {
  const counters = {};
  const resolveMapperFrameId = createResolver([], counters);
  const frameId = await resolveMapperFrameId(42, {
    fingerprint: {
      structural: {
        frameScope: { path: "top" },
      },
    },
  });

  assert.equal(frameId, 0);
  assert.equal(counters.executeCount, 0);
  assert.equal(counters.injectCount, 0);
});

test("an exact same-origin path remains resolvable when the discovered set overflows", async () => {
  const results = Array.from({ length: 150 }, (_, frameId) => createFrameResult(frameId));
  const counters = {};
  const resolveMapperFrameId = createResolver(results, counters);
  const frameId = await resolveMapperFrameId(42, {
    fingerprint: {
      structural: {
        frameScope: {
          path: "top > iframe:nth(99)",
          access: "same_origin",
          extensionAccessible: true,
          frameIdHint: 99,
        },
      },
    },
  });

  assert.equal(frameId, 99);
  assert.equal(counters.executeCount, 1);
  assert.equal(counters.injectCount, 0);
});

test("unproven identity returns structured frame_context_overflow diagnostics", async () => {
  const results = Array.from({ length: 150 }, (_, frameId) => createFrameResult(frameId));
  const counters = {};
  const resolveMapperFrameId = createResolver(results, counters);

  await assert.rejects(
    resolveMapperFrameId(42, {
      fingerprint: {
        structural: {
          frameScope: {
            path: "top > iframe:nth(149)",
            access: "same_origin",
            extensionAccessible: true,
          },
        },
      },
    }),
    (error) => {
      assert.equal(error.diagnostics?.mapperState, "dynamic_deferred");
      assert.equal(error.diagnostics?.mapperReason, "frame_context_overflow");
      assert.equal(error.diagnostics?.finalReason, "mapper_frame_context_overflow");
      assert.equal(error.diagnostics?.maxFrameContexts, FRAME_CONTEXT_BUDGET);
      assert.equal(error.diagnostics?.discoveredFrameContextCount, 150);
      assert.equal(error.diagnostics?.inspectedResultCount, FRAME_CONTEXT_BUDGET + 1);
      assert.equal(error.diagnostics?.selectedFrameContextCount, FRAME_CONTEXT_BUDGET);
      assert.equal(error.diagnostics?.firstOmittedFrameId, 100);
      return true;
    },
  );
  assert.equal(counters.executeCount, 1);
  assert.equal(counters.injectCount, 0);
});

test("cross-origin multiplicity is never inferred from an overflowed subset", async () => {
  const results = Array.from({ length: 101 }, (_, frameId) => createFrameResult(frameId, {
    path: "isolated/embed",
    access: "cross_origin",
    contextKey: "embed",
    extensionAccessible: true,
  }));
  results[100] = { frameId: 100, result: null };
  const counters = {};
  const resolveMapperFrameId = createResolver(results, counters);

  await assert.rejects(
    resolveMapperFrameId(42, {
      fingerprint: {
        structural: {
          frameScope: {
            path: "isolated/embed/instance_1",
            access: "cross_origin",
            contextKey: "embed",
            frameContextId: "embed_instance_1",
            contextMultiplicity: 1,
            extensionAccessible: true,
          },
        },
      },
    }),
    (error) => error.diagnostics?.mapperReason === "frame_context_overflow",
  );
  assert.equal(counters.executeCount, 2);
  assert.equal(counters.injectCount, 1);
});
