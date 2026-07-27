// Workflow schema v1/v2/v3 adapters.
// v2 remains the current linear runtime graph. v3 adds mapper unresolved routing.

import { Actions } from "./constants.js";

export const WorkflowSchemaVersion = Object.freeze({
  Sequential: 1,
  Graph: 2,
  MapperGraph: 3,
});

export const CurrentGraphWorkflowSchemaVersion = WorkflowSchemaVersion.MapperGraph;

export const GraphEdgeHandles = Object.freeze({
  Input: "input",
  Success: "success",
  Error: "error",
  Unresolved: "unresolved",
});

export const MapperAttentionNodeType = "workflow.needs_attention";

const DOM_DEPENDENT_ACTIONS = new Set([
  Actions.ElementClick,
  Actions.ElementType,
  Actions.ElementExtract,
  Actions.ElementFocus,
  Actions.ElementSelect,
  Actions.ElementToggle,
  Actions.ElementDoubleClick,
  Actions.ElementHover,
  Actions.ElementClear,
  Actions.ElementScrollIntoView,
  Actions.WaitElementVisible,
  Actions.WaitElementHidden,
  Actions.WaitElementEnabled,
  Actions.WaitElementText,
  Actions.DataExtractText,
  Actions.DataExtractAttribute,
  Actions.DataExtractList,
  Actions.DataExtractTable,
  Actions.FileInputUpload,
]);

export function isGraphWorkflowSchemaVersion(version) {
  return version === WorkflowSchemaVersion.Graph ||
    version === WorkflowSchemaVersion.MapperGraph;
}

export function isMapperGraphWorkflow(input = {}) {
  return input?.schemaVersion === WorkflowSchemaVersion.MapperGraph;
}

export function isDomDependentNode(node = {}) {
  return DOM_DEPENDENT_ACTIONS.has(node?.type) ||
    Boolean(node?.data?.componentRef);
}

export function detectWorkflowSchema(input) {
  return isGraphWorkflowSchemaVersion(input?.schemaVersion)
    ? input.schemaVersion
    : WorkflowSchemaVersion.Sequential;
}

export function upgradeWorkflowToV2(input = {}, options = {}) {
  if (isGraphWorkflowSchemaVersion(detectWorkflowSchema(input))) {
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
      version: legacyNodeContractVersion(step?.version),
      position: { x: 80, y: 80 + index * 180 },
      config: cloneObject(step?.config),
      data,
    };
  });
  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `edge-${node.id}-${nodes[index + 1].id}`,
    source: node.id,
    sourceHandle: GraphEdgeHandles.Success,
    target: nodes[index + 1].id,
    targetHandle: GraphEdgeHandles.Input,
  }));

  const graph = {
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
  assertValidGraphWorkflow(graph);
  return graph;
}

export function upgradeWorkflowToCanonical(input = {}, options = {}) {
  let graph;
  const schema = detectWorkflowSchema(input);
  if (isGraphWorkflowSchemaVersion(schema)) {
    assertValidGraphWorkflow(input);
    graph = structuredClone(input);
  } else {
    graph = upgradeWorkflowToV2(input, options);
  }
  graph.schemaVersion = WorkflowSchemaVersion.MapperGraph;
  graph.settings = cloneObject(graph.settings);
  graph.variables = cloneObject(graph.variables);
  graph.datasets = cloneObject(graph.datasets);
  graph.dataSources = cloneArray(graph.dataSources);
  return ensureCanonicalMapperRoutes(graph);
}

export function canonicalWorkflowToSequentialView(input = {}, options = {}) {
  const graph = upgradeWorkflowToCanonical(input, options);
  const userNodes = orderedSequentialUserNodes(graph);
  return {
    id: graph.id,
    name: graph.name,
    description: graph.description,
    boundDomain: graph.boundDomain,
    variables: cloneObject(graph.variables),
    datasets: cloneObject(graph.datasets),
    dataSources: cloneArray(graph.dataSources),
    settings: cloneObject(graph.settings),
    steps: userNodes.map(graphNodeToSequentialStep),
    canonicalGraph: structuredClone(graph),
    structureSignature: userNodes.map((node) => node.id).join("|"),
    structureLocked: hasUserManagedRoutes(graph),
  };
}

