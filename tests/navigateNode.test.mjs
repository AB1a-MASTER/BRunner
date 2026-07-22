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
  SideEffectStates,
} from "../BRunner/nodes/shared/executionPolicy.js";
import {
  NavigateDestinations,
  NavigateNoHistoryBehaviors,
  NavigateOperations,
  NavigateReadiness,
  NavigateTabSources,
  executeNavigate,
  navigateNodeDefinition,
  normalizeNavigateConfig,
  normalizeStrictNavigationUrl,
  verifyNavigateBeforeRetry,
} from "../BRunner/nodes/navigation/navigate/index.js";

function createHarness(options = {}) {
  let now = 1000;
  const calls = [];
  const references = new Map();
  const tabsById = new Map();
  const initial = {
    id: 1,
    windowId: 7,
    index: 0,
    url: options.initialUrl || "https://start.example/",
    title: "Start",
    active: true,
    status: "complete",
  };
  tabsById.set(initial.id, initial);
  let nextId = 2;
  let navigateFailures = Number(options.navigateFailures || 0);

  const tabs = {
    async resolve(request) {
      calls.push(["resolve", request.source]);
      return clone(initial);
    },
    async get(id) {
      calls.push(["get", id]);
      return tabsById.has(id) ? clone(tabsById.get(id)) : null;
    },
    async navigate(id, url) {
      calls.push(["navigate", id, url]);
      if (navigateFailures > 0) {
        navigateFailures -= 1;
        throw new Error("temporary navigation failure");
      }
      const tab = tabsById.get(id);
      Object.assign(tab, { url, status: "loading" });
      return clone(tab);
    },
    async create(properties) {
      calls.push(["create", clone(properties)]);
      const tab = {
        id: nextId++,
        windowId: properties.windowId ?? initial.windowId,
        index: tabsById.size,
        url: properties.url,
        title: "Created",
        active: properties.active === true,
        status: "loading",
      };
      tabsById.set(tab.id, tab);
      return clone(tab);
    },
    async back(id) {
      calls.push(["back", id]);
      if (options.actionNoHistory) {
        return { performed: false, reason: "no_history" };
      }
      const tab = tabsById.get(id);
      tab.url = "https://previous.example/";
      return clone(tab);
    },
    async forward(id) {
      calls.push(["forward", id]);
      const tab = tabsById.get(id);
      tab.url = "https://forward.example/";
      return clone(tab);
    },
    async reload(id) {
      calls.push(["reload", id]);
      return clone(tabsById.get(id));
    },
    async waitForReadiness(id, state) {
      calls.push(["wait", id, state]);
      const tab = tabsById.get(id);
      if (options.redirectUrl) tab.url = options.redirectUrl;
      tab.status = "complete";
      return { state };
    },
    async saveReference(name, reference) {
      calls.push(["saveReference", name]);
      references.set(name, clone(reference));
    },
    async verifyNavigation(request) {
      calls.push(["verifyNavigation", clone(request)]);
      if (options.verification) return clone(options.verification);
      return null;
    },
  };

  if (options.canGoBack !== undefined) {
    tabs.canGoBack = async () => options.canGoBack;
  }
  if (options.canGoForward !== undefined) {
    tabs.canGoForward = async () => options.canGoForward;
  }

  return {
    calls,
    references,
    tabsById,
    tabs,
    services: {
      tabs,
      clock() {
        now += 5;
        return now;
      },
    },
    current: initial,
  };
}

test("Navigate definition exposes the finalized package contract", () => {
  assert.equal(navigateNodeDefinition.type, "browser.navigate");
  assert.equal(navigateNodeDefinition.version, 1);
  assert.deepEqual(
    navigateNodeDefinition.outputPorts.map((port) => port.id),
    ["success", "error"],
  );
  assert.equal(navigateNodeDefinition.retrySafety, "verify_before_retry");
  assert.equal(navigateNodeDefinition.defaultRetryCount, 1);
  assert.equal(navigateNodeDefinition.hostClassification, "none");
  assert.equal(navigateNodeDefinition.configSchema.length >= 10, true);
  assert.equal(Object.isFrozen(navigateNodeDefinition), true);
  assert.equal(
    navigateNodeDefinition.outputSchema.required.includes("currentUrl"),
    true,
  );
});

