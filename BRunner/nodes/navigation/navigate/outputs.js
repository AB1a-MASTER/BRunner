import {
  NodeErrorCodes,
  NodeExecutionError,
} from "../../shared/nodeContracts.js";
import {
  NavigateOperations,
  NavigateReadiness,
} from "./definition.js";

const NAVIGATION_STATES = new Set([
  ...Object.values(NavigateReadiness),
  "protected_page_skipped",
  "no_history_skipped",
  "no_history_continued",
]);

export function buildNavigateOutput(value = {}) {
  const operation = String(value.operation || "").trim();
  if (!Object.values(NavigateOperations).includes(operation)) {
    invalid("Navigate output operation is invalid.");
  }
  const durationMs = Number(value.durationMs);
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    invalid("Navigate output durationMs must be a non-negative number.");
  }
  const navigationState = String(value.navigationState || "").trim();
  if (!NAVIGATION_STATES.has(navigationState)) {
    invalid("Navigate output navigationState is invalid.");
  }

  return Object.freeze({
    operation,
    previousUrl: nullableString(value.previousUrl),
    currentUrl: nullableString(value.currentUrl),
    tab: Object.freeze(normalizeTab(value.tab)),
    navigationState,
    durationMs,
  });
}

export function normalizeNavigateTab(tab = {}) {
  return normalizeTab(tab);
}

export function createTabReference(tab = {}) {
  const normalized = normalizeTab(tab);
  return Object.freeze({
    kind: "tab",
    tabId: normalized.id,
    windowId: normalized.windowId,
  });
}

function normalizeTab(tab) {
  if (!tab || typeof tab !== "object" || !Number.isInteger(Number(tab.id))) {
    invalid("Navigate output requires a tab with an integer id.");
  }
  const requestedPageCapability = String(tab.pageCapability || "").trim();
  return {
    id: Number(tab.id),
    windowId: nullableInteger(tab.windowId),
    index: nullableInteger(tab.index),
    url: nullableString(tab.url),
    title: nullableString(tab.title),
    active: tab.active === true,
    status: nullableString(tab.status),
    pageCapability: ["dom_supported", "tab_control_only"].includes(
      requestedPageCapability,
    )
      ? requestedPageCapability
      : pageCapabilityForUrl(tab.url),
  };
}

function pageCapabilityForUrl(url) {
  return isProtectedBrowserUrl(url) ? "tab_control_only" : "dom_supported";
}

export function isProtectedBrowserUrl(value) {
  const url = String(value || "").trim().toLowerCase();
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-error://") ||
    url.startsWith("chrome-search://") ||
    url.startsWith("chrome-untrusted://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("view-source:") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("devtools://")
  );
}

function nullableString(value) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function nullableInteger(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : null;
}

function invalid(message) {
  throw new NodeExecutionError(
    NodeErrorCodes.ValidationFailed,
    message,
  );
}
