// core/downloadWait.js
// Cancellable download matching with safe metadata output.

import { Actions } from "./constants.js";

const SAFE_DANGERS = new Set([
  "safe",
  "accepted",
  "allowlistedByPolicy",
  "deepScannedSafe",
]);
const PENDING_DANGERS = new Set([
  "asyncScanning",
  "asyncLocalPasswordScanning",
]);

export class DownloadWaitError extends Error {
  constructor(message, finalReason, extra = {}) {
    super(message);
    this.name = "DownloadWaitError";
    this.diagnostics = {
      action: Actions.DownloadWait,
      finalReason,
      ...extra,
    };
  }
}

export function waitForDownload(config = {}, options = {}) {
  const downloadsApi = options.downloadsApi;
  const signal = options.signal || null;
  const timeoutMs = normalizePositiveNumber(config.timeoutMs, 30000, "timeout");
  const startedWithinMs = normalizePositiveNumber(
    config.startedWithinMs,
    15000,
    "recent-download window",
    true,
  );
  const filenameContains = String(config.filenameContains || "").trim();
  const urlContains = String(config.urlContains || "").trim();
  const dangerPolicy = String(config.dangerPolicy || "fail").trim();

  if (!downloadsApi?.search || !downloadsApi?.onCreated || !downloadsApi?.onChanged) {
    throw new DownloadWaitError(
      "Chrome Downloads API is unavailable.",
      "download_api_unavailable",
    );
  }

  if (!["fail", "allow"].includes(dangerPolicy)) {
    throw new DownloadWaitError(
      `Unsupported download danger policy: ${dangerPolicy || "empty"}`,
      "download_invalid_configuration",
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let candidateId = null;
    let timeoutId;

    const cleanup = () => {
      clearTimeout(timeoutId);
      downloadsApi.onCreated.removeListener(onCreated);
      downloadsApi.onChanged.removeListener(onChanged);
      downloadsApi.onErased?.removeListener(onErased);
      signal?.removeEventListener("abort", onAbort);
    };

    const finishResolve = (item) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(createSafeDownloadMetadata(item));
    };

    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const evaluate = (item) => {
      if (!item || !matchesDownload(item, filenameContains, urlContains)) return;
      if (candidateId !== null && item.id !== candidateId) return;
      candidateId = item.id;

      const danger = String(item.danger || "safe");
      if (
        dangerPolicy === "fail" &&
        !SAFE_DANGERS.has(danger) &&
        !PENDING_DANGERS.has(danger)
      ) {
        finishReject(new DownloadWaitError(
          "Matched download was classified as dangerous.",
          "download_dangerous",
          { id: item.id, danger },
        ));
        return;
      }

      if (item.state === "interrupted") {
        finishReject(new DownloadWaitError(
          "Matched download was interrupted.",
          "download_interrupted",
          { id: item.id, error: item.error || "" },
        ));
        return;
      }

      if (item.state === "complete" && !PENDING_DANGERS.has(danger)) {
        finishResolve(item);
      }
    };

    const refreshDownload = async (id) => {
      try {
        const items = await downloadsApi.search({ id });
        if (!items?.length) {
          if (candidateId === id) {
            finishReject(new DownloadWaitError(
              "Matched download no longer exists.",
              "download_missing",
              { id },
            ));
          }
          return;
        }
        evaluate(items[0]);
      } catch {
        finishReject(new DownloadWaitError(
          "Failed to inspect browser downloads.",
          "download_search_failed",
        ));
      }
    };

    function onCreated(item) {
      evaluate(item);
    }

    function onChanged(delta) {
      if (candidateId !== null && delta.id !== candidateId) return;
      void refreshDownload(delta.id);
    }

    function onErased(id) {
      if (candidateId !== id) return;
      finishReject(new DownloadWaitError(
        "Matched download was erased before completion.",
        "download_missing",
        { id },
      ));
    }

    function onAbort() {
      const error = new Error("Workflow stopped by user.");
      error.name = "WorkflowCancelledError";
      error.diagnostics = {
        action: Actions.DownloadWait,
        finalReason: "workflow_cancelled",
      };
      finishReject(error);
    }

    downloadsApi.onCreated.addListener(onCreated);
    downloadsApi.onChanged.addListener(onChanged);
    downloadsApi.onErased?.addListener(onErased);
    signal?.addEventListener("abort", onAbort, { once: true });

    if (signal?.aborted) {
      onAbort();
      return;
    }

    timeoutId = setTimeout(() => {
      finishReject(new DownloadWaitError(
        `Timed out waiting for a download after ${timeoutMs} ms.`,
        "download_timeout",
        {
          timeoutMs,
          filenameMatcherConfigured: Boolean(filenameContains),
          urlMatcherConfigured: Boolean(urlContains),
        },
      ));
    }, timeoutMs);

    void (async () => {
      try {
        const startedAfter = new Date(Date.now() - startedWithinMs).toISOString();
        const items = await downloadsApi.search({
          startedAfter,
          orderBy: ["-startTime"],
        });

        for (const item of items || []) {
          if (settled || candidateId !== null) break;
          evaluate(item);
        }
      } catch {
        finishReject(new DownloadWaitError(
          "Failed to inspect browser downloads.",
          "download_search_failed",
        ));
      }
    })();
  });
}

export function createSafeDownloadMetadata(item = {}) {
  return {
    id: item.id ?? null,
    filename: getBasename(item.filename),
    url: sanitizeUrl(item.url),
    finalUrl: sanitizeUrl(item.finalUrl),
    mime: item.mime || "",
    bytesReceived: Number(item.bytesReceived || 0),
    totalBytes: Number(item.totalBytes || 0),
    state: item.state || "",
    danger: item.danger || "safe",
    paused: Boolean(item.paused),
    exists: item.exists !== false,
    startTime: item.startTime || "",
    endTime: item.endTime || "",
  };
}

function matchesDownload(item, filenameContains, urlContains) {
  const filename = getBasename(item.filename).toLowerCase();
  const sourceUrl = String(item.finalUrl || item.url || "").toLowerCase();

  return (
    (!filenameContains || filename.includes(filenameContains.toLowerCase())) &&
    (!urlContains || sourceUrl.includes(urlContains.toLowerCase()))
  );
}

function getBasename(value) {
  return String(value || "").split(/[\\/]/).at(-1) || "";
}

function sanitizeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function normalizePositiveNumber(value, fallback, label, allowZero = false) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) {
    throw new DownloadWaitError(
      `Download ${label} must be ${allowZero ? "non-negative" : "greater than zero"}.`,
      "download_invalid_configuration",
    );
  }
  return number;
}
