import {
  detectWorkflowSchema,
  upgradeWorkflowToV2,
  validateGraphWorkflow,
  WorkflowSchemaVersion,
} from "../../core/workflowSchema.js";

export function workflowToCanvas(input, definitions) {
  const sourceSchema = detectWorkflowSchema(input);
  const graph = sourceSchema === WorkflowSchemaVersion.Graph
    ? structuredClone(input)
    : upgradeWorkflowToV2(input);
  const validation = validateGraphWorkflow(graph);
  if (!validation.valid) {
    throw new Error(`Cannot open graph: ${validation.errors.join(" ")}`);
  }

  const definitionsByType = definitions instanceof Map
    ? definitions
    : new Map((definitions || []).map((definition) => [definition.type, definition]));
  const readOnly = sourceSchema === WorkflowSchemaVersion.Sequential;
  const layoutDirection = normalizeLayoutDirection(
    graph.settings?.graphLayoutDirection,
  );
  let nodes = graph.nodes.map((node) => {
    const persistedData = cloneObject(node.data);
    const originalTarget = persistedData.target ?? "";
    return {
      id: node.id,
      type: "brunner",
      position: clonePosition(node.position),
      data: {
        ...persistedData,
        type: node.type,
        definition: definitionsByType.get(node.type) || fallbackDefinition(node),
        config: cloneObject(node.config),
        target: displayTarget(originalTarget),
        targetSource: structuredClone(originalTarget),
        targetEdited: false,
        executionMode: persistedData.executionMode || (persistedData.disabled ? "disabled" : "enabled"),
        skipWhen: persistedData.skipWhen || "",
        collapsed: persistedData.collapsed === true,
        layoutDirection,
        readOnly,
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
      boundDomain: graph.boundDomain || "",
      settings: cloneObject(graph.settings),
      variables: cloneObject(graph.variables),
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
  const incoming = new Set(graphEdges.map((edge) => edge.target));
  const entries = graphNodes.filter((node) => !incoming.has(node.id));

  const graph = {
    schemaVersion: WorkflowSchemaVersion.Graph,
    id: String(metadata.id || "workflow-v2"),
    name: String(metadata.name || "Untitled"),
    boundDomain: String(metadata.boundDomain || ""),
    settings: cloneObject(metadata.settings),
    variables: cloneObject(metadata.variables),
    entryNodeId: graphNodes.length ? (entries.length === 1 ? entries[0].id : "") : "",
    nodes: graphNodes,
    edges: graphEdges,
  };
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
  const data = Object.fromEntries(
    Object.entries(source).filter(([key, value]) => {
      return ![
        "type",
        "definition",
        "config",
        "readOnly",
        "targetSource",
        "targetEdited",
        "layoutDirection",
        "runtimeStatus",
        "executionLocked",
      ].includes(key) && typeof value !== "function";
    }),
  );
  data.target = source.targetEdited
    ? source.target
    : structuredClone(source.targetSource ?? source.target ?? "");
  delete data.disabled;
  return data;
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

function clonePosition(position) {
  return {
    x: Number(position?.x) || 0,
    y: Number(position?.y) || 0,
  };
}

function fallbackDefinition(node) {
  return {
    type: node.type,
    version: Number(node.version) || 1,
    category: "Unknown",
    label: node.type,
    description: "Definition unavailable in this extension version.",
    targetRequired: false,
    config: [],
  };
}
