import { isComponentRef } from "../../mapper/core.js";
import {
  NodeErrorCodes,
  NodeExecutionError,
} from "./nodeContracts.js";
import { normalizeTextMatchConfig } from "./textMatching.js";

export const TargetIdentifierTypes = Object.freeze({
  Auto: "auto",
  Css: "css",
  XPath: "xpath",
  Id: "id",
  Name: "name",
  Label: "label",
  VisibleText: "visible_text",
  Role: "role",
  Placeholder: "placeholder",
  Attribute: "attribute",
  ComponentRef: "component_ref",
  Coordinates: "coordinates",
});

export const TargetScopes = Object.freeze({
  WholePage: "whole_page",
  Frame: "frame",
  SelectedContainer: "selected_container",
  AutomaticShadowDom: "automatic_shadow_dom",
});

export const TargetStates = Object.freeze({
  Any: "any",
  Visible: "visible",
  Interactable: "interactable",
});

export const TargetMapFreshness = Object.freeze({
  UseCache: "use_cache",
  RevalidateIfStale: "revalidate_if_stale",
  RefreshBeforeResolution: "refresh_before_resolution",
});

export const TargetFallbackPolicies = Object.freeze({
  Disabled: "disabled",
  SemanticOnly: "semantic_only",
  AllVerified: "all_verified",
});

export const TargetAmbiguityPolicies = Object.freeze({
  Fail: "fail",
  UserReview: "user_review",
});

export const TargetTabSources = Object.freeze({
  Current: "current",
  Active: "active",
  SavedReference: "saved_reference",
  PreviousNode: "previous_node",
});

const IDENTIFIER_ALIASES = Object.freeze({
  auto: TargetIdentifierTypes.Auto,
  css: TargetIdentifierTypes.Css,
  css_selector: TargetIdentifierTypes.Css,
  xpath: TargetIdentifierTypes.XPath,
  id: TargetIdentifierTypes.Id,
  element_id: TargetIdentifierTypes.Id,
  name: TargetIdentifierTypes.Name,
  label: TargetIdentifierTypes.Label,
  label_text: TargetIdentifierTypes.Label,
  text: TargetIdentifierTypes.VisibleText,
  visible_text: TargetIdentifierTypes.VisibleText,
  role: TargetIdentifierTypes.Role,
  accessible_role: TargetIdentifierTypes.Role,
  placeholder: TargetIdentifierTypes.Placeholder,
  attribute: TargetIdentifierTypes.Attribute,
  component: TargetIdentifierTypes.ComponentRef,
  component_ref: TargetIdentifierTypes.ComponentRef,
  coordinates: TargetIdentifierTypes.Coordinates,
});

const SCOPE_ALIASES = Object.freeze({
  page: TargetScopes.WholePage,
  whole_page: TargetScopes.WholePage,
  frame: TargetScopes.Frame,
  container: TargetScopes.SelectedContainer,
  selected_container: TargetScopes.SelectedContainer,
  shadow: TargetScopes.AutomaticShadowDom,
  automatic_shadow_dom: TargetScopes.AutomaticShadowDom,
});

const RESOLVED_STATES = new Set(["resolved", "resolved_with_fallback"]);

