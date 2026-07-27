import "../shared/nodeAuthoring.js";

const nodeAuthoring = globalThis.BRunnerNodeAuthoring;

if (!nodeAuthoring) {
  throw new Error("BRunner shared node-authoring implementation did not load.");
}

export const {
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
} = nodeAuthoring;

export default nodeAuthoring;
