import {
  NodeErrorCodes,
  NodeExecutionError,
  NodeStatuses,
  isNodeErrorCode,
  isNodeStatus,
  normalizeCommonNodeConfig,
} from "./nodeContracts.js";

/**
 * Build the execution metadata required by every finalized node result.
 */
export function createExecutionMetadata(execution = {}, now = Date.now()) {
  const source = isPlainObject(execution) ? execution : {};
  const nowValue = resolveNow(now);
  const startedAt = toIsoTimestamp(source.startedAt, nowValue);
  const finishedAt = toIsoTimestamp(source.finishedAt, nowValue);
  const calculatedDuration = Math.max(
    0,
    Date.parse(finishedAt) - Date.parse(startedAt),
  );

  return {
    ...source,
    nodeId: String(source.nodeId || ""),
    attempt: normalizeAttempt(source.attempt),
    startedAt,
    finishedAt,
    durationMs: normalizeDuration(source.durationMs, calculatedDuration),
    executionMethod: String(source.executionMethod || "unknown"),
  };
}

/**
 * Convert Error instances and executor error-like values to the stable result
 * shape. Details are retained verbatim as local workflow data.
 */
export function normalizeNodeError(error, fallbackCode = NodeErrorCodes.CONFIG_INVALID) {
  const source = error instanceof Error || isPlainObject(error) ? error : {};
  const code = isNodeErrorCode(source.code)
    ? source.code
    : isNodeErrorCode(fallbackCode)
      ? fallbackCode
      : NodeErrorCodes.CONFIG_INVALID;

  return {
    code,
    message: String(source.message || error || code),
    details: source.details ?? null,
  };
}

/**
 * Create a normalized finalized node result envelope.
 */
export function createNodeResult(options = {}) {
  const status = options.status ?? NodeStatuses.COMPLETED;
  if (!isNodeStatus(status)) {
    throw new NodeExecutionError(
      NodeErrorCodes.CONFIG_INVALID,
      `Unknown node result status: ${String(status)}`,
      { status },
    );
  }

  const executionSource = {
    ...(isPlainObject(options.execution) ? options.execution : {}),
  };
  if (options.nodeId !== undefined) executionSource.nodeId = options.nodeId;
  if (options.attempt !== undefined) executionSource.attempt = options.attempt;
  if (options.startedAt !== undefined) executionSource.startedAt = options.startedAt;
  if (options.finishedAt !== undefined) executionSource.finishedAt = options.finishedAt;
  if (options.durationMs !== undefined) executionSource.durationMs = options.durationMs;
  if (options.executionMethod !== undefined) {
    executionSource.executionMethod = options.executionMethod;
  }

  return {
    status,
    output: status === NodeStatuses.SKIPPED_DISABLED
      ? null
      : options.output === undefined
        ? {}
        : options.output,
    warnings: Array.isArray(options.warnings) ? [...options.warnings] : [],
    errors: normalizeErrors(options.errors),
    execution: createExecutionMetadata(executionSource, options.now),
  };
}

export function createCompletedNodeResult(options = {}) {
  return createNodeResult({
    ...options,
    status: NodeStatuses.COMPLETED,
  });
}

export function createFailedNodeResult(options = {}) {
  return createNodeResult({
    ...options,
    status: NodeStatuses.FAILED,
  });
}

export function createDisabledNodeResult(options = {}) {
  return createNodeResult({
    ...options,
    status: NodeStatuses.SKIPPED_DISABLED,
    output: null,
    warnings: [],
    errors: [],
  });
}

export function normalizeNodeResult(result = {}, executionDefaults = {}) {
  const source = isPlainObject(result) ? result : {};
  return createNodeResult({
    ...source,
    execution: {
      ...(isPlainObject(executionDefaults) ? executionDefaults : {}),
      ...(isPlainObject(source.execution) ? source.execution : {}),
    },
  });
}

/**
 * Publish a completed node result to the injected workflow registry.
 *
 * The registry contract is intentionally only `set(path, value)`. This keeps
 * the node layer independent from the current VariableRegistry class and from
 * background-page state.
 *
 * Workflow Clipboard is also injected. An adapter may be a callback or expose
 * `publish(publication)`, `write(publication)`, or
 * mode-specific methods. `set(key, value)` is the replace-mode fallback.
 */