export function normalizeTargetConfig(input = {}, options = {}) {
  const source = isPlainObject(input?.target) ? input.target : input;
  const componentRef = cloneObject(source.componentRef || input.componentRef);
  const hasExplicitIdentifierType =
    source.identifierType !== undefined &&
    source.identifierType !== null &&
    source.identifierType !== "";
  const inferredIdentifierType = hasExplicitIdentifierType
    ? normalizeEnum(
        source.identifierType,
        IDENTIFIER_ALIASES,
        TargetIdentifierTypes.Auto,
      )
    : componentRef
      ? TargetIdentifierTypes.ComponentRef
      : TargetIdentifierTypes.Auto;
  const minimumConfidence = normalizeConfidence(
    source.minimumConfidence,
    options.defaultMinimumConfidence ?? 0.75,
  );
  const scope = normalizeScope(source);
  const tabSource = normalizeTabSource(source.tabSource, source.tabReference);

  return {
    identifierType: inferredIdentifierType,
    identifierValue: cloneValue(source.identifierValue),
    attributeName: cleanString(source.attributeName),
    roleName: cleanString(source.roleName || source.accessibleName),
    componentRef,
    coordinates: normalizeCoordinates(
      source.coordinates ??
        (inferredIdentifierType === TargetIdentifierTypes.Coordinates
          ? source.identifierValue
          : null),
    ),
    textMatch: normalizeTextMatchConfig(source.textMatch || source),
    scope,
    targetState: normalizeEnum(
      source.targetState,
      valueMap(TargetStates),
      TargetStates.Interactable,
    ),
    mapFreshness: normalizeEnum(
      source.mapFreshness,
      valueMap(TargetMapFreshness),
      TargetMapFreshness.RevalidateIfStale,
    ),
    fallbackPolicy: normalizeEnum(
      source.fallbackPolicy,
      valueMap(TargetFallbackPolicies),
      TargetFallbackPolicies.AllVerified,
    ),
    ambiguityPolicy: normalizeEnum(
      source.ambiguityPolicy,
      {
        fail: TargetAmbiguityPolicies.Fail,
        review: TargetAmbiguityPolicies.UserReview,
        user_review: TargetAmbiguityPolicies.UserReview,
        explicit_user_review: TargetAmbiguityPolicies.UserReview,
      },
      TargetAmbiguityPolicies.Fail,
    ),
    minimumConfidence,
    tabSource,
  };
}

