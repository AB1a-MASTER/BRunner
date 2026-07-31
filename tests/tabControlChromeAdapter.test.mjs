import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MultipleMatchBehaviors,
  TabSelectorKinds,
  createChromeBookmarksService,
  createChromeTabControlService,
} from "../BRunner/nodes/navigation/tab-control/index.js";

test("Chrome tab adapter tracks only tabs created during the run for recency", async () => {
  const harness = createChromeHarness();
  const unavailable = await harness.service.resolve({
    kind: TabSelectorKinds.MostRecentlyOpened,
  });
  assert.equal(unavailable.tab, null);

  const first = await harness.service.create({
    url: "https://created.example/one",
    active: false,
  });
  const second = await harness.service.create({
    url: "https://created.example/two",
    active: false,
  });
  const recent = await harness.service.resolve({
    kind: TabSelectorKinds.MostRecentlyOpened,
  });
  assert.equal(recent.tab.id, second.id);
  assert.equal(harness.service.creationSequence.has(first.id), true);
  assert.equal(harness.service.creationSequence.has(1), false);
});

test("Chrome adapter applies complete-set matching, relative wrap, state, focus, and references", async () => {
  const harness = createChromeHarness();
  const match = await harness.service.resolve({
    kind: TabSelectorKinds.Title,
    value: "Article",
    matchMode: "contains",
    multipleMatchBehavior: MultipleMatchBehaviors.FirstMatching,
  });
  assert.equal(match.tab.id, 2);
  assert.equal(match.matchCount, 2);

  const relative = await harness.service.resolveRelative({
    currentTab: harness.tabs.get(1),
    direction: "previous",
    offset: 1,
    wrapAround: true,
  });
  assert.equal(relative.tab.id, 3);

  const updated = await harness.service.updateState(2, {
    pinned: true,
    muted: true,
  });
  assert.equal(updated.pinned, true);
  assert.equal(updated.mutedInfo.muted, true);
  await harness.service.focusWindow(updated.windowId);
  await harness.service.saveReference("article", { tabId: 2 });
  assert.equal(harness.references.get("article").tabId, 2);
  await harness.service.removeReferencesForTab(2);
  assert.equal(harness.references.has("article"), false);
});

test("Chrome adapter resolves close fallbacks without invented recency", async () => {
  const harness = createChromeHarness();
  assert.equal(
    (await harness.service.resolveCloseFallback(harness.tabs.get(2), "opener")).id,
    1,
  );
  assert.equal(
    (await harness.service.resolveCloseFallback(harness.tabs.get(2), "left")).id,
    1,
  );
  assert.equal(
    (await harness.service.resolveCloseFallback(harness.tabs.get(2), "right")).id,
    3,
  );
  assert.equal(
    await harness.service.resolveCloseFallback(harness.tabs.get(2), "most_recent"),
    null,
  );

  const created = await harness.service.create({
    url: "https://created.example/",
    active: false,
    windowId: 9,
  });
  assert.equal(
    (
      await harness.service.resolveCloseFallback(
        harness.tabs.get(2),
        "most_recent",
      )
    ).id,
    created.id,
  );
});

test("Chrome bookmark adapter checks optional permission and exact bookmark APIs", async () => {
  const harness = createChromeHarness();
  const bookmarks = createChromeBookmarksService({
    chromeApi: harness.chromeApi,
  });
  assert.equal(await bookmarks.hasPermission(), true);
  assert.equal(await bookmarks.getDefaultBarId(), "1");
  const created = await bookmarks.create({
    parentId: "1",
    title: "Example",
    url: "https://example.com/",
  });
  assert.equal(
    (await bookmarks.findByUrl("https://example.com/"))[0].id,
    created.id,
  );
  assert.equal((await bookmarks.getById(created.id))[0].url, "https://example.com/");
  await bookmarks.remove(created.id);
  assert.deepEqual(await bookmarks.getById(created.id), []);
  assert.equal(
    harness.calls.some((call) => call[0] === "permissions.contains"),
    true,
  );
  assert.equal(
    harness.calls.some((call) => call[0] === "permissions.request"),
    false,
  );
});