export async function publishNodeResult(options = {}, dependencies = undefined) {
  const normalizedOptions = normalizePublishArguments(options, dependencies);
  const {
    registry,
    workflowClipboard,
    config: rawConfig = {},
  } = normalizedOptions;
  const result = normalizeNodeResult(normalizedOptions.result);
  const nodeId = String(normalizedOptions.nodeId || result.execution.nodeId || "").trim();

  if (!nodeId) {
    throw new NodeExecutionError(
      NodeErrorCodes.CONFIG_INVALID,
      "A nodeId is required to publish node output.",
      null,
    );
  }
  if (!registry || typeof registry.set !== "function") {
    throw new NodeExecutionError(
      NodeErrorCodes.DEPENDENCY_NOT_READY,
      "The workflow registry is unavailable.",
      { dependency: "registry" },
    );
  }

  const config = normalizeCommonNodeConfig(rawConfig);
  const outputAvailable = result.status === NodeStatuses.COMPLETED;
  const publishedOutput = outputAvailable ? result.output : null;
  const nodeOutputPath = `nodes.${nodeId}.output`;
  const aliasPath = normalizeOutputAlias(config.saveOutputAs);
  const clipboardPublication = outputAvailable
    ? createWorkflowClipboardPublication(rawConfig, config, nodeId, publishedOutput)
    : null;

  if (
    clipboardPublication
    && !hasWorkflowClipboardPublisher(workflowClipboard, clipboardPublication.mode)
  ) {
    throw new NodeExecutionError(
      NodeErrorCodes.DEPENDENCY_NOT_READY,
      "Workflow Clipboard output was requested but its adapter is unavailable.",
      { dependency: "workflowClipboard", mode: clipboardPublication.mode },
    );
  }

  registry.set(nodeOutputPath, publishedOutput);
  if (aliasPath) registry.set(aliasPath, publishedOutput);

  if (clipboardPublication) {
    await publishWorkflowClipboard(workflowClipboard, clipboardPublication);
  }

  return result;
}

/**
 * Build the standard start/retry/terminal log events for a node result.
 *
 * Verbose events retain the full local input and output values. Normal events
 * use structural summaries; this is a verbosity choice, not redaction.
 */
export function createNodeLogEvents(options = {}) {
  const config = normalizeCommonNodeConfig(options.config || {});
  const result = normalizeNodeResult(options.result || {}, {
    nodeId: options.nodeId,
  });
  const execution = result.execution;
  const nodeId = String(options.nodeId || execution.nodeId || "");
  const fullValues = config.logLevel === "verbose";
  const inputs = fullValues ? options.inputs : summarizeLogValue(options.inputs);
  const output = fullValues ? result.output : summarizeLogValue(result.output);
  const context = compactObject({
    nodeType: optionalString(options.nodeType),
    displayName: optionalString(config.displayName),
    tabRef: options.tabRef ?? execution.tabRef,
    url: options.url ?? execution.url,
    executionMethod: execution.executionMethod,
    hostFallback: options.hostFallback ?? execution.hostFallback,
    artifacts: options.artifacts,
  });

  const events = [{
    event: "node_started",
    nodeId,
    status: NodeStatuses.RUNNING,
    timestamp: execution.startedAt,
    attempt: execution.attempt,
    inputs,
    ...context,
  }];

  for (const retry of normalizeRetries(options.retries)) {
    events.push({
      event: "node_retry",
      nodeId,
      status: NodeStatuses.WAITING_ASYNC,
      timestamp: retry.timestamp || execution.startedAt,
      attempt: retry.attempt,
      reason: retry.reason,
      delayMs: retry.delayMs,
      ...context,
    });
  }

  events.push({
    event: terminalEventName(result.status),
    nodeId,
    status: result.status,
    timestamp: execution.finishedAt,
    attempt: execution.attempt,
    durationMs: execution.durationMs,
    output,
    warnings: [...result.warnings],
    errors: result.errors.map((error) => ({ ...error })),
    ...context,
  });

  return events;
}

export function summarizeLogValue(value, limits = {}) {
  const maxStringLength = normalizePositiveInteger(limits.maxStringLength, 160);
  const maxKeys = normalizePositiveInteger(limits.maxKeys, 20);

  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.length <= maxStringLength) return value;
    return {
      type: "string",
      length: value.length,
      preview: `${value.slice(0, Math.max(0, maxStringLength - 1))}…`,
    };
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
    };
  }

  const keys = Object.keys(value);
  return {
    type: "object",
    keys: keys.slice(0, maxKeys),
    keyCount: keys.length,
  };
}

function normalizePublishArguments(options, dependencies) {
  if (isPlainObject(options) && Object.prototype.hasOwnProperty.call(options, "result")) {
    return options;
  }
  return {
    ...(isPlainObject(dependencies) ? dependencies : {}),
    result: options,
  };
}

function normalizeErrors(errors) {
  if (errors === null || errors === undefined) return [];
  const list = Array.isArray(errors) ? errors : [errors];
  return list.map((error) => normalizeNodeError(error));
}

