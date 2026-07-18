export const STUDIO_DRAFT_VERSION = 1;

export function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

export function hashWorkflowSnapshot(snapshot) {
  const source = stableStringify(snapshot);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function savedSnapshotIsCurrent(submitted, current) {
  return Boolean(
    submitted
      && current
      && submitted.revision === current.revision
      && submitted.fingerprint === current.fingerprint,
  );
}

export function reconcileGraphSaveResponse({
  submitted,
  current,
  savedFilename,
  responseWorkflowName,
} = {}) {
  const submittedStillCurrent = savedSnapshotIsCurrent(submitted, current);
  const explicitResponseWorkflowName = String(responseWorkflowName || "").trim();
  const normalizedWorkflowName = String(
    explicitResponseWorkflowName
      || submitted?.workflowName
      || stripJsonFilename(savedFilename)
      || "Untitled",
  );
  const responseChangesWorkflowName = Boolean(
    submittedStillCurrent
      && explicitResponseWorkflowName
      && normalizedWorkflowName !== String(submitted?.workflowName || "Untitled"),
  );
  return {
    submittedStillCurrent,
    normalizedWorkflowName,
    applyResponseWorkflowName: submittedStillCurrent && Boolean(explicitResponseWorkflowName),
    responseChangesWorkflowName,
    clearDirty: submittedStillCurrent && !responseChangesWorkflowName,
    reason: !submittedStillCurrent
      ? "newer_edits"
      : responseChangesWorkflowName
        ? "response_normalized_name"
        : "saved",
  };
}

export function createSerializedSaveQueue() {
  let tail = Promise.resolve();
  let pending = 0;

  return {
    enqueue(task) {
      pending += 1;
      const result = tail.then(task, task);
      tail = result.catch(() => {});
      return result.finally(() => {
        pending = Math.max(0, pending - 1);
      });
    },
    get pending() {
      return pending;
    },
  };
}

export function createRecoverableGraphDraft(input = {}) {
  return cloneWithoutFunctions({
    version: STUDIO_DRAFT_VERSION,
    studio: "graph",
    revision: Number.isFinite(input.revision) ? input.revision : 0,
    loadedFilename: String(input.loadedFilename || ""),
    workflowName: String(input.workflowName || "Untitled"),
    sourceSchema: Number(input.sourceSchema) || 2,
    metadata: input.metadata || {},
    nodes: Array.isArray(input.nodes)
      ? input.nodes.map((node) => compactGraphDraftNode(node))
      : [],
    edges: Array.isArray(input.edges) ? input.edges : [],
    updatedAt: input.updatedAt || new Date().toISOString(),
  });
}

function compactGraphDraftNode(node = {}) {
  const data = node?.data && typeof node.data === "object" ? node.data : {};
  const definitionType = String(
    data.definition?.type || data.type || "",
  ).trim();
  const { definition: _definition, ...draftData } = data;
  return {
    ...node,
    data: {
      ...draftData,
      ...(definitionType ? { definition: { type: definitionType } } : {}),
    },
  };
}

function cloneWithoutFunctions(value) {
  if (typeof value === "function" || value === undefined) return undefined;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => cloneWithoutFunctions(item))
      .filter((item) => item !== undefined);
  }

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const cloned = cloneWithoutFunctions(item);
    if (cloned !== undefined) result[key] = cloned;
  }
  return result;
}

function stripJsonFilename(filename) {
  return String(filename || "").replace(/\.json$/i, "");
}
