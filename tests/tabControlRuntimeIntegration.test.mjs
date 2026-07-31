import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FinalizedNodeRoutes,
  executeFinalizedNode,
} from "../BRunner/nodes/runtime/executeFinalizedNode.js";
import {
  TabControlOperations,
  executeTabControl,
  tabControlNodeDefinition,
  verifyTabControlBeforeRetry,
} from "../BRunner/nodes/navigation/tab-control/index.js";
import {
  NodeErrorCodes,
  NodeExecutionError,
  NodeStatuses,
} from "../BRunner/nodes/shared/nodeContracts.js";
import {
  SideEffectStates,
} from "../BRunner/nodes/shared/executionPolicy.js";

test("finalized runtime bypasses Tab Control without browser side effects", async () => {
  let executed = false;
  const values = {};
  const outcome = await executeFinalizedNode({
    nodeId: "tab-disabled",
    nodeType: "browser.tab.control",
    nodeVersion: 1,
    definition: tabControlNodeDefinition,
    config: { enabled: false },
    executor: async () => {
      executed = true;
    },
  }, {
    registry: {
      set(path, value) {
        values[path] = value;
      },
    },
    logger() {},
  });
  assert.equal(executed, false);
  assert.equal(outcome.result.status, NodeStatuses.SkippedDisabled);
  assert.equal(outcome.route, FinalizedNodeRoutes.Success);
  assert.equal(values["nodes.tab-disabled.output"], null);
});

test("finalized runtime retries one proven tab-not-found race", async () => {
  const tab = browserTab();
  let resolveCount = 0;
  const tabs = {
    async resolve() {
      resolveCount += 1;
      return resolveCount === 1
        ? { tab: null, matchedBy: "id" }
        : { tab: structuredClone(tab), matchedBy: "id" };
    },
    async activate() {
      return { ...structuredClone(tab), active: true };
    },
    async get() {
      return structuredClone(tab);
    },
  };
  const config = {
    operation: TabControlOperations.SwitchTab,
    tabSelectorKind: "id",
    tabSelectorValue: "2",
    retryCount: 1,
    timeout: 100,
  };
  const outcome = await executeFinalizedNode({
    nodeId: "tab-retry",
    nodeType: "browser.tab.control",
    nodeVersion: 1,
    definition: tabControlNodeDefinition,
    config,
    executor: (context) => executeTabControl({
      ...context,
      tab: browserTab(1),
      originTab: browserTab(1),
    }),
    verifyBeforeRetry: ({ error }) => verifyTabControlBeforeRetry({
      config,
      services: { tabs },
      error,
    }),
  }, services({ tabs }));

  assert.equal(outcome.route, FinalizedNodeRoutes.Success);
  assert.equal(outcome.result.execution.attempt, 2);
  assert.equal(outcome.result.output.tab.id, 2);
  assert.equal(resolveCount, 2);
});

test("finalized runtime publishes Tab Control aliases, clipboard data, and logs", async () => {
  const tab = browserTab();
  const values = {};
  const publications = [];
  const events = [];
  const tabs = successfulTabs(tab);
  const config = {
    operation: TabControlOperations.SwitchTab,
    tabSelectorKind: "current",
    timeout: 100,
    saveOutputAs: "selected_tab",
    saveToWorkflowClipboard: "replace",
    workflowClipboardEntry: "selected_tab",
  };
  const outcome = await executeFinalizedNode({
    nodeId: "tab-output",
    nodeType: "browser.tab.control",
    nodeVersion: 1,
    definition: tabControlNodeDefinition,
    config,
    executor: (context) => executeTabControl({
      ...context,
      tab,
      originTab: tab,
    }),
  }, {
    ...services({ tabs }),
    registry: {
      set(path, value) {
        values[path] = structuredClone(value);
      },
    },
    workflowClipboard: {
      publish(value) {
        publications.push(structuredClone(value));
      },
    },
    logger(event) {
      events.push(structuredClone(event));
    },
  });

  assert.deepEqual(values["variables.selected_tab"], outcome.result.output);
  assert.deepEqual(publications[0], {
    mode: "replace",
    key: "selected_tab",
    value: outcome.result.output,
    nodeId: "tab-output",
  });
  assert.deepEqual(events.map((event) => event.event), [
    "node_started",
    "node_completed",
  ]);
});

