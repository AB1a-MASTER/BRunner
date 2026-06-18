// core/variableRegistry.js
// Per-run variable storage and strict {{expression}} resolution.

export class VariableResolutionError extends Error {
  constructor(variableName, valuePath) {
    super(`Variable "${variableName}" was not found while resolving ${valuePath}.`);
    this.name = "VariableResolutionError";
    this.variableName = variableName;
    this.valuePath = valuePath;
  }
}

export class VariableRegistry {
  constructor(initialValues = {}) {
    this.values = cloneValue(initialValues || {});
  }

  has(path) {
    return getPath(this.values, path).found;
  }

  get(path) {
    const result = getPath(this.values, path);
    return result.found ? result.value : undefined;
  }

  set(path, value) {
    const parts = normalizePath(path);
    if (parts.length === 0) {
      throw new Error("Variable name is empty.");
    }

    let current = this.values;

    for (let index = 0; index < parts.length - 1; index++) {
      const part = parts[index];

      if (!isPlainObject(current[part])) {
        current[part] = {};
      }

      current = current[part];
    }

    current[parts.at(-1)] = cloneValue(value);
    return value;
  }

  resolve(value, valuePath = "value") {
    if (typeof value === "string") {
      return this.resolveString(value, valuePath);
    }

    if (Array.isArray(value)) {
      return value.map((item, index) => {
        return this.resolve(item, `${valuePath}[${index}]`);
      });
    }

    if (isPlainObject(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
          return [key, this.resolve(item, `${valuePath}.${key}`)];
        }),
      );
    }

    return value;
  }

  resolveString(template, valuePath) {
    const exact = template.match(/^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/);

    if (exact) {
      return cloneValue(this.require(exact[1], valuePath));
    }

    return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, name) => {
      const value = this.require(name, valuePath);

      if (value === null || value === undefined) return "";
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    });
  }

  require(path, valuePath) {
    const result = getPath(this.values, path);

    if (!result.found) {
      throw new VariableResolutionError(String(path).trim(), valuePath);
    }

    return result.value;
  }

  snapshot() {
    return cloneValue(this.values);
  }
}

export function resolveStepExpressions(step, registry) {
  const resolved = { ...step };
  const expressionFields = [
    "url",
    "value",
    "text",
    "keys",
    "ms",
    "duration",
    "option",
    "variableName",
    "payload",
    "config",
  ];

  for (const key of expressionFields) {
    if (resolved[key] !== undefined) {
      resolved[key] = registry.resolve(resolved[key], `step.${key}`);
    }
  }

  return resolved;
}

function getPath(root, path) {
  const parts = normalizePath(path);
  let current = root;

  for (const part of parts) {
    if (
      current === null ||
      current === undefined ||
      !Object.prototype.hasOwnProperty.call(Object(current), part)
    ) {
      return { found: false, value: undefined };
    }

    current = current[part];
  }

  return {
    found: parts.length > 0,
    value: current,
  };
}

function normalizePath(path) {
  return String(path || "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
}

function isPlainObject(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value),
  );
}

function cloneValue(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

