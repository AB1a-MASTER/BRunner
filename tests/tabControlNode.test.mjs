import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BookmarkFolderModes,
  BookmarkSelectorKinds,
  MultipleMatchBehaviors,
  TabControlErrorCodes,
  TabControlOperations,
  TabMatchModes,
  TabNotFoundBehaviors,
  TabReadiness,
  TabSelectorKinds,
  buildTabControlOutput,
  executeTabControl,
  selectRelativeTab,
  selectTabFromCandidates,
  tabControlNodeDefinition,
  validateTabControlConfig,
  verifyTabControlBeforeRetry,
} from "../BRunner/nodes/navigation/tab-control/index.js";
import {
  NodeErrorCodes,
  NodeExecutionError,
} from "../BRunner/nodes/shared/nodeContracts.js";
import { SideEffectStates } from "../BRunner/nodes/shared/executionPolicy.js";

test("Tab Control freezes the exact finalized definition and explicit controls", () => {
  assert.equal(tabControlNodeDefinition.type, "browser.tab.control");
  assert.equal(tabControlNodeDefinition.version, 1);
  assert.equal(tabControlNodeDefinition.contractKind, "finalized");
  assert.equal(tabControlNodeDefinition.catalogNumber, 3);
  assert.deepEqual(tabControlNodeDefinition.outputs, ["success", "error"]);
  assert.deepEqual(
    new Set(tabControlNodeDefinition.capabilities),
    new Set(["browser-tab", "side-effect", "async"]),
  );
  assert.deepEqual(
    new Set(Object.values(TabControlOperations)),
    new Set([
      "open_browser_new_tab",
      "open_url_in_new_tab",
      "switch_tab",
      "switch_relative_tab",
      "return_to_origin_tab",
      "close_tab",
      "focus_tab",
      "pin_tab",
      "unpin_tab",
      "mute_tab",
      "unmute_tab",
      "toggle_mute",
      "bookmark_page",
      "remove_bookmark",
    ]),
  );
  const fields = new Map(
    tabControlNodeDefinition.configSchema.map((field) => [field.key, field]),
  );
  for (const key of [
    "tabSelectorKind",
    "tabMatchMode",
    "multipleMatchBehavior",
    "relativeDirection",
    "relativeOffset",
    "wrapAround",
    "closeBehavior",
    "ifNotFound",
    "bookmarkFolderMode",
    "bookmarkSelectorKind",
    "removeAllBookmarkMatches",
  ]) {
    assert.equal(
      ["select", "boolean", "number"].includes(fields.get(key)?.kind),
      true,
      key,
    );
  }
  assert.equal(
    tabControlNodeDefinition.protectedPageBehavior.domAutomationAllowed,
    false,
  );
  assert.deepEqual(tabControlNodeDefinition.optionalServices, [
    "bookmarks",
    "permissions",
    "interactive-confirmation",
  ]);
});

test("Tab Control validator enforces selector, URL, bookmark, and expression rules", () => {
  const valid = validateTabControlConfig({
    operation: TabControlOperations.SwitchTab,
    tabSelectorKind: TabSelectorKinds.Title,
    tabSelectorValue: "{{ variables.title }}",
    tabMatchMode: TabMatchModes.Wildcard,
    multipleMatchBehavior: MultipleMatchBehaviors.FirstMatching,
    timeout: "{{ variables.timeout }}",
  }, { allowExpressions: true });
  assert.equal(valid.valid, true);

  for (const [config, text] of [
    [{
      operation: TabControlOperations.SwitchTab,
      tabSelectorKind: TabSelectorKinds.Title,
    }, /tabSelectorValue/],
    [{
      operation: TabControlOperations.OpenUrlInNewTab,
      url: "fruit search",
    }, /absolute URL/],
    [{
      operation: TabControlOperations.BookmarkPage,
      bookmarkFolderMode: BookmarkFolderModes.FolderId,
    }, /bookmarkFolderId/],
    [{
      operation: TabControlOperations.RemoveBookmark,
      bookmarkSelectorKind: BookmarkSelectorKinds.BookmarkId,
    }, /bookmarkId/],
  ]) {
    const result = validateTabControlConfig(config);
    assert.equal(result.valid, false);
    assert.match(result.errors[0], text);
  }
});

