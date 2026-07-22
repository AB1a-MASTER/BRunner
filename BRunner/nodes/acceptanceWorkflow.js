import { validateGraphWorkflow } from "../core/workflowSchema.js";

export const NodeAcceptanceSchemaVersion = 1;
export const NodeAcceptanceFilenamePattern = /^(\d{3})_([a-z0-9]+(?:_[a-z0-9]+)*)_acceptance\.json$/;

export function nodeAcceptanceSlug(name = "") {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function expectedNodeAcceptanceFilename(catalogNode = {}) {
  const order = Number(catalogNode.order);
  const slug = nodeAcceptanceSlug(catalogNode.name);
  if (!Number.isInteger(order) || order < 1 || !slug) return "";
  return `${String(order).padStart(3, "0")}_${slug}_acceptance.json`;
}

export function validateNodeAcceptanceWorkflow({ filename, workflow, catalogNode } = {}) {
  const errors = [];
  const expectedFilename = expectedNodeAcceptanceFilename(catalogNode);
  if (!NodeAcceptanceFilenamePattern.test(String(filename || ""))) {
    errors.push("Filename must match NNN_<node_slug>_acceptance.json.");
  }
  if (!expectedFilename || filename !== expectedFilename) {
    errors.push(`Filename must be ${expectedFilename || "derived from a valid catalog node"}.`);
  }
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    return { valid: false, errors: [...errors, "Workflow must be a JSON object."] };
  }

  const acceptance = workflow.acceptance;
  if (!acceptance || typeof acceptance !== "object" || Array.isArray(acceptance)) {
    errors.push("Workflow requires an acceptance metadata object.");
  } else {
    if (acceptance.schemaVersion !== NodeAcceptanceSchemaVersion) {
      errors.push(`acceptance.schemaVersion must be ${NodeAcceptanceSchemaVersion}.`);
    }
    if (acceptance.catalogOrder !== catalogNode?.order) {
      errors.push(`acceptance.catalogOrder must be ${catalogNode?.order}.`);
    }
    if (acceptance.nodeType !== catalogNode?.type) {
      errors.push(`acceptance.nodeType must be ${catalogNode?.type}.`);
    }
    if (acceptance.nodeVersion !== catalogNode?.version) {
      errors.push(`acceptance.nodeVersion must be ${catalogNode?.version}.`);
    }
    if (acceptance.synthetic !== true) {
      errors.push("acceptance.synthetic must be true.");
    }
    if (!nonEmptyString(acceptance.primaryBehavior)) {
      errors.push("acceptance.primaryBehavior is required.");
    }
    if (!Array.isArray(acceptance.expectedOutputKeys) ||
        acceptance.expectedOutputKeys.length === 0 ||
        !acceptance.expectedOutputKeys.every(nonEmptyString)) {
      errors.push("acceptance.expectedOutputKeys must contain at least one non-empty key.");
    }
    if (!nonEmptyString(acceptance.safeFailureOrAlternate)) {
      errors.push("acceptance.safeFailureOrAlternate is required; use 'not_applicable: <reason>' when necessary.");
    }
    validateFixturePaths(acceptance.fixturePaths, errors);
  }

  const graphValidation = validateGraphWorkflow(workflow);
  errors.push(...graphValidation.errors.map((error) => `workflow: ${error}`));

  const targetNodes = Array.isArray(workflow.nodes)
    ? workflow.nodes.filter((node) => node?.type === catalogNode?.type)
    : [];
  if (!targetNodes.length) {
    errors.push(
      `Workflow must contain at least one ${catalogNode?.type}@${catalogNode?.version} node.`,
    );
  } else if (targetNodes.some((node) => node.version !== catalogNode?.version)) {
    errors.push(`Every ${catalogNode?.type} node must use version ${catalogNode?.version}.`);
  }

  return { valid: errors.length === 0, errors };
}

function validateFixturePaths(paths, errors) {
  if (!Array.isArray(paths)) {
    errors.push("acceptance.fixturePaths must be an array.");
    return;
  }
  for (const value of paths) {
    const path = String(value || "").replace(/\\/g, "/");
    if (!path || path.startsWith("/") || /^[a-z]:\//i.test(path) ||
        path.split("/").includes("..")) {
      errors.push(`Fixture path must be repository-relative and cannot traverse upward: ${value}.`);
    }
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && Boolean(value.trim());
}
