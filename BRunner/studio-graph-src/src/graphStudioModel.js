import {
  CurrentGraphWorkflowSchemaVersion,
  detectWorkflowSchema,
  isGraphWorkflowSchemaVersion,
  upgradeWorkflowToCanonical,
  upgradeWorkflowToV2,
  validateGraphWorkflow,
  WorkflowSchemaVersion,
} from "../../core/workflowSchema.js";
import { createDefaultMapperSettings } from "../../mapper/core.js";
import { prepareNodeConfiguration } from "../../core/nodeAuthoring.js";
import { normalizeWorkflowSettings } from "../../core/workflowUtils.js";

export function workflowToCanvas(input, definitions) {
  const sourceSchema = detectWorkflowSchema(input);
  const graph = isGraphWorkflowSchemaVersion(sourceSchema)
    ? upgradeWorkflowToCanonical(input)
    : upgradeWorkflowToV2(input);
  const validation = validateGraphWorkflow(graph);
  if (!validation.valid) {
    throw new Error(`Cannot open graph: ${validation.errors.join(" ")}`);
  }

  const definitionsByContract = definitions instanceof Map
    ? definitions
    : new Map((definitions || []).map((definition) => [
        nodeContractKey(definition.type, definition.version),
        definition,
      ]));
  const readOnly = sourceSchema === WorkflowSchemaVersion.Sequential;
  const layoutDirection = normalizeLayoutDirection(
    graph.settings?.graphLayoutDirection,
  );
  let nodes = graph.nodes.map((node) => {
    const persistedData = cloneObject(node.data);
    const persistedDataKeys = Object.keys(persistedData);
    const originalTarget = persistedData.target ?? "";
    const contractDefinition = definitionsByContract.get(
      nodeContractKey(node.type, node.version),
    );
    const systemNode = node.type === "workflow.needs_attention";
    const definition = contractDefinition || fallbackDefinition(node, systemNode);
    const prepared = contractDefinition
      ? prepareNodeConfiguration(node.config, definition, {
          node: {
            ...node,
            ...persistedData,
            data: persistedData,
          },
        })
      : {
          config: cloneObject(node.config),
          issues: [],
        };
    return {
      id: node.id,
      type: "brunner",
      position: clonePosition(node.position),
      data: {
        ...persistedData,
        type: node.type,
        definition,
        config: prepared.config,
        configurationIssues: prepared.issues,
        target: displayTarget(originalTarget),
        targetSource: structuredClone(originalTarget),
        targetEdited: false,
        persistedDataKeys,
        executionMode: persistedData.executionMode || (persistedData.disabled ? "disabled" : "enabled"),
        skipWhen: persistedData.skipWhen || "",
        collapsed: persistedData.collapsed === true,
        layoutDirection,
        readOnly: readOnly || !contractDefinition && !systemNode,
      },
    };
  });
  const edges = graph.edges.map((edge) => ({
    ...structuredClone(edge),
    type: "removable",
    animated: false,
    data: { readOnly },
  }));

  if (readOnly) {
    nodes = layoutCanvasNodes(nodes, edges, layoutDirection);
  }

  return {
    sourceSchema,
    readOnly,
    nodes,
    edges,
    metadata: {
      id: graph.id || "workflow-v2",
      name: graph.name || input?.name || "Untitled",
      description: graph.description || input?.description || "",
      boundDomain: graph.boundDomain || "",
      schemaVersion: graph.schemaVersion || WorkflowSchemaVersion.Graph,
      settings: normalizeWorkflowSettings(graph.settings),
      variables: cloneObject(graph.variables),
      datasets: cloneObject(graph.datasets),
      dataSources: cloneArray(graph.dataSources),
      entryNodeId: String(graph.entryNodeId || ""),
      passthrough: extractWorkflowPassthrough(graph),
    },
  };
}

export function canvasToGraphWorkflow(nodes, edges, metadata = {}) {
  const graphNodes = nodes.map((node) => {
    const data = sanitizeNodeData(node.data);
    return {
      id: node.id,
      type: node.data.type,
      version: Number(node.data.definition?.version) || 1,
      position: clonePosition(node.position),
      config: cloneObject(node.data.config),
      data,
    };
  });
  const graphEdges = edges.map((edge, index) => ({
    id: edge.id || `edge-${edge.source}-${edge.target}-${index + 1}`,
    source: edge.source,
    sourceHandle: edge.sourceHandle || "success",
    target: edge.target,
    targetHandle: edge.targetHandle || "input",
  }));
  const graph = {
    ...cloneObject(metadata.passthrough),
    schemaVersion: metadata.schemaVersion || CurrentGraphWorkflowSchemaVersion,
    id: String(metadata.id || "workflow-v2"),
    name: String(metadata.name || "Untitled"),
    description: String(metadata.description || ""),
    boundDomain: String(metadata.boundDomain || ""),
    settings: normalizeWorkflowSettings(metadata.settings),
    variables: cloneObject(metadata.variables),
    datasets: cloneObject(metadata.datasets),
    dataSources: cloneArray(metadata.dataSources),
    entryNodeId: resolveEntryNodeId(
      graphNodes,
      graphEdges,
      metadata.entryNodeId,
    ),
    nodes: graphNodes,
    edges: graphEdges,
  };
  for (let index = 0; index < graphNodes.length; index += 1) {
    const definition = nodes[index]?.data?.definition || {};
    if (definition.contractAvailable === false) {
      throw new Error(
        `Cannot save graph: node ${graphNodes[index].id} uses unsupported contract ${graphNodes[index].type}@${graphNodes[index].version}.`,
      );
    }
    const prepared = prepareNodeConfiguration(
      graphNodes[index].config,
      definition,
      {
        node: {
          ...graphNodes[index],
          ...graphNodes[index].data,
          data: graphNodes[index].data,
        },
      },
    );
    graphNodes[index].config = prepared.config;
    if (prepared.issues.length) {
      throw new Error(
        `Cannot save graph: node ${graphNodes[index].id} has invalid configuration: ${prepared.issues.map((issue) => issue.message).join(" ")}`,
      );
    }
  }
  const validation = validateGraphWorkflow(graph);
  if (!validation.valid) {
    throw new Error(`Cannot save graph: ${validation.errors.join(" ")}`);
  }
  return graph;
}