test("tab selector evaluates the complete set before ambiguity behavior", () => {
  const tabs = sampleTabs();
  assert.throws(
    () => selectTabFromCandidates({
      kind: TabSelectorKinds.Title,
      value: "Article",
      matchMode: TabMatchModes.Contains,
      multipleMatchBehavior: MultipleMatchBehaviors.Fail,
      tabs,
    }),
    (error) => (
      error.code === TabControlErrorCodes.AmbiguousSelector &&
      error.details.matchCount === 2
    ),
  );
  const first = selectTabFromCandidates({
    kind: TabSelectorKinds.Title,
    value: "Article",
    matchMode: TabMatchModes.Contains,
    multipleMatchBehavior: MultipleMatchBehaviors.FirstMatching,
    tabs,
  });
  assert.equal(first.tab.id, 2);
  assert.equal(first.matchCount, 2);

  const wildcard = selectTabFromCandidates({
    kind: TabSelectorKinds.Url,
    value: "https://one.example/article?",
    matchMode: TabMatchModes.Wildcard,
    tabs,
  });
  assert.equal(wildcard.tab.id, 2);
});

test("most recently opened uses only run creation sequence and never guesses", () => {
  const tabs = sampleTabs();
  const unavailable = selectTabFromCandidates({
    kind: TabSelectorKinds.MostRecentlyOpened,
    tabs,
  });
  assert.equal(unavailable.tab, null);

  const sequence = new Map([[2, 1], [3, 4]]);
  const selected = selectTabFromCandidates({
    kind: TabSelectorKinds.MostRecentlyOpened,
    tabs,
    creationSequence: sequence,
  });
  assert.equal(selected.tab.id, 3);

  const multiple = selectTabFromCandidates({
    kind: TabSelectorKinds.Title,
    value: "Article",
    matchMode: TabMatchModes.Contains,
    multipleMatchBehavior: MultipleMatchBehaviors.MostRecentlyOpened,
    tabs,
    creationSequence: sequence,
  });
  assert.equal(multiple.tab.id, 3);
});

test("relative selection is ordered, bounded, and wraps only when enabled", () => {
  const tabs = sampleTabs();
  assert.equal(selectRelativeTab({
    currentTab: tabs[0],
    tabs,
    direction: "right",
    offset: 2,
  }).tab.id, 3);
  assert.equal(selectRelativeTab({
    currentTab: tabs[0],
    tabs,
    direction: "left",
    offset: 1,
  }).tab, null);
  assert.equal(selectRelativeTab({
    currentTab: tabs[0],
    tabs,
    direction: "previous",
    offset: 1,
    wrapAround: true,
  }).tab.id, 3);
});

test("open operations create protected and URL tabs with bounded outputs", async () => {
  const harness = createHarness();
  const browserNewTab = await executeTabControl({
    config: {
      operation: TabControlOperations.OpenBrowserNewTab,
      waitUntil: TabReadiness.DomReady,
      saveTabReferenceAs: "new_tab",
    },
    services: harness.services,
    tab: harness.origin,
    originTab: harness.origin,
  });
  assert.equal(browserNewTab.output.createdTab.url, "chrome://newtab/");
  assert.equal(browserNewTab.output.pageCapability, "tab_control_only");
  assert.equal(browserNewTab.warnings[0].code, NodeErrorCodes.ProtectedPage);
  assert.equal(harness.references.get("new_tab").tabId, 4);

  const urlTab = await executeTabControl({
    config: {
      operation: TabControlOperations.OpenUrlInNewTab,
      url: "https://new.example/",
      openInBackground: true,
      waitUntil: TabReadiness.NavigationStart,
    },
    services: harness.services,
    tab: harness.origin,
    originTab: harness.origin,
  });
  assert.equal(urlTab.output.createdTab.id, 5);
  assert.equal(urlTab.output.createdTab.active, false);
});

test("open URL reuses one exact URL and rejects ambiguous reuse", async () => {
  const harness = createHarness();
  const reused = await executeTabControl({
    config: {
      operation: TabControlOperations.OpenUrlInNewTab,
      url: "https://one.example/article1",
      reuseMatchingTab: true,
    },
    services: harness.services,
    tab: harness.origin,
    originTab: harness.origin,
  });
  assert.equal(reused.output.tab.id, 2);
  assert.equal(harness.calls.some((call) => call[0] === "create"), false);

  harness.tabs.set(7, {
    ...structuredClone(harness.tabs.get(2)),
    id: 7,
    index: 3,
  });
  await assert.rejects(
    executeTabControl({
      config: {
        operation: TabControlOperations.OpenUrlInNewTab,
        url: "https://one.example/article1",
        reuseMatchingTab: true,
      },
      services: harness.services,
      tab: harness.origin,
      originTab: harness.origin,
    }),
    (error) => error.code === TabControlErrorCodes.AmbiguousSelector,
  );
});

