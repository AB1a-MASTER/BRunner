import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NavigateNoHistoryBehaviors,
  NavigateErrorCodes,
  NavigateOperations,
  NavigateReadiness,
  createChromeNavigateTabsService,
  executeNavigate,
} from "../BRunner/nodes/navigation/navigate/index.js";
import {
  NodeErrorCodes,
} from "../BRunner/nodes/shared/nodeContracts.js";

function createChromeHarness(options = {}) {
  let now = 0;
  let nextTabId = 2;
  const calls = [];
  const references = new Map();
  const tabs = new Map([
    [1, {
      id: 1,
      windowId: 4,
      index: 0,
      active: true,
      status: "complete",
      url: options.initialUrl || "https://start.example/",
      title: "Start",
    }],
  ]);
  let readinessProbe = 0;

  const chromeApi = {
    tabs: {
      async get(tabId) {
        calls.push(["get", tabId]);
        const tab = tabs.get(tabId);
        if (!tab) throw new Error(`No tab with id ${tabId}`);
        return structuredClone(tab);
      },
      async query(query) {
        calls.push(["query", query]);
        return [...tabs.values()]
          .filter((tab) => !query.active || tab.active)
          .map((tab) => structuredClone(tab));
      },
      async update(tabId, patch) {
        calls.push(["update", tabId, patch]);
        const tab = tabs.get(tabId);
        Object.assign(tab, patch, { status: "loading" });
        return structuredClone(tab);
      },
      async create(properties) {
        calls.push(["create", properties]);
        const tab = {
          id: nextTabId++,
          windowId: properties.windowId ?? 4,
          index: tabs.size,
          active: properties.active !== false,
          status: "loading",
          title: "Created",
          ...(options.createdWithPendingUrl
            ? { pendingUrl: properties.url }
            : { url: properties.url }),
        };
        tabs.set(tab.id, tab);
        return structuredClone(tab);
      },
      async goBack(tabId) {
        calls.push(["goBack", tabId]);
        if (options.noHistory) throw new Error("Cannot find history entry.");
        Object.assign(tabs.get(tabId), {
          url: "https://previous.example/",
          status: "complete",
        });
      },
      async goForward(tabId) {
        calls.push(["goForward", tabId]);
        Object.assign(tabs.get(tabId), {
          url: "https://forward.example/",
          status: "complete",
        });
      },
      async reload(tabId) {
        calls.push(["reload", tabId]);
        tabs.get(tabId).status = "complete";
      },
    },
    scripting: {
      async executeScript(request) {
        calls.push(["executeScript", request.target.tabId]);
        readinessProbe += 1;
        const tab = tabs.get(request.target.tabId);
        if (options.redirectUrl) tab.url = options.redirectUrl;
        if (!options.neverReady) tab.status = "complete";
        const readyState = options.neverReady
          ? "loading"
          : options.readyState || "complete";
        return [{
          result: {
            readyState,
            quietForMs: options.quietForMs ?? 700,
            documentUrl: options.networkErrorDocument
              ? "chrome-error://chromewebdata/"
              : tab.url,
            bodyClass: options.networkErrorDocument ? "neterror" : "",
            mainFrameError: options.networkErrorDocument === true,
            networkErrorCode: options.networkErrorDocument
              ? "ERR_CONNECTION_REFUSED"
              : "",
          },
        }];
      },
    },
  };

  const service = createChromeNavigateTabsService({
    chromeApi,
    tabsByRef: references,
    currentTab: options.withoutCurrentTab ? null : tabs.get(1),
    clock: () => now,
    delay: async (ms) => {
      now += ms;
    },
  });

  return {
    calls,
    chromeApi,
    readinessProbe: () => readinessProbe,
    references,
    service,
    tabs,
  };
}

test("Chrome adapter executes exact URL navigation, redirect readiness, and tab-reference save", async () => {
  const harness = createChromeHarness({
    redirectUrl: "https://final.example/customer",
  });
  const result = await executeNavigate({
    config: {
      operation: NavigateOperations.GotoUrl,
      url: "https://requested.example/customer",
      waitUntil: NavigateReadiness.DomReady,
      saveTabReferenceAs: "customer_tab",
    },
    services: { tabs: harness.service, clock: () => 10 },
    tab: harness.tabs.get(1),
  });

  assert.equal(result.output.currentUrl, "https://final.example/customer");
  assert.equal(result.output.navigationState, NavigateReadiness.DomReady);
  assert.equal(harness.references.get("customer_tab").id, 1);
  assert.equal(harness.calls.some((call) => call[0] === "update"), true);
  assert.equal(harness.calls.some((call) => call[0] === "executeScript"), true);
});

test("Chrome adapter opens a new tab and reports the created tab", async () => {
  const harness = createChromeHarness();
  const result = await executeNavigate({
    config: {
      operation: NavigateOperations.GotoUrl,
      url: "https://new.example/",
      openDestinationIn: "new_tab",
      waitUntil: NavigateReadiness.NavigationStart,
    },
    services: { tabs: harness.service },
    tab: harness.tabs.get(1),
  });

  assert.equal(result.output.tab.id, 2);
  assert.equal(result.output.currentUrl, "https://new.example/");
  assert.equal(harness.calls.filter((call) => call[0] === "create").length, 1);
});

