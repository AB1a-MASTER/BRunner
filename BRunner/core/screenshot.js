// core/screenshot.js
// Visible-tab screenshot capture with explicit memory/download output.

import { Actions } from "./constants.js";

export class ScreenshotCaptureError extends Error {
  constructor(message, finalReason, extra = {}) {
    super(message);
    this.name = "ScreenshotCaptureError";
    this.diagnostics = {
      action: Actions.ScreenshotCapture,
      finalReason,
      ...extra,
    };
  }
}

export async function captureScreenshot(tab, config = {}, adapter = {}) {
  if (!tab?.id || tab.windowId === undefined) {
    throw new ScreenshotCaptureError(
      "Screenshot Capture requires a browser tab.",
      "screenshot_tab_missing",
    );
  }

  const format = String(config.format || "png").toLowerCase();
  const outputMode = String(config.outputMode || "data");
  const quality = Number(config.quality ?? 90);

  if (!["png", "jpeg"].includes(format)) {
    throw new ScreenshotCaptureError(
      `Unsupported screenshot format: ${format || "empty"}`,
      "screenshot_invalid_configuration",
    );
  }

  if (!["data", "download"].includes(outputMode)) {
    throw new ScreenshotCaptureError(
      `Unsupported screenshot output mode: ${outputMode || "empty"}`,
      "screenshot_invalid_configuration",
    );
  }

  const downloadFilename = outputMode === "download"
    ? normalizeFilename(config.filename, format)
    : "";

  if (!Number.isFinite(quality) || quality < 0 || quality > 100) {
    throw new ScreenshotCaptureError(
      "Screenshot quality must be between 0 and 100.",
      "screenshot_invalid_configuration",
    );
  }

  if (typeof adapter.activateTab !== "function" ||
      typeof adapter.captureVisibleTab !== "function") {
    throw new ScreenshotCaptureError(
      "Screenshot capture is unavailable in this runtime.",
      "screenshot_api_unavailable",
    );
  }

  try {
    await adapter.activateTab(tab.id, tab.windowId);
  } catch {
    throw new ScreenshotCaptureError(
      "Failed to activate screenshot target tab.",
      "screenshot_tab_activation_failed",
    );
  }

  let dataUrl;
  try {
    dataUrl = await adapter.captureVisibleTab(tab.windowId, {
      format,
      ...(format === "jpeg" ? { quality } : {}),
    });
  } catch (error) {
    throw new ScreenshotCaptureError(
      "Visible-tab screenshot capture failed.",
      "screenshot_capture_failed",
      { platformReason: sanitizePlatformError(error) },
    );
  }

  const expectedPrefix = `data:image/${format};base64,`;
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(expectedPrefix)) {
    throw new ScreenshotCaptureError(
      "Screenshot API returned invalid image data.",
      "screenshot_invalid_result",
    );
  }

  const result = {
    format,
    mimeType: `image/${format}`,
    bytes: getBase64ByteLength(dataUrl.slice(expectedPrefix.length)),
    capturedAt: new Date().toISOString(),
    saved: false,
    filename: "",
    downloadId: null,
  };

  if (outputMode === "data") {
    return {
      ...result,
      dataUrl,
    };
  }

  if (typeof adapter.download !== "function") {
    throw new ScreenshotCaptureError(
      "Screenshot download output is unavailable.",
      "screenshot_download_unavailable",
    );
  }

  let downloadId;
  try {
    downloadId = await adapter.download({
      url: dataUrl,
      filename: downloadFilename,
      conflictAction: "uniquify",
      saveAs: false,
    });
  } catch {
    throw new ScreenshotCaptureError(
      "Failed to save screenshot to Downloads.",
      "screenshot_download_failed",
    );
  }

  return {
    ...result,
    saved: true,
    filename: downloadFilename,
    downloadId,
  };
}

function normalizeFilename(value, format) {
  let filename = String(value || `brunner-screenshot.${format}`).trim();
  if (!filename) filename = `brunner-screenshot.${format}`;
  if (filename.includes("\0") || /[\\/]/.test(filename)) {
    throw new ScreenshotCaptureError(
      "Screenshot filename must not contain a filesystem path.",
      "screenshot_invalid_configuration",
    );
  }

  const extension = format === "jpeg" ? ".jpg" : ".png";
  if (!filename.toLowerCase().endsWith(extension) &&
      !(format === "jpeg" && filename.toLowerCase().endsWith(".jpeg"))) {
    filename += extension;
  }
  return filename;
}

function getBase64ByteLength(base64) {
  const compact = String(base64 || "").replace(/\s+/g, "");
  if (!compact) return 0;
  const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  return Math.floor((compact.length * 3) / 4) - padding;
}

function sanitizePlatformError(error) {
  return String(error?.message || error || "")
    .replace(/(?:https?|file|chrome|edge|about):\/\/\S+/gi, "[REDACTED URL]")
    .slice(0, 200);
}