test("switch, relative, origin, focus, pin, and mute operations use exact classes", async (t) => {
  const cases = [
    {
      operation: TabControlOperations.SwitchTab,
      config: {
        tabSelectorKind: TabSelectorKinds.Id,
        tabSelectorValue: 2,
      },
      expected: 2,
    },
    {
      operation: TabControlOperations.SwitchRelativeTab,
      config: { relativeDirection: "right", relativeOffset: 1 },
      expected: 2,
    },
    {
      operation: TabControlOperations.ReturnToOriginTab,
      current: 2,
      expected: 1,
    },
    {
      operation: TabControlOperations.FocusTab,
      config: {
        tabSelectorKind: TabSelectorKinds.Id,
        tabSelectorValue: 2,
      },
      expected: 2,
      focus: true,
    },
    {
      operation: TabControlOperations.PinTab,
      config: {
        tabSelectorKind: TabSelectorKinds.Id,
        tabSelectorValue: 2,
      },
      expected: 2,
      pinned: true,
    },
    {
      operation: TabControlOperations.UnpinTab,
      config: {
        tabSelectorKind: TabSelectorKinds.Id,
        tabSelectorValue: 2,
      },
      expected: 2,
      pinned: false,
    },
    {
      operation: TabControlOperations.MuteTab,
      config: {
        tabSelectorKind: TabSelectorKinds.Id,
        tabSelectorValue: 2,
      },
      expected: 2,
      muted: true,
    },
    {
      operation: TabControlOperations.UnmuteTab,
      config: {
        tabSelectorKind: TabSelectorKinds.Id,
        tabSelectorValue: 2,
      },
      expected: 2,
      muted: false,
    },
    {
      operation: TabControlOperations.ToggleMute,
      config: {
        tabSelectorKind: TabSelectorKinds.Id,
        tabSelectorValue: 2,
      },
      expected: 2,
      muted: true,
    },
  ];

  for (const entry of cases) {
    await t.test(entry.operation, async () => {
      const harness = createHarness();
      const current = harness.tabs.get(entry.current || 1);
      const result = await executeTabControl({
        config: { operation: entry.operation, ...entry.config },
        services: harness.services,
        tab: current,
        originTab: harness.origin,
      });
      assert.equal(result.output.tab.id, entry.expected);
      if ("pinned" in entry) assert.equal(result.output.pinned, entry.pinned);
      if ("muted" in entry) assert.equal(result.output.muted, entry.muted);
      if (entry.focus) {
        assert.equal(harness.calls.some((call) => call[0] === "focusWindow"), true);
      }
    });
  }
});

test("close confirmation is explicit and close fallback is deterministic", async () => {
  const unavailable = createHarness();
  await assert.rejects(
    executeTabControl({
      config: {
        operation: TabControlOperations.CloseTab,
        tabSelectorKind: TabSelectorKinds.Id,
        tabSelectorValue: 2,
        confirmBeforeClose: true,
      },
      services: { tabs: unavailable.services.tabs },
      tab: unavailable.origin,
      originTab: unavailable.origin,
    }),
    (error) => (
      error.code === TabControlErrorCodes.CloseConfirmationUnavailable &&
      unavailable.tabs.has(2)
    ),
  );

  const harness = createHarness();
  harness.services.confirmation = {
    async request() {
      return { approved: true };
    },
  };
  const result = await executeTabControl({
    config: {
      operation: TabControlOperations.CloseTab,
      tabSelectorKind: TabSelectorKinds.Id,
      tabSelectorValue: 2,
      confirmBeforeClose: true,
      closeBehavior: "opener",
    },
    services: harness.services,
    tab: harness.origin,
    originTab: harness.origin,
  });
  assert.equal(harness.tabs.has(2), false);
  assert.equal(result.output.tab.id, 1);
});