test("Chrome adapter creates an independent tab when Studio has no runtime tab", async () => {
  const harness = createChromeHarness({ withoutCurrentTab: true });
  const result = await executeNavigate({
    config: {
      operation: NavigateOperations.GotoUrl,
      url: "https://studio-start.example/",
      openDestinationIn: "new_tab",
      waitUntil: NavigateReadiness.None,
    },
    services: { tabs: harness.service },
    tab: null,
  });

  assert.equal(result.output.previousUrl, null);
  assert.equal(result.output.tab.id, 2);
  const createCall = harness.calls.find((call) => call[0] === "create");
  assert.deepEqual(createCall[1], {
    url: "https://studio-start.example/",
    active: true,
  });
  assert.equal(harness.calls.some((call) => call[0] === "query"), false);
});

test("Chrome adapter recognizes a protected pending destination before DOM polling", async () => {
  const harness = createChromeHarness({
    withoutCurrentTab: true,
    createdWithPendingUrl: true,
  });

  await assert.rejects(
    executeNavigate({
      config: {
        operation: NavigateOperations.GotoUrl,
        url: "chrome://settings/",
        openDestinationIn: "new_tab",
        waitUntil: NavigateReadiness.DomReady,
        protectedPagePolicy: "fail",
      },
      services: { tabs: harness.service },
      tab: null,
    }),
    (error) => error.code === NodeErrorCodes.ProtectedPage,
  );
  assert.equal(harness.readinessProbe(), 0);
});

test("Chrome adapter converts Chrome's no-history rejection into Navigate continue behavior", async () => {
  const harness = createChromeHarness({ noHistory: true });
  const result = await executeNavigate({
    config: {
      operation: NavigateOperations.Back,
      onNoHistory: NavigateNoHistoryBehaviors.Continue,
      waitUntil: NavigateReadiness.None,
    },
    services: { tabs: harness.service },
    tab: harness.tabs.get(1),
  });

  assert.equal(result.output.navigationState, "no_history_continued");
  assert.equal(result.warnings.length, 1);
});

test("Chrome adapter enforces bounded readiness timeout with a stable timeout code", async () => {
  const harness = createChromeHarness({ neverReady: true });
  await assert.rejects(
    harness.service.waitForReadiness(1, NavigateReadiness.DomReady, {
      timeoutMs: 250,
    }),
    (error) => (
      error.code === NodeErrorCodes.Timeout &&
      error.details?.retryReason === "navigation_failure"
    ),
  );
  assert.equal(harness.readinessProbe() >= 3, true);
});

test("Chrome adapter rejects Chromium network-error documents as navigation failures", async (t) => {
  for (const readiness of [
    NavigateReadiness.DomReady,
    NavigateReadiness.FullLoad,
  ]) {
    await t.test(readiness, async () => {
      const harness = createChromeHarness({ networkErrorDocument: true });
      await assert.rejects(
        harness.service.waitForReadiness(1, readiness, {
          timeoutMs: 250,
        }),
        (error) => (
          error.code === NavigateErrorCodes.NavigationFailed &&
          error.category === "navigation" &&
          error.details?.errorCode === "ERR_CONNECTION_REFUSED" &&
          error.details?.retryable === false &&
          error.details?.finalReason === "chromium_network_error_document"
        ),
      );
      assert.equal(harness.readinessProbe(), 1);
    });
  }
});

test("Chrome adapter recognizes full-load and bounded network-idle readiness", async () => {
  const harness = createChromeHarness({ quietForMs: 650 });
  const fullLoad = await harness.service.waitForReadiness(
    1,
    NavigateReadiness.FullLoad,
    { timeoutMs: 500 },
  );
  const networkIdle = await harness.service.waitForReadiness(
    1,
    NavigateReadiness.NetworkIdle,
    { timeoutMs: 500 },
  );

  assert.equal(fullLoad.state, NavigateReadiness.FullLoad);
  assert.equal(networkIdle.state, NavigateReadiness.NetworkIdle);
  assert.equal(harness.readinessProbe(), 2);
});

test("Chrome adapter stops readiness polling when its abort signal is cancelled", async () => {
  const harness = createChromeHarness({ neverReady: true });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    harness.service.waitForReadiness(1, NavigateReadiness.NetworkIdle, {
      timeoutMs: 1000,
      signal: controller.signal,
    }),
    (error) => error.code === NodeErrorCodes.Cancelled,
  );
  assert.equal(harness.readinessProbe(), 0);
});

test("Chrome adapter waits for a supported destination after a protected page", async () => {
  const harness = createChromeHarness({ initialUrl: "chrome://newtab/" });
  let reads = 0;
  const originalGet = harness.chromeApi.tabs.get;
  harness.chromeApi.tabs.get = async (tabId) => {
    reads += 1;
    if (reads === 2) {
      Object.assign(harness.tabs.get(tabId), {
        url: "https://supported.example/",
        status: "complete",
      });
    }
    return await originalGet(tabId);
  };

  const tab = await harness.service.waitUntilSupported(1, { timeoutMs: 500 });
  assert.equal(tab.url, "https://supported.example/");
});