function createChromeHarness() {
  const calls = [];
  const references = new Map();
  const tabs = new Map([
    [1, tab(1, 0, "Start", "https://start.example/", true)],
    [2, { ...tab(2, 1, "Article One", "https://one.example/", false), openerTabId: 1 }],
    [3, { ...tab(3, 2, "Article Two", "https://two.example/", false), openerTabId: 1 }],
  ]);
  const bookmarkRecords = new Map();
  let nextTabId = 4;
  let nextBookmarkId = 1;
  const chromeApi = {
    tabs: {
      async get(id) {
        calls.push(["tabs.get", id]);
        const value = tabs.get(Number(id));
        if (!value) throw new Error("missing");
        return structuredClone(value);
      },
      async query(query) {
        calls.push(["tabs.query", query]);
        return [...tabs.values()]
          .filter((value) => (
            query.windowId === undefined ||
            Number(value.windowId) === Number(query.windowId)
          ))
          .map((value) => structuredClone(value));
      },
      async create(properties) {
        calls.push(["tabs.create", properties]);
        const value = tab(
          nextTabId++,
          tabs.size,
          "Created",
          properties.url,
          properties.active !== false,
        );
        value.windowId = properties.windowId ?? 9;
        value.openerTabId = properties.openerTabId;
        tabs.set(value.id, value);
        return structuredClone(value);
      },
      async update(id, patch) {
        calls.push(["tabs.update", id, patch]);
        const value = tabs.get(Number(id));
        if ("active" in patch) {
          for (const candidate of tabs.values()) candidate.active = false;
        }
        Object.assign(value, patch);
        if ("muted" in patch) {
          value.mutedInfo = { muted: patch.muted };
          delete value.muted;
        }
        return structuredClone(value);
      },
      async remove(id) {
        calls.push(["tabs.remove", id]);
        tabs.delete(Number(id));
      },
    },
    windows: {
      async update(id, patch) {
        calls.push(["windows.update", id, patch]);
        return { id, ...patch };
      },
    },
    permissions: {
      async contains(value) {
        calls.push(["permissions.contains", value]);
        return true;
      },
    },
    bookmarks: {
      async getTree() {
        calls.push(["bookmarks.getTree"]);
        return [{
          id: "0",
          children: [{ id: "1", title: "bar", children: [] }],
        }];
      },
      async search(query) {
        calls.push(["bookmarks.search", query]);
        return [...bookmarkRecords.values()]
          .filter((record) => record.url === query.url)
          .map((record) => structuredClone(record));
      },
      async get(id) {
        calls.push(["bookmarks.get", id]);
        const record = bookmarkRecords.get(String(id));
        if (!record) throw new Error("missing");
        return [structuredClone(record)];
      },
      async create(value) {
        calls.push(["bookmarks.create", value]);
        const record = { id: String(nextBookmarkId++), ...structuredClone(value) };
        bookmarkRecords.set(record.id, record);
        return structuredClone(record);
      },
      async remove(id) {
        calls.push(["bookmarks.remove", id]);
        bookmarkRecords.delete(String(id));
      },
    },
    scripting: {
      async executeScript() {
        return [{
          result: {
            readyState: "complete",
            quietForMs: 1000,
            documentUrl: "https://example.com/",
          },
        }];
      },
    },
  };
  const service = createChromeTabControlService({
    chromeApi,
    tabsByRef: references,
    currentTab: tabs.get(1),
    delay: async () => {},
  });
  return {
    calls,
    chromeApi,
    references,
    service,
    tabs,
  };
}

function tab(id, index, title, url, active) {
  return {
    id,
    windowId: 9,
    index,
    title,
    url,
    active,
    status: "complete",
    pinned: false,
    mutedInfo: { muted: false },
  };
}
