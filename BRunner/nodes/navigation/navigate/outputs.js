import {
  NodeErrorCodes,
  NodeExecutionError,
} from "../../shared/nodeContracts.js";
import { NavigateOperations } from "./definition.js";

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
  if (!navigationState) {
    invalid("Navigate output navigationState is required.");
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
  return {
    id: Number(tab.id),
    windowId: nullableInteger(tab.windowId),
    index: nullableInteger(tab.index),
    url: nullableString(tab.url),
    title: nullableString(tab.title),
    active: tab.active === true,
    status: nullableString(tab.status),
    pageCapability:
      String(tab.pageCapability || "").trim() ||
      pageCapabilityForUrl(tab.url),
  };
}

function pageCapabilityForUrl(url) {
  return isProtectedBrowserUrl(url) ? "tab_control_only" : "dom_supported";
}

export function isProtectedBrowserUrl(value) {
  const url = String(value || "").trim().toLowerCase();
  return (
    url.startsWith("chrome://") ||
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
