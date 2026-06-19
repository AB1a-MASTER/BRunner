(function exposeStudioValidation(root) {
  "use strict";

  const EXPRESSION_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;
  const VARIABLE_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

  function extractExpressionNames(value) {
    const names = new Set();
    visitStrings(value, (text) => {
      for (const match of text.matchAll(EXPRESSION_PATTERN)) {
        const name = match[1].trim();
        if (name) names.add(name);
      }
    });
    return [...names];
  }

  function collectAvailableVariableNames(workflow, stepIndex) {
    const names = new Set(Object.keys(workflow?.variables || {}));
    const steps = Array.isArray(workflow?.steps) ? workflow.steps : [];

    steps.slice(0, Math.max(0, stepIndex)).forEach((step) => {
      const outputName = getOutputVariableName(step);
      if (outputName) names.add(outputName);
    });

    return [...names].sort((left, right) => left.localeCompare(right));
  }

  function validateWorkflow(workflow, definitions) {
    const definitionsByType = definitions instanceof Map
      ? definitions
      : new Map((definitions || []).map((definition) => [definition.type, definition]));
    const issues = [];
    const steps = Array.isArray(workflow?.steps) ? workflow.steps : [];

    steps.forEach((step, stepIndex) => {
      const definition = definitionsByType.get(step.action || step.type);
      if (!definition) {
        issues.push(issue(step, stepIndex, "action", "Unsupported node type."));
        return;
      }

      if (definition.targetRequired && !hasTarget(step.target)) {
        issues.push(issue(step, stepIndex, "target", "Target element is required."));
      }

      for (const field of definition.config || []) {
        const value = getFieldValue(step, field.key);
        if (field.required && isEmpty(value)) {
          issues.push(issue(
            step,
            stepIndex,
            field.key,
            `${field.label || field.key} is required.`,
          ));
          continue;
        }

        if (field.key === "variableName" && !isEmpty(value) && !VARIABLE_NAME_PATTERN.test(String(value).trim())) {
          issues.push(issue(
            step,
            stepIndex,
            field.key,
            "Variable name must start with a letter, _ or $ and contain no spaces.",
          ));
        }
      }

      const availableRoots = new Set(
        collectAvailableVariableNames(workflow, stepIndex).map(rootVariableName),
      );
      const expressionSource = getExpressionSource(step, definition);

      for (const expressionName of extractExpressionNames(expressionSource)) {
        if (!availableRoots.has(rootVariableName(expressionName))) {
          issues.push(issue(
            step,
            stepIndex,
            findExpressionField(step, definition, expressionName),
            `Variable "${expressionName}" is not available before this node.`,
          ));
        }
      }
    });

    return issues;
  }

  function getExpressionSource(step, definition) {
    const source = {
      url: step.url,
      value: step.value,
      keys: step.keys,
      ms: step.ms,
      payload: step.payload,
      config: {},
    };

    for (const field of definition.config || []) {
      if (field.key !== "variableName") {
        source.config[field.key] = getFieldValue(step, field.key);
      }
    }
    return source;
  }

  function findExpressionField(step, definition, expressionName) {
    for (const field of definition.config || []) {
      if (field.key !== "variableName" && extractExpressionNames(getFieldValue(step, field.key)).includes(expressionName)) {
        return field.key;
      }
    }
    for (const key of ["url", "value", "keys", "ms", "payload"]) {
      if (extractExpressionNames(step[key]).includes(expressionName)) return key;
    }
    return "expression";
  }

  function getFieldValue(step, key) {
    if (step?.config && step.config[key] !== undefined) return step.config[key];
    if (step?.[key] !== undefined) return step[key];
    if (key === "url" || key === "value" || key === "variableName" || key === "keys" || key === "ms") {
      return step?.payload?.primary;
    }
    return undefined;
  }

  function getOutputVariableName(step) {
    const value = getFieldValue(step, "variableName");
    if (typeof value !== "string") return "";
    const name = value.trim();
    return VARIABLE_NAME_PATTERN.test(name) ? name : "";
  }

  function getLastRunOutputSample(step, values) {
    const name = getOutputVariableName(step);
    const hasValue = Boolean(
      name && values && Object.prototype.hasOwnProperty.call(values, name),
    );
    return {
      name,
      hasValue,
      value: hasValue ? values[name] : undefined,
    };
  }

  function hasTarget(target) {
    if (typeof target === "string") return Boolean(target.trim());
    if (!target || typeof target !== "object") return false;
    return Boolean(String(target.value || target.primary?.value || "").trim());
  }

  function isEmpty(value) {
    return value === undefined || value === null || (typeof value === "string" && !value.trim());
  }

  function rootVariableName(path) {
    return String(path || "").trim().split(".")[0];
  }

  function visitStrings(value, visitor) {
    if (typeof value === "string") {
      visitor(value);
    } else if (Array.isArray(value)) {
      value.forEach((item) => visitStrings(item, visitor));
    } else if (value && typeof value === "object") {
      Object.values(value).forEach((item) => visitStrings(item, visitor));
    }
  }

  function issue(step, stepIndex, fieldKey, message) {
    return {
      stepId: step.id || "",
      stepIndex,
      fieldKey,
      message,
    };
  }

  root.BRunnerStudioValidation = Object.freeze({
    collectAvailableVariableNames,
    extractExpressionNames,
    getLastRunOutputSample,
    getOutputVariableName,
    validateWorkflow,
  });
})(globalThis);
