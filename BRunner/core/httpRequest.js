// core/httpRequest.js
// Secure, cancellable HTTP execution for background workflow nodes.

import { Actions } from "./constants.js";

const ALLOWED_METHODS = new Set([
  "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD",
]);
const ALLOWED_RESPONSE_TYPES = new Set(["auto", "json", "text"]);
const ALLOWED_HTTP_ERROR_POLICIES = new Set(["fail", "continue"]);

export class HttpRequestError extends Error {
  constructor(message, diagnostics, response = null) {
    super(message);
    this.name = "HttpRequestError";
    this.diagnostics = diagnostics;
    this.response = response;
  }
}

export async function executeHttpRequest(config = {}, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const externalSignal = options.signal || null;
  const method = normalizeMethod(config.method);
  const url = normalizeHttpUrl(config.url);
  const responseType = normalizeChoice(
    config.responseType || "auto",
    ALLOWED_RESPONSE_TYPES,
    "response type",
  );
  const httpErrorPolicy = normalizeChoice(
    config.httpErrorPolicy || "fail",
    ALLOWED_HTTP_ERROR_POLICIES,
    "HTTP error policy",
  );
  const timeoutMs = normalizeTimeout(config.timeoutMs);
  const headers = normalizeHeaders(config.headers);
  const body = normalizeBody(
    config.body,
    config.bodyType || "auto",
    method,
    headers,
  );

  if (typeof fetchImpl !== "function") {
    throw createRequestError(
      "HTTP requests are unavailable in this runtime.",
      method,
      url,
      "http_fetch_unavailable",
    );
  }

  const controller = new AbortController();
  let timeoutTriggered = false;
  let externalCancelled = Boolean(externalSignal?.aborted);
  const abortFromExternal = () => {
    externalCancelled = true;
    controller.abort();
  };

  if (externalCancelled) controller.abort();
  externalSignal?.addEventListener("abort", abortFromExternal, { once: true });

  const timeoutId = setTimeout(() => {
    timeoutTriggered = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(url.href, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      credentials: "omit",
      redirect: "follow",
      signal: controller.signal,
    });

    const result = await readStructuredResponse(response, responseType, {
      method,
      requestUrl: url,
    });

    if (!response.ok && httpErrorPolicy === "fail") {
      throw new HttpRequestError(
        `HTTP request failed with status ${response.status}.`,
        createDiagnostics(method, url, "http_error", {
          status: response.status,
          statusText: response.statusText || "",
          finalUrl: sanitizeUrl(response.url || url.href),
        }),
        result,
      );
    }

    return result;
  } catch (error) {
    if (error instanceof HttpRequestError) throw error;

    if (error?.name === "AbortError" || controller.signal.aborted) {
      if (externalCancelled || externalSignal?.aborted) {
        const cancelled = new Error("Workflow stopped by user.");
        cancelled.name = "WorkflowCancelledError";
        cancelled.diagnostics = createDiagnostics(
          method,
          url,
          "workflow_cancelled",
        );
        throw cancelled;
      }

      if (timeoutTriggered) {
        throw createRequestError(
          `HTTP request timed out after ${timeoutMs} ms.`,
          method,
          url,
          "http_timeout",
          { timeoutMs },
        );
      }
    }

    throw createRequestError(
      `HTTP request failed: ${error?.message || String(error)}`,
      method,
      url,
      "http_network_failure",
    );
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

async function readStructuredResponse(response, responseType, request) {
  const headers = Object.fromEntries(response.headers.entries());
  const contentType = response.headers.get("content-type") || "";
  const resolvedType = responseType === "auto"
    ? contentType.toLowerCase().includes("json") ? "json" : "text"
    : responseType;
  let data = null;

  if (request.method !== "HEAD" && response.status !== 204) {
    try {
      data = resolvedType === "json"
        ? await response.json()
        : await response.text();
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new HttpRequestError(
        "HTTP response body is not valid JSON.",
        createDiagnostics(
          request.method,
          request.requestUrl,
          "http_invalid_json_response",
          {
            status: response.status,
            finalUrl: sanitizeUrl(response.url || request.requestUrl.href),
          },
        ),
      );
    }
  }

  return {
    status: response.status,
    ok: response.ok,
    finalUrl: response.url || request.requestUrl.href,
    headers,
    data,
  };
}

function normalizeMethod(value) {
  const method = String(value || "GET").trim().toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    throw createConfigError(`Unsupported HTTP method: ${method || "empty"}`);
  }
  return method;
}

function normalizeHttpUrl(value) {
  let url;

  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw createConfigError("HTTP Request requires a valid absolute URL.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw createConfigError("HTTP Request supports only http:// and https:// URLs.");
  }

  if (url.username || url.password) {
    throw createConfigError("Credentials must not be embedded in the request URL.");
  }

  return url;
}

function normalizeHeaders(value) {
  if (value === undefined || value === null || value === "") return {};

  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw createConfigError("HTTP headers must be a valid JSON object.");
    }
  }

  if (!isPlainObject(parsed)) {
    throw createConfigError("HTTP headers must be a JSON object.");
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([key, headerValue]) => {
      return [String(key), String(headerValue)];
    }),
  );
}

function normalizeBody(value, bodyType, method, headers) {
  if (["GET", "HEAD"].includes(method) || value === undefined || value === null) {
    return undefined;
  }

  const normalizedBodyType = normalizeChoice(
    bodyType,
    new Set(["auto", "json", "text"]),
    "body type",
  );

  if (normalizedBodyType === "json") {
    let jsonValue = value;
    if (typeof value === "string") {
      try {
        jsonValue = JSON.parse(value);
      } catch {
        throw createConfigError("HTTP JSON body is not valid JSON.");
      }
    }
    setJsonContentType(headers);
    return JSON.stringify(jsonValue);
  }

  if (typeof value === "string") return value;

  if (typeof value === "object") {
    setJsonContentType(headers);
    return JSON.stringify(value);
  }

  return String(value);
}

function setJsonContentType(headers) {
  const hasContentType = Object.keys(headers).some(
    (key) => key.toLowerCase() === "content-type",
  );
  if (!hasContentType) headers["Content-Type"] = "application/json";
}

function normalizeTimeout(value) {
  const timeoutMs = Number(value ?? 30000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw createConfigError("HTTP timeout must be greater than zero.");
  }
  return timeoutMs;
}

function normalizeChoice(value, allowed, label) {
  const normalized = String(value || "").trim();
  if (!allowed.has(normalized)) {
    throw createConfigError(`Unsupported HTTP ${label}: ${normalized || "empty"}`);
  }
  return normalized;
}

function createConfigError(message) {
  return new HttpRequestError(message, {
    action: Actions.HttpRequest,
    finalReason: "http_invalid_configuration",
  });
}

function createRequestError(message, method, url, finalReason, extra = {}) {
  return new HttpRequestError(
    message,
    createDiagnostics(method, url, finalReason, extra),
  );
}

function createDiagnostics(method, url, finalReason, extra = {}) {
  return {
    action: Actions.HttpRequest,
    method,
    requestUrl: sanitizeUrl(url instanceof URL ? url.href : url),
    finalReason,
    ...extra,
  };
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

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
