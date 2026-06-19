const PRIORITY_KEYS = [
  "variableName",
  "url",
  "query",
  "value",
  "template",
  "method",
  "field",
  "itemSelector",
  "attributeName",
  "rowSelector",
  "cellSelector",
  "keys",
  "ms",
  "timeoutMs",
  "filename",
  "outputMode",
];

const SENSITIVE_FIELDS = new Set([
  "headers",
  "body",
  "content",
  "path",
]);

export function getNodeSummaryRows(data = {}, limit = 3) {
  const rows = [];
  if (hasDisplayValue(data.target)) {
    rows.push({ key: "target", label: "Target", value: formatSummaryValue(data.target) });
  }

  const fields = [...(data.definition?.config || [])]
    .filter((field) => isFieldVisible(field, data.config || {}))
    .filter((field) => hasDisplayValue(data.config?.[field.key]))
    .sort((left, right) => fieldPriority(left.key) - fieldPriority(right.key));

  for (const field of fields) {
    if (rows.length >= limit) break;
    rows.push({
      key: field.key,
      label: field.label || field.key,
      value: SENSITIVE_FIELDS.has(field.key)
        ? "Configured"
        : formatSummaryValue(data.config[field.key]),
    });
  }

  return rows;
}

export function getExecutionPresentation(data = {}) {
  const mode = data.executionMode || (data.disabled ? "disabled" : "enabled");
  if (mode === "disabled") {
    return { mode, label: "Bypassed", detail: "Always skipped" };
  }
  if (mode === "conditional") {
    return {
      mode,
      label: "Conditional",
      detail: data.skipWhen ? truncate(String(data.skipWhen), 34) : "Condition required",
    };
  }
  return { mode: "enabled", label: "Enabled", detail: "Runs normally" };
}

function isFieldVisible(field, config) {
  if (!field.visibleWhen) return true;
  return String(config[field.visibleWhen.field] ?? "") === String(field.visibleWhen.equals);
}

function fieldPriority(key) {
  const index = PRIORITY_KEYS.indexOf(key);
  return index === -1 ? PRIORITY_KEYS.length : index;
}

function hasDisplayValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return Boolean(value.trim());
  return true;
}

function formatSummaryValue(value) {
  if (Array.isArray(value)) return `${value.length} items`;
  if (value && typeof value === "object") return `${Object.keys(value).length} fields`;
  return truncate(String(value), 42);
}

function truncate(value, limit) {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}
