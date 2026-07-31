import {
  NodeErrorCodes,
  NodeExecutionError,
} from "../../shared/nodeContracts.js";
import {
  ScrollExecutionMethods,
  ScrollOperations,
  ScrollStopReasons,
} from "./definition.js";

export function buildScrollOutput(value = {}) {
  const operation = String(value.operation || "").trim();
  if (!Object.values(ScrollOperations).includes(operation)) {
    invalid("Scroll output operation is invalid.");
  }
  const scrollCount = Number(value.scrollCount);
  if (!Number.isInteger(scrollCount) || scrollCount < 0) {
    invalid("Scroll output scrollCount must be a non-negative integer.");
  }
  const stopReason = String(value.stopReason || "").trim();
  if (!Object.values(ScrollStopReasons).includes(stopReason)) {
    invalid("Scroll output stopReason is invalid.");
  }
  const executionMethod = String(value.executionMethod || "").trim();
  if (!Object.values(ScrollExecutionMethods).includes(executionMethod)) {
    invalid("Scroll output executionMethod is invalid.");
  }

  return Object.freeze({
    operation,
    scrollCount,
    finalPosition: Object.freeze(normalizeScrollPosition(value.finalPosition)),
    stopReason,
    executionMethod,
  });
}

export function normalizeScrollPosition(value = {}) {
  const x = nonNegative(value.x, "x");
  const y = nonNegative(value.y, "y");
  const maxX = nonNegative(value.maxX, "maxX");
  const maxY = nonNegative(value.maxY, "maxY");
  if (x > maxX + 1 || y > maxY + 1) {
    invalid("Scroll output position exceeds its maximum.");
  }
  return {
    x: Math.min(x, maxX),
    y: Math.min(y, maxY),
    maxX,
    maxY,
    atStart: value.atStart === true || (x <= 1 && y <= 1),
    atEnd: value.atEnd === true || (x >= maxX - 1 && y >= maxY - 1),
  };
}

function nonNegative(value, field) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    invalid(`Scroll output ${field} must be a non-negative number.`);
  }
  return numeric;
}

function invalid(message) {
  throw new NodeExecutionError(NodeErrorCodes.ValidationFailed, message);
}