test("Navigate configuration validates all enums and strict URLs", () => {
  const config = normalizeNavigateConfig({
    operation: "goto_url",
    tabSource: "active",
    url: "https://example.com/path?q=one",
    openDestinationIn: "new_tab",
    waitUntil: "network_idle",
    timeout: 2500,
    onNoHistory: "continue",
    protectedPagePolicy: "wait_until_supported",
  });
  assert.equal(config.tabSource, NavigateTabSources.Active);
  assert.equal(config.openDestinationIn, NavigateDestinations.NewTab);
  assert.equal(config.url, "https://example.com/path?q=one");

  assert.throws(
    () => normalizeStrictNavigationUrl("example search words"),
    (error) => error.code === NodeErrorCodes.CONFIG_INVALID,
  );
  assert.throws(
    () => normalizeNavigateConfig({ operation: "unknown" }),
    (error) => error.code === NodeErrorCodes.CONFIG_INVALID,
  );
  assert.throws(
    () => normalizeNavigateConfig({
      operation: NavigateOperations.Back,
      openDestinationIn: NavigateDestinations.NewTab,
    }),
    (error) => error.code === NodeErrorCodes.CONFIG_INVALID,
  );
  assert.throws(
    () => normalizeNavigateConfig({
      tabSource: NavigateTabSources.SavedReference,
    }),
    (error) => error.code === NodeErrorCodes.CONFIG_INVALID,
  );
});

test("goto_url publishes redirect URL, readiness, and a saved tab reference", async () => {
  const harness = createHarness({
    redirectUrl: "https://final.example/account",
  });
  const result = await executeNavigate({
    config: {
      operation: NavigateOperations.GotoUrl,
      url: "https://requested.example/account",
      waitUntil: NavigateReadiness.DomReady,
      saveTabReferenceAs: "account",
    },
    services: harness.services,
    tab: harness.current,
  });

  assert.equal(result.output.previousUrl, "https://start.example/");
  assert.equal(result.output.currentUrl, "https://final.example/account");
  assert.equal(result.output.navigationState, NavigateReadiness.DomReady);
  assert.equal(result.output.operation, NavigateOperations.GotoUrl);
  assert.deepEqual(harness.references.get("account"), {
    kind: "tab",
    tabId: 1,
    windowId: 7,
  });
  assert.equal(harness.calls.some((call) => call[0] === "navigate"), true);
  assert.equal(harness.calls.some((call) => call[0] === "wait"), true);
});

test("back handles unavailable history as fail, skip, or continue", async () => {
  const failing = createHarness({ canGoBack: false });
  await assert.rejects(
    executeNavigate({
      config: {
        operation: NavigateOperations.Back,
        onNoHistory: NavigateNoHistoryBehaviors.Fail,
      },
      services: failing.services,
      tab: failing.current,
    }),
    (error) =>
      error.code === NodeErrorCodes.VALIDATION_FAILED &&
      error.details?.reason === "no_history",
  );

  for (const behavior of [
    NavigateNoHistoryBehaviors.Skip,
    NavigateNoHistoryBehaviors.Continue,
  ]) {
    const harness = createHarness({ canGoBack: false });
    const result = await executeNavigate({
      config: {
        operation: NavigateOperations.Back,
        onNoHistory: behavior,
      },
      services: harness.services,
      tab: harness.current,
    });
    assert.equal(result.output.navigationState, "no_history_" + (
      behavior === NavigateNoHistoryBehaviors.Skip ? "skipped" : "continued"
    ));
    assert.equal(
      harness.calls.some((call) => call[0] === "back"),
      false,
    );
    assert.equal(result.warnings.length, 1);
  }
});

test("history action may report no history when preflight is unavailable", async () => {
  const harness = createHarness({ actionNoHistory: true });
  const result = await executeNavigate({
    config: {
      operation: NavigateOperations.Back,
      onNoHistory: NavigateNoHistoryBehaviors.Continue,
    },
    services: harness.services,
    tab: harness.current,
  });
  assert.equal(result.output.navigationState, "no_history_continued");
  assert.equal(result.output.currentUrl, "https://start.example/");
});

test("reload executes once and can avoid a readiness wait", async () => {
  const harness = createHarness();
  const result = await executeNavigate({
    config: {
      operation: NavigateOperations.Reload,
      waitUntil: NavigateReadiness.None,
    },
    services: harness.services,
    tab: harness.current,
  });
  assert.equal(result.output.navigationState, NavigateReadiness.None);
  assert.equal(
    harness.calls.filter((call) => call[0] === "reload").length,
    1,
  );
  assert.equal(harness.calls.some((call) => call[0] === "wait"), false);
});

