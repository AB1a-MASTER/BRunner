import {
  NodeErrorCodes,
  NodeExecutionError,
  NodeStatuses,
  normalizeCommonNodeConfig,
} from "../shared/nodeContracts.js";
import {
  createCompletedNodeResult,
  createDisabledNodeResult,
  createNodeLogEvents,
  createNodeResult,
  normalizeNodeError,
  normalizeNodeResult,
  publishNodeResult,
} from "../shared/resultAdapter.js";
import {
  executeWithRetry,
  normalizeRetryPolicy,
} from "../shared/executionPolicy.js";

export const FinalizedNodeRoutes = Object.freeze({
  Success: "success",
  Error: "error",
  Fail: "fail",
});

export async function executeFinalizedNode(request = {}, services = {}) {
  const definition = request.definition || {};
  const nodeId = String(request.nodeId || request.node?.id || "").trim();
  const nodeType = String(
    request.nodeType ||
      request.node?.type ||
      definition.type ||
      "",
  ).trim();
  if (!nodeId) {
    throw new NodeExecutionError(
      NodeErrorCodes.ConfigInvalid,
      "Finalized node execution requires nodeId.",
    );
  }
  const config = normalizeCommonNodeConfig(
    request.config || request.node?.config || {},
    definition.commonConfigDefaults || {
      displayName: definition.displayName || definition.label || nodeType || "Node",
      retryCount: definition.defaultRetryCount,
      retryDelay: definition.defaultRetryDelay,
      retryOnlyFor: definition.retryOnlyFor,
      timeout: definition.defaultTimeout,
      onError: definition.defaultOnError,
    },
  );
  const startedMs = nowMs(services.clock);
  const startedAt = new Date(startedMs).toISOString();
  const baseExecution = {
    nodeId,
    attempt: 1,
    startedAt,
    executionMethod: "runtime",
  };
  const retries = [];

  if (config.enabled === false) {
    const result = createDisabledNodeResult({
      execution: {
        ...baseExecution,
        finishedAt: new Date(nowMs(services.clock)).toISOString(),
      },
    });
    await publishAndLog({
      request,
      services,
      config,
      result,
      nodeId,
      nodeType,
      retries: [],
    });
    return {
      result,
      route: FinalizedNodeRoutes.Success,
      handledError: false,
    };
  }


  if (typeof request.executor !== "function") {
    throw new NodeExecutionError(
      NodeErrorCodes.DependencyNotReady,
      "Finalized node executor is unavailable.",
      { nodeId, nodeType },
    );
  }

  try {
    await validateNodeRequest(request, {
      nodeId,
      nodeType,
      config,
      definition,
      services,
    });
    const dependencies =
      typeof request.resolveDependencies === "function"
        ? await request.resolveDependencies({
            nodeId,
            nodeType,
            config,
            definition,
            inputs: request.inputs,
            services,
          })
        : {};
    const retryPolicy = normalizeRetryPolicy(config, definition);
    const execution = await executeWithRetry(async ({ attempt, policy }) => {
      const value = await executeAttemptWithTimeout({
        executor: request.executor,
        timeoutMs: config.timeout,
        services,
        context: {
          nodeId,
          nodeType,
          attempt,
          policy,
          config,
          definition,
          inputs: request.inputs,
          dependencies,
          services,
        },
      });
      return normalizeExecutorValue(value, {
        ...baseExecution,
        attempt,
      }, services.clock);
    }, {
      policy: retryPolicy,
      definition,
      delay: services.delay,
      isCancelled: services.isCancelled,
      verifyBeforeRetry: request.verifyBeforeRetry,
      onAttempt: request.onAttempt,
      onRetry: async (event) => {
        retries.push({
          ...event,
          timestamp: new Date(nowMs(services.clock)).toISOString(),
        });
        await request.onRetry?.(event);
      },
    });

    const result = normalizeNodeResult(execution.value, {
      ...baseExecution,
      attempt: execution.attempts,
      finishedAt: new Date(nowMs(services.clock)).toISOString(),
    });
    await publishAndLog({
      request,
      services,
      config,
      result,
      nodeId,
      nodeType,
      retries,
    });
    return {
      result,
      route: FinalizedNodeRoutes.Success,
      handledError: false,
    };
  } catch (rawError) {
    const error = normalizeRuntimeError(rawError);
    const attempt = Math.max(1, Number(error.details?.attempts) || 1);
    const finishedAt = new Date(nowMs(services.clock)).toISOString();
    const status =
      error.code === NodeErrorCodes.Timeout
        ? NodeStatuses.TimedOut
        : error.code === NodeErrorCodes.Cancelled
          ? NodeStatuses.Cancelled
          : NodeStatuses.Failed;
    const failureResult = createNodeResult({
      status,
      output: null,
      errors: [error],
      execution: {
        ...baseExecution,
        attempt,
        finishedAt,
        executionMethod:
          error.details?.executionMethod ||
          baseExecution.executionMethod,
      },
    });
    const handled = applyOnErrorPolicy(failureResult, config, error);
    await publishAndLog({
      request,
      services,
      config,
      result: handled.result,
      nodeId,
      nodeType,
      retries,
    });
    return handled;
  }
}

