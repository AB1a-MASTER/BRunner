import {
  NodeContractKinds,
  resolveNodeDefinition,
} from "./nodeRegistry.js";
import { prepareNodeConfiguration } from "./nodeAuthoring.js";
import {
  MapperAttentionNodeType,
  WorkflowSchemaVersion,
  detectWorkflowSchema,
  isGraphWorkflowSchemaVersion,
  upgradeWorkflowToCanonical,
  validateGraphWorkflow,
} from "./workflowSchema.js";
import {
  normalizeWorkflow,
  normalizeWorkflowSettings,
} from "./workflowUtils.js";

export const WorkflowExecutionModels = Object.freeze({
  CanonicalGraph: "canonical_graph",
  LegacyLinear: "legacy_linear",
});

export const WorkflowExecutionPlanVersion = 1;

export const WorkflowPreparationCodes = Object.freeze({
  ContractInvalid: "WORKFLOW_CONTRACT_INVALID",
  ConfigInvalid: "WORKFLOW_CONFIG_INVALID",
  GraphInvalid: "WORKFLOW_GRAPH_INVALID",
  RouteInvalid: "WORKFLOW_ROUTE_INVALID",
});

export class WorkflowPreparationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "WorkflowPreparationError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

export function prepareWorkflowForExecution(input = {}, options = {}) {
  const sourceSchema = detectWorkflowSchema(input);
  const graphInput = isGraphWorkflowSchemaVersion(sourceSchema);
  const resolveDefinition = options.resolveDefinition || resolveNodeDefinition;
  const linearWorkflow = graphInput ? null : normalizeWorkflow(input);
  const linearDefinitions = graphInput
    ? []
    : resolveExecutableDefinitions(
        linearWorkflow.steps,
        resolveDefinition,
      );
  const containsFinalizedNodes = graphInput
    ? false
    : linearDefinitions.some(isFinalizedDefinition);

  if (!graphInput && !containsFinalizedNodes) {
    const executionPlan = createWorkflowExecutionPlan({
      sourceSchema,
      executionModel: WorkflowExecutionModels.LegacyLinear,
      containsFinalizedNodes: false,
      workflow: linearWorkflow,
      nodeInvocations: linearWorkflow.steps,
    });
    return {
      sourceSchema,
      executionModel: WorkflowExecutionModels.LegacyLinear,
      containsFinalizedNodes: false,
      workflow: executionPlan.workflow,
      steps: executionPlan.nodeInvocations,
      executionPlan,
    };
  }

  const canonicalInput = graphInput ? input : linearWorkflow;
  const canonical = upgradeWorkflowToCanonical(canonicalInput, {
    id: options.id,
    name: options.name,
  });
  const preparedNodes = [];
  const invocationNodes = [];
  const definitionsByNodeId = new Map();
  let finalized = containsFinalizedNodes;

  for (let index = 0; index < canonical.nodes.length; index += 1) {
    const node = canonical.nodes[index];
    if (node.type === MapperAttentionNodeType) {
      preparedNodes.push(structuredClone(node));
      invocationNodes.push(structuredClone(node));
      continue;
    }

    const definition = resolveExecutableDefinition(
      node,
      index,
      resolveDefinition,
    );
    finalized ||= isFinalizedDefinition(definition);
    definitionsByNodeId.set(node.id, definition);
    const prepared = prepareNodeConfiguration(
      node.config,
      definition,
      {
        node: {
          ...node,
          ...(node.data || {}),
          data: node.data || {},
        },
      },
    );
    if (prepared.issues.length) {
      throw new WorkflowPreparationError(
        WorkflowPreparationCodes.ConfigInvalid,
        `Node ${node.id} has invalid configuration: ${prepared.issues
          .map((issue) => issue.message)
          .join(" ")}`,
        {
          nodeId: node.id,
          nodeType: node.type,
          nodeVersion: node.version,
          issues: prepared.issues,
        },
      );
    }

    let invocationConfig = prepared.config;
    if (
      isFinalizedDefinition(definition) &&
      typeof options.validateFinalizedConfig === "function"
    ) {
      const validation = validateFinalizedConfiguration(
        options.validateFinalizedConfig,
        prepared.config,
        node,
        definition,
      );
      invocationConfig = validation.config;
    }

    preparedNodes.push({
      ...structuredClone(node),
      config: structuredClone(prepared.config),
    });
    invocationNodes.push({
      ...structuredClone(node),
      config: structuredClone(invocationConfig),
    });
  }

  const workflow = {
    ...structuredClone(canonical),
    schemaVersion: WorkflowSchemaVersion.MapperGraph,
    settings: normalizeWorkflowSettings(canonical.settings),
    nodes: preparedNodes,
    edges: structuredClone(canonical.edges),
  };
  const validation = validateGraphWorkflow(workflow);
  if (!validation.valid) {
    throw new WorkflowPreparationError(
      WorkflowPreparationCodes.GraphInvalid,
      `Invalid canonical workflow: ${validation.errors.join(" ")}`,
      { errors: validation.errors },
    );
  }
  assertFinalizedErrorRoutes(workflow, definitionsByNodeId);
  const executionPlan = createWorkflowExecutionPlan({
    sourceSchema,
    executionModel: WorkflowExecutionModels.CanonicalGraph,
    containsFinalizedNodes: finalized,
    workflow,
    nodeInvocations: invocationNodes,
  });

  return {
    sourceSchema,
    executionModel: WorkflowExecutionModels.CanonicalGraph,
    containsFinalizedNodes: finalized,
    workflow: executionPlan.workflow,
    steps: executionPlan.nodeInvocations,
    executionPlan,
  };
}