export function ensureWorkflowFilename(name) {
  const cleaned = String(name || "Untitled")
    .replace(/\.json$/i, "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/^\.+|\.+$/g, "")
    .trim() || "Untitled";
  return `${cleaned}.json`;
}

export function layoutCanvasNodes(nodes, edges, direction = "vertical") {
  const normalizedDirection = normalizeLayoutDirection(direction);
  const incoming = new Set(edges.map((edge) => edge.target));
  const outgoing = new Map(edges.map((edge) => [edge.source, edge.target]));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ordered = [];
  const visited = new Set();
  let current = nodes.find((node) => !incoming.has(node.id))?.id || nodes[0]?.id;

  while (current && !visited.has(current) && byId.has(current)) {
    visited.add(current);
    ordered.push(byId.get(current));
    current = outgoing.get(current);
  }
  nodes.forEach((node) => {
    if (!visited.has(node.id)) ordered.push(node);
  });

  return ordered.map((node, index) => ({
    ...node,
    position: normalizedDirection === "horizontal"
      ? { x: 90 + index * 340, y: 120 }
      : { x: 120, y: 70 + index * 300 },
    data: { ...node.data, layoutDirection: normalizedDirection },
  }));
}

function sanitizeNodeData(source = {}) {
  const persistedDataKeys = new Set(
    Array.isArray(source.persistedDataKeys) ? source.persistedDataKeys : [],
  );
  const data = Object.fromEntries(
    Object.entries(source).filter(([key, value]) => {
      return ![
        "type",
        "definition",
        "config",
        "configurationIssues",
        "readOnly",
        "targetSource",
        "targetEdited",
        "persistedDataKeys",
        "layoutDirection",
        "runtimeStatus",
        "executionLocked",
        "navigationLocked",
        "target",
      ].includes(key) &&
        typeof value !== "function" &&
        (
          key !== "executionMode" ||
          persistedDataKeys.has(key) ||
          value !== "enabled"
        ) &&
        (
          key !== "skipWhen" ||
          persistedDataKeys.has(key) ||
          String(value || "") !== ""
        ) &&
        (
          key !== "collapsed" ||
          persistedDataKeys.has(key) ||
          value === true
        );
    }),
  );
  if (source.targetEdited || persistedDataKeys.has("target")) {
    data.target = source.targetEdited
      ? structuredClone(source.target)
      : structuredClone(source.targetSource ?? source.target ?? "");
  }
  if (source.componentRef) data.componentRef = structuredClone(source.componentRef);
  delete data.disabled;
  return data;
}

export function createNewWorkflowMetadata(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    name: "Untitled",
    description: "",
    boundDomain: "",
    schemaVersion: CurrentGraphWorkflowSchemaVersion,
    settings: {
      reuseExistingTabs: false,
      graphLayoutDirection: "vertical",
      mapper: createDefaultMapperSettings(),
    },
    variables: {},
    datasets: {},
    dataSources: [],
    ...overrides,
  };
}

function normalizeLayoutDirection(value) {
  return value === "horizontal" ? "horizontal" : "vertical";
}

function displayTarget(target) {
  if (typeof target === "string") return target;
  if (!target || typeof target !== "object") return "";
  return target.value || target.primary?.value || "";
}

function cloneObject(value) {
  return value && typeof value === "object" ? structuredClone(value) : {};
}

function cloneArray(value) {
  return Array.isArray(value) ? structuredClone(value) : [];
}

function clonePosition(position) {
  return {
    x: Number(position?.x) || 0,
    y: Number(position?.y) || 0,
  };
}

function resolveEntryNodeId(nodes, edges, requestedEntryNodeId = "") {
  if (!nodes.length) return "";
  const incoming = new Set(edges.map((edge) => edge.target));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const requested = String(requestedEntryNodeId || "");
  if (requested && nodeIds.has(requested) && !incoming.has(requested)) {
    return requested;
  }
  const entries = nodes.filter((node) => !incoming.has(node.id));
  return entries.length === 1 ? entries[0].id : "";
}

function extractWorkflowPassthrough(workflow = {}) {
  const coreKeys = new Set([
    "schemaVersion",
    "id",
    "name",
    "description",
    "boundDomain",
    "settings",
    "variables",
    "datasets",
    "dataSources",
    "entryNodeId",
    "nodes",
    "edges",
  ]);
  return Object.fromEntries(
    Object.entries(workflow)
      .filter(([key]) => !coreKeys.has(key))
      .map(([key, value]) => [key, structuredClone(value)]),
  );
}

function fallbackDefinition(node, systemNode = false) {
  return {
    type: node.type,
    version: Number(node.version) || 1,
    category: "Unknown",
    label: node.type,
    description: "Definition unavailable in this extension version.",
    targetRequired: false,
    config: [],
    contractAvailable: systemNode,
  };
}

function nodeContractKey(type, version) {
  return `${String(type || "").trim()}@${String(version ?? "").trim()}`;
}
