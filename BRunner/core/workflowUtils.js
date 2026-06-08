// core/workflowUtils.js
// Utilities for normalizing, validating, and naming workflows.

import { Defaults } from "./constants.js";

export function normalizeWorkflow(input = {}) {
  if (Array.isArray(input)) {
    return {
      boundDomain: "",
      steps: input,
    };
  }

  return {
    boundDomain: typeof input.boundDomain === "string" ? input.boundDomain : "",
    steps: Array.isArray(input.steps) ? input.steps : [],
  };
}

export function createEmptyWorkflow(boundDomain = "") {
  return {
    boundDomain,
    steps: [],
  };
}

export function isWorkflowLike(input) {
  if (Array.isArray(input)) return true;
  if (!input || typeof input !== "object") return false;
  return Array.isArray(input.steps);
}

export function getWorkflowSteps(input) {
  return normalizeWorkflow(input).steps;
}

export function sanitizeWorkflowName(name) {
  const raw = String(name || Defaults.DefaultWorkflowName).trim();

  const cleaned = raw
    .replace(/\.json$/i, "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

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