export function sequentialViewToCanonicalWorkflow(view = {}, options = {}) {
  const steps = Array.isArray(view.steps) ? view.steps : [];
  const base = view.canonicalGraph
    ? upgradeWorkflowToCanonical(view.canonicalGraph, options)
    : upgradeWorkflowToCanonical({
        id: view.id,
        name: view.name,
        description: view.description,
        boundDomain: view.boundDomain,
        variables: view.variables,
        datasets: view.datasets,
        dataSources: view.dataSources,
        settings: view.settings,
        steps,
      }, options);
  const baseUserNodes = orderedSequentialUserNodes(base);
  const originalSignature = view.structureSignature ||
    baseUserNodes.map((node) => node.id).join("|");
  const nextSignature = steps.map((step) => String(step.id || "")).join("|");
  const structureChanged = originalSignature !== nextSignature;
  if (structureChanged && hasUserManagedRoutes(base)) {
    throw new Error(
      "This workflow contains explicit graph routes. The legacy linear adapter cannot edit route structure; use Graph Studio.",
    );
  }

  const baseById = new Map(base.nodes.map((node) => [node.id, node]));
  const userNodes = steps.map((step, index) => sequentialStepToGraphNode(
    step,
    baseById.get(step.id),
    index,
  ));
  const systemNodes = base.nodes.filter((node) => node.type === MapperAttentionNodeType);
  let edges;
  if (structureChanged) {
    edges = userNodes.slice(0, -1).map((node, index) => ({
      id: `edge-${node.id}-${userNodes[index + 1].id}`,
      source: node.id,
      sourceHandle: GraphEdgeHandles.Success,
      target: userNodes[index + 1].id,
      targetHandle: GraphEdgeHandles.Input,
    }));
  } else {
    const retained = new Set([...userNodes, ...systemNodes].map((node) => node.id));
    edges = base.edges.filter((edge) => retained.has(edge.source) && retained.has(edge.target));
  }

  const graph = {
    ...base,
    schemaVersion: CurrentGraphWorkflowSchemaVersion,
    id: String(view.id || base.id || options.id || "workflow-v3"),
    name: String(view.name || base.name || options.name || "Untitled"),
    description: String(view.description ?? base.description ?? ""),
    boundDomain: String(view.boundDomain ?? base.boundDomain ?? ""),
    variables: cloneObject(view.variables ?? base.variables),
    datasets: cloneObject(view.datasets ?? base.datasets),
    dataSources: cloneArray(view.dataSources ?? base.dataSources),
    settings: cloneObject(view.settings ?? base.settings),
    entryNodeId: userNodes[0]?.id || "",
    nodes: [...userNodes, ...systemNodes],
    edges,
  };
  return ensureCanonicalMapperRoutes(graph);
}

/**
 * Schema-v1 workflows predate required node contract versions. This is the
 * only implicit version migration: a missing legacy version becomes 1.
 * Explicit invalid values are preserved so validation fails closed.
 */
export function addLegacyNodeContractVersions(input = {}) {
  if (Array.isArray(input)) {
    return input.map((step) => addLegacyStepContractVersion(step));
  }
  const source = input && typeof input === "object" ? structuredClone(input) : {};
  source.steps = Array.isArray(source.steps)
    ? source.steps.map((step) => addLegacyStepContractVersion(step))
    : [];
  return source;
}

