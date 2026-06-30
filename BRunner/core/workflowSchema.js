// Workflow schema v1/v2 adapters.
// Milestone 3 initially permits only one complete success path in v2 graphs.

export const WorkflowSchemaVersion = Object.freeze({
  Sequential: 1,
  Graph: 2,
});

export function detectWorkflowSchema(input) {
  return input?.schemaVersion === WorkflowSchemaVersion.Graph
    ? WorkflowSchemaVersion.Graph
    : WorkflowSchemaVersion.Sequential;
}

export function upgradeWorkflowToV2(input = {}, options = {}) {
  if (detectWorkflowSchema(input) === WorkflowSchemaVersion.Graph) {
    assertValidGraphWorkflow(input);
    return structuredClone(input);
  }

  const steps = Array.isArray(input) ? input : (input.steps || []);
  const usedIds = new Set();
  const nodes = steps.map((step, index) => {
    const id = uniqueNodeId(step?.id || `node-${index + 1}`, usedIds);
    const data = omitKeys(step || {}, ["id", "action", "type", "version", "config"]);
    return {
      id,
      type: step?.action || step?.type || "element.click",
      version: Number(step?.version) || 1,
      position: { x: 80, y: 80 + index * 180 },
      config: cloneObject(step?.config),
      data,
    };
  });
  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `edge-${node.id}-${nodes[index + 1].id}`,
    source: node.id,
    sourceHandle: "success",
    target: nodes[index + 1].id,
    targetHandle: "input",
  }));

  return {
    schemaVersion: WorkflowSchemaVersion.Graph,
    id: String(options.id || input?.id || "workflow-v2"),
    name: String(options.name || input?.name || "Untitled"),
    description: typeof input?.description === "string" ? input.description : "",
    boundDomain: typeof input?.boundDomain === "string" ? input.boundDomain : "",
    settings: cloneObject(input?.settings),
    variables: cloneObject(input?.variables),
    datasets: cloneObject(input?.datasets),
    dataSources: cloneArray(input?.dataSources),
    entryNodeId: nodes[0]?.id || "",
    nodes,
    edges,
  };
}

export function graphWorkflowToSequential(input = {}) {
  assertValidGraphWorkflow(input);
  const nodesById = new Map(input.nodes.map((node) => [node.id, node]));
  const outgoing = new Map(input.edges.map((edge) => [edge.source, edge]));
  const steps = [];
  let nodeId = input.entryNodeId;

  while (nodeId) {
    const node = nodesById.get(nodeId);
    steps.push({
      ...cloneObject(node.data),
      id: node.id,
      action: node.type,
      version: Number(node.version) || 1,
      config: cloneObject(node.config),
    });
    nodeId = outgoing.get(nodeId)?.target || "";
  }

  return {
    description: typeof input.description === "string" ? input.description : "",
    boundDomain: typeof input.boundDomain === "string" ? input.boundDomain : "",
    variables: cloneObject(input.variables),
    datasets: cloneObject(input.datasets),
    dataSources: cloneArray(input.dataSources),
    settings: cloneObject(input.settings),
    steps,
  };
}

export function validateGraphWorkflow(input = {}) {
  const errors = [];
  if (input.schemaVersion !== WorkflowSchemaVersion.Graph) {
    errors.push("Workflow schemaVersion must be 2.");
  }
  if (!Array.isArray(input.nodes)) errors.push("Workflow nodes must be an array.");
  if (!Array.isArray(input.edges)) errors.push("Workflow edges must be an array.");
  if (errors.length) return { valid: false, errors };

  const nodeIds = input.nodes.map((node) => String(node?.id || ""));
  const nodeIdSet = new Set(nodeIds);
  const edgeIds = input.edges.map((edge) => String(edge?.id || ""));
  if (nodeIds.some((id) => !id)) errors.push("Every graph node requires an id.");
  if (nodeIdSet.size !== nodeIds.length) errors.push("Graph node ids must be unique.");
  if (edgeIds.some((id) => !id)) errors.push("Every graph edge requires an id.");
  if (new Set(edgeIds).size !== edgeIds.length) errors.push("Graph edge ids must be unique.");
  if (input.nodes.some((node) => !String(node?.type || "").trim())) {
    errors.push("Every graph node requires a type.");
  }

  if (input.nodes.length === 0) {
    if (input.entryNodeId) errors.push("An empty graph cannot have an entry node.");
    if (input.edges.length) errors.push("An empty graph cannot have edges.");
    return { valid: errors.length === 0, errors };
  }
  if (!nodeIdSet.has(input.entryNodeId)) errors.push("Graph entryNodeId is missing or invalid.");

  const incomingCounts = new Map(nodeIds.map((id) => [id, 0]));
  const outgoingCounts = new Map(nodeIds.map((id) => [id, 0]));
  const outgoing = new Map();

  for (const edge of input.edges) {
    if (!nodeIdSet.has(edge?.source) || !nodeIdSet.has(edge?.target)) {
      errors.push(`Edge "${edge?.id || "unknown"}" references a missing node.`);
      continue;
    }
    if (edge.sourceHandle && edge.sourceHandle !== "success") {
      errors.push("Initial graph execution supports success edges only.");
    }
    incomingCounts.set(edge.target, incomingCounts.get(edge.target) + 1);
    outgoingCounts.set(edge.source, outgoingCounts.get(edge.source) + 1);
    outgoing.set(edge.source, edge.target);
  }

  if ((incomingCounts.get(input.entryNodeId) || 0) !== 0) {
    errors.push("Entry node cannot have an incoming edge.");
  }
  for (const nodeId of nodeIds) {
    if ((incomingCounts.get(nodeId) || 0) > 1 || (outgoingCounts.get(nodeId) || 0) > 1) {
      errors.push("Initial graph execution supports one linear path only.");
      break;
    }
  }

  const visited = new Set();
  let current = input.entryNodeId;
  while (current && !visited.has(current)) {
    visited.add(current);
    current = outgoing.get(current) || "";
  }
  if (current) errors.push("Graph success path contains a cycle.");
  if (visited.size !== input.nodes.length) errors.push("Every graph node must belong to the entry success path.");
  if (input.edges.length !== Math.max(0, input.nodes.length - 1)) {
    errors.push("A linear graph must contain exactly one fewer edge than nodes.");
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function assertValidGraphWorkflow(input) {
  const result = validateGraphWorkflow(input);
  if (!result.valid) {
    throw new Error(`Invalid graph workflow: ${result.errors.join(" ")}`);
  }
  return input;
}

function uniqueNodeId(candidate, usedIds) {
  const base = String(candidate || "node").trim() || "node";
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) id = `${base}-${suffix++}`;
  usedIds.add(id);
  return id;
}

function omitKeys(value, keys) {
  const omitted = new Set(keys);
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !omitted.has(key)),
  );
}

function cloneObject(value) {
  return value && typeof value === "object" ? structuredClone(value) : {};
}

function cloneArray(value) {
  return Array.isArray(value) ? structuredClone(value) : [];
}
