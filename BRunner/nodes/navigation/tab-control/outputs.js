import {
  NodeErrorCodes,
  NodeExecutionError,
} from "../../shared/nodeContracts.js";
import {
  normalizeNavigateTab,
} from "../navigate/outputs.js";
import { TabControlOperations } from "./definition.js";

export function buildTabControlOutput(value = {}) {
  const operation = String(value.operation || "").trim();
  if (!Object.values(TabControlOperations).includes(operation)) {
    invalid("Tab Control output operation is invalid.");
  }
  const originTab = nullableTab(value.originTab);
  const tab = nullableTab(value.tab);
  const createdTab = nullableTab(value.createdTab);
  const pageCapability =
    nullableString(value.pageCapability) ||
    tab?.pageCapability ||
    createdTab?.pageCapability ||
    null;
  if (
    pageCapability !== null &&
    !["dom_supported", "tab_control_only"].includes(pageCapability)
  ) {
    invalid("Tab Control output pageCapability is invalid.");
  }

  return Object.freeze({
    operation,
    originTab,
    tab,
    createdTab,
    pageCapability,
    matchedBy: nullableString(value.matchedBy),
    pinned: nullableBoolean(value.pinned),
    muted: nullableBoolean(value.muted),
    bookmarked: nullableBoolean(value.bookmarked),
  });
}

export function createTabControlReference(tab = {}) {
  const normalized = normalizeNavigateTab(tab);
  return Object.freeze({
    kind: "tab",
    tabId: normalized.id,
    windowId: normalized.windowId,
  });
}

function nullableTab(value) {
  if (value === null || value === undefined) return null;
  return Object.freeze(normalizeNavigateTab(value));
}

function nullableString(value) {
  return value === null || value === undefined || value === ""
    ? null
    : String(value);
}

function nullableBoolean(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "boolean") {
    invalid("Tab Control state flags must be boolean or null.");
  }
  return value;
}

function invalid(message) {
  throw new NodeExecutionError(NodeErrorCodes.ValidationFailed, message);
}
