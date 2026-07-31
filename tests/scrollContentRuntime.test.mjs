import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const mapperSource = await readFile(new URL(
  "../BRunner/content/mapper.js",
  import.meta.url,
), "utf8");

function createHarness() {
  class FakeElement {
    constructor({
      clientWidth = 800,
      clientHeight = 500,
      scrollWidth = clientWidth,
      scrollHeight = clientHeight,
      overflowX = "visible",
      overflowY = "visible",
      rect = null,
    } = {}) {
      this.clientWidth = clientWidth;
      this.clientHeight = clientHeight;
      this.scrollWidth = scrollWidth;
      this.scrollHeight = scrollHeight;
      this.scrollLeft = 0;
      this.scrollTop = 0;
      this.parentElement = null;
      this.childElementCount = 0;
      this.textContent = "";
      this.innerText = "";
      this.isConnected = true;
      this.style = { overflowX, overflowY };
      this.rect = rect || {
        left: 0,
        top: 0,
        right: clientWidth,
        bottom: clientHeight,
        width: clientWidth,
        height: clientHeight,
      };
    }

    scrollTo({ left = this.scrollLeft, top = this.scrollTop } = {}) {
      this.scrollLeft = clamp(left, 0, this.scrollWidth - this.clientWidth);
      this.scrollTop = clamp(top, 0, this.scrollHeight - this.clientHeight);
    }

    scrollBy({ left = 0, top = 0 } = {}) {
      this.scrollTo({
        left: this.scrollLeft + Number(left || 0),
        top: this.scrollTop + Number(top || 0),
      });
    }

    getBoundingClientRect() {
      return { ...this.rect };
    }

    querySelector() {
      return null;
    }
  }

  const pageRoot = new FakeElement({
    clientWidth: 800,
    clientHeight: 500,
    scrollWidth: 800,
    scrollHeight: 2000,
  });
  const body = new FakeElement({
    clientWidth: 800,
    clientHeight: 2000,
  });
  body.innerText = "Synthetic Scroll fixture";
  body.textContent = body.innerText;
  const document = {
    scrollingElement: pageRoot,
    documentElement: pageRoot,
    body,
    title: "Scroll test",
    querySelector() {
      return null;
    },
  };
  const window = {
    BRunnerTargetResolver: {},
    __BRUNNER_MAPPER__: {},
    __BRUNNER_MAPPER_TEST_HOOK__: true,
    innerWidth: 800,
    innerHeight: 500,
    scrollX: 0,
    scrollY: 0,
    devicePixelRatio: 1,
    location: {
      href: "http://127.0.0.1:8765/tests/fixtures/scroll-acceptance.html",
    },
    getComputedStyle(element) {
      return {
        display: "block",
        visibility: "visible",
        overflowX: element.style?.overflowX || "visible",
        overflowY: element.style?.overflowY || "visible",
      };
    },
    scrollTo({ left = window.scrollX, top = window.scrollY } = {}) {
      window.scrollX = clamp(left, 0, pageRoot.scrollWidth - window.innerWidth);
      window.scrollY = clamp(top, 0, pageRoot.scrollHeight - window.innerHeight);
      pageRoot.scrollLeft = window.scrollX;
      pageRoot.scrollTop = window.scrollY;
    },
    scrollBy({ left = 0, top = 0 } = {}) {
      window.scrollTo({
        left: window.scrollX + Number(left || 0),
        top: window.scrollY + Number(top || 0),
      });
    },
    requestAnimationFrame(callback) {
      callback();
    },
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
    console: {
      error() {},
      log() {},
      warn() {},
    },
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

  return {
    FakeElement,
    body,
    document,
    mapper,
    pageRoot,
    window,
  };
}

function finalizedConfig(overrides = {}) {
  return {
    operation: "by_amount",
    scrollTarget: "page",
    direction: "down",
    amount: 200,
    amountUnit: "pixels",
    alignment: "center",
    smooth: false,
    stopCondition: "scroll_end",
    stopValue: "",
    __scrollInspectOnly: false,
    ...overrides,
  };
}

test("content transport keeps provisional Scroll v1 separate from finalized v2", async () => {
  const harness = createHarness();
  harness.mapper.executeFinalizedScrollStep = async () => {
    throw new Error("v1 must not enter the v2 transport");
  };

  const result = await harness.mapper.executeStep({
    action: "browser.scroll",
    version: 1,
    config: { x: 0, y: 75 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.usedStrategy, "window.scrollBy");
  assert.equal(harness.window.scrollY, 75);
});

test("finalized page Scroll reports bounded amount and boundary telemetry", async () => {
  const harness = createHarness();
  const amount = await harness.mapper.executeStep({
    action: "browser.scroll",
    version: 2,
    config: finalizedConfig(),
  });
  assert.equal(amount.ok, true);
  assert.equal(amount.value.moved, true);
  assert.equal(amount.value.scrollCount, 1);
  assert.equal(amount.value.stopReason, "amount_complete");
  assert.equal(amount.value.finalPosition.y, 200);

  harness.window.scrollTo({ top: 1400 });
  const boundary = await harness.mapper.executeStep({
    action: "browser.scroll",
    version: 2,
    config: finalizedConfig({
      operation: "until_condition",
      amount: 200,
    }),
  });
  assert.equal(boundary.value.finalPosition.y, 1500);
  assert.equal(boundary.value.conditionMet, true);
  assert.equal(boundary.value.stopReason, "scroll_end");
});

test("finalized Scroll handles containers, elements, and unresolved targets", async () => {
  const harness = createHarness();
  const unready = new harness.FakeElement({
    clientHeight: 200,
    scrollHeight: 200,
    overflowY: "auto",
  });
  harness.mapper.resolveStepTarget = () => ({
    element: unready,
    mapperState: "resolved",
    strategy: "css",
    value: "#not-ready",
  });
  const unavailable = await harness.mapper.executeStep({
    action: "browser.scroll",
    version: 2,
    config: finalizedConfig({ scrollTarget: "container" }),
  });
  assert.equal(unavailable.ok, false);
  assert.equal(
    unavailable.diagnostics.finalReason,
    "scroll_container_not_ready",
  );
  assert.equal(unavailable.diagnostics.sideEffectState, "not_started");

  harness.mapper.resolveStepTarget = () => ({
    element: null,
    mapperState: "ambiguous",
  });
  const unresolved = await harness.mapper.executeStep({
    action: "browser.scroll",
    version: 2,
    config: finalizedConfig({ scrollTarget: "container" }),
  });
  assert.equal(unresolved.ok, false);
  assert.equal(unresolved.diagnostics.mapperState, "ambiguous");

  const container = new harness.FakeElement({
    clientHeight: 200,
    scrollHeight: 1000,
    overflowY: "auto",
  });
  const target = new harness.FakeElement({ clientHeight: 30 });
  target.parentElement = container;
  target.scrollIntoView = () => {
    container.scrollTop = 400;
  };
  harness.mapper.resolveStepTarget = () => ({
    element: target,
    mapperState: "resolved",
    strategy: "component_ref",
    value: "result-row",
  });
  const aligned = await harness.mapper.executeStep({
    action: "browser.scroll",
    version: 2,
    config: finalizedConfig({ operation: "to_element" }),
  });
  assert.equal(aligned.ok, true);
  assert.equal(aligned.value.finalPosition.y, 400);
  assert.equal(aligned.value.stopReason, "target_aligned");
});

test("finalized Scroll evaluates safe conditions without arbitrary code", async () => {
  const harness = createHarness();
  const marker = new harness.FakeElement({
    clientWidth: 20,
    clientHeight: 20,
  });
  marker.getBoundingClientRect = () => ({
    left: 20,
    top: 700 - harness.window.scrollY,
    right: 40,
    bottom: 720 - harness.window.scrollY,
    width: 20,
    height: 20,
  });
  harness.document.querySelector = (selector) => (
    selector === "#complete" ? marker : null
  );
  const firstSelectorAttempt = await harness.mapper.executeStep({
    action: "browser.scroll",
    version: 2,
    config: finalizedConfig({
      operation: "until_condition",
      stopCondition: "selector_visible",
      stopValue: "#complete",
    }),
  });
  assert.equal(firstSelectorAttempt.value.conditionMet, false);
  const secondSelectorAttempt = await harness.mapper.executeStep({
    action: "browser.scroll",
    version: 2,
    config: finalizedConfig({
      operation: "until_condition",
      stopCondition: "selector_visible",
      stopValue: "#complete",
    }),
  });
  assert.equal(secondSelectorAttempt.value.conditionMet, true);
  assert.equal(secondSelectorAttempt.value.stopReason, "condition_met");

  harness.body.innerText = "The final result is ready";
  const text = await harness.mapper.executeStep({
    action: "browser.scroll",
    version: 2,
    config: finalizedConfig({
      operation: "until_condition",
      stopCondition: "text_present",
      stopValue: "result is ready",
    }),
  });
  assert.equal(text.value.conditionMet, true);
});

test("inspection and cancellation never introduce an extra Scroll side effect", async () => {
  const harness = createHarness();
  harness.window.scrollTo({ top: 300 });
  const inspected = await harness.mapper.executeStep({
    action: "browser.scroll",
    version: 2,
    config: finalizedConfig({ __scrollInspectOnly: true }),
  });
  assert.equal(inspected.value.scrollCount, 0);
  assert.equal(inspected.value.moved, false);
  assert.equal(harness.window.scrollY, 300);

  harness.mapper.cancelledRunIds.add("cancelled-scroll");
  await assert.rejects(
    harness.mapper.executeStep({
      action: "browser.scroll",
      version: 2,
      config: finalizedConfig(),
    }, "cancelled-scroll"),
    /stopped by user/,
  );
  assert.equal(harness.window.scrollY, 300);
});

test("visible host preparation is vertical, bounded, and target-visible", async () => {
  const harness = createHarness();
  const prepared = await harness.mapper.prepareHostFallback({
    action: "browser.scroll",
    version: 2,
    config: finalizedConfig({ amount: 360 }),
  });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.action, "scroll");
  assert.equal(prepared.amount, -3);
  assert.equal(prepared.confidence, 1);
  assert.equal(prepared.visible, true);
  assert.equal(prepared.beforePosition.y, 0);

  const horizontal = await harness.mapper.prepareHostFallback({
    action: "browser.scroll",
    version: 2,
    config: finalizedConfig({ direction: "right" }),
  });
  assert.equal(horizontal.ok, false);
  assert.equal(
    horizontal.diagnostics.finalReason,
    "scroll_host_horizontal_unsupported",
  );
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(Number(value) || 0, Math.max(maximum, 0)));
}
