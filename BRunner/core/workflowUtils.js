// core/workflowUtils.js
// Utilities for normalizing, validating, and naming workflows.

import { Defaults } from "./constants.js";
import {
  detectWorkflowSchema,
  graphWorkflowToSequential,
  WorkflowSchemaVersion,
} from "./workflowSchema.js";

export function normalizeWorkflow(input = {}) {
  if (detectWorkflowSchema(input) === WorkflowSchemaVersion.Graph) {
    input = graphWorkflowToSequential(input);
  }
  if (Array.isArray(input)) {
    return {
      description: "",
      boundDomain: "",
      variables: {},
      settings: createDefaultWorkflowSettings(),
      steps: input,
    };
  }

  return {
    description: typeof input.description === "string" ? input.description : "",
    boundDomain: typeof input.boundDomain === "string" ? input.boundDomain : "",
    variables:
      input.variables && typeof input.variables === "object"
        ? structuredClone(input.variables)
        : {},
    settings: normalizeWorkflowSettings(input.settings),
    steps: Array.isArray(input.steps) ? input.steps : [],
  };
}

export function createEmptyWorkflow(boundDomain = "") {
  return {
    description: "",
    boundDomain,
    variables: {},
    settings: createDefaultWorkflowSettings(),
    steps: [],
  };
}

export function createDefaultWorkflowSettings() {
  return {
    reuseExistingTabs: false,
  };
}

export function normalizeWorkflowSettings(settings = {}) {
  return {
    reuseExistingTabs: settings?.reuseExistingTabs === true,
  };
}

export function isWorkflowLike(input) {
  if (Array.isArray(input)) return true;
  if (!input || typeof input !== "object") return false;
  return Array.isArray(input.steps) || (
    detectWorkflowSchema(input) === WorkflowSchemaVersion.Graph &&
    Array.isArray(input.nodes) &&
    Array.isArray(input.edges)
  );
}

export function getWorkflowSteps(input) {
  return normalizeWorkflow(input).steps;
}

export function sanitizeWorkflowName(name) {
  const raw = String(name || Defaults.DefaultWorkflowName).trim();

  const cleaned = raw
    .replace(/\.json$/i, "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim();

  return cleaned || Defaults.DefaultWorkflowName;
}

export function ensureJsonFilename(name) {
  const cleanName = sanitizeWorkflowName(name);
  return cleanName.toLowerCase().endsWith(Defaults.WorkflowFileExtension)
    ? cleanName
    : `${cleanName}${Defaults.WorkflowFileExtension}`;
}

export function createAutoSaveName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  return ensureJsonFilename(`recording_${stamp}`);
}

export function extractDomainFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function isStudioUrl(url = "") {
  try {
    return url.startsWith(chrome.runtime.getURL("studio/index.html"));
  } catch {
    return false;
  }
}

export function isBrowserInternalUrl(url = "") {
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("devtools://")
  );
}

export function stepLabel(step = {}) {
  if (step.label) return step.label;
  if (step.action) return step.action;
  if (step.type) return step.type;
  return "Unknown Step";
}

export function getRegistrableDomain(hostname) {
  const host = String(hostname || "").toLowerCase();

  if (!host) return "";
  if (host === "localhost") return "localhost";
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;

  const parts = host.split(".").filter(Boolean);

  if (parts.length <= 2) {
    return host;
  }

  // Basic heuristic. Later replace with Public Suffix List logic if needed.
  return parts.slice(-2).join(".");
}

export function getPageContextFromUrl(url, title = "") {
  try {
    const parsed = new URL(url);

    return {
      url: parsed.href,
      origin: parsed.origin,
      host: parsed.host,
      hostname: parsed.hostname,
      domain: getRegistrableDomain(parsed.hostname),
      path: parsed.pathname,
      search: parsed.search,
      title,
    };
  } catch {
    return {
      url: "",
      origin: "",
      host: "",
      hostname: "",
      domain: "",
      path: "",
      search: "",
      title,
    };
  }
}

export function pageContextsCompatible(currentPage, stepPage, options = {}) {
  const strictPath = Boolean(options.strictPath);

  if (!stepPage || !stepPage.url) return true;
  if (!currentPage || !currentPage.url) return false;

  if (stepPage.domain && currentPage.domain) {
    if (stepPage.domain !== currentPage.domain) return false;
  } else if (stepPage.hostname && currentPage.hostname) {
    if (stepPage.hostname !== currentPage.hostname) return false;
  }

  if (strictPath && stepPage.path && currentPage.path) {
    return stepPage.path === currentPage.path;
  }

  return true;
}

export function resolveWaitDuration(step = {}, randomFn = Math.random) {
  const config = step.config || {};
  const mode = config.mode || step.mode || "fixed";

  if (mode === "random") {
    const minMs = Number(config.minMs ?? step.minMs);
    const maxMs = Number(config.maxMs ?? step.maxMs);

    validateWaitNumber(minMs, "minimum");
    validateWaitNumber(maxMs, "maximum");

    if (minMs > maxMs) {
      throw new Error("Random wait minimum cannot exceed maximum.");
    }

    const unit = Math.min(Math.max(Number(randomFn()), 0), 0.999999999999);
    return Math.floor(minMs + unit * (maxMs - minMs + 1));
  }

  const milliseconds = Number(
    step.ms ?? config.ms ?? step.duration ?? 1000,
  );
  validateWaitNumber(milliseconds, "duration");
  return milliseconds;
}

function validateWaitNumber(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Wait ${label} must be a non-negative number.`);
  }
}