test("not-found behavior either skips safely or reports the requested error route", async () => {
  const harness = createHarness();
  const skipped = await executeTabControl({
    config: {
      operation: TabControlOperations.SwitchTab,
      tabSelectorKind: TabSelectorKinds.Id,
      tabSelectorValue: 99,
      ifNotFound: TabNotFoundBehaviors.Skip,
    },
    services: harness.services,
    tab: harness.origin,
    originTab: harness.origin,
  });
  assert.equal(skipped.output.tab, null);
  assert.equal(skipped.warnings[0].code, NodeErrorCodes.TabNotFound);

  await assert.rejects(
    executeTabControl({
      config: {
        operation: TabControlOperations.SwitchTab,
        tabSelectorKind: TabSelectorKinds.Id,
        tabSelectorValue: 99,
        ifNotFound: TabNotFoundBehaviors.ErrorPort,
      },
      services: harness.services,
      tab: harness.origin,
      originTab: harness.origin,
    }),
    (error) => (
      error.code === NodeErrorCodes.TabNotFound &&
      error.details.requestedRoute === "error"
    ),
  );
});

test("bookmark permission, idempotence, explicit removal, and duplicate safety are stable", async () => {
  const denied = createHarness({ bookmarkPermission: false });
  await assert.rejects(
    executeTabControl({
      config: {
        operation: TabControlOperations.BookmarkPage,
        tabSelectorKind: TabSelectorKinds.Id,
        tabSelectorValue: 2,
      },
      services: denied.services,
      tab: denied.origin,
      originTab: denied.origin,
    }),
    (error) => error.code === TabControlErrorCodes.BookmarkPermissionUnavailable,
  );

  const harness = createHarness();
  const first = await executeTabControl({
    config: {
      operation: TabControlOperations.BookmarkPage,
      tabSelectorKind: TabSelectorKinds.Id,
      tabSelectorValue: 2,
    },
    services: harness.services,
    tab: harness.origin,
    originTab: harness.origin,
  });
  const second = await executeTabControl({
    config: {
      operation: TabControlOperations.BookmarkPage,
      tabSelectorKind: TabSelectorKinds.Id,
      tabSelectorValue: 2,
    },
    services: harness.services,
    tab: harness.origin,
    originTab: harness.origin,
  });
  assert.equal(first.output.bookmarked, true);
  assert.equal(second.output.bookmarked, true);
  assert.equal(harness.bookmarks.size, 1);

  harness.bookmarks.set("duplicate", {
    id: "duplicate",
    parentId: "1",
    url: "https://one.example/article1",
  });
  await assert.rejects(
    executeTabControl({
      config: {
        operation: TabControlOperations.RemoveBookmark,
        tabSelectorKind: TabSelectorKinds.Id,
        tabSelectorValue: 2,
      },
      services: harness.services,
      tab: harness.origin,
      originTab: harness.origin,
    }),
    (error) => error.code === TabControlErrorCodes.AmbiguousSelector,
  );

  const removed = await executeTabControl({
    config: {
      operation: TabControlOperations.RemoveBookmark,
      tabSelectorKind: TabSelectorKinds.Id,
      tabSelectorValue: 2,
      removeAllBookmarkMatches: true,
    },
    services: harness.services,
    tab: harness.origin,
    originTab: harness.origin,
  });
  assert.equal(removed.output.bookmarked, false);
  assert.equal(harness.bookmarks.size, 0);
});

test("retry verification suppresses duplicate side effects and permits proven misses", async () => {
  const harness = createHarness();
  const opened = await verifyTabControlBeforeRetry({
    config: {
      operation: TabControlOperations.OpenUrlInNewTab,
      url: "https://one.example/article1",
    },
    services: harness.services,
    error: new NodeExecutionError(
      TabControlErrorCodes.OperationFailed,
      "readiness failed",
      {
        createdTabId: 2,
        sideEffectState: SideEffectStates.Unknown,
      },
    ),
  });
  assert.equal(opened.sideEffectState, SideEffectStates.Completed);

  const notStarted = await verifyTabControlBeforeRetry({
    config: {
      operation: TabControlOperations.SwitchTab,
      tabSelectorKind: TabSelectorKinds.Id,
      tabSelectorValue: 99,
    },
    services: harness.services,
    error: new NodeExecutionError(
      NodeErrorCodes.TabNotFound,
      "missing",
      { sideEffectState: SideEffectStates.NotStarted },
    ),
  });
  assert.equal(notStarted.result, "not_completed");
});

test("output builder retains the Navigate-compatible bounded tab shape", () => {
  const output = buildTabControlOutput({
    operation: TabControlOperations.SwitchTab,
    originTab: sampleTabs()[0],
    tab: { ...sampleTabs()[1], arbitrary: "discarded" },
    createdTab: null,
    matchedBy: "id",
    pinned: false,
    muted: true,
    bookmarked: null,
  });
  assert.deepEqual(Object.keys(output.tab), [
    "id",
    "windowId",
    "index",
    "url",
    "title",
    "active",
    "status",
    "pageCapability",
  ]);
  assert.equal(output.tab.arbitrary, undefined);
});

