// Shared serializable authoring contract used by Graph Studio and the
// background node registry. Kept as a classic script for transitional imports.

(function exposeNodeAuthoring(global) {
  "use strict";

  const FIELD_KINDS = Object.freeze([
    "text",
    "textarea",
    "number",
    "select",
    "boolean",
    "value",
  ]);
  const EXPRESSION_MODES = Object.freeze([
    "none",
    "expression",
    "template",
  ]);
  const AUTOCOMPLETE_SOURCES = Object.freeze({
    Variables: "variables",
    NodeOutputs: "node_outputs",
    WorkflowClipboard: "workflow_clipboard",
    LoopValues: "loop_values",
    TabReferences: "tab_references",
    ApprovedDirectories: "approved_directories",
    FileReferences: "file_references",
  });
  const TARGET_IDENTIFIER_TYPES = Object.freeze([
    "auto",
    "component_id",
    "component_ref",
    "css",
    "xpath",
    "id",
    "name",
    "label",
    "visible_text",
    "role",
    "placeholder",
    "attribute",
    "coordinates",
  ]);
  const UNKNOWN_CONFIG_POLICIES = Object.freeze({
    Preserve: "preserve",
    Reject: "reject",
  });

  function normalizeNodeFieldSchema(fields = []) {
    const seen = new Set();
    return (Array.isArray(fields) ? fields : []).map((field) => {
      const normalized = normalizeFieldDefinition(field);
      if (seen.has(normalized.key)) {
        throw new Error(`Duplicate node field key: ${normalized.key}.`);
      }
      seen.add(normalized.key);
      return normalized;
    });
  }

  function normalizeFieldDefinition(field = {}) {
    const key = String(field.key || "").trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid node field key: ${key || "<empty>"}.`);
    }
    const kind = FIELD_KINDS.includes(field.kind) ? field.kind : "text";
    const expressionMode = normalizeExpressionMode(field, kind, key);
    const autocompleteSources = normalizeAutocompleteSources(
      field.autocompleteSources,
      expressionMode,
      key,
    );
    const selectOptions = kind === "select" ? normalizeOptions(field.options) : [];
    if (kind === "select" && !selectOptions.length) {
      throw new Error(`Select field ${key} requires at least one option.`);
    }
    const defaultExample = field.default ?? (
      kind === "select" ? optionValue(selectOptions[0]) : inferExample(key, kind)
    );
    const example = String(field.example ?? defaultExample).trim();
    const normalized = {
      ...field,
      key,
      label: String(field.label || humanize(key)),
      kind,
      help: String(field.help || inferHelp(key, kind, expressionMode)),
      example,
      placeholder: String(field.placeholder || example),
      expressionMode,
      autocompleteSources,
    };
    if (kind === "select") {
      normalized.options = selectOptions;
      const allowedExamples = selectOptions.map((option) => optionValue(option));
      if (!allowedExamples.includes(example)) {
        throw new Error(`Select field ${key} example must be one of its options.`);
      }
    }
    return normalized;
  }

  function createTargetEditorSchema(required = true) {
    return Object.freeze({
      required: required === true,
      fields: Object.freeze(normalizeNodeFieldSchema([
        {
          key: "identifierType",
          label: "Identifier Type",
          kind: "select",
          default: "auto",
          options: TARGET_IDENTIFIER_TYPES,
          help: "Choose how the target identifier should be interpreted.",
          example: "component_id",
          expressionMode: "none",
        },
        {
          key: "identifierValue",
          label: "Identifier Value",
          kind: "text",
          default: "",
          help: "Enter the value for the selected identifier type.",
          example: "submit_order_button",
          autocompleteSources: [
            AUTOCOMPLETE_SOURCES.NodeOutputs,
          ],
        },
        {
          key: "attributeName",
          label: "Attribute Name",
          kind: "text",
          default: "",
          visibleWhen: { field: "identifierType", equals: "attribute" },
          help: "Required when Identifier Type is attribute.",
          example: "data-testid",
          expressionMode: "none",
        },
        {
          key: "roleName",
          label: "Accessible Name",
          kind: "text",
          default: "",
          visibleWhen: { field: "identifierType", equals: "role" },
          help: "Accessible name paired with the role identifier.",
          example: "Save changes",
        },
        {
          key: "matchMode",
          label: "Text Match",
          kind: "select",
          default: "exact",
          options: ["exact", "contains", "starts_with", "ends_with", "wildcard", "regex"],
          help: "Controls matching for text-like identifiers.",
          example: "exact",
          expressionMode: "none",
        },
        {
          key: "caseSensitive",
          label: "Case Sensitive",
          kind: "boolean",
          default: false,
          help: "When off, text matching ignores letter case.",
          example: "Unchecked",
          expressionMode: "none",
        },
        {
          key: "whitespaceHandling",
          label: "Whitespace",
          kind: "select",
          default: "normalize",
          options: ["preserve", "trim", "normalize"],
          help: "Choose whether surrounding and repeated whitespace matters.",
          example: "normalize",
          expressionMode: "none",
        },
        {
          key: "multipleMatchBehavior",
          label: "If Multiple Match",
          kind: "select",
          default: "fail",
          options: ["fail", "first", "highest_confidence", "return_all"],
          help: "Fail is the safe default and never guesses an ambiguous target.",
          example: "fail",
          expressionMode: "none",
        },
        {
          key: "scope",
          label: "Search Scope",
          kind: "select",
          default: "whole_page",
          options: ["whole_page", "frame", "selected_container", "automatic_shadow_dom"],
          help: "Limit where BRunner searches for the target.",
          example: "whole_page",
          expressionMode: "none",
        },
      ])),
    });
  }

  function normalizeTargetEditorValue(target) {
    const source = target && typeof target === "object" ? target : {};
    const primary = source.primary && typeof source.primary === "object"
      ? source.primary
      : {};
    const strategy = String(
      source.identifierType || source.strategy || primary.strategy ||
        (source.componentRef ? "component_ref" : "auto"),
    ).trim();
    const identifierType = normalizeIdentifierType(strategy);
    const rawIdentifierValue = source.identifierValue ?? source.value ?? primary.value ??
      source.coordinates ??
      source.componentRef?.componentId ?? source.componentRef?.id ??
      (typeof target === "string" ? target : "");
    const identifierValue = identifierType === "coordinates"
      ? formatEditorCoordinates(rawIdentifierValue)
      : rawIdentifierValue;
    const textMatch = source.textMatch && typeof source.textMatch === "object"
      ? source.textMatch
      : source;
    return {
      identifierType,
      identifierValue: cloneValue(identifierValue),
      attributeName: String(source.attributeName || ""),
      roleName: String(source.roleName || source.accessibleName || ""),
      matchMode: String(textMatch.matchMode || "exact"),
      caseSensitive: textMatch.caseSensitive === true,
      whitespaceHandling: String(textMatch.whitespaceHandling || "normalize"),
      multipleMatchBehavior: String(textMatch.multipleMatchBehavior || "fail"),
      scope: String(
        typeof source.scope === "object" ? source.scope.mode : source.scope || "whole_page",
      ),
      componentRef: source.componentRef && typeof source.componentRef === "object"
        ? structuredClone(source.componentRef)
        : null,
    };
  }

  function buildTargetEditorValue(value = {}) {
    const normalized = normalizeTargetEditorValue(value);
    const identifierValue = normalized.identifierType === "coordinates"
      ? parseEditorCoordinates(normalized.identifierValue)
      : cloneValue(normalized.identifierValue);
    return {
      identifierType: normalized.identifierType,
      identifierValue,
      ...(normalized.identifierType === "coordinates" && identifierValue
        ? { coordinates: cloneValue(identifierValue) }
        : {}),
      ...(normalized.attributeName ? { attributeName: normalized.attributeName } : {}),
      ...(normalized.roleName ? { roleName: normalized.roleName } : {}),
      textMatch: {
        matchMode: normalized.matchMode,
        caseSensitive: normalized.caseSensitive,
        whitespaceHandling: normalized.whitespaceHandling,
        occurrence: "first",
        occurrenceIndex: 0,
        multipleMatchBehavior: normalized.multipleMatchBehavior,
        emptyValueBehavior: "fail",
      },
      scope: normalized.scope,
      ...(normalized.identifierType === "component_ref" && normalized.componentRef
        ? { componentRef: structuredClone(normalized.componentRef) }
        : {}),
    };
  }

  function collectFieldAutocompleteOptions(field = {}, context = {}) {
    const sources = Array.isArray(field.autocompleteSources)
      ? field.autocompleteSources
      : [];
    const values = [];
    for (const source of sources) {
      if (source === AUTOCOMPLETE_SOURCES.Variables) {
        values.push(...objectKeys(context.variables).map((name) => `{{ variables.${name} }}`));
      } else if (source === AUTOCOMPLETE_SOURCES.NodeOutputs) {
        values.push(...arrayValues(context.nodeIds).map((id) => `{{ nodes.${id}.output }}`));
      } else if (source === AUTOCOMPLETE_SOURCES.WorkflowClipboard) {
        values.push(...arrayValues(context.workflowClipboardKeys).map((key) => `{{ workflowClipboard.${key} }}`));
      } else if (source === AUTOCOMPLETE_SOURCES.LoopValues) {
        values.push("{{ loop.item }}", "{{ loop.index }}");
      } else if (source === AUTOCOMPLETE_SOURCES.TabReferences) {
        values.push(...referenceValues(context.tabReferences));
      } else if (source === AUTOCOMPLETE_SOURCES.ApprovedDirectories) {
        values.push(...arrayValues(context.approvedDirectories).map((entry) => {
          return typeof entry === "string" ? entry : entry?.id || entry?.alias || "";
        }));
      } else if (source === AUTOCOMPLETE_SOURCES.FileReferences) {
        values.push(...referenceValues(context.fileReferences));
      }
    }
    return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
  }

  function createNodeAutocompleteContext(options = {}) {
    const nodes = arrayValues(options.nodes);
    const edges = arrayValues(options.edges);
    const currentNodeId = String(options.currentNodeId || "").trim();
    const nodeIds = collectReachablePredecessorNodeIds({
      nodes,
      edges,
      currentNodeId,
      entryNodeId: options.entryNodeId,
    });
    const predecessors = new Set(nodeIds);
    const predecessorNodes = nodes.filter((node) => predecessors.has(String(node?.id || "")));
    const variables = {};
    const workflowClipboardKeys = [];

    for (const name of objectKeys(options.variables)) {
      addVariableName(variables, name);
    }
    for (const entry of arrayValues(options.runtimeVariables)) {
      const name = typeof entry === "string" ? entry : entry?.name || entry?.id;
      if (String(name || "").startsWith("workflowClipboard.")) {
        workflowClipboardKeys.push(String(name).slice("workflowClipboard.".length));
      } else {
        addVariableName(variables, name);
      }
    }

    for (const source of arrayValues(options.dataSources)) {
      addVariableName(variables, source?.variableName || source?.id || source?.name);
    }

    const tabReferences = [...referenceValues(options.tabReferences)];
    for (const node of predecessorNodes) {
      const config = nodeConfiguration(node);
      addVariableName(variables, config.saveOutputAs);
      addVariableName(variables, config.variableName);

      const tabReference = config.saveTabReferenceAs || node?.data?.tabRef || node?.tabRef;
      if (tabReference) tabReferences.push(tabReference);

      if (workflowClipboardEnabled(config.saveToWorkflowClipboard)) {
        const clipboardKey = config.workflowClipboardEntry ||
          normalizeVariableName(config.saveOutputAs) ||
          String(node?.id || "");
        if (clipboardKey) workflowClipboardKeys.push(clipboardKey);
      }
    }

    workflowClipboardKeys.unshift(...referenceValues(options.workflowClipboardKeys));

    return {
      variables,
      nodeIds,
      workflowClipboardKeys: uniqueStrings(workflowClipboardKeys),
      tabReferences: uniqueStrings(tabReferences),
      approvedDirectories: cloneArrayValues(options.approvedDirectories),
      fileReferences: uniqueStrings(referenceValues(options.fileReferences)),
    };
  }

  function collectReachablePredecessorNodeIds(options = {}) {
    const nodes = arrayValues(options.nodes);
    const nodeOrder = nodes.map((node) => String(node?.id || "").trim()).filter(Boolean);
    const validIds = new Set(nodeOrder);
    const currentNodeId = String(options.currentNodeId || "").trim();
    if (!currentNodeId || !validIds.has(currentNodeId)) return [];

    const incoming = new Map(nodeOrder.map((id) => [id, []]));
    const outgoing = new Map(nodeOrder.map((id) => [id, []]));
    for (const edge of arrayValues(options.edges)) {
      const source = String(edge?.source || "").trim();
      const target = String(edge?.target || "").trim();
      if (!validIds.has(source) || !validIds.has(target)) continue;
      incoming.get(target).push(source);
      outgoing.get(source).push(target);
    }

    const explicitEntry = String(options.entryNodeId || "").trim();
    const entries = validIds.has(explicitEntry)
      ? [explicitEntry]
      : nodeOrder.filter((id) => incoming.get(id).length === 0);
    if (!entries.length) return [];

    const reachableBeforeCurrent = new Set();
    const queue = [...entries];
    while (queue.length) {
      const id = queue.shift();
      if (!id || reachableBeforeCurrent.has(id)) continue;
      reachableBeforeCurrent.add(id);
      if (id === currentNodeId) continue;
      queue.push(...outgoing.get(id));
    }

    const ancestors = new Set();
    const pending = [...incoming.get(currentNodeId)];
    while (pending.length) {
      const id = pending.pop();
      if (!id || id === currentNodeId || ancestors.has(id)) continue;
      ancestors.add(id);
      pending.push(...incoming.get(id));
    }

    return nodeOrder.filter((id) => (
      id !== currentNodeId &&
      ancestors.has(id) &&
      reachableBeforeCurrent.has(id)
    ));
  }

  function coerceNodeFieldValue(field = {}, value) {
    if (value === undefined) return undefined;
    if (value === null) return null;

    if (field.kind === "number") {
      if (typeof value === "number") return value;
      if (isExpression(value) || (typeof value === "string" && !value.trim())) {
        return value;
      }
      const number = Number(value);
      return Number.isFinite(number) ? number : cloneValue(value);
    }

    return cloneValue(value);
  }

  function prepareNodeConfiguration(config = {}, definition = {}, options = {}) {
    const issues = [];
    const source = isPlainObject(config) ? config : {};
    if (!isPlainObject(config)) {
      issues.push({
        fieldKey: "config",
        message: "Node configuration must be an object.",
      });
    }

    const fields = Array.isArray(definition.config)
      ? definition.config
      : Array.isArray(definition.configSchema)
        ? definition.configSchema
        : [];
    const defaults = isPlainObject(definition.commonConfigDefaults)
      ? definition.commonConfigDefaults
      : {};
    const knownKeys = new Set(fields.map((field) => field.key));
    const prepared = {};

    for (const field of fields) {
      const hasSourceValue = Object.prototype.hasOwnProperty.call(source, field.key);
      const hasFieldDefault = Object.prototype.hasOwnProperty.call(field, "default");
      const hasCommonDefault = Object.prototype.hasOwnProperty.call(defaults, field.key);
      let value;

      if (hasSourceValue) {
        value = source[field.key];
        if (
          typeof value === "string" &&
          !value.trim() &&
          ["number", "boolean", "select"].includes(field.kind) &&
          (hasFieldDefault || hasCommonDefault)
        ) {
          value = hasFieldDefault ? field.default : defaults[field.key];
        }
      } else if (options.applyDefaults !== false && (hasFieldDefault || hasCommonDefault)) {
        value = hasFieldDefault ? field.default : defaults[field.key];
      } else {
        continue;
      }

      prepared[field.key] = coerceNodeFieldValue(field, value);
    }

    const unknownPolicy = normalizeUnknownConfigPolicy(
      options.unknownConfigPolicy ?? definition.unknownConfigPolicy,
    );
    for (const [key, value] of Object.entries(source)) {
      if (knownKeys.has(key)) continue;
      prepared[key] = cloneValue(value);
      if (unknownPolicy === UNKNOWN_CONFIG_POLICIES.Reject) {
        issues.push({
          fieldKey: `config.${key}`,
          message: `Unsupported configuration field: ${key}.`,
        });
      }
    }

    issues.push(...validatePreparedConfiguration(
      prepared,
      definition,
      options.node || {},
    ));
    return {
      config: prepared,
      issues: dedupeIssues(issues),
    };
  }

  function validateNodeConfiguration(node = {}, definition = {}) {
    const config = node.config && typeof node.config === "object" ? node.config : {};
    const source = { ...config };
    for (const field of definition.config || definition.configSchema || []) {
      if (Object.prototype.hasOwnProperty.call(source, field.key)) continue;
      const fallback = node[field.key] ?? legacyPayloadValue(node, field.key);
      if (fallback !== undefined) source[field.key] = fallback;
    }
    return prepareNodeConfiguration(source, definition, { node }).issues;
  }

  function validatePreparedConfiguration(config, definition, node) {
    const issues = [];
    if (definition.targetRequired) {
      const targetSource = node.target || node.data?.target || node.componentRef || node.data?.componentRef;
      const isComponentRef = Boolean(
        targetSource && typeof targetSource === "object" &&
        (targetSource.componentId ||
          (targetSource.mapperSchemaVersion && targetSource.id)),
      );
      const target = normalizeTargetEditorValue(
        isComponentRef ? { componentRef: targetSource } : targetSource,
      );
      const hasValue = target.identifierType === "component_ref"
        ? Boolean(target.componentRef)
        : target.identifierType === "coordinates"
          ? Boolean(parseEditorCoordinates(target.identifierValue))
        : target.identifierValue !== undefined && target.identifierValue !== null &&
          (typeof target.identifierValue !== "string" || target.identifierValue.trim());
      if (!hasValue) issues.push({ fieldKey: "target", message: "Target element is required." });
      if (target.identifierType === "attribute" && !target.attributeName.trim()) {
        issues.push({ fieldKey: "target.attributeName", message: "Attribute targets require an attribute name." });
      }
    }

    for (const field of definition.config || definition.configSchema || []) {
      const value = config[field.key] ?? node[field.key] ?? legacyPayloadValue(node, field.key);
      const required = field.required === true || conditionMatches(field.requiredWhen, config, node);
      if (required && isEmpty(value)) {
        issues.push({ fieldKey: field.key, message: `${field.label || field.key} is required.` });
        continue;
      }
      if (isEmpty(value)) continue;
      if (field.kind === "select") {
        const allowed = (field.options || []).map((option) => String(
          typeof option === "object" ? option.value : option,
        ));
        if (!allowed.includes(String(value))) {
          issues.push({ fieldKey: field.key, message: `${field.label || field.key} has an unsupported option.` });
        }
      }
      if (field.kind === "boolean" && typeof value !== "boolean") {
        issues.push({ fieldKey: field.key, message: `${field.label || field.key} must be checked or unchecked.` });
      }
      if (
        ["text", "textarea"].includes(field.kind) &&
        typeof value !== "string"
      ) {
        issues.push({ fieldKey: field.key, message: `${field.label || field.key} must be text.` });
      }
      if (
        field.format === "absolute_url_template" &&
        typeof value === "string" &&
        !isAbsoluteUrlTemplate(value, field.allowedProtocols)
      ) {
        issues.push({
          fieldKey: field.key,
          message: `${field.label || field.key} must be an absolute URL or an expression that resolves to one.`,
        });
      }
      if (field.kind === "number" && !isExpression(value)) {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          issues.push({ fieldKey: field.key, message: `${field.label || field.key} must be a number or expression.` });
        } else if (field.integer === true && !Number.isInteger(value)) {
          issues.push({ fieldKey: field.key, message: `${field.label || field.key} must be a whole number.` });
        } else if (field.minimum !== undefined && value < Number(field.minimum)) {
          issues.push({ fieldKey: field.key, message: `${field.label || field.key} must be at least ${field.minimum}.` });
        } else if (field.maximum !== undefined && value > Number(field.maximum)) {
          issues.push({ fieldKey: field.key, message: `${field.label || field.key} must be at most ${field.maximum}.` });
        }
      }
    }
    return issues;
  }

  function normalizeUnknownConfigPolicy(value) {
    return Object.values(UNKNOWN_CONFIG_POLICIES).includes(value)
      ? value
      : UNKNOWN_CONFIG_POLICIES.Preserve;
  }

  function dedupeIssues(issues) {
    const seen = new Set();
    return issues.filter((issue) => {
      const key = `${issue.fieldKey || ""}\u0000${issue.message || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function normalizeExpressionMode(field, kind, key) {
    if (EXPRESSION_MODES.includes(field.expressionMode)) return field.expressionMode;
    if (["select", "boolean"].includes(kind) || key === "variableName") return "none";
    return kind === "text" || kind === "textarea" || kind === "value"
      ? "template"
      : "expression";
  }

  function normalizeAutocompleteSources(value, expressionMode, key) {
    const allowed = new Set(Object.values(AUTOCOMPLETE_SOURCES));
    const explicit = arrayValues(value).filter((source) => allowed.has(source));
    if (explicit.length) return [...new Set(explicit)];
    const inferred = [];
    if (expressionMode !== "none") {
      inferred.push(
        AUTOCOMPLETE_SOURCES.Variables,
        AUTOCOMPLETE_SOURCES.NodeOutputs,
        AUTOCOMPLETE_SOURCES.WorkflowClipboard,
        AUTOCOMPLETE_SOURCES.LoopValues,
      );
    }
    if (/tab(reference|ref)?/i.test(key)) inferred.push(AUTOCOMPLETE_SOURCES.TabReferences);
    if (/directoryalias/i.test(key)) inferred.push(AUTOCOMPLETE_SOURCES.ApprovedDirectories);
    if (/(file|path)/i.test(key)) inferred.push(AUTOCOMPLETE_SOURCES.FileReferences);
    return [...new Set(inferred)];
  }

  function normalizeOptions(options) {
    return arrayValues(options).map((option) => {
      if (option && typeof option === "object") {
        return {
          value: String(option.value ?? option.id ?? ""),
          label: String(option.label ?? option.value ?? option.id ?? ""),
        };
      }
      return String(option);
    }).filter((option) => typeof option === "string" ? option : option.value);
  }

  function optionValue(option) {
    return String(typeof option === "object" ? option.value : option);
  }

  function formatEditorCoordinates(value) {
    if (value && typeof value === "object") {
      const x = Number(value.x);
      const y = Number(value.y);
      if (Number.isFinite(x) && Number.isFinite(y)) return `${x}, ${y}`;
    }
    return String(value || "");
  }

  function parseEditorCoordinates(value) {
    if (value && typeof value === "object") {
      const x = Number(value.x);
      const y = Number(value.y);
      return Number.isFinite(x) && Number.isFinite(y)
        ? { x, y, coordinateSpace: String(value.coordinateSpace || "viewport") }
        : null;
    }
    const parts = String(value || "").split(",").map((part) => Number(part.trim()));
    return parts.length === 2 && parts.every(Number.isFinite)
      ? { x: parts[0], y: parts[1], coordinateSpace: "viewport" }
      : null;
  }

  function normalizeIdentifierType(value) {
    const aliases = {
      css_selector: "css",
      text: "visible_text",
      label_text: "label",
      accessible_role: "role",
      component: "component_ref",
      component_id: "component_id",
    };
    const normalized = String(value || "auto").trim().toLowerCase();
    const resolved = aliases[normalized] || normalized;
    return TARGET_IDENTIFIER_TYPES.includes(resolved) ? resolved : "auto";
  }

  function inferExample(key, kind) {
    const examples = {
      url: "https://example.com/",
      variableName: "customer_record",
      tabRef: "results_tab",
      tabReference: "results_tab",
      directoryAlias: "allowedfiles",
      relativePath: "exports/results.json",
      selector: "form#checkout button[type=\"submit\"]",
      timeout: "30000",
      timeoutMs: "30000",
    };
    if (examples[key]) return examples[key];
    if (kind === "boolean") return "Unchecked";
    if (kind === "number") return "1";
    if (kind === "select") return "Choose an option";
    return `Example ${humanize(key).toLowerCase()}`;
  }

  function inferHelp(key, kind, expressionMode) {
    const label = humanize(key);
    if (kind === "boolean") return `Choose whether ${label.toLowerCase()} is enabled.`;
    if (kind === "select") return `Choose the ${label.toLowerCase()} value.`;
    if (expressionMode === "expression") {
      return `Enter ${label.toLowerCase()} as a literal value or expression.`;
    }
    if (expressionMode === "template") {
      return `Enter ${label.toLowerCase()}; templates may include workflow values.`;
    }
    return `Enter the ${label.toLowerCase()} value.`;
  }

  function humanize(value) {
    return String(value || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function objectKeys(value) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value)
      : arrayValues(value).map((entry) => typeof entry === "string" ? entry : entry?.name || entry?.id || "");
  }

  function arrayValues(value) {
    return Array.isArray(value) ? value : [];
  }

  function cloneArrayValues(value) {
    return arrayValues(value).map((entry) => cloneValue(entry));
  }

  function referenceValues(value) {
    return arrayValues(value).map((entry) => {
      if (typeof entry === "string") return entry;
      return entry?.id || entry?.referenceId || entry?.alias || entry?.name || "";
    });
  }

  function uniqueStrings(value) {
    return [...new Set(arrayValues(value)
      .map((entry) => String(entry || "").trim())
      .filter(Boolean))];
  }

  function nodeConfiguration(node) {
    if (isPlainObject(node?.data?.config)) return node.data.config;
    return isPlainObject(node?.config) ? node.config : {};
  }

  function addVariableName(target, value) {
    const name = normalizeVariableName(value);
    if (name) target[name] = true;
  }

  function normalizeVariableName(value) {
    const name = String(value || "").trim();
    if (!name || name === "variables" || name.startsWith("nodes.") ||
        name.startsWith("workflowClipboard.")) {
      return "";
    }
    return name.startsWith("variables.") ? name.slice("variables.".length) : name;
  }

  function workflowClipboardEnabled(value) {
    const mode = isPlainObject(value) ? value.mode : value;
    return Boolean(mode && String(mode).trim().toLowerCase() !== "off");
  }

  function cloneValue(value) {
    return value && typeof value === "object" ? structuredClone(value) : value;
  }

  function isPlainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function conditionMatches(condition, config, node) {
    if (!condition || typeof condition !== "object") return false;
    const actual = config[condition.field] ?? node[condition.field];
    return String(actual ?? "") === String(condition.equals ?? "");
  }

  function legacyPayloadValue(node, key) {
    if (["url", "value", "variableName", "keys", "ms"].includes(key)) {
      return node.payload?.primary;
    }
    return undefined;
  }

  function isEmpty(value) {
    return value === undefined || value === null ||
      (typeof value === "string" && !value.trim());
  }

  function isExpression(value) {
    return typeof value === "string" && /\{\{[^{}]+\}\}/.test(value);
  }

  function isAbsoluteUrlTemplate(value, allowedProtocols = []) {
    const input = String(value || "").trim();
    if (!input) return false;
    if (/^\{\{[^{}]+\}\}/.test(input)) return true;
    const probe = input.replace(/\{\{[^{}]+\}\}/g, "expression");
    try {
      const parsed = new URL(probe);
      const allowed = Array.isArray(allowedProtocols)
        ? allowedProtocols.map((protocol) => String(protocol).toLowerCase())
        : [];
      if (allowed.length && !allowed.includes(parsed.protocol.toLowerCase())) {
        return false;
      }
      if (
        ["http:", "https:"].includes(parsed.protocol.toLowerCase()) &&
        !String(parsed.hostname || "").trim()
      ) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  global.BRunnerNodeAuthoring = Object.freeze({
    FIELD_KINDS,
    EXPRESSION_MODES,
    AUTOCOMPLETE_SOURCES,
    TARGET_IDENTIFIER_TYPES,
    UNKNOWN_CONFIG_POLICIES,
    normalizeNodeFieldSchema,
    normalizeFieldDefinition,
    createTargetEditorSchema,
    normalizeTargetEditorValue,
    buildTargetEditorValue,
    collectFieldAutocompleteOptions,
    createNodeAutocompleteContext,
    collectReachablePredecessorNodeIds,
    coerceNodeFieldValue,
    prepareNodeConfiguration,
    validateNodeConfiguration,
  });
})(globalThis);
