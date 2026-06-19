import assert from "node:assert/strict";
import { test } from "node:test";

import { captureScreenshot } from "../BRunner/core/screenshot.js";

const tab = { id: 7, windowId: 3 };

function adapter(overrides = {}) {
  return {
    async activateTab() {},
    async captureVisibleTab() {
      return "data:image/png;base64,YWJj";
    },
    async download() {
      return 42;
    },
    ...overrides,
  };
}

test("data output returns screenshot data and metadata", async () => {
  let activatedTab;
  let activatedWindow;
  let capturedWindow;
  let captureOptions;
  const result = await captureScreenshot(
    tab,
    { format: "png", outputMode: "data" },
    adapter({
      async activateTab(tabId, windowId) {
        activatedTab = tabId;
        activatedWindow = windowId;
      },
      async captureVisibleTab(windowId, options) {
        capturedWindow = windowId;
        captureOptions = options;
        return "data:image/png;base64,YWJj";
      },
    }),
  );

  assert.equal(activatedTab, 7);
  assert.equal(activatedWindow, 3);
  assert.equal(capturedWindow, 3);
  assert.deepEqual(captureOptions, { format: "png" });
  assert.equal(result.bytes, 3);
  assert.equal(result.dataUrl, "data:image/png;base64,YWJj");
  assert.equal(result.saved, false);
});

test("JPEG capture passes quality", async () => {
  let captureOptions;
  const result = await captureScreenshot(
    tab,
    { format: "jpeg", quality: 75, outputMode: "data" },
    adapter({
      async captureVisibleTab(windowId, options) {
        captureOptions = options;
        return "data:image/jpeg;base64,YWJj";
      },
    }),
  );

  assert.deepEqual(captureOptions, { format: "jpeg", quality: 75 });
  assert.equal(result.mimeType, "image/jpeg");
});

test("download output explicitly saves without retaining image data", async () => {
  let downloadOptions;
  const result = await captureScreenshot(
    tab,
    {
      format: "png",
      outputMode: "download",
      filename: "acceptance",
    },
    adapter({
      async download(options) {
        downloadOptions = options;
        return 55;
      },
    }),
  );

  assert.equal(downloadOptions.filename, "acceptance.png");
  assert.equal(downloadOptions.saveAs, false);
  assert.equal(result.saved, true);
  assert.equal(result.downloadId, 55);
  assert.equal(result.filename, "acceptance.png");
  assert.equal(Object.hasOwn(result, "dataUrl"), false);
});

test("download filename rejects filesystem paths before capture", async () => {
  let captured = false;

  await assert.rejects(
    captureScreenshot(
      tab,
      {
        outputMode: "download",
        filename: "C:\\secret.png",
      },
      adapter({
        async captureVisibleTab() {
          captured = true;
          return "data:image/png;base64,YWJj";
        },
      }),
    ),
    (error) => {
      assert.equal(
        error.diagnostics.finalReason,
        "screenshot_invalid_configuration",
      );
      return true;
    },
  );

  assert.equal(captured, false);
});

test("capture failures expose safe diagnostics", async () => {
  await assert.rejects(
    captureScreenshot(
      tab,
      {},
      adapter({
        async captureVisibleTab() {
          throw new Error("platform detail");
        },
      }),
    ),
    (error) => {
      assert.equal(error.message, "Visible-tab screenshot capture failed.");
      assert.equal(error.diagnostics.finalReason, "screenshot_capture_failed");
      return true;
    },
  );
});

test("invalid screenshot data is rejected", async () => {
  await assert.rejects(
    captureScreenshot(
      tab,
      {},
      adapter({ async captureVisibleTab() { return "not-an-image"; } }),
    ),
    (error) => {
      assert.equal(error.diagnostics.finalReason, "screenshot_invalid_result");
      return true;
    },
  );
});
