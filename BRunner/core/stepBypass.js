// Static and expression-driven workflow step bypass decisions.

export function resolveStepBypass(step = {}, registry) {
  const mode = step.executionMode || (step.disabled === true ? "disabled" : "enabled");

  if (mode === "disabled") {
    return { skip: true, mode, reason: "Node is disabled." };
  }

  if (mode !== "conditional") {
    return { skip: false, mode: "enabled", reason: "" };
  }

  const condition = registry.resolve(
    step.skipWhen ?? false,
    `step.${step.id || "unknown"}.skipWhen`,
  );
  const skip = normalizeCondition(condition);
  return {
    skip,
    mode,
    reason: skip ? "Conditional bypass matched." : "",
  };
}

function normalizeCondition(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (value === null || value === undefined) return false;

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  throw new Error(
    "Conditional bypass must resolve to true/false, yes/no, on/off, or 1/0.",
  );
}
