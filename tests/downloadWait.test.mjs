import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createSafeDownloadMetadata,
  waitForDownload,
} from "../BRunner/core/downloadWait.js";

class FakeEvent {
  listeners = new Set();

  addListener(listener) {
    this.listeners.add(listener);
  }

  removeListener(listener) {
    this.listeners.delete(listener);
  }

  emit(value) {
    for (const listener of this.listeners) listener(value);
  }
}

class FakeDownloadsApi {
  constructor(items = []) {
    this.items = new Map(items.map((item) => [item.id, { ...item }]));
    this.onCreated = new FakeEvent();
    this.onChanged = new FakeEvent();
    this.onErased = new FakeEvent();
  }

  async search(query) {
    if (query.id !== undefined) {
      const item = this.items.get(query.id);
      return item ? [{ ...item }] : [];
    }

    return Array.from(this.items.values())
      .sort((left, right) => String(right.startTime).localeCompare(left.startTime))
      .map((item) => ({ ...item }));
  }

  create(item) {
    this.items.set(item.id, { ...item });
    this.onCreated.emit({ ...item });
  }

  update(id, patch) {
    this.items.set(id, { ...this.items.get(id), ...patch });
    this.onChanged.emit({ id });
  }
}

function download(overrides = {}) {
  return {
    id: 1,
    filename: "C:\\Users\\tester\\Downloads\\report.txt",
    url: "https://example.test/report.txt?token=secret",
    finalUrl: "https://cdn.example.test/report.txt?signature=secret",
    mime: "text/plain",
    bytesReceived: 12,
    totalBytes: 12,
    state: "complete",
    danger: "safe",
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    exists: true,
    paused: false,
    ...overrides,
  };
}

test("recent completed download returns safe metadata", async () => {
  const api = new FakeDownloadsApi([download()]);
  const result = await waitForDownload(
    { filenameContains: "report", timeoutMs: 100 },
    { downloadsApi: api },
  );

  assert.equal(result.filename, "report.txt");
  assert.equal(result.url, "https://example.test/report.txt");
  assert.equal(result.finalUrl, "https://cdn.example.test/report.txt");
  assert.equal(result.totalBytes, 12);
  assert.equal(Object.hasOwn(result, "fullPath"), false);
});

test("new matching download resolves after completion", async () => {
  const api = new FakeDownloadsApi();
  const pending = waitForDownload(
    { filenameContains: "new-file", timeoutMs: 200 },
    { downloadsApi: api },
  );

  api.create(download({
    id: 2,
    filename: "C:\\Downloads\\new-file.txt",
    state: "in_progress",
    endTime: "",
  }));
  api.update(2, { state: "complete", endTime: new Date().toISOString() });

  const result = await pending;
  assert.equal(result.id, 2);
  assert.equal(result.state, "complete");
});

test("dangerous download fails by default", async () => {
  const api = new FakeDownloadsApi([download({ danger: "dangerous" })]);

  await assert.rejects(
    waitForDownload({ timeoutMs: 100 }, { downloadsApi: api }),
    (error) => {
      assert.equal(error.diagnostics.finalReason, "download_dangerous");
      return true;
    },
  );
});

test("interrupted download has distinct diagnostics", async () => {
  const api = new FakeDownloadsApi([
    download({ state: "interrupted", error: "NETWORK_FAILED" }),
  ]);

  await assert.rejects(
    waitForDownload({ timeoutMs: 100 }, { downloadsApi: api }),
    (error) => {
      assert.equal(error.diagnostics.finalReason, "download_interrupted");
      assert.equal(error.diagnostics.error, "NETWORK_FAILED");
      return true;
    },
  );
});

test("download wait times out cleanly", async () => {
  const api = new FakeDownloadsApi();

  await assert.rejects(
    waitForDownload({ timeoutMs: 10 }, { downloadsApi: api }),
    (error) => {
      assert.equal(error.diagnostics.finalReason, "download_timeout");
      return true;
    },
  );
});

test("workflow cancellation stops download wait", async () => {
  const api = new FakeDownloadsApi();
  const controller = new AbortController();
  const pending = waitForDownload(
    { timeoutMs: 1000 },
    { downloadsApi: api, signal: controller.signal },
  );
  controller.abort();

  await assert.rejects(pending, (error) => {
    assert.equal(error.name, "WorkflowCancelledError");
    assert.equal(error.diagnostics.finalReason, "workflow_cancelled");
    return true;
  });
});

test("safe metadata never exposes full local path", () => {
  const result = createSafeDownloadMetadata(download());
  assert.equal(result.filename, "report.txt");
  assert.equal(JSON.stringify(result).includes("Users"), false);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});