export function graphWorkflowToSequential(input = {}) {
  assertValidGraphWorkflow(input);
  if (
    isMapperGraphWorkflow(input) &&
    input.edges.some((edge) => edgeSourceHandle(edge) !== GraphEdgeHandles.Success)
  ) {
    throw new Error(
      "Mapper v3 workflows with non-success routing require graph traversal and cannot run in the linear executor.",
    );
  }
  const nodesById = new Map(input.nodes.map((node) => [node.id, node]));
  const outgoing = new Map(input.edges
    .filter((edge) => edgeSourceHandle(edge) === GraphEdgeHandles.Success)
    .map((edge) => [edge.source, edge]));
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
  if (input.schemaVersion === WorkflowSchemaVersion.Graph) {
    return validateLinearGraphWorkflow(input);
  }
  if (input.schemaVersion === WorkflowSchemaVersion.MapperGraph) {
    return validateMapperGraphWorkflow(input);
  }

  const errors = [];
  errors.push("Workflow schemaVersion must be 2 or 3.");
  if (!Array.isArray(input.nodes)) errors.push("Workflow nodes must be an array.");
  if (!Array.isArray(input.edges)) errors.push("Workflow edges must be an array.");
  return { valid: false, errors };
}

function validateLinearGraphWorkflow(input = {}) {
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
  if (input.nodes.some((node) => !isPositiveContractVersion(node?.version))) {
    errors.push("Every graph node requires a positive integer contract version.");
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
    if (edge.sourceHandle && edge.sourceHandle !== GraphEdgeHandles.Success) {
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

function validateMapperGraphWorkflow(input = {}) {
  const errors = [];
  if (!Array.isArray(input.nodes)) errors.push("Workflow nodes must be an array.");
  if (!Array.isArray(input.edges)) errors.push("Workflow edges must be an array.");
  if (errors.length) return { valid: false, errors };

  const nodeIds = input.nodes.map((node) => String(node?.id || ""));
  const nodeIdSet = new Set(nodeIds);
  const edgeIds = input.edges.map((edge) => String(edge?.id || ""));
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));

  if (nodeIds.some((id) => !id)) errors.push("Every graph node requires an id.");
  if (nodeIdSet.size !== nodeIds.length) errors.push("Graph node ids must be unique.");
  if (edgeIds.some((id) => !id)) errors.push("Every graph edge requires an id.");
  if (new Set(edgeIds).size !== edgeIds.length) errors.push("Graph edge ids must be unique.");
  if (input.nodes.some((node) => !String(node?.type || "").trim())) {
    errors.push("Every graph node requires a type.");
  }
  if (input.nodes.some((node) => !isPositiveContractVersion(node?.version))) {
    errors.push("Every graph node requires a positive integer contract version.");
  }

  if (input.nodes.length === 0) {
    if (input.entryNodeId) errors.push("An empty graph cannot have an entry node.");
    if (input.edges.length) errors.push("An empty graph cannot have edges.");
    return { valid: errors.length === 0, errors };
  }
  if (!nodeIdSet.has(input.entryNodeId)) errors.push("Graph entryNodeId is missing or invalid.");

  const incomingSuccessCounts = new Map(nodeIds.map((id) => [id, 0]));
  const incomingAnyCounts = new Map(nodeIds.map((id) => [id, 0]));
  const outgoingSuccessCounts = new Map(nodeIds.map((id) => [id, 0]));
  const outgoingErrorCounts = new Map(nodeIds.map((id) => [id, 0]));
  const outgoingUnresolvedCounts = new Map(nodeIds.map((id) => [id, 0]));
  const successOutgoing = new Map();
  const allOutgoing = new Map(nodeIds.map((id) => [id, []]));

  for (const edge of input.edges) {
    if (!nodeIdSet.has(edge?.source) || !nodeIdSet.has(edge?.target)) {
      errors.push(`Edge "${edge?.id || "unknown"}" references a missing node.`);
      continue;
    }

    const sourceHandle = edgeSourceHandle(edge);
    if (
      sourceHandle !== GraphEdgeHandles.Success &&
      sourceHandle !== GraphEdgeHandles.Error &&
      sourceHandle !== GraphEdgeHandles.Unresolved
    ) {
      errors.push("Mapper v3 edges support success, error, and unresolved handles only.");
      continue;
    }
    if (edge.targetHandle && edge.targetHandle !== GraphEdgeHandles.Input) {
      errors.push("Mapper v3 edges must target the input handle.");
    }

    incomingAnyCounts.set(edge.target, incomingAnyCounts.get(edge.target) + 1);
    allOutgoing.get(edge.source).push(edge.target);

    if (sourceHandle === GraphEdgeHandles.Success) {
      incomingSuccessCounts.set(edge.target, incomingSuccessCounts.get(edge.target) + 1);
      outgoingSuccessCounts.set(edge.source, outgoingSuccessCounts.get(edge.source) + 1);
      successOutgoing.set(edge.source, edge.target);
    } else if (sourceHandle === GraphEdgeHandles.Error) {
      outgoingErrorCounts.set(edge.source, outgoingErrorCounts.get(edge.source) + 1);
    } else {
      outgoingUnresolvedCounts.set(edge.source, outgoingUnresolvedCounts.get(edge.source) + 1);
    }
  }

  if ((incomingAnyCounts.get(input.entryNodeId) || 0) !== 0) {
    errors.push("Entry node cannot have an incoming edge.");
  }

  for (const nodeId of nodeIds) {
    const node = nodeById.get(nodeId);
    if ((outgoingSuccessCounts.get(nodeId) || 0) > 1) {
      errors.push("Mapper v3 nodes can have at most one success edge.");
      break;
    }
    if ((outgoingUnresolvedCounts.get(nodeId) || 0) > 1) {
      errors.push("Mapper v3 nodes can have at most one unresolved edge.");
      break;
    }
    if ((outgoingErrorCounts.get(nodeId) || 0) > 1) {
      errors.push("Mapper v3 nodes can have at most one error edge.");
      break;
    }
    if (
      node?.type !== MapperAttentionNodeType &&
      (incomingSuccessCounts.get(nodeId) || 0) > 1
    ) {
      errors.push("Mapper v3 nodes can have at most one success parent.");
      break;
    }
  }

  for (const node of input.nodes) {
    if (isDomDependentNode(node) && (outgoingUnresolvedCounts.get(node.id) || 0) !== 1) {
      errors.push(`Mapper v3 DOM node "${node.id}" requires an unresolved edge.`);
    }
  }

  const successVisited = new Set();
  let current = input.entryNodeId;
  while (current && !successVisited.has(current)) {
    successVisited.add(current);
    current = successOutgoing.get(current) || "";
  }
  if (current) errors.push("Graph success path contains a cycle.");

  const reachable = new Set();
  const queue = [input.entryNodeId];
  while (queue.length) {
    const nodeId = queue.shift();
    if (!nodeId || reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    queue.push(...(allOutgoing.get(nodeId) || []));
  }
  if (reachable.size !== input.nodes.length) {
    errors.push("Every graph node must be reachable from the entry node.");
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

function edgeSourceHandle(edge = {}) {
  return edge.sourceHandle || GraphEdgeHandles.Success;
}

function ensureCanonicalMapperRoutes(input) {
  const graph = structuredClone(input);
  graph.schemaVersion = WorkflowSchemaVersion.MapperGraph;
  const domNodes = graph.nodes.filter((node) => isDomDependentNode(node));
  if (!domNodes.length) {
    const systemAttentionIds = new Set(graph.nodes
      .filter((node) => (
        node.type === MapperAttentionNodeType && node.data?.systemNode === true
      ))
      .map((node) => node.id));
    const referencedAttentionIds = new Set(graph.edges
      .filter((edge) => (
        edgeSourceHandle(edge) !== GraphEdgeHandles.Unresolved &&
        (
          systemAttentionIds.has(edge.source) ||
          systemAttentionIds.has(edge.target)
        )
      ))
      .flatMap((edge) => [edge.source, edge.target])
      .filter((nodeId) => systemAttentionIds.has(nodeId)));
    const orphanIds = new Set(
      [...systemAttentionIds]
        .filter((nodeId) => !referencedAttentionIds.has(nodeId)),
    );
    if (orphanIds.size) {
      graph.nodes = graph.nodes.filter((node) => !orphanIds.has(node.id));
      graph.edges = graph.edges.filter((edge) => (
        !orphanIds.has(edge.source) && !orphanIds.has(edge.target)
      ));
      if (orphanIds.has(graph.entryNodeId)) graph.entryNodeId = graph.nodes[0]?.id || "";
    }
  }
  let attention = graph.nodes.find((node) => node.type === MapperAttentionNodeType);
  if (domNodes.length && !attention) {
    const usedIds = new Set(graph.nodes.map((node) => node.id));
    const id = uniqueNodeId("workflow-needs-attention", usedIds);
    attention = {
      id,
      type: MapperAttentionNodeType,
      version: 1,
      position: { x: 420, y: 80 + graph.nodes.length * 180 },
      config: {},
      data: { systemNode: true },
    };
    graph.nodes.push(attention);
  }
  if (attention) {
    for (const node of domNodes) {
      const existing = graph.edges.some((edge) =>
        edge.source === node.id &&
        edgeSourceHandle(edge) === GraphEdgeHandles.Unresolved
      );
      if (!existing) {
        graph.edges.push({
          id: uniqueEdgeId(`edge-${node.id}-unresolved-${attention.id}`, graph.edges),
          source: node.id,
          sourceHandle: GraphEdgeHandles.Unresolved,
          target: attention.id,
          targetHandle: GraphEdgeHandles.Input,
        });
      }
    }
  }
  assertValidGraphWorkflow(graph);
  return graph;
}

function orderedSequentialUserNodes(graph) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const success = new Map(graph.edges
    .filter((edge) => edgeSourceHandle(edge) === GraphEdgeHandles.Success)
    .map((edge) => [edge.source, edge.target]));
  const ordered = [];
  const visited = new Set();
  let current = graph.entryNodeId;
  while (current && !visited.has(current)) {
    visited.add(current);
    const node = byId.get(current);
    if (node && node.type !== MapperAttentionNodeType) ordered.push(node);
    current = success.get(current) || "";
  }
  for (const node of graph.nodes) {
    if (node.type !== MapperAttentionNodeType && !visited.has(node.id)) {
      ordered.push(node);
    }
  }
  return ordered;
}

function graphNodeToSequentialStep(node) {
  return {
    ...cloneObject(node.data),
    id: node.id,
    action: node.type,
    type: node.type,
    version: node.version,
    config: cloneObject(node.config),
  };
}

function sequentialStepToGraphNode(step, existing, index) {
  const type = String(step.action || step.type || "").trim();
  const data = omitKeys(step || {}, [
    "id",
    "action",
    "type",
    "version",
    "config",
  ]);
  return {
    ...(existing ? structuredClone(existing) : {}),
    id: String(step.id || `node-${index + 1}`),
    type,
    version: step.version,
    position: existing?.position || { x: 80, y: 80 + index * 180 },
    config: cloneObject(step.config),
    data,
  };
}

function hasUserManagedRoutes(graph) {
  const attentionIds = new Set(graph.nodes
    .filter((node) => node.type === MapperAttentionNodeType)
    .map((node) => node.id));
  return graph.edges.some((edge) => {
    const handle = edgeSourceHandle(edge);
    return handle !== GraphEdgeHandles.Success && !(
      handle === GraphEdgeHandles.Unresolved && attentionIds.has(edge.target)
    );
  });
}

function uniqueEdgeId(candidate, edges) {
  const used = new Set(edges.map((edge) => edge.id));
  let id = candidate;
  let suffix = 2;
  while (used.has(id)) id = `${candidate}-${suffix++}`;
  return id;
}

function addLegacyStepContractVersion(step = {}) {
  const source = step && typeof step === "object" ? structuredClone(step) : {};
  if (source.version === undefined || source.version === null || source.version === "") {
    source.version = 1;
  }
  return source;
}

function legacyNodeContractVersion(value) {
  if (value === undefined || value === null || value === "") return 1;
  return Number(value);
}

function isPositiveContractVersion(value) {
  return Number.isInteger(value) && value > 0;
}