function createHarness(options = {}) {
  const calls = [];
  const tabs = new Map(sampleTabs().map((tab) => [tab.id, structuredClone(tab)]));
  const references = new Map();
  const creationSequence = new Map([[2, 1], [3, 2]]);
  const bookmarks = new Map();
  let nextTabId = 4;
  let nextBookmarkId = 1;
  const origin = tabs.get(1);

  const services = {
    tabs: {
      async resolve(request) {
        const referencedTab = request.kind === TabSelectorKinds.SavedReference
          ? references.get(String(request.value))
          : null;
        return selectTabFromCandidates({
          ...request,
          referencedTab,
          tabs: [...tabs.values()],
          creationSequence,
        });
      },
      async resolveRelative(request) {
        return selectRelativeTab({ ...request, tabs: [...tabs.values()] });
      },
      async get(id) {
        const tab = tabs.get(Number(id));
        if (!tab) throw new Error("missing");
        return structuredClone(tab);
      },
      async create(properties) {
        calls.push(["create", properties]);
        const tab = {
          id: nextTabId++,
          windowId: properties.windowId ?? 9,
          index: tabs.size,
          active: properties.active !== false,
          status: "complete",
          url: properties.url,
          title: "Created",
          openerTabId: properties.openerTabId,
          pinned: false,
          mutedInfo: { muted: false },
        };
        tabs.set(tab.id, tab);
        creationSequence.set(tab.id, Math.max(0, ...creationSequence.values()) + 1);
        return structuredClone(tab);
      },
      async activate(id) {
        calls.push(["activate", id]);
        for (const tab of tabs.values()) tab.active = tab.id === Number(id);
        return structuredClone(tabs.get(Number(id)));
      },
      async focusWindow(id) {
        calls.push(["focusWindow", id]);
      },
      async updateState(id, patch) {
        calls.push(["updateState", id, patch]);
        const tab = tabs.get(Number(id));
        if ("pinned" in patch) tab.pinned = patch.pinned;
        if ("muted" in patch) tab.mutedInfo = { muted: patch.muted };
        return structuredClone(tab);
      },
      async remove(id) {
        calls.push(["remove", id]);
        tabs.delete(Number(id));
      },
      async resolveCloseFallback(tab, behavior) {
        if (behavior === "opener") return tabs.get(tab.openerTabId) || null;
        return null;
      },
      async removeReferencesForTab(id) {
        for (const [name, reference] of references) {
          if (Number(reference.tabId) === Number(id)) references.delete(name);
        }
      },
      async saveReference(name, reference) {
        references.set(name, structuredClone(reference));
      },
      async waitForReadiness() {},
    },
    bookmarks: {
      async hasPermission() {
        return options.bookmarkPermission !== false;
      },
      async getDefaultBarId() {
        return "1";
      },
      async findByUrl(url) {
        return [...bookmarks.values()]
          .filter((bookmark) => bookmark.url === url)
          .map((bookmark) => structuredClone(bookmark));
      },
      async getById(id) {
        return bookmarks.has(String(id))
          ? [structuredClone(bookmarks.get(String(id)))]
          : [];
      },
      async create(value) {
        const id = String(nextBookmarkId++);
        bookmarks.set(id, { id, ...structuredClone(value) });
      },
      async remove(id) {
        bookmarks.delete(String(id));
      },
    },
  };

  return {
    bookmarks,
    calls,
    creationSequence,
    origin,
    references,
    services,
    tabs,
  };
}

function sampleTabs() {
  return [
    {
      id: 1,
      windowId: 9,
      index: 0,
      active: true,
      status: "complete",
      url: "https://start.example/",
      title: "Start",
      pinned: false,
      mutedInfo: { muted: false },
    },
    {
      id: 2,
      windowId: 9,
      index: 1,
      active: false,
      status: "complete",
      url: "https://one.example/article1",
      title: "Article One",
      openerTabId: 1,
      pinned: false,
      mutedInfo: { muted: false },
    },
    {
      id: 3,
      windowId: 9,
      index: 2,
      active: false,
      status: "complete",
      url: "https://two.example/article2",
      title: "Article Two",
      openerTabId: 1,
      pinned: false,
      mutedInfo: { muted: false },
    },
  ];
}
