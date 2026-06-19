// core/variableInspector.js
// Small, safe summaries for runtime-state broadcasts and Studio inspection.

export function summarizeVariables(values = {}, origins = {}) {
  if (!isPlainObject(values)) return [];

  return Object.entries(values).map(([name, value]) => {
    const summary = summarizeValue(value);
    const origin = findOrigin(name, origins);

    return {
      name,
      ...summary,
      origin: origin || {
        source: "workflow",
        nodeId: "",
        action: "workflow.variable",
      },
    };
  });
}

export function summarizeValue(value) {
  if (value === null) {
    return { type: "null", size: 0, preview: "null" };
  }

  if (Array.isArray(value)) {
    const table = value.length > 0 && value.every(isPlainObject);
    return {
      type: table ? "table" : "list",
      size: value.length,
      preview: `${value.length} ${table ? "rows" : "items"}`,
    };
  }

  if (isPlainObject(value)) {
    const size = Object.keys(value).length;
    return {
      type: "object",
      size,
      preview: `${size} fields`,
    };
  }

  if (typeof value === "string") {
    const imageData = /^data:image\//i.test(value);
    return {
      type: imageData ? "image" : "string",
      size: value.length,
      preview: imageData ? "image data available" : `${value.length} characters`,
    };
  }

  return {
    type: typeof value,
    size: 1,
    preview: typeof value === "boolean" ? String(value) : "value available",
  };
}

export function inferOutputVariableName(step = {}) {
  return String(
    step.config?.variableName || step.variableName || "",
  ).trim();
}

function findOrigin(name, origins) {
  if (origins[name]) return origins[name];

  const nested = Object.entries(origins).find(([path]) => {
    return path.startsWith(`${name}.`);
  });
  return nested?.[1] || null;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