test("goto_url can create a new active destination tab", async () => {
  const harness = createHarness();
  const result = await executeNavigate({
    config: {
      operation: NavigateOperations.GotoUrl,
      url: "https://new.example/",
      openDestinationIn: NavigateDestinations.NewTab,
      waitUntil: NavigateReadiness.FullLoad,
    },
    services: harness.services,
    tab: harness.current,
  });
  assert.equal(result.output.tab.id, 2);
  assert.equal(result.output.currentUrl, "https://new.example/");
  assert.equal(result.output.previousUrl, "https://start.example/");
  assert.equal(harness.calls.some((call) => call[0] === "create"), true);
});

test("protected New Tab may navigate away, while protected DOM readiness obeys policy", async () => {
  const away = createHarness({ initialUrl: "chrome://newtab/" });
  const success = await executeNavigate({
    config: {
      operation: NavigateOperations.GotoUrl,
      url: "https://supported.example/",
      waitUntil: NavigateReadiness.DomReady,
    },
    services: away.services,
    tab: away.current,
  });
  assert.equal(success.output.currentUrl, "https://supported.example/");

  const protectedDestination = createHarness();
  await assert.rejects(
    executeNavigate({
      config: {
        operation: NavigateOperations.GotoUrl,
        url: "chrome://settings/",
        waitUntil: NavigateReadiness.DomReady,
        protectedPagePolicy: "fail",
      },
      services: protectedDestination.services,
      tab: protectedDestination.current,
    }),
    (error) => error.code === NodeErrorCodes.PROTECTED_PAGE,
  );

  const skipped = createHarness();
  const skippedResult = await executeNavigate({
    config: {
      operation: NavigateOperations.GotoUrl,
      url: "chrome://settings/",
      waitUntil: NavigateReadiness.DomReady,
      protectedPagePolicy: "skip",
    },
    services: skipped.services,
    tab: skipped.current,
  });
  assert.equal(skippedResult.output.navigationState, "protected_page_skipped");
});

test("retry verification suppresses a duplicate after URL change", async () => {
  const harness = createHarness();
  harness.tabsById.get(1).url = "https://changed.example/";
  const result = await verifyNavigateBeforeRetry({
    config: {
      operation: NavigateOperations.GotoUrl,
      url: "https://changed.example/",
    },
    services: harness.services,
    context: {},
    error: new NodeExecutionError(
      NodeErrorCodes.VALIDATION_FAILED,
      "Readiness failed.",
      {
        tabId: 1,
        previousUrl: "https://start.example/",
        targetUrl: "https://changed.example/",
        phase: "after_action",
        sideEffectState: SideEffectStates.Unknown,
      },
    ),
  });
  assert.equal(result.sideEffectState, SideEffectStates.Completed);
  assert.equal(result.result, "completed");
});

test("finalized runtime disables Navigate without resolving browser services", async () => {
  const values = {};
  const outcome = await executeFinalizedNode({
    nodeId: "navigate-disabled",
    nodeType: "browser.navigate",
    nodeVersion: navigateNodeDefinition.version,
    definition: navigateNodeDefinition,
    config: { enabled: false },
    executor: executeNavigate,
  }, {
    registry: {
      set(path, value) {
        values[path] = value;
      },
    },
    logger() {},
  });
  assert.equal(outcome.result.status, NodeStatuses.SKIPPED_DISABLED);
  assert.equal(outcome.route, FinalizedNodeRoutes.Success);
  assert.equal(values["nodes.navigate-disabled.output"], null);
});

test("finalized runtime retries one verified navigation failure and publishes output", async () => {
  const harness = createHarness({ navigateFailures: 1 });
  const values = {};
  const config = {
    operation: NavigateOperations.GotoUrl,
    url: "https://eventual.example/",
    waitUntil: NavigateReadiness.None,
    timeout: 100,
    retryCount: 1,
  };
  const outcome = await executeFinalizedNode({
    nodeId: "navigate-retry",
    nodeType: "browser.navigate",
    nodeVersion: navigateNodeDefinition.version,
    definition: navigateNodeDefinition,
    config,
    executor: executeNavigate,
    verifyBeforeRetry({ error }) {
      return verifyNavigateBeforeRetry({
        config,
        services: harness.services,
        context: {},
        error,
      });
    },
  }, {
    ...harness.services,
    registry: {
      set(path, value) {
        values[path] = clone(value);
      },
    },
    logger() {},
    async delay() {},
    async withTimeout(task) {
      return await task();
    },
  });

  assert.equal(outcome.result.status, NodeStatuses.COMPLETED);
  assert.equal(outcome.result.execution.attempt, 2);
  assert.equal(outcome.result.output.currentUrl, "https://eventual.example/");
  assert.equal(
    harness.calls.filter((call) => call[0] === "navigate").length,
    2,
  );
  assert.deepEqual(
    values["nodes.navigate-retry.output"],
    outcome.result.output,
  );
});

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}
