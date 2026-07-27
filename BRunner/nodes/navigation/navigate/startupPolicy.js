import {
  NavigateDestinations,
  NavigateOperations,
  NavigateTabSources,
} from "./definition.js";

const NAVIGATE_NODE_TYPE = "browser.navigate";
const FINALIZED_NAVIGATE_VERSION = 2;

/**
 * A workflow may start without an existing automation tab only when its entry
 * node can create a destination without reading from or mutating a tab.
 *
 * Keep this deliberately narrow. Other tab sources and operations require a
 * resolved browser target, and bypassed/conditional entries might not create
 * the tab needed by later nodes.
 */
export function workflowCanBootstrapNavigateWithoutTab(workflow = {}) {
  return navigateCanBootstrapWithoutTab(getWorkflowEntry(workflow));
}

export function navigateCanBootstrapWithoutTab(node = {}) {
  const candidate = normalizeNode(node);
  const config = candidate.config;

  return (
    candidate.type === NAVIGATE_NODE_TYPE &&
    candidate.version === FINALIZED_NAVIGATE_VERSION &&
    candidate.executionMode === "enabled" &&
    config.enabled !== false &&
    (config.operation || NavigateOperations.GotoUrl) ===
      NavigateOperations.GotoUrl &&
    (config.tabSource || NavigateTabSources.Current) ===
      NavigateTabSources.Current &&
    config.openDestinationIn === NavigateDestinations.NewTab
  );
}

function getWorkflowEntry(workflow) {
  if (Array.isArray(workflow?.nodes)) {
    const entryNodeId = String(workflow.entryNodeId || "");
    return workflow.nodes.find((node) => String(node?.id || "") === entryNodeId)
      || null;
  }

  return Array.isArray(workflow?.steps) ? workflow.steps[0] || null : null;
}

function normalizeNode(node) {
  if (!node || typeof node !== "object") {
    return {
      type: "",
      version: null,
      config: {},
      executionMode: "disabled",
    };
  }

  const data = node.data && typeof node.data === "object" ? node.data : {};
  const rawMode =
    node.executionMode ||
    data.executionMode ||
    (node.disabled === true || data.disabled === true ? "disabled" : "enabled");

  return {
    type: String(node.type || node.action || ""),
    version: Number(node.version),
    config:
      node.config && typeof node.config === "object" && !Array.isArray(node.config)
        ? node.config
        : {},
    executionMode: rawMode === "enabled" ? "enabled" : rawMode,
  };
}
