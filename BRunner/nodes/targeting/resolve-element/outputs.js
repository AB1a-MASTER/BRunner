import {
  NodeErrorCodes,
  NodeExecutionError,
} from "../../shared/nodeContracts.js";
import { ResolveElementModes } from "./definition.js";

export const MAX_RESOLVED_COMPONENTS = 200;
const MAX_TEXT_LENGTH = 200;

export function buildResolveElementOutput(value = {}) {
  const mode = String(value.mode || "").trim();
  if (!Object.values(ResolveElementModes).includes(mode)) {
    invalid("Resolve Element output mode is invalid.");
  }

  const components = boundedComponents(value.components);
  const component = value.component === null || value.component === undefined
    ? components[0] || null
    : boundedComponent(value.component);
  const matchCount = normalizeMatchCount(value.matchCount, components.length);

  return Object.freeze({
    mode,
    resolvedComponentId: component?.componentId || null,
    component,
    components: Object.freeze(components),
    matchCount,
    targetResolution: Object.freeze(
      isPlainObject(value.targetResolution)
        ? structuredClone(value.targetResolution)
        : {},
    ),
  });
}

export function boundedComponent(value) {
  if (!isPlainObject(value)) return null;
  const componentId = boundedText(
    value.componentId || value.id || value.componentUid,
  );
  if (!componentId) {
    invalid("A resolved component requires a bounded component identifier.");
  }
  return Object.freeze({
    componentId,
    componentUid: nullableText(value.componentUid),
    semanticType: nullableText(
      value.semanticType ||
        value.fingerprint?.semantic?.semanticType ||
        value.role,
    ),
    accessibleName: nullableText(
      value.accessibleName || value.fingerprint?.semantic?.accessibleName,
    ),
    mappingLayer: nullableText(value.mappingLayer),
    pageProfileKey: nullableText(value.pageProfileKey),
    frameContext: boundedFrameContext(
      value.frameContext || value.fingerprint?.structural?.frameScope,
    ),
    state: Object.freeze({
      visible: nullableBoolean(value.visible ?? value.state?.visible),
      interactable: nullableBoolean(
        value.interactable ?? value.state?.interactable,
      ),
      status: nullableText(value.status || value.state?.status),
    }),
    confidence: normalizeConfidence(value.confidence ?? value.score),
  });
}

function boundedComponents(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    invalid("Resolve Element components must be an array.");
  }
  if (value.length > MAX_RESOLVED_COMPONENTS) {
    invalid(
      `Resolve Element cannot publish more than ${MAX_RESOLVED_COMPONENTS} components.`,
    );
  }
  return value.map(boundedComponent).filter(Boolean);
}

function boundedFrameContext(value) {
  if (!isPlainObject(value)) return null;
  return Object.freeze({
    framePath: nullableText(value.framePath),
    access: nullableText(value.access),
  });
}

function normalizeMatchCount(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) {
    invalid("Resolve Element matchCount must be a non-negative integer.");
  }
  return count;
}

function normalizeConfidence(value) {
  if (value === undefined || value === null || value === "") return 0;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    invalid("Resolve Element confidence must be numeric.");
  }
  const scaled = numeric > 1 ? numeric / 100 : numeric;
  return Math.min(1, Math.max(0, scaled));
}

function boundedText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim().slice(0, MAX_TEXT_LENGTH);
}

function nullableText(value) {
  const text = boundedText(value);
  return text || null;
}

function nullableBoolean(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "boolean") {
    invalid("Resolve Element state flags must be boolean or null.");
  }
  return value;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function invalid(message) {
  throw new NodeExecutionError(NodeErrorCodes.ValidationFailed, message);
}
