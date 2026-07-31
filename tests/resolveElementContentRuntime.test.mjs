import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const mapperSource = await readFile(new URL(
  "../BRunner/content/mapper.js",
  import.meta.url,
), "utf8");

function createHarness({ matches = 1, visible = true, disabled = false } = {}) {
  class FakeElement {
    constructor(id = "results-table", overrides = {}) {
      this.id = id;
      this.tagName = "TABLE";
      this.isConnected = true;
      this.disabled = disabled;
      this.attributes = { role: "table", "aria-label": "Results" };
      this.style = {};
      Object.assign(this, overrides);
    }

    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
        ? this.attributes[name]
        : null;
    }

    getBoundingClientRect() {
      return { left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 };
    }
  }

  const elements = Array.from(
    { length: matches },
    (_, index) => new FakeElement(`results-row-${index + 1}`),
  );

  const document = {
    title: "Resolve test",
    querySelector: () => elements[0] || null,
    querySelectorAll: () => elements,
    elementFromPoint: () => elements[0] || null,
    evaluate: () => ({
      snapshotLength: elements.length,
      snapshotItem: (index) => {
        const element = elements[index];
        if (!element) return null;
        element.nodeType = 1;
        return element;
      },
    }),
  };

  const window = {
    BRunnerTargetResolver: {},
    __BRUNNER_MAPPER__: {},
    __BRUNNER_MAPPER_TEST_HOOK__: true,
    innerWidth: 800,
    innerHeight: 500,
    location: {
      href: "http://127.0.0.1:8765/tests/fixtures/resolve-acceptance.html",
    },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    setTimeout(callback) {
      callback();
      return 1;
    },
  };
  window.window = window;
  window.top = window;

  const context = vm.createContext({
    window,
    document,
    Element: FakeElement,
    XPathResult: { ORDERED_NODE_SNAPSHOT_TYPE: 7 },
    console: { error() {}, log() {}, warn() {} },
    setTimeout: window.setTimeout,
    clearTimeout() {},
  });
  vm.runInContext(mapperSource, context);

  const MapperClass = window.__BRUNNER_MAPPER_CLASS__;
  const mapper = Object.create(MapperClass.prototype);
  mapper.cancelledRunIds = new Set();
  mapper.withMapperRuntimeResolution = (payload) => payload;
  mapper.createExecutionDiagnostics = (_step, resolved, finalReason) => ({
    mapperState: resolved?.mapperState || "",
    finalReason,
  });
  mapper.isVisibleElement = () => visible;
  mapper.resolveStepTarget = () => ({
    element: elements[0] || null,
    mode: "direct",
    mapperState: "resolved",
    strategy: "css_selector",
    value: "#results-table",
    confidence: 68,
    attempts: [],
  });

  return { document, elements, mapper, window };
}

function resolveStep(config = {}, target = null) {
  return {
    action: "element.resolve",
    version: 1,
    config: {
      mode: "resolve_known",
      resultCardinality: "one",
      visibilityRequirement: "any",
      ...config,
    },
    data: {
      target: target || {
        identifierType: "css",
        identifierValue: "#results-table",
      },
    },
  };
}

test("the finalized resolve step reports bounded component facts", async () => {
  const harness = createHarness();
  const result = await harness.mapper.executeStep(resolveStep());

  assert.equal(result.ok, true);
  assert.equal(result.value.mapperState, "resolved");
  assert.equal(result.value.matchCount, 1);
  assert.equal(result.value.component.componentId, "results-row-1");
  assert.equal(result.value.component.semanticType, "table");
  assert.equal(result.value.component.accessibleName, "Results");
  assert.equal(result.value.component.visible, true);
  assert.equal(result.value.component.interactable, true);
});

test("a direct explicit-locator match reports full confidence", async () => {
  const harness = createHarness();
  const result = await harness.mapper.executeStep(resolveStep());

  // The recorded resolver returns a strategy-preference score of 68 for a CSS
  // selector; a unique explicit match is a definite match, not a 0.68 guess.
  assert.equal(result.value.confidence, 100);
  assert.equal(result.value.component.confidence, 100);
});