export function createWorkflowExecutionPlan({
  sourceSchema = WorkflowSchemaVersion.Sequential,
  executionModel = WorkflowExecutionModels.LegacyLinear,
  containsFinalizedNodes = false,
  workflow = {},
  nodeInvocations,
} = {}) {
  if (!Object.values(WorkflowExecutionModels).includes(executionModel)) {
    throw new WorkflowPreparationError(
      WorkflowPreparationCodes.GraphInvalid,
      `Unsupported workflow execution model: ${String(executionModel)}.`,
      { executionModel },
    );
  }

  const planWorkflow = structuredClone(workflow);
  const canonical =
    executionModel === WorkflowExecutionModels.CanonicalGraph;
  const workflowNodes = canonical
    ? planWorkflow.nodes
    : planWorkflow.steps;
  if (!Array.isArray(workflowNodes)) {
    throw new WorkflowPreparationError(
      WorkflowPreparationCodes.GraphInvalid,
      "Prepared workflow is missing its executable node list.",
      { executionModel },
    );
  }

  const invocations = structuredClone(
    Array.isArray(nodeInvocations) ? nodeInvocations : workflowNodes,
  );
  assertExecutionPlanAlignment(workflowNodes, invocations, canonical);

  return {
    planVersion: WorkflowExecutionPlanVersion,
    sourceSchema,
    executionModel,
    containsFinalizedNodes: containsFinalizedNodes === true,
    workflow: planWorkflow,
    nodeInvocations: invocations,
  };
}

export function createWorkflowVariableState(
  variables = {},
  executionModel = WorkflowExecutionModels.LegacyLinear,
) {
  const seeds = isPlainObject(variables) ? structuredClone(variables) : {};
  const origins = Object.fromEntries(
    Object.keys(seeds).map((name) => [
      name,
      {
        source: "workflow",
        nodeId: "",
        action: "workflow.variable",
      },
    ]),
  );
  if (executionModel !== WorkflowExecutionModels.CanonicalGraph) {
    return { values: seeds, origins };
  }

  const legacyAliases = Object.fromEntries(
    Object.entries(seeds).filter(([name]) => (
      !["variables", "nodes", "workflowClipboard", "workflowClipboardVersions"]
        .includes(name)
    )),
  );
  return {
    values: {
      ...legacyAliases,
      variables: structuredClone(seeds),
      nodes: {},
      workflowClipboard: {},
      workflowClipboardVersions: {},
    },
    origins: {
      ...origins,
      ...Object.fromEntries(
        Object.entries(origins).map(([name, origin]) => [
          `variables.${name}`,
          structuredClone(origin),
        ]),
      ),
    },
  };
}

function resolveExecutableDefinitions(nodes, resolveDefinition) {
  return nodes
    .filter((node) => (node.action || node.type) !== MapperAttentionNodeType)
    .map((node, index) => resolveExecutableDefinition(
      node,
      index,
      resolveDefinition,
    ));
}