function normalizeOutputAlias(saveOutputAs) {
  const alias = String(saveOutputAs || "").trim();
  if (!alias) return null;
  return alias.startsWith("variables.") ? alias : `variables.${alias}`;
}

function createWorkflowClipboardPublication(rawConfig, config, nodeId, value) {
  const clipboardConfig = normalizeWorkflowClipboardConfig(
    rawConfig.saveToWorkflowClipboard,
    rawConfig.workflowClipboardEntry || config.saveOutputAs || nodeId,
  );
  if (clipboardConfig.mode === "off") return null;

  return {
    ...clipboardConfig,
    value,
    nodeId,
  };
}

export function normalizeWorkflowClipboardConfig(value, fallbackKey = "") {
  const raw = isPlainObject(value) ? value : {};
  const mode = normalizeCommonNodeConfig({
    saveToWorkflowClipboard: value,
  }).saveToWorkflowClipboard;
  const key = String(
    raw.key
      || raw.entryName
      || fallbackKey,
  ).trim();

  return {
    mode,
    key,
  };
}

function hasWorkflowClipboardPublisher(workflowClipboard, mode) {
  if (!workflowClipboard) return false;
  if (
    typeof workflowClipboard === "function"
    || typeof workflowClipboard?.publish === "function"
    || typeof workflowClipboard?.write === "function"
  ) {
    return true;
  }
  if (mode === "replace") {
    return Boolean(
      typeof workflowClipboard.replace === "function"
      || typeof workflowClipboard.set === "function",
    );
  }
  if (mode === "append") {
    return typeof workflowClipboard.append === "function";
  }
  if (mode === "version") {
    return Boolean(
      typeof workflowClipboard.version === "function"
      || typeof workflowClipboard.createVersion === "function",
    );
  }
  return false;
}

async function publishWorkflowClipboard(workflowClipboard, publication) {
  if (typeof workflowClipboard === "function") {
    await workflowClipboard(publication);
    return;
  }
  if (
    publication.mode === "replace"
    && typeof workflowClipboard.replace === "function"
  ) {
    await workflowClipboard.replace(publication.key, publication.value);
    return;
  }
  if (
    publication.mode === "append"
    && typeof workflowClipboard.append === "function"
  ) {
    await workflowClipboard.append(publication.key, publication.value);
    return;
  }
  if (
    publication.mode === "version"
    && typeof workflowClipboard.createVersion === "function"
  ) {
    await workflowClipboard.createVersion(publication.key, publication.value);
    return;
  }
  if (
    publication.mode === "version"
    && typeof workflowClipboard.version === "function"
  ) {
    await workflowClipboard.version(publication.key, publication.value);
    return;
  }
  if (typeof workflowClipboard.publish === "function") {
    await workflowClipboard.publish(publication);
    return;
  }
  if (typeof workflowClipboard.write === "function") {
    await workflowClipboard.write(publication);
    return;
  }
  if (
    publication.mode === "replace"
    && typeof workflowClipboard.set === "function"
  ) {
    await workflowClipboard.set(publication.key, publication.value);
    return;
  }
  throw new NodeExecutionError(
    NodeErrorCodes.DEPENDENCY_NOT_READY,
    `Workflow Clipboard does not support ${publication.mode} publication.`,
    { dependency: "workflowClipboard", mode: publication.mode },
  );
}

function normalizeRetries(retries) {
  if (!Array.isArray(retries)) return [];
  return retries.map((retry, index) => {
    const source = isPlainObject(retry) ? retry : { reason: retry };
    return {
      timestamp: optionalString(source.timestamp),
      attempt: normalizeAttempt(source.attempt ?? index + 2),
      reason: String(source.reason || "eligible_failure"),
      delayMs: normalizeDuration(source.delayMs, 0),
    };
  });
}

function terminalEventName(status) {
  if (status === NodeStatuses.COMPLETED) return "node_completed";
  if (status === NodeStatuses.SKIPPED_DISABLED) return "node_skipped";
  if (status === NodeStatuses.TIMED_OUT) return "node_timed_out";
  if (status === NodeStatuses.CANCELLED) return "node_cancelled";
  if (status === NodeStatuses.FAILED) return "node_failed";
  return "node_status";
}

function resolveNow(now) {
  const resolved = typeof now === "function" ? now() : now;
  const number = Number(resolved);
  return Number.isFinite(number) ? number : Date.now();
}

function toIsoTimestamp(value, fallbackMs) {
  if (value === null || value === undefined || value === "") {
    return new Date(fallbackMs).toISOString();
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? new Date(fallbackMs).toISOString()
    : date.toISOString();
}

function normalizeAttempt(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 1;
}

function normalizeDuration(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

function optionalString(value) {
  if (value === null || value === undefined || value === "") return undefined;
  return String(value);
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