test("finalized runtime routes stable Tab Control failures through error", async () => {
  const tab = browserTab();
  const tabs = {
    async resolve() {
      return { tab: null, matchedBy: "id" };
    },
  };
  const config = {
    operation: TabControlOperations.SwitchTab,
    tabSelectorKind: "id",
    tabSelectorValue: "99",
    ifNotFound: "error_port",
    onError: "error_port",
    retryCount: 0,
    timeout: 100,
  };
  const outcome = await executeFinalizedNode({
    nodeId: "tab-error",
    nodeType: "browser.tab.control",
    nodeVersion: 1,
    definition: tabControlNodeDefinition,
    config,
    executor: (context) => executeTabControl({
      ...context,
      tab,
      originTab: tab,
    }),
    selectFailureRoute(error) {
      return error?.details?.requestedRoute === "error"
        ? FinalizedNodeRoutes.Error
        : null;
    },
  }, services({ tabs }));

  assert.equal(outcome.route, FinalizedNodeRoutes.Error);
  assert.equal(outcome.result.errors[0].code, NodeErrorCodes.TabNotFound);
  assert.equal(outcome.result.errors[0].category, "tab");
});

test("finalized runtime reports Tab Control timeout and cancellation distinctly", async (t) => {
  await t.test("timeout", async () => {
    const outcome = await executeFinalizedNode({
      nodeId: "tab-timeout",
      nodeType: "browser.tab.control",
      nodeVersion: 1,
      definition: tabControlNodeDefinition,
      config: {
        operation: TabControlOperations.SwitchTab,
        tabSelectorKind: "current",
        retryCount: 0,
        timeout: 10,
      },
      executor: async () => {
        throw new NodeExecutionError(
          NodeErrorCodes.Timeout,
          "Tab Control execution timed out.",
          {
            retryable: false,
            sideEffectState: SideEffectStates.Unknown,
          },
        );
      },
    }, services({ tabs: successfulTabs(browserTab()) }));
    assert.equal(outcome.result.status, NodeStatuses.TimedOut);
    assert.equal(outcome.result.errors[0].code, NodeErrorCodes.Timeout);
  });

  await t.test("cancellation", async () => {
    const outcome = await executeFinalizedNode({
      nodeId: "tab-cancelled",
      nodeType: "browser.tab.control",
      nodeVersion: 1,
      definition: tabControlNodeDefinition,
      config: {
        operation: TabControlOperations.SwitchTab,
        tabSelectorKind: "current",
        timeout: 10,
      },
      executor: executeTabControl,
    }, {
      ...services({ tabs: successfulTabs(browserTab()) }),
      isCancelled: () => true,
    });
    assert.equal(outcome.result.status, NodeStatuses.Cancelled);
    assert.equal(outcome.result.errors[0].code, NodeErrorCodes.Cancelled);
  });
});

test("retry verification blocks an uncertain mutation and recognizes completed close", async () => {
  const existing = browserTab();
  const uncertain = await verifyTabControlBeforeRetry({
    config: {
      operation: TabControlOperations.ToggleMute,
      tabSelectorKind: "current",
    },
    services: { tabs: successfulTabs(existing) },
    error: new NodeExecutionError(
      "browser.tab.control/OPERATION_FAILED",
      "uncertain",
      {
        tabId: 2,
        sideEffectState: SideEffectStates.Unknown,
      },
    ),
  });
  assert.equal(uncertain.result, "unknown");

  const closed = await verifyTabControlBeforeRetry({
    config: {
      operation: TabControlOperations.CloseTab,
      tabSelectorKind: "id",
      tabSelectorValue: 2,
    },
    services: {
      tabs: {
        async get() {
          throw new Error("closed");
        },
      },
    },
    error: new NodeExecutionError(
      "browser.tab.control/OPERATION_FAILED",
      "after close",
      {
        tabId: 2,
        sideEffectState: SideEffectStates.Unknown,
      },
    ),
  });
  assert.equal(closed.sideEffectState, SideEffectStates.Completed);
});

function services({ tabs }) {
  return {
    tabs,
    registry: { set() {} },
    logger() {},
    async delay() {},
    async withTimeout(task) {
      return await task(new AbortController().signal);
    },
  };
}

function successfulTabs(tab) {
  return {
    async resolve() {
      return { tab: structuredClone(tab), matchedBy: "current" };
    },
    async activate() {
      return { ...structuredClone(tab), active: true };
    },
    async get() {
      return structuredClone(tab);
    },
  };
}

function browserTab(id = 2) {
  return {
    id,
    windowId: 9,
    index: id - 1,
    url: "https://example.com/",
    title: "Example",
    active: id === 1,
    status: "complete",
    pinned: false,
    mutedInfo: { muted: false },
  };
}