test("a non-direct match keeps the resolver's real score", async () => {
  const harness = createHarness();
  harness.mapper.resolveStepTarget = () => ({
    element: harness.elements[0],
    mode: "fuzzy",
    mapperState: "resolved_with_fallback",
    strategy: "snapshot_fuzzy",
    value: "fuzzy",
    confidence: 82,
    attempts: [],
  });

  const result = await harness.mapper.executeStep(resolveStep());
  assert.equal(result.value.confidence, 82);
});

test("an unresolved target reports the mapper state without acting", async () => {
  const harness = createHarness();
  harness.mapper.resolveStepTarget = () => ({
    element: null,
    mode: "failed",
    mapperState: "not_found",
    strategy: null,
    value: null,
    confidence: 0,
    attempts: [],
  });

  const result = await harness.mapper.executeStep(resolveStep());
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.mapperState, "not_found");
  assert.equal(result.diagnostics.finalReason, "mapper_not_found");
});

test("a hidden element fails the visible requirement", async () => {
  const harness = createHarness({ visible: false });
  const result = await harness.mapper.executeStep(
    resolveStep({ visibilityRequirement: "visible" }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.finalReason, "target_not_visible");
});

test("a disabled element fails the interactable requirement", async () => {
  const harness = createHarness({ disabled: true });
  const result = await harness.mapper.executeStep(
    resolveStep({ visibilityRequirement: "interactable" }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.finalReason, "target_not_interactable");
});

test("cardinality all enumerates the complete bounded candidate set", async () => {
  const harness = createHarness({ matches: 4 });
  const result = await harness.mapper.executeStep(
    resolveStep({ mode: "find_dynamic", resultCardinality: "all" }, {
      identifierType: "css",
      identifierValue: "#results-table tbody tr",
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.value.matchCount, 4);
  assert.equal(result.value.components.length, 4);
  // Components cross the vm realm boundary, so compare as a host array.
  assert.deepEqual(
    Array.from(result.value.components, (entry) => entry.componentId),
    ["results-row-1", "results-row-2", "results-row-3", "results-row-4"],
  );
});

test("cardinality first takes one match after collecting the whole set", async () => {
  const harness = createHarness({ matches: 4 });
  const result = await harness.mapper.executeStep(
    resolveStep({ mode: "find_dynamic", resultCardinality: "first" }, {
      identifierType: "css",
      identifierValue: "#results-table tbody tr",
    }),
  );

  assert.equal(result.value.components.length, 1);
  assert.equal(result.value.matchCount, 4);
});

test("cardinality all fails closed without an explicit enumerable selector", async () => {
  const harness = createHarness({ matches: 4 });
  const result = await harness.mapper.executeStep(
    resolveStep({ mode: "find_dynamic", resultCardinality: "all" }, {
      identifierType: "visible_text",
      identifierValue: "Results",
    }),
  );

  assert.equal(result.ok, false);
  assert.equal(
    result.diagnostics.finalReason,
    "resolve_cardinality_requires_explicit_selector",
  );
});

test("candidate enumeration is bounded to 200 elements", async () => {
  const harness = createHarness({ matches: 260 });
  const result = await harness.mapper.executeStep(
    resolveStep({ mode: "find_dynamic", resultCardinality: "all" }, {
      identifierType: "css",
      identifierValue: "#results-table tbody tr",
    }),
  );

  assert.equal(result.value.components.length, 200);
});

test("an unsupported resolve version does not enter the finalized transport", async () => {
  const harness = createHarness();
  harness.mapper.executeFinalizedResolveElementStep = async () => {
    throw new Error("only version 1 may enter the finalized resolve transport");
  };

  const step = resolveStep();
  step.version = 2;
  const result = await harness.mapper.executeStep(step);

  assert.notEqual(result.ok, true);
});