function resolveExecutableDefinition(node, index, resolveDefinition) {
  try {
    return resolveDefinition(node);
  } catch (error) {
    throw new WorkflowPreparationError(
      WorkflowPreparationCodes.ContractInvalid,
      error.message || "Workflow contains an unsupported node contract.",
      {
        nodeId: node?.id || "",
        nodeType: node?.type || node?.action || "",
        nodeVersion: node?.version ?? null,
        nodeIndex: index,
        contractCode: error.code || "NODE_CONTRACT_INVALID",
        contractDetails: error.details || null,
      },
    );
  }
}

function isFinalizedDefinition(definition = {}) {
  return definition.contractKind === NodeContractKinds.Finalized;
}

function assertExecutionPlanAlignment(workflowNodes, invocations, canonical) {
  if (workflowNodes.length !== invocations.length) {
    throw new WorkflowPreparationError(
      WorkflowPreparationCodes.GraphInvalid,
      "Execution plan node count does not match the prepared workflow.",
      {
        workflowNodeCount: workflowNodes.length,
        invocationCount: invocations.length,
      },
    );
  }

  for (let index = 0; index < workflowNodes.length; index += 1) {
    const workflowNode = workflowNodes[index] || {};
    const invocation = invocations[index] || {};
    const workflowType = canonical
      ? workflowNode.type
      : workflowNode.action || workflowNode.type;
    const invocationType = canonical
      ? invocation.type
      : invocation.action || invocation.type;
    if (
      String(workflowNode.id || "") !== String(invocation.id || "") ||
      String(workflowType || "") !== String(invocationType || "") ||
      Number(workflowNode.version) !== Number(invocation.version)
    ) {
      throw new WorkflowPreparationError(
        WorkflowPreparationCodes.GraphInvalid,
        `Execution plan invocation ${index + 1} does not match its workflow node.`,
        {
          index,
          workflowNode: {
            id: workflowNode.id || "",
            type: workflowType || "",
            version: workflowNode.version ?? null,
          },
          invocation: {
            id: invocation.id || "",
            type: invocationType || "",
            version: invocation.version ?? null,
          },
        },
      );
    }
  }
}

function validateFinalizedConfiguration(
  validator,
  config,
  node,
  definition,
) {
  let validation;
  try {
    validation = validator(config, { node, definition });
  } catch (error) {
    throw new WorkflowPreparationError(
      WorkflowPreparationCodes.ConfigInvalid,
      error.message || `Node ${node.id} has invalid finalized configuration.`,
      {
        nodeId: node.id,
        nodeType: node.type,
        nodeVersion: node.version,
        validationErrors: [error.message || "Configuration is invalid."],
      },
    );
  }
  if (validation === false || validation?.valid === false) {
    const errors = validation?.errors || ["Configuration is invalid."];
    throw new WorkflowPreparationError(
      WorkflowPreparationCodes.ConfigInvalid,
      `Node ${node.id} has invalid finalized configuration: ${errors.join(" ")}`,
      {
        nodeId: node.id,
        nodeType: node.type,
        nodeVersion: node.version,
        validationErrors: errors,
      },
    );
  }
  return {
    config: validation?.config
      ? structuredClone(validation.config)
      : structuredClone(config),
  };
}

function assertFinalizedErrorRoutes(workflow, definitionsByNodeId) {
  const errorSources = new Set(workflow.edges
    .filter((edge) => edge.sourceHandle === "error")
    .map((edge) => edge.source));

  for (const node of workflow.nodes) {
    const definition = definitionsByNodeId.get(node.id);
    if (!isFinalizedDefinition(definition)) continue;
    if (node.config?.onError !== "error_port") continue;

    const supportsError = (definition.outputPorts || definition.outputs || [])
      .some((port) => (typeof port === "string" ? port : port?.id) === "error");
    if (!supportsError || !errorSources.has(node.id)) {
      throw new WorkflowPreparationError(
        WorkflowPreparationCodes.RouteInvalid,
        `Node ${node.id} requires a connected error route for onError error_port.`,
        {
          nodeId: node.id,
          nodeType: node.type,
          nodeVersion: node.version,
          route: "error",
        },
      );
    }
  }
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