export function validateTargetConfig(input = {}, options = {}) {
  const source = isPlainObject(input?.target) ? input.target : input;
  const target = normalizeTargetConfig(input, options);
  const errors = [];

  validateEnumInput(
    source.identifierType,
    IDENTIFIER_ALIASES,
    "identifierType",
    errors,
  );
  validateEnumInput(
    source.targetState,
    valueMap(TargetStates),
    "targetState",
    errors,
  );
  validateEnumInput(
    source.mapFreshness,
    valueMap(TargetMapFreshness),
    "mapFreshness",
    errors,
  );
  validateEnumInput(
    source.fallbackPolicy,
    valueMap(TargetFallbackPolicies),
    "fallbackPolicy",
    errors,
  );
  validateEnumInput(
    source.ambiguityPolicy,
    {
      fail: TargetAmbiguityPolicies.Fail,
      review: TargetAmbiguityPolicies.UserReview,
      user_review: TargetAmbiguityPolicies.UserReview,
      explicit_user_review: TargetAmbiguityPolicies.UserReview,
    },
    "ambiguityPolicy",
    errors,
  );
  const rawScope = isPlainObject(source.scope) ? source.scope.mode : source.scope;
  validateEnumInput(rawScope, SCOPE_ALIASES, "scope", errors);
  const rawTabSource = isPlainObject(source.tabSource)
    ? source.tabSource.mode
    : source.tabSource;
  validateEnumInput(
    rawTabSource,
    {
      current: TargetTabSources.Current,
      active: TargetTabSources.Active,
      saved: TargetTabSources.SavedReference,
      saved_reference: TargetTabSources.SavedReference,
      previous: TargetTabSources.PreviousNode,
      previous_node: TargetTabSources.PreviousNode,
    },
    "tabSource",
    errors,
  );
  if (
    source.minimumConfidence !== undefined &&
    source.minimumConfidence !== null &&
    source.minimumConfidence !== ""
  ) {
    const confidence = Number(source.minimumConfidence);
    if (
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 100
    ) {
      errors.push("minimumConfidence must be between 0 and 1, or 0 and 100.");
    }
  }

  if (target.componentRef && !isComponentRef(target.componentRef)) {
    errors.push("componentRef is not a valid mapper ComponentRef.");
  }

  if (
    target.identifierType === TargetIdentifierTypes.ComponentRef &&
    !isComponentRef(target.componentRef)
  ) {
    errors.push("A mapper ComponentRef is required.");
  }

  if (
    target.identifierType === TargetIdentifierTypes.Coordinates &&
    !target.coordinates
  ) {
    errors.push("Coordinate targets require finite x and y values.");
  }

  if (
    requiresIdentifierValue(target.identifierType) &&
    isEmptyIdentifierValue(target.identifierValue)
  ) {
    errors.push(`${target.identifierType} targets require identifierValue.`);
  }

  if (
    target.identifierType === TargetIdentifierTypes.Attribute &&
    !target.attributeName
  ) {
    errors.push("Attribute targets require attributeName.");
  }

  if (
    target.identifierType === TargetIdentifierTypes.Role &&
    !target.roleName &&
    isEmptyIdentifierValue(target.identifierValue)
  ) {
    errors.push("Role targets require a role and accessible name.");
  }

  if (
    target.scope.mode === TargetScopes.Frame &&
    !target.scope.frameReference
  ) {
    errors.push("Frame scope requires frameReference.");
  }

  if (
    target.scope.mode === TargetScopes.SelectedContainer &&
    !isComponentRef(target.scope.containerRef)
  ) {
    errors.push("Selected-container scope requires a mapper ComponentRef.");
  }

  if (options.requireComponentRef === true && !isComponentRef(target.componentRef)) {
    errors.push(
      "Finalized node execution requires an authoring target converted to a mapper ComponentRef.",
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    target,
  };
}

export function assertValidTargetConfig(input = {}, options = {}) {
  const validation = validateTargetConfig(input, options);
  if (!validation.valid) {
    throw new NodeExecutionError(
      NodeErrorCodes.ConfigInvalid,
      validation.errors.join(" "),
      { validationErrors: validation.errors },
    );
  }
  return validation.target;
}

export function targetResolutionRequirements(input = {}, options = {}) {
  const target = normalizeTargetConfig(input, options);
  return {
    action: cleanString(options.action),
    expectedElementType: cleanString(options.expectedElementType),
    targetState: target.targetState,
    scope: cloneValue(target.scope),
    mapFreshness: target.mapFreshness,
    fallbackPolicy: target.fallbackPolicy,
    allowFallback: target.fallbackPolicy !== TargetFallbackPolicies.Disabled,
    semanticFallbackOnly:
      target.fallbackPolicy === TargetFallbackPolicies.SemanticOnly,
    ambiguityPolicy: target.ambiguityPolicy,
    minimumConfidence: target.minimumConfidence,
    minimumConfidenceScore: Math.round(target.minimumConfidence * 100),
    tabSource: cloneValue(target.tabSource),
  };
}

export function normalizeTargetResolutionOutput(
  outcome = {},
  input = {},
  options = {},
) {
  const target = normalizeTargetConfig(input, options);
  const state = cleanString(outcome.state || outcome.mapperState || "not_found");
  const confidence = normalizeConfidence(
    outcome.confidence ?? outcome.score,
    0,
  );
  const fallbackUsed =
    outcome.fallbackUsed === true ||
    state === "resolved_with_fallback" ||
    Boolean(
      outcome.matchedBy &&
        !["primary", "primary_identifier", "primary_locator_unique"].includes(
          cleanString(outcome.matchedBy),
        ),
    );
  const resolved =
    RESOLVED_STATES.has(state) &&
    confidence >= target.minimumConfidence &&
    targetStateSatisfied(outcome, target.targetState);

  return {
    primaryIdentifier: {
      type: target.identifierType,
      value:
        target.identifierType === TargetIdentifierTypes.ComponentRef
          ? target.componentRef?.componentId || target.componentRef?.id || ""
          : cloneValue(target.identifierValue),
    },
    primaryMatchStatus: fallbackUsed
      ? "not_found"
      : resolved
        ? "matched"
        : state,
    resolved,
    state: resolved ? state : normalizeUnresolvedState(outcome, target, state),
    matchedBy: cleanString(
      outcome.matchedBy ||
        outcome.strategy ||
        outcome.reason ||
        (fallbackUsed ? "mapper_fallback" : ""),
    ),
    fallbackUsed,
    confidence,
    matchCount: normalizeMatchCount(outcome, resolved),
    reviewRequired:
      state === "ambiguous" &&
      target.ambiguityPolicy === TargetAmbiguityPolicies.UserReview,
    reason: cleanString(outcome.reason || outcome.mapperReason),
    componentRef: cloneObject(outcome.componentRef || target.componentRef),
    component: cloneObject(outcome.component || outcome.candidate),
  };
}

export async function resolveTarget(input = {}, services = {}, options = {}) {
  let target = assertValidTargetConfig(input, options);
  let componentRef = target.componentRef;

  if (!componentRef) {
    if (typeof services.mapAuthoringTarget !== "function") {
      return targetFailure(
        NodeErrorCodes.DependencyNotReady,
        "The authoring target has not been converted to a mapper ComponentRef.",
        { target },
      );
    }

    const mapped = await services.mapAuthoringTarget(target, {
      tab: services.tab,
      page: services.page,
      workflowId: services.workflowId,
    });
    componentRef = mapped?.componentRef || mapped;
    if (!isComponentRef(componentRef)) {
      return targetFailure(
        NodeErrorCodes.TargetNotFound,
        "The mapper could not create a unique ComponentRef for the authoring target.",
        { target, mapperOutcome: mapped || null },
      );
    }
    target = {
      ...target,
      componentRef: cloneObject(componentRef),
    };
  }

  if (!services.mapper || typeof services.mapper.resolveComponent !== "function") {
    return targetFailure(
      NodeErrorCodes.DependencyNotReady,
      "Mapper resolution service is unavailable.",
      { componentRef },
    );
  }

  const request = {
    workflowId: cleanString(
      services.workflowId || componentRef.workflowId,
    ),
    componentRef,
    tab: services.tab,
    page: services.page,
    requirements: targetResolutionRequirements(target, options),
  };

  if (target.mapFreshness === TargetMapFreshness.RefreshBeforeResolution) {
    await refreshTargetMap(services, request);
  }

  let outcome = await services.mapper.resolveComponent(request);
  if (
    (outcome?.state || outcome?.mapperState) === "map_stale" &&
    target.mapFreshness === TargetMapFreshness.RevalidateIfStale
  ) {
    await refreshTargetMap(services, request);
    const resolver =
      typeof services.mapper.revalidateComponent === "function"
        ? services.mapper.revalidateComponent.bind(services.mapper)
        : services.mapper.resolveComponent.bind(services.mapper);
    outcome = await resolver(request);
  }

  const targetResolution = normalizeTargetResolutionOutput(
    { ...outcome, componentRef },
    target,
    options,
  );
  if (!targetResolution.resolved) {
    return targetFailureForOutcome(targetResolution, outcome);
  }

  return {
    ok: true,
    componentRef: cloneObject(componentRef),
    component: cloneObject(outcome?.component || outcome?.candidate),
    candidate: cloneObject(outcome?.candidate),
    targetResolution,
    mapperOutcome: cloneValue(outcome),
  };
}

async function refreshTargetMap(services, request) {
  const refresh =
    services.refreshMap ||
    services.mapper?.refreshPageMap;
  if (typeof refresh !== "function") {
    throw new NodeExecutionError(
      NodeErrorCodes.DependencyNotReady,
      "Target policy requires a mapper refresh service.",
      { mapFreshness: request.requirements?.mapFreshness },
    );
  }
  await refresh.call(services.mapper, request);
}

function targetFailureForOutcome(targetResolution, outcome = {}) {
  let code = NodeErrorCodes.TargetNotFound;
  if (targetResolution.state === "ambiguous") {
    code = NodeErrorCodes.AmbiguousTarget;
  } else if (targetResolution.state === "protected_unsupported") {
    code = NodeErrorCodes.ProtectedPage;
  } else if (targetResolution.state === "target_not_visible") {
    code = NodeErrorCodes.TargetNotVisible;
  } else if (targetResolution.state === "target_not_interactable") {
    code = NodeErrorCodes.TargetNotInteractable;
  }

  return targetFailure(
    code,
    targetFailureMessage(code, targetResolution),
    {
      targetResolution,
      mapperOutcome: cloneValue(outcome),
    },
  );
}

function targetFailure(code, message, details = {}) {
  return {
    ok: false,
    error: {
      code,
      message,
      details: cloneValue(details),
    },
    targetResolution: cloneValue(details.targetResolution || null),
  };
}

function targetFailureMessage(code, resolution) {
  const messages = {
    [NodeErrorCodes.AmbiguousTarget]:
      resolution.reviewRequired
        ? "Target resolution requires explicit user review."
        : "Target resolution was ambiguous.",
    [NodeErrorCodes.ProtectedPage]:
      "The target is on a protected or unsupported browser surface.",
    [NodeErrorCodes.TargetNotVisible]: "The resolved target is not visible.",
    [NodeErrorCodes.TargetNotInteractable]:
      "The resolved target is not interactable.",
    [NodeErrorCodes.TargetNotFound]: "The mapper could not resolve the target.",
  };
  return messages[code] || "Target resolution failed.";
}

function normalizeUnresolvedState(outcome, target, state) {
  if (RESOLVED_STATES.has(state)) {
    if (
      normalizeConfidence(outcome.confidence ?? outcome.score, 0) <
      target.minimumConfidence
    ) {
      return "below_minimum_confidence";
    }
    if (target.targetState === TargetStates.Visible && outcome.visible === false) {
      return "target_not_visible";
    }
    if (
      target.targetState === TargetStates.Interactable &&
      (outcome.visible === false || outcome.interactable === false)
    ) {
      return "target_not_interactable";
    }
  }
  return state;
}

function targetStateSatisfied(outcome, targetState) {
  if (targetState === TargetStates.Any) return true;
  if (targetState === TargetStates.Visible) return outcome.visible !== false;
  return outcome.visible !== false && outcome.interactable !== false;
}

function normalizeScope(source = {}) {
  const scopeSource = isPlainObject(source.scope)
    ? source.scope
    : { mode: source.scope };
  return {
    mode: normalizeEnum(
      scopeSource.mode,
      SCOPE_ALIASES,
      TargetScopes.AutomaticShadowDom,
    ),
    frameReference: cloneValue(
      scopeSource.frameReference || source.frameReference,
    ),
    containerRef: cloneObject(
      scopeSource.containerRef || source.containerRef,
    ),
  };
}

function normalizeTabSource(value, fallbackReference) {
  const source = isPlainObject(value) ? value : { mode: value };
  const aliases = {
    current: TargetTabSources.Current,
    active: TargetTabSources.Active,
    saved: TargetTabSources.SavedReference,
    saved_reference: TargetTabSources.SavedReference,
    previous: TargetTabSources.PreviousNode,
    previous_node: TargetTabSources.PreviousNode,
  };
  return {
    mode: normalizeEnum(
      source.mode,
      aliases,
      TargetTabSources.Current,
    ),
    reference: cloneValue(source.reference ?? fallbackReference ?? ""),
  };
}

function normalizeCoordinates(value) {
  if (!isPlainObject(value)) return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x,
    y,
    coordinateSpace: cleanString(value.coordinateSpace || "viewport"),
  };
}