async function validateNodeRequest(request, context) {
  const validators = [
    request.validateConfig,
    request.definition?.validateConfig,
  ].filter((validator) => typeof validator === "function");

  for (const validator of validators) {
    const validation = await validator(context.config, context);
    if (validation === false) {
      throw new NodeExecutionError(
        NodeErrorCodes.ConfigInvalid,
        "Node configuration is invalid.",
        { nodeId: context.nodeId, nodeType: context.nodeType },
      );
    }
    if (validation && validation.valid === false) {
      throw new NodeExecutionError(
        NodeErrorCodes.ConfigInvalid,
        (validation.errors || ["Node configuration is invalid."]).join(" "),
        { validationErrors: validation.errors || [] },
      );
    }
  }
}

async function executeAttemptWithTimeout({
  executor,
  timeoutMs,
  services,
  context,
}) {
  if (services.isCancelled?.()) {
    throw new NodeExecutionError(
      NodeErrorCodes.Cancelled,
      "Node execution was cancelled.",
      { attempt: context.attempt },
    );
  }

  const timeout = Number(timeoutMs);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    return await executor(context);
  }

  if (typeof services.withTimeout === "function") {
    return await services.withTimeout(
      () => executor(context),
      timeout,
      context,
    );
  }

  throw new NodeExecutionError(
    NodeErrorCodes.DependencyNotReady,
    "A cancellable timeout service is required when node timeout is enabled.",
    {
      attempt: context.attempt,
      timeoutMs: timeout,
      dependency: "withTimeout",
      retryable: false,
    },
  );
}

function normalizeExecutorValue(value, executionDefaults, clock) {
  if (isResultEnvelope(value)) {
    const normalized = normalizeNodeResult(value, {
      ...executionDefaults,
      finishedAt: new Date(nowMs(clock)).toISOString(),
    });
    if (normalized.status === NodeStatuses.Completed) return normalized;

    const returnedError = normalized.errors[0] || {};
    const defaultCode =
      normalized.status === NodeStatuses.TimedOut
        ? NodeErrorCodes.Timeout
        : normalized.status === NodeStatuses.Cancelled
          ? NodeErrorCodes.Cancelled
          : NodeErrorCodes.ValidationFailed;
    const code = Object.values(NodeErrorCodes).includes(returnedError.code)
      ? returnedError.code
      : defaultCode;
    throw new NodeExecutionError(
      code,
      returnedError.message || `Node executor returned ${normalized.status}.`,
      {
        ...(isPlainObject(returnedError.details) ? returnedError.details : {}),
        returnedStatus: normalized.status,
        executionMethod: normalized.execution?.executionMethod || "runtime",
      },
    );
  }

  const source = isPlainObject(value) ? value : { output: value };
  return createCompletedNodeResult({
    output:
      Object.prototype.hasOwnProperty.call(source, "output")
        ? source.output
        : source,
    warnings: source.warnings,
    errors: source.errors,
    execution: {
      ...executionDefaults,
      ...(isPlainObject(source.execution) ? source.execution : {}),
      executionMethod:
        source.executionMethod ||
        source.execution?.executionMethod ||
        "runtime",
      finishedAt: new Date(nowMs(clock)).toISOString(),
    },
  });
}

function applyOnErrorPolicy(failureResult, config, error) {
  if (config.onError === "continue_with_warning" || config.onError === "skip") {
    const warning = {
      code: error.code,
      message:
        config.onError === "skip"
          ? `Node error skipped: ${error.message}`
          : error.message,
      details: error.details,
    };
    return {
      result: createNodeResult({
        status: NodeStatuses.Completed,
        output: null,
        warnings: [warning],
        errors: [],
        execution: failureResult.execution,
      }),
      route: FinalizedNodeRoutes.Success,
      handledError: true,
    };
  }
  if (config.onError === "error_port") {
    return {
      result: failureResult,
      route: FinalizedNodeRoutes.Error,
      handledError: true,
    };
  }
  return {
    result: failureResult,
    route: FinalizedNodeRoutes.Fail,
    handledError: false,
  };
}

async function publishAndLog({
  request,
  services,
  config,
  result,
  nodeId,
  nodeType,
  retries,
}) {
  await publishNodeResult({
    result,
    nodeId,
    config,
    registry: services.registry,
    workflowClipboard: services.workflowClipboard,
  });
  const events = createNodeLogEvents({
    result,
    nodeId,
    nodeType,
    config,
    inputs: request.inputs,
    retries,
    tabRef: request.tabRef,
    url: request.url,
  });
  for (const event of events) {
    await emitLog(services.logger, event);
  }
}

async function emitLog(logger, event) {
  if (!logger) return;
  if (typeof logger === "function") {
    await logger(event);
    return;
  }
  if (typeof logger.append === "function") {
    await logger.append(event);
    return;
  }
  if (typeof logger.appendExecutionLog === "function") {
    await logger.appendExecutionLog(event);
    return;
  }
  throw new NodeExecutionError(
    NodeErrorCodes.DependencyNotReady,
    "Node logging adapter is invalid.",
    { dependency: "logger" },
  );
}

function normalizeRuntimeError(error) {
  if (error instanceof NodeExecutionError) return error;
  const normalized = normalizeNodeError(
    error,
    NodeErrorCodes.ValidationFailed,
  );
  return new NodeExecutionError(
    normalized.code,
    normalized.message,
    normalized.details,
  );
}

function isResultEnvelope(value) {
  return isPlainObject(value) &&
    typeof value.status === "string" &&
    Object.prototype.hasOwnProperty.call(value, "output");
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nowMs(clock) {
  const value = typeof clock === "function" ? clock() : Date.now();
  if (value instanceof Date) return value.getTime();
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}