function requiresIdentifierValue(identifierType) {
  return ![
    TargetIdentifierTypes.Auto,
    TargetIdentifierTypes.ComponentRef,
    TargetIdentifierTypes.Coordinates,
    TargetIdentifierTypes.Role,
  ].includes(identifierType);
}

function isEmptyIdentifierValue(value) {
  return value === undefined ||
    value === null ||
    (typeof value === "string" && !value.trim());
}

function normalizeEnum(value, aliases, fallback) {
  const normalized = cleanString(value)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return aliases[normalized] || fallback;
}

function validateEnumInput(value, aliases, field, errors) {
  if (value === undefined || value === null || value === "") return;
  const normalized = cleanString(value)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!aliases[normalized]) {
    errors.push(`${field} has an unsupported value.`);
  }
}

function valueMap(values) {
  return Object.fromEntries(Object.values(values).map((value) => [value, value]));
}

function normalizeConfidence(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return clamp(Number(fallback) || 0, 0, 1);
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return clamp(Number(fallback) || 0, 0, 1);
  return clamp(numeric > 1 ? numeric / 100 : numeric, 0, 1);
}

function normalizeMatchCount(outcome, resolved) {
  const explicit = Number(outcome.matchCount);
  if (Number.isInteger(explicit) && explicit >= 0) return explicit;
  if (Array.isArray(outcome.matches)) return outcome.matches.length;
  if (Array.isArray(outcome.candidates) && !resolved) {
    return outcome.candidates.length;
  }
  return resolved ? 1 : 0;
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cloneObject(value) {
  return isPlainObject(value) ? structuredClone(value) : null;
}

function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}
