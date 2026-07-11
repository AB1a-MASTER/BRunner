export const MapperCoreVersion = "0.1.0";
export const MapperSchemaVersion = 1;

export const MapperModes = Object.freeze({
  Automatic: "automatic",
  Explicit: "explicit",
});

export const MapperCaptureModes = Object.freeze({
  StaticBounded: "static_bounded",
});

export const MapperShadowDomModes = Object.freeze({
  OpenOnly: "open_only",
});

export const MapperPageClassifications = Object.freeze({
  Static: "static",
  HybridDynamic: "hybrid_dynamic",
  DynamicDeferred: "dynamic_deferred",
  Unsupported: "unsupported",
});

export const MapperMapStatuses = Object.freeze({
  Ready: "ready",
  Stale: "stale",
  Refreshed: "refreshed",
  Unsupported: "unsupported",
  Invalidated: "invalidated",
});

export const MapperComponentStatuses = Object.freeze({
  Same: "same",
  Changed: "changed",
  New: "new",
  Removed: "removed",
  Ambiguous: "ambiguous",
});

export const MapperResolverStates = Object.freeze({
  Resolved: "resolved",
  ResolvedWithFallback: "resolved_with_fallback",
  Ambiguous: "ambiguous",
  NotFound: "not_found",
  MapStale: "map_stale",
  ProtectedUnsupported: "protected_unsupported",
  DynamicDeferred: "dynamic_deferred",
});

export const MapperScoringProfile = Object.freeze({
  version: "mapper.scoring.v1",
  minimumScore: 75,
  minimumMargin: 15,
  rebindConfirmationCaptures: 2,
  weights: Object.freeze({
    semantic: 45,
    structural: 30,
    technical: 15,
    behavioral: 8,
    visual: 2,
  }),
});

export function createDefaultMapperSettings(overrides = {}) {
  const base = {
    enabled: true,
    mode: MapperModes.Automatic,
    captureMode: MapperCaptureModes.StaticBounded,
    shadowDom: MapperShadowDomModes.OpenOnly,
    maxComponents: 500,
    maxVersions: 3,
    materialMutationLimit: 50,
    queryAllowlist: [],
    siteOverrides: {},
    pageOverrides: {},
  };

  return normalizeMapperSettings({ ...base, ...overrides });
}

export function normalizeMapperSettings(settings = {}) {
  return {
    enabled: settings?.enabled !== false,
    mode: Object.values(MapperModes).includes(settings?.mode)
      ? settings.mode
      : MapperModes.Automatic,
    captureMode: MapperCaptureModes.StaticBounded,
    shadowDom: MapperShadowDomModes.OpenOnly,
    maxComponents: clampInteger(settings?.maxComponents, 1, 2000, 500),
    maxVersions: clampInteger(settings?.maxVersions, 1, 3, 3),
    materialMutationLimit: clampInteger(settings?.materialMutationLimit, 1, 500, 50),
    queryAllowlist: normalizeStringList(settings?.queryAllowlist),
    siteOverrides: normalizeRecord(settings?.siteOverrides),
    pageOverrides: normalizeRecord(settings?.pageOverrides),
  };
}

export function normalizePageProfile(input = {}, settings = {}) {
  const url = typeof input === "string" ? input : input.url;
  const allowlist = normalizeStringList(settings?.queryAllowlist);

  try {
    const parsed = new URL(String(url || ""));
    const query = new URLSearchParams();
    for (const key of allowlist) {
      if (parsed.searchParams.has(key)) {
        query.set(key, parsed.searchParams.get(key));
      }
    }

    return {
      origin: parsed.origin,
      hostname: parsed.hostname,
      path: normalizePath(parsed.pathname),
      query: query.toString(),
      title: typeof input?.title === "string" ? input.title.trim() : "",
      siteKey: createSiteKey(parsed.hostname),
      pageKey: createPageKey(parsed.hostname, parsed.pathname, query.toString()),
    };
  } catch {
    return {
      origin: "",
      hostname: "",
      path: "",
      query: "",
      title: typeof input?.title === "string" ? input.title.trim() : "",
      siteKey: "",
      pageKey: "",
    };
  }
}

export function createPlaceholderComponentRef(nodeId = "", action = "") {
  const safeNodeId = String(nodeId || "component")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "component";

  return {
    mapperSchemaVersion: MapperSchemaVersion,
    id: `pending:${safeNodeId}`,
    name: "Unmapped component",
    action: String(action || ""),
    status: "placeholder",
  };
}

export function isComponentRef(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      Number(value.mapperSchemaVersion) === MapperSchemaVersion &&
      typeof value.id === "string" &&
      value.id.trim(),
  );
}

export function createEmptyWorkflowMapperState(workflowId = "", settings = {}) {
  return {
    mapperSchemaVersion: MapperSchemaVersion,
    mapperCoreVersion: MapperCoreVersion,
    workflowId: String(workflowId || ""),
    settings: createDefaultMapperSettings(settings),
    maps: [],
    storage: createMapperStorageMetadata({ provider: "unknown" }),
    updatedAt: "",
  };
}

export function serializeWorkflowMapperState(state = {}) {
  return {
    mapperSchemaVersion: MapperSchemaVersion,
    mapperCoreVersion: String(state.mapperCoreVersion || MapperCoreVersion),
    workflowId: String(state.workflowId || ""),
    settings: normalizeMapperSettings(state.settings),
    maps: Array.isArray(state.maps) ? structuredClone(state.maps) : [],
    storage: createMapperStorageMetadata(state.storage),
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : "",
  };
}

export function deserializeWorkflowMapperState(state = {}) {
  if (!state || typeof state !== "object") return null;
  if (Number(state.mapperSchemaVersion) !== MapperSchemaVersion) return null;
  return serializeWorkflowMapperState(state);
}

export function createMapperStorageMetadata(metadata = {}) {
  const conflicts = Array.isArray(metadata.conflicts)
    ? metadata.conflicts
        .map((entry) => ({
          type: cleanToken(entry?.type || "last_write_wins"),
          workflowId: cleanValue(entry?.workflowId),
          previousRevision: cleanValue(entry?.previousRevision),
          nextRevision: cleanValue(entry?.nextRevision),
          detectedAt: cleanValue(entry?.detectedAt),
          resolvedBy: cleanValue(entry?.resolvedBy),
          detail: cleanValue(entry?.detail),
        }))
        .filter((entry) => entry.detectedAt || entry.previousRevision || entry.nextRevision)
        .slice(-20)
    : [];

  return {
    provider: cleanToken(metadata.provider || "unknown"),
    revision: cleanValue(metadata.revision),
    savedAt: cleanValue(metadata.savedAt),
    loadedAt: cleanValue(metadata.loadedAt),
    lastWriter: cleanValue(metadata.lastWriter),
    conflictPolicy: cleanToken(metadata.conflictPolicy || "last_write_wins"),
    conflicts,
  };
}

export function buildStaticPageMap({
  page = {},
  componentFacts = [],
  settings = {},
  previousMap = null,
  now = new Date().toISOString(),
} = {}) {
  const policy = normalizeMapperSettings(settings);
  const profile = normalizePageProfile(page, policy);
  const usableFacts = componentFacts
    .map((fact, index) => normalizeComponentFact(fact, index))
    .filter(Boolean);
  const orderedFacts = sortComponentFactsByVisualOrder(usableFacts);
  const materialMutationCount = Math.max(Number(page.materialMutationCount) || 0, 0);
  const platformProfile = normalizePlatformProfile(page.platformProfile);
  const frameSummary = normalizeFrameSummary(page.frameSummary);
  const dynamic = materialMutationCount > policy.materialMutationLimit;
  const overLimit = orderedFacts.length > policy.maxComponents;
  const dynamicRegionCount = orderedFacts.filter((fact) => {
    return ["dynamic", "loaded_window", "ephemeral_context"].includes(
      fact.fingerprint?.structural?.regionDynamics?.classification,
    );
  }).length;
  const hasBoundedDynamicRegions = dynamicRegionCount > 0;
  const classification = overLimit
    ? MapperPageClassifications.DynamicDeferred
    : dynamic && hasBoundedDynamicRegions
      ? MapperPageClassifications.HybridDynamic
      : dynamic
        ? MapperPageClassifications.DynamicDeferred
        : MapperPageClassifications.Static;
  const supportedClassification = [
    MapperPageClassifications.Static,
    MapperPageClassifications.HybridDynamic,
  ].includes(classification);
  const componentResult = supportedClassification
    ? createComponentRecords({
        facts: orderedFacts,
        profile,
        previousMap,
        now,
      })
    : {
        components: [],
        reconciliation: createEmptyReconciliation(previousMap),
      };
  const fingerprintDigest = digestSerializable(orderedFacts.map((fact) => fact.fingerprint));
  const refreshed = Boolean(previousMap?.mapVersionId) &&
    previousMap.fingerprintDigest &&
    previousMap.fingerprintDigest !== fingerprintDigest;

  return {
    schemaVersion: MapperSchemaVersion,
    mapVersionId: createMapVersionId(profile, now, orderedFacts),
    siteKey: profile.siteKey,
    pageProfileKey: profile.pageKey,
    createdAt: now,
    status: supportedClassification
      ? refreshed
        ? MapperMapStatuses.Refreshed
        : MapperMapStatuses.Ready
      : MapperMapStatuses.Unsupported,
    classification,
    platformProfile,
    componentCount: componentResult.components.filter((component) => {
      return component.status !== MapperComponentStatuses.Removed;
    }).length,
    fingerprintDigest,
    components: componentResult.components,
    reconciliation: componentResult.reconciliation,
    reliabilityMetrics: componentResult.reconciliation.reliabilityMetrics,
    diagnostics: {
      scoringProfile: MapperScoringProfile.version,
      materialMutationCount,
      maxComponents: policy.maxComponents,
      platformProfileFamily: platformProfile.family,
      frameSummary,
      dynamicRegionCount,
      loadedContentOnly: classification === MapperPageClassifications.HybridDynamic,
      reason: dynamic
        ? hasBoundedDynamicRegions && !overLimit
          ? "bounded_dynamic_regions"
          : "material_mutation_limit_exceeded"
        : overLimit
          ? "component_limit_exceeded"
          : "",
    },
  };
}

export function createComponentRefFromRecord(component = {}) {
  return {
    mapperSchemaVersion: MapperSchemaVersion,
    componentId: String(component.componentId || ""),
    componentUid: String(component.componentUid || ""),
    siteKey: String(component.siteKey || ""),
    pageProfileKey: String(component.pageProfileKey || ""),
    capturedMapVersionId: String(component.capturedMapVersionId || ""),
  };
}

export function resolveMappedComponent(component = {}, candidateFacts = [], options = {}) {
  const componentScope = component.fingerprint?.structural?.platformScope || {};
  const frameScope = component.fingerprint?.structural?.frameScope || {};
  const repeatScope = component.fingerprint?.structural?.repeatScope || {};
  if (repeatScope.resolutionPolicy === "pattern_requires_condition") {
    return createResolutionResult(MapperResolverStates.ProtectedUnsupported, {
      reason: "repeat_condition_required",
      component,
    });
  }
  if (frameScope.access === "cross_origin") {
    return createResolutionResult(MapperResolverStates.ProtectedUnsupported, {
      reason: "cross_origin_frame_unsupported",
      component,
    });
  }
  if (componentScope.mappingDisposition === "unsupported_scope") {
    return createResolutionResult(MapperResolverStates.ProtectedUnsupported, {
      reason: "platform_scope_insufficient",
      component,
    });
  }
  if (options.pageClassification === MapperPageClassifications.DynamicDeferred) {
    return createResolutionResult(MapperResolverStates.DynamicDeferred, {
      reason: "dynamic_deferred",
      component,
    });
  }

  const action = String(options.action || component.action || "");
  const actionCandidates = candidateFacts
    .map((fact, index) => normalizeComponentFact(fact, index))
    .filter((fact) => isActionCompatible(fact.expectedCapabilities, action));
  const candidates = actionCandidates.filter((candidate) => {
    return repeatScopesCompatible(
      component.fingerprint?.structural?.repeatScope,
      candidate.fingerprint?.structural?.repeatScope,
    ) && frameScopesCompatible(
      component.fingerprint?.structural?.frameScope,
      candidate.fingerprint?.structural?.frameScope,
    ) && platformScopesCompatible(
      component.fingerprint?.structural?.platformScope,
      candidate.fingerprint?.structural?.platformScope,
    );
  });

  if (!candidates.length) {
    return createResolutionResult(MapperResolverStates.NotFound, {
      reason: actionCandidates.length
        ? "no_platform_scope_compatible_candidates"
        : "no_compatible_candidates",
      component,
    });
  }

  const primaryMatches = candidates.filter((candidate) => {
    return hasLocator(candidate.locators, component.primaryLocator);
  });

  if (primaryMatches.length === 1) {
    return createResolutionResult(MapperResolverStates.Resolved, {
      reason: "primary_locator_unique",
      component,
      candidate: primaryMatches[0],
      score: 100,
    });
  }

  if (primaryMatches.length > 1) {
    return createResolutionResult(MapperResolverStates.Ambiguous, {
      reason: "primary_locator_ambiguous",
      component,
      candidates: primaryMatches,
    });
  }

  const scored = candidates
    .map((candidate) => ({
      candidate,
      ...scoreCandidateAgainstComponent(component, candidate),
    }))
    .filter((result) => !result.disqualified)
    .sort((a, b) => b.score - a.score);

  if (!scored.length || scored[0].score < MapperScoringProfile.minimumScore) {
    return createResolutionResult(MapperResolverStates.NotFound, {
      reason: "below_threshold",
      component,
      score: scored[0]?.score || 0,
      candidates: scored.slice(0, 3),
    });
  }

  const runnerUp = scored[1];
  const margin = scored[0].score - (runnerUp?.score || 0);
  if (runnerUp && margin < MapperScoringProfile.minimumMargin) {
    return createResolutionResult(MapperResolverStates.Ambiguous, {
      reason: "runner_up_margin_too_small",
      component,
      score: scored[0].score,
      runnerUpScore: runnerUp.score,
      candidates: scored.slice(0, 3),
    });
  }

  return createResolutionResult(MapperResolverStates.ResolvedWithFallback, {
    reason: "fingerprint_unique",
    component,
    candidate: scored[0].candidate,
    score: scored[0].score,
    margin,
    evidence: scored[0].evidence,
  });
}

export function recordMapperRuntimeResolution(pageMap = {}, outcome = {}, now = new Date().toISOString()) {
  if (!pageMap || typeof pageMap !== "object") return pageMap;
  const redactedOutcome = redactRuntimeResolutionOutcome(outcome, now);
  const reliabilityMetrics = updateRuntimeReliabilityMetrics(
    pageMap.reliabilityMetrics ||
      pageMap.reconciliation?.reliabilityMetrics ||
      createRedactedReliabilityMetrics(null, pageMap.components || [], pageMap.reconciliation || null),
    redactedOutcome,
  );
  const resolverAttempts = [
    ...(Array.isArray(pageMap.resolverAttempts) ? pageMap.resolverAttempts : []),
    redactedOutcome,
  ].slice(-25);

  return {
    ...structuredClone(pageMap),
    reliabilityMetrics,
    reconciliation: {
      ...(pageMap.reconciliation || createEmptyReconciliation(null)),
      reliabilityMetrics,
    },
    resolverAttempts,
    updatedAt: now,
  };
}

export function scoreCandidateAgainstComponent(component = {}, candidate = {}) {
  const expected = component.fingerprint || {};
  const actual = candidate.fingerprint || {};
  const evidence = [];
  let score = 0;

  if (!platformScopesCompatible(
    expected.structural?.platformScope,
    actual.structural?.platformScope,
  )) {
    return {
      score: 0,
      evidence: ["platform_scope_contradiction"],
      disqualified: true,
      reason: "platform_scope_mismatch",
    };
  }

  if (!frameScopesCompatible(
    expected.structural?.frameScope,
    actual.structural?.frameScope,
  )) {
    return {
      score: 0,
      evidence: ["frame_scope_contradiction"],
      disqualified: true,
      reason: "frame_scope_mismatch",
    };
  }

  if (!repeatScopesCompatible(
    expected.structural?.repeatScope,
    actual.structural?.repeatScope,
  )) {
    return {
      score: 0,
      evidence: ["repeat_scope_contradiction"],
      disqualified: true,
      reason: "repeat_scope_mismatch",
    };
  }

  const semantic = scoreSemantic(expected.semantic, actual.semantic);
  if (semantic.disqualified) {
    return {
      score: 0,
      evidence: semantic.evidence,
      disqualified: true,
      reason: semantic.reason,
    };
  }
  score += semantic.score;
  evidence.push(...semantic.evidence);

  const structural = scoreListOverlap(
    collectStructuralTokens(expected.structural),
    collectStructuralTokens(actual.structural),
    MapperScoringProfile.weights.structural,
  );
  score += structural.score;
  if (structural.score) evidence.push("structural");

  const technical = scoreLocatorOverlap(
    component,
    candidate,
    MapperScoringProfile.weights.technical,
  );
  score += technical.score;
  if (technical.score) evidence.push("technical");

  const behavioral = scoreListOverlap(
    expected.behavioral?.capabilities,
    actual.behavioral?.capabilities,
    MapperScoringProfile.weights.behavioral,
  );
  score += behavioral.score;
  if (behavioral.score) evidence.push("behavioral");

  const visual = scoreBoundsSimilarity(
    expected.visual?.bounds,
    actual.visual?.bounds,
    MapperScoringProfile.weights.visual,
  );
  score += visual;
  if (visual) evidence.push("visual");

  return {
    score: Math.min(Math.round(score), 100),
    evidence,
    disqualified: false,
  };
}

function createComponentRecords({ facts, profile, previousMap, now }) {
  const previousComponents = Array.isArray(previousMap?.components)
    ? previousMap.components.filter((component) => {
        return component.status !== MapperComponentStatuses.Removed;
      })
    : [];
  const previousByUid = new Map(previousComponents
    .map((component) => [component.componentUid, component]));
  const names = allocateComponentNames(facts, profile);
  const usedPreviousUids = new Set();
  const mapVersionId = createMapVersionId(profile, now, facts);

  const components = facts.map((fact, index) => {
    const componentUid = fact.componentUid || createComponentUid(profile, fact);
    const candidate = factToCandidate(componentUid, fact);
    const match = selectPreviousComponentMatch({
      componentUid,
      candidate,
      previousComponents,
      previousByUid,
      usedPreviousUids,
    });
    const previous = match.previous;
    if (previous?.componentUid) usedPreviousUids.add(previous.componentUid);

    const componentId = previous?.componentId || names[index];
    const primaryLocator = selectPrimaryLocator(fact);
    const fallbackLocators = fact.locators.filter((locator) => locator !== primaryLocator);
    const status = match.status;
    const identityConfirmation = createIdentityConfirmation({
      previous,
      componentUid,
      match,
      mapVersionId,
      now,
    });

    return {
      mapperSchemaVersion: MapperSchemaVersion,
      componentId,
      componentUid,
      displayName: createDisplayName(fact),
      siteKey: profile.siteKey,
      pageProfileKey: profile.pageKey,
      capturedMapVersionId: mapVersionId,
      captureOrder: Number.isFinite(Number(fact.index)) ? Number(fact.index) : index,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
      status,
      reviewRequired: match.reviewRequired === true,
      reconciliationDecision: {
        reason: match.reason || "",
        score: match.score || 0,
        margin: Number.isFinite(match.margin) ? match.margin : null,
        automatic: match.reviewRequired !== true,
        evidence: redactEvidenceLabels(match.evidence),
      },
      identityConfirmation,
      primaryLocator,
      fallbackLocators,
      fingerprint: fact.fingerprint,
      expectedCapabilities: fact.expectedCapabilities,
      historicalLinks: previous
        ? [{
            componentUid: previous.componentUid,
            mapVersionId: previous.capturedMapVersionId || "",
            score: match.score || 0,
            status,
          }]
        : [],
      action: fact.action,
    };
  });

  const removedComponents = previousComponents
    .filter((component) => !usedPreviousUids.has(component.componentUid))
    .map((component) => ({
      ...structuredClone(component),
      capturedMapVersionId: mapVersionId,
      updatedAt: now,
      status: MapperComponentStatuses.Removed,
      reviewRequired: false,
      reconciliationDecision: {
        reason: "not_present_in_current_map",
        score: 0,
        margin: null,
        automatic: true,
      },
      historicalLinks: [
        ...(Array.isArray(component.historicalLinks) ? component.historicalLinks : []),
        {
          componentUid: component.componentUid,
          mapVersionId: component.capturedMapVersionId || previousMap?.mapVersionId || "",
          status: MapperComponentStatuses.Removed,
        },
      ],
    }));

  const allComponents = sortComponentsByVisualOrder(components.concat(removedComponents));

  return {
    components: allComponents,
    reconciliation: summarizeReconciliation(previousMap, allComponents),
  };
}

function sortComponentFactsByVisualOrder(facts = []) {
  return facts.slice().sort(compareVisualRecords);
}

function sortComponentsByVisualOrder(components = []) {
  return components.slice().sort(compareVisualRecords);
}

function compareVisualRecords(a = {}, b = {}) {
  const aRemoved = a.status === MapperComponentStatuses.Removed;
  const bRemoved = b.status === MapperComponentStatuses.Removed;
  if (aRemoved !== bRemoved) return aRemoved ? 1 : -1;

  const aBounds = visualOrderBounds(a);
  const bBounds = visualOrderBounds(b);
  if (aBounds.hasPosition && bBounds.hasPosition) {
    const yDelta = aBounds.y - bBounds.y;
    if (Math.abs(yDelta) > 4) return yDelta;
    const xDelta = aBounds.x - bBounds.x;
    if (Math.abs(xDelta) > 4) return xDelta;
  } else if (aBounds.hasPosition !== bBounds.hasPosition) {
    return aBounds.hasPosition ? -1 : 1;
  }

  const indexDelta = visualOrderIndex(a) - visualOrderIndex(b);
  if (indexDelta) return indexDelta;

  const aPath = visualOrderPath(a);
  const bPath = visualOrderPath(b);
  if (aPath !== bPath) return aPath.localeCompare(bPath);

  return 0;
}

function visualOrderBounds(record = {}) {
  const visual = record.fingerprint?.visual || {};
  const bounds = visual.documentBounds || visual.bounds || visual.viewportBounds || {};
  return {
    x: Number.isFinite(Number(bounds.x ?? bounds.left)) ? Number(bounds.x ?? bounds.left) : Number.MAX_SAFE_INTEGER,
    y: Number.isFinite(Number(bounds.y ?? bounds.top)) ? Number(bounds.y ?? bounds.top) : Number.MAX_SAFE_INTEGER,
    hasPosition: Number.isFinite(Number(bounds.x ?? bounds.left)) && Number.isFinite(Number(bounds.y ?? bounds.top)),
  };
}

function visualOrderPath(record = {}) {
  return String(record.fingerprint?.technical?.domPath || record.componentId || record.componentUid || "");
}

function visualOrderIndex(record = {}) {
  const index = Number(record.captureOrder ?? record.index);
  return Number.isFinite(index) ? index : Number.MAX_SAFE_INTEGER;
}

function selectPreviousComponentMatch({
  componentUid,
  candidate,
  previousComponents,
  previousByUid,
  usedPreviousUids,
}) {
  const exact = previousByUid.get(componentUid);
  if (exact && !usedPreviousUids.has(exact.componentUid)) {
    const scored = scoreCandidateAgainstComponent(exact, candidate);
    if (!scored.disqualified) {
      const score = scored.score;
      return {
        previous: exact,
        status: score >= 95
          ? MapperComponentStatuses.Same
          : MapperComponentStatuses.Changed,
        score,
        margin: 100,
        reason: score >= 95 ? "component_uid_unchanged" : "component_uid_drift",
        reviewRequired: false,
        evidence: scored.evidence,
      };
    }
  }

  const scored = previousComponents
    .filter((component) => !usedPreviousUids.has(component.componentUid))
    .map((component) => ({
      component,
      ...scoreCandidateAgainstComponent(component, candidate),
    }))
    .filter((match) => !match.disqualified)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return {
      previous: null,
      status: MapperComponentStatuses.New,
      score: 0,
      margin: null,
      reason: "no_compatible_history",
      reviewRequired: false,
    };
  }

  const best = scored[0];
  const runnerUp = scored[1];
  const margin = best.score - (runnerUp?.score || 0);
  if (
    runnerUp &&
    best.score >= 65 &&
    margin < MapperScoringProfile.minimumMargin
  ) {
    return {
      previous: null,
      status: MapperComponentStatuses.New,
      score: best.score,
      margin,
      reason: "uncertain_history_treated_as_new",
      reviewRequired: false,
    };
  }

  if (best.score >= 80 && margin >= MapperScoringProfile.minimumMargin) {
    return {
      previous: best.component,
      status: MapperComponentStatuses.Changed,
      score: best.score,
      margin,
      reason: "strong_unique_history_match",
      reviewRequired: false,
      evidence: best.evidence,
    };
  }

  return {
    previous: null,
    status: MapperComponentStatuses.New,
    score: best.score,
    margin,
    reason: best.score >= 65
      ? "weak_history_treated_as_new"
      : "history_below_identity_threshold",
    reviewRequired: false,
  };
}

function factToCandidate(componentUid, fact = {}) {
  return {
    componentUid,
    locators: fact.locators || [],
    fingerprint: fact.fingerprint || {},
    expectedCapabilities: fact.expectedCapabilities || [],
  };
}

function summarizeReconciliation(previousMap, components = []) {
  const summary = createEmptyReconciliation(previousMap);
  for (const component of components) {
    if (component.status === MapperComponentStatuses.Same) summary.same += 1;
    else if (component.status === MapperComponentStatuses.Changed) summary.changed += 1;
    else if (component.status === MapperComponentStatuses.New) summary.new += 1;
    else if (component.status === MapperComponentStatuses.Removed) summary.removed += 1;
    else if (component.status === MapperComponentStatuses.Ambiguous) summary.ambiguous += 1;
  }
  summary.reliabilityMetrics = createRedactedReliabilityMetrics(previousMap, components, summary);
  return summary;
}

function createEmptyReconciliation(previousMap = null) {
  return {
    previousMapVersionId: previousMap?.mapVersionId || "",
    same: 0,
    changed: 0,
    new: 0,
    removed: 0,
    ambiguous: 0,
    reliabilityMetrics: createRedactedReliabilityMetrics(previousMap, [], null),
  };
}

function createIdentityConfirmation({
  previous = null,
  componentUid = "",
  match = {},
  mapVersionId = "",
  now = "",
} = {}) {
  const prior = normalizeIdentityConfirmation(previous?.identityConfirmation);
  const isHistoricalRebind = Boolean(
    previous?.componentUid &&
      componentUid &&
      previous.componentUid !== componentUid &&
      match.reason === "strong_unique_history_match",
  );

  if (isHistoricalRebind) {
    const evidenceSignature = createEvidenceSignature({
      previous,
      componentUid,
      match,
    });
    const sameEvidence = prior?.evidenceSignature === evidenceSignature;
    const confirmationCount = sameEvidence
      ? Math.max(1, Number(prior.confirmationCount) || 1) + 1
      : 1;
    return {
      status: confirmationCount >= MapperScoringProfile.rebindConfirmationCaptures
        ? "confirmed"
        : "pending",
      confirmationCount,
      requiredCaptures: MapperScoringProfile.rebindConfirmationCaptures,
      reason: "strong_unique_history_match",
      firstSeenAt: sameEvidence ? prior.firstSeenAt || now : now,
      lastSeenAt: now,
      lastConfirmedMapVersionId: mapVersionId,
      evidenceSignature,
      score: match.score || 0,
      margin: Number.isFinite(match.margin) ? match.margin : null,
      automatic: match.reviewRequired !== true,
    };
  }

  if (prior?.status === "pending" && previous?.componentUid === componentUid) {
    const confirmationCount = Math.max(1, Number(prior.confirmationCount) || 1) + 1;
    return {
      ...prior,
      status: confirmationCount >= MapperScoringProfile.rebindConfirmationCaptures
        ? "confirmed"
        : "pending",
      confirmationCount,
      requiredCaptures: MapperScoringProfile.rebindConfirmationCaptures,
      reason: "settled_capture_confirmed_rebind",
      lastSeenAt: now,
      lastConfirmedMapVersionId: mapVersionId,
      score: match.score || prior.score || 0,
      margin: Number.isFinite(match.margin) ? match.margin : prior.margin ?? null,
      automatic: match.reviewRequired !== true,
    };
  }

  if (prior?.status === "confirmed" && previous?.componentUid === componentUid) {
    return {
      ...prior,
      reason: "settled_capture_confirmed_rebind",
      lastSeenAt: now,
      lastConfirmedMapVersionId: mapVersionId,
      score: match.score || prior.score || 0,
      margin: Number.isFinite(match.margin) ? match.margin : prior.margin ?? null,
      automatic: match.reviewRequired !== true,
    };
  }

  return null;
}

function normalizeIdentityConfirmation(value = null) {
  if (!value || typeof value !== "object") return null;
  const status = ["pending", "confirmed"].includes(value.status) ? value.status : "";
  if (!status) return null;
  return {
    status,
    confirmationCount: Math.max(1, Number(value.confirmationCount) || 1),
    requiredCaptures: Math.max(1, Number(value.requiredCaptures) || MapperScoringProfile.rebindConfirmationCaptures),
    reason: cleanToken(value.reason),
    firstSeenAt: cleanValue(value.firstSeenAt),
    lastSeenAt: cleanValue(value.lastSeenAt),
    lastConfirmedMapVersionId: cleanValue(value.lastConfirmedMapVersionId),
    evidenceSignature: cleanValue(value.evidenceSignature),
    score: clampInteger(value.score, 0, 100, 0),
    margin: Number.isFinite(Number(value.margin)) ? Number(value.margin) : null,
    automatic: value.automatic !== false,
  };
}

function createEvidenceSignature({ previous = {}, componentUid = "", match = {} } = {}) {
  return digestSerializable({
    reason: cleanToken(match.reason),
    previousUid: cleanValue(previous.componentUid),
    nextUid: cleanValue(componentUid),
    scoreBand: Math.floor((Number(match.score) || 0) / 5) * 5,
    marginBand: Math.floor((Number(match.margin) || 0) / 5) * 5,
    evidence: redactEvidenceLabels(match.evidence),
  }).slice(0, 16);
}

function redactEvidenceLabels(evidence = []) {
  return normalizeStringList(evidence)
    .map(cleanToken)
    .filter(Boolean)
    .slice(0, 8);
}

function createRedactedReliabilityMetrics(previousMap = null, components = [], summary = null) {
  const liveComponents = components.filter((component) => {
    return component.status !== MapperComponentStatuses.Removed;
  });
  const previousLiveCount = Array.isArray(previousMap?.components)
    ? previousMap.components.filter((component) => {
        return component.status !== MapperComponentStatuses.Removed;
      }).length
    : 0;
  const decisions = liveComponents.map((component) => component.reconciliationDecision || {});
  const automaticStrongMatchReasons = new Set([
    "component_uid_unchanged",
    "component_uid_drift",
    "strong_unique_history_match",
  ]);
  const uncertainAsNewReasons = new Set([
    "uncertain_history_treated_as_new",
    "weak_history_treated_as_new",
  ]);
  const automaticStrongMatchCount = decisions.filter((decision) => {
    return decision.automatic !== false && automaticStrongMatchReasons.has(decision.reason);
  }).length;
  const uncertainAsNewCount = decisions.filter((decision) => {
    return uncertainAsNewReasons.has(decision.reason);
  }).length;
  const reviewRequiredCount = components.filter((component) => component.reviewRequired === true).length;
  const rebindPendingCount = liveComponents.filter((component) => {
    return component.identityConfirmation?.status === "pending";
  }).length;
  const rebindConfirmedCount = liveComponents.filter((component) => {
    return component.identityConfirmation?.status === "confirmed";
  }).length;
  const same = summary?.same || 0;
  const changed = summary?.changed || 0;

  return {
    version: "mapper.reliability.v1",
    source: "static_reconciliation",
    redaction: {
      level: "counts_only",
      rawTextStored: false,
      rawLocatorStored: false,
    },
    liveComponentCount: liveComponents.length,
    previousLiveComponentCount: previousLiveCount,
    automaticStrongMatchCount,
    automaticStrongMatchRate: ratio(automaticStrongMatchCount, liveComponents.length),
    uncertainAsNewCount,
    reviewRequiredCount,
    componentIdSurvivalRate: previousLiveCount
      ? ratio(same + changed, previousLiveCount)
      : 1,
    rebindConfirmation: {
      requiredCaptures: MapperScoringProfile.rebindConfirmationCaptures,
      pendingCount: rebindPendingCount,
      confirmedCount: rebindConfirmedCount,
    },
    runtime: {
      fallbackRecoveryCount: 0,
      ambiguousCount: 0,
      notFoundCount: 0,
      incorrectActionCount: 0,
      staleToResolvedConvergenceAttempts: 0,
      attemptCount: 0,
      lastAttemptAt: "",
      source: "static_mapper_core_initialized",
    },
  };
}

function updateRuntimeReliabilityMetrics(metrics = {}, outcome = {}) {
  const next = structuredClone(metrics || {});
  const runtime = {
    fallbackRecoveryCount: 0,
    ambiguousCount: 0,
    notFoundCount: 0,
    incorrectActionCount: 0,
    staleToResolvedConvergenceAttempts: 0,
    attemptCount: 0,
    lastAttemptAt: "",
    source: "runtime_resolution",
    ...(next.runtime || {}),
  };
  runtime.attemptCount += 1;
  runtime.lastAttemptAt = outcome.createdAt || runtime.lastAttemptAt || "";
  runtime.source = "runtime_resolution";

  if (outcome.state === MapperResolverStates.ResolvedWithFallback) {
    runtime.fallbackRecoveryCount += 1;
  } else if (outcome.state === MapperResolverStates.Ambiguous) {
    runtime.ambiguousCount += 1;
  } else if (outcome.state === MapperResolverStates.NotFound) {
    runtime.notFoundCount += 1;
  }

  if (outcome.finalReason === "post_action_verification_failed") {
    runtime.incorrectActionCount += 1;
  }
  if (outcome.staleToResolved === true) {
    runtime.staleToResolvedConvergenceAttempts += 1;
  }

  return {
    ...next,
    runtime,
  };
}

function redactRuntimeResolutionOutcome(outcome = {}, now = "") {
  const state = cleanToken(outcome.state || outcome.mapperState || "unresolved");
  const resolverLog = outcome.resolverLog && typeof outcome.resolverLog === "object"
    ? outcome.resolverLog
    : {};
  const selected = sanitizeRuntimeCandidate(resolverLog.selected);
  const runnerUp = sanitizeRuntimeCandidate(resolverLog.runnerUp);
  const margin = Number.isFinite(Number(outcome.margin))
    ? Number(outcome.margin)
    : Number.isFinite(Number(resolverLog.margin))
      ? Number(resolverLog.margin)
      : selected && runnerUp
        ? selected.score - runnerUp.score
        : null;

  return {
    version: "mapper.runtime_resolution.v1",
    createdAt: cleanValue(outcome.createdAt || now),
    action: cleanToken(outcome.action || resolverLog.action || ""),
    componentId: cleanValue(outcome.componentId || resolverLog.componentId),
    componentUid: cleanValue(outcome.componentUid || resolverLog.componentUid),
    pageProfileKey: cleanValue(outcome.pageProfileKey),
    mapVersionId: cleanValue(outcome.mapVersionId),
    state,
    reason: cleanToken(outcome.reason || outcome.mapperReason || resolverLog.reason),
    finalReason: cleanToken(outcome.finalReason),
    confidence: clampInteger(outcome.confidence ?? resolverLog.confidence, 0, 100, 0),
    margin,
    attemptCount: clampInteger(outcome.attemptCount ?? resolverLog.attemptCount, 0, 1000, 0),
    selected,
    runnerUp,
    evidence: redactEvidenceLabels(outcome.evidence || selected?.evidence || []),
    staleToResolved: outcome.staleToResolved === true,
    redaction: {
      level: "counts_and_scores",
      rawTextStored: false,
      rawLocatorStored: false,
    },
  };
}

function sanitizeRuntimeCandidate(candidate = null) {
  if (!candidate || typeof candidate !== "object") return null;
  return {
    rank: clampInteger(candidate.rank, 1, 100, 1),
    score: clampInteger(candidate.score, 0, 100, 0),
    evidence: redactEvidenceLabels(candidate.evidence),
    componentIdHash: candidate.componentId
      ? digestSerializable(cleanValue(candidate.componentId)).slice(0, 12)
      : "",
    componentUidHash: candidate.componentUid
      ? digestSerializable(cleanValue(candidate.componentUid)).slice(0, 12)
      : "",
    primaryStrategy: cleanToken(candidate.primary?.strategy),
    visible: candidate.visible !== false,
  };
}

function ratio(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 10000) / 10000;
}

function normalizeComponentFact(fact = {}, index = 0) {
  if (!fact || typeof fact !== "object") return null;
  const fingerprint = normalizeFingerprint(fact.fingerprint || fact);
  const locators = normalizeLocators(fact.locators || fact.locatorCandidates || fact.fallbackLocators);
  const explicitCapabilities = normalizeCapabilities(fact.expectedCapabilities);
  const fingerprintCapabilities = normalizeCapabilities(fingerprint.behavioral?.capabilities);
  const expectedCapabilities = explicitCapabilities.length
    ? explicitCapabilities
    : fingerprintCapabilities.length
      ? fingerprintCapabilities
      : inferCapabilities(fingerprint);

  if (!locators.length && !hasMeaningfulFingerprint(fingerprint)) return null;

  return {
    index,
    action: String(fact.action || ""),
    componentId: cleanValue(fact.componentId),
    componentUid: cleanValue(fact.componentUid),
    locators,
    fingerprint: {
      ...fingerprint,
      behavioral: {
        ...fingerprint.behavioral,
        capabilities: expectedCapabilities,
      },
    },
    expectedCapabilities,
  };
}

function normalizePlatformProfile(profile = {}) {
  const family = ["chat", "social", "generic"].includes(cleanToken(profile?.family))
    ? cleanToken(profile.family)
    : "generic";
  const signals = normalizeRecord(profile?.signals);
  const loadedWindowHints = normalizeRecord(profile?.loadedWindowHints);

  return {
    version: cleanValue(profile?.version || "mapper.platform_profile.v1").slice(0, 80),
    family,
    confidence: clampInteger(profile?.confidence, 0, 100, 0),
    product: cleanToken(profile?.product).slice(0, 80),
    detectionSource: cleanToken(profile?.detectionSource).slice(0, 80),
    signals: {
      chat: clampInteger(signals.chat, 0, 999, 0),
      social: clampInteger(signals.social, 0, 999, 0),
    },
    loadedWindowHints: {
      messages: clampInteger(loadedWindowHints.messages, 0, 9999, 0),
      feedCards: clampInteger(loadedWindowHints.feedCards, 0, 9999, 0),
    },
  };
}

function normalizePlatformScope(scope = {}) {
  const family = ["chat", "social", "generic"].includes(cleanToken(scope?.family))
    ? cleanToken(scope.family)
    : "";
  if (!family || family === "generic") {
    return {
      version: "mapper.platform_scope.v1",
      family: "",
      region: "",
      containerId: "",
      threadId: "",
      repeatedKind: "",
      loadedWindowIndex: "",
      durability: "",
      dynamicKind: "",
      mappingDisposition: "",
      scopeSource: "",
      confidence: 0,
    };
  }

  return {
    version: cleanValue(scope?.version || "mapper.platform_scope.v1").slice(0, 80),
    family,
    region: cleanToken(scope?.region).slice(0, 80),
    containerId: cleanToken(scope?.containerId).slice(0, 120),
    threadId: cleanToken(scope?.threadId).slice(0, 120),
    repeatedKind: cleanToken(scope?.repeatedKind).slice(0, 80),
    loadedWindowIndex: cleanToken(scope?.loadedWindowIndex).slice(0, 80),
    durability: cleanToken(scope?.durability).slice(0, 80),
    dynamicKind: cleanToken(scope?.dynamicKind).slice(0, 80),
    mappingDisposition: cleanToken(scope?.mappingDisposition).slice(0, 80),
    scopeSource: cleanToken(scope?.scopeSource).slice(0, 80),
    confidence: clampInteger(scope?.confidence, 0, 100, 0),
  };
}

function normalizeRegionDynamics(region = {}) {
  const classification = ["static", "dynamic", "loaded_window", "ephemeral_context"]
    .includes(cleanToken(region?.classification))
    ? cleanToken(region.classification)
    : "static";
  return {
    version: "mapper.region_dynamics.v1",
    regionId: cleanToken(region?.regionId).slice(0, 120),
    classification,
    mutationCount: clampInteger(region?.mutationCount, 0, 10000, 0),
    loadedContentOnly: region?.loadedContentOnly === true,
    bounded: region?.bounded !== false,
  };
}

function normalizeFrameScope(scope = {}) {
  const access = ["top", "same_origin", "cross_origin"].includes(cleanToken(scope?.access))
    ? cleanToken(scope.access)
    : "top";
  return {
    version: "mapper.frame_scope.v1",
    access,
    path: cleanValue(scope?.path || "top").slice(0, 480),
    depth: clampInteger(scope?.depth, 0, 6, 0),
  };
}

function normalizeFrameSummary(summary = {}) {
  return {
    sameOriginFrames: clampInteger(summary?.sameOriginFrames, 0, 100, 0),
    crossOriginFrames: clampInteger(summary?.crossOriginFrames, 0, 100, 0),
  };
}

function normalizeRepeatScope(scope = {}) {
  return {
    version: "mapper.repeat_scope.v1",
    kind: cleanToken(scope?.kind).slice(0, 80),
    containerId: cleanToken(scope?.containerId).slice(0, 120),
    itemKey: cleanToken(scope?.itemKey).slice(0, 120),
    loadedWindowIndex: cleanToken(scope?.loadedWindowIndex).slice(0, 80),
    loadedContentOnly: scope?.loadedContentOnly === true,
    resolutionPolicy: ["pinned_item", "pattern_requires_condition"].includes(cleanToken(scope?.resolutionPolicy))
      ? cleanToken(scope.resolutionPolicy)
      : "",
  };
}

function normalizeFingerprint(fingerprint = {}) {
  const semantic = fingerprint.semantic || {};
  const structural = fingerprint.structural || {};
  const technical = fingerprint.technical || {};
  const behavioral = fingerprint.behavioral || {};
  const visual = fingerprint.visual || {};

  return {
    semantic: {
      role: cleanToken(semantic.role || fingerprint.role),
      accessibleName: cleanValue(semantic.accessibleName || semantic.ariaLabel || fingerprint.ariaLabel),
      altText: cleanValue(semantic.altText || fingerprint.altText),
      labelText: cleanValue(semantic.labelText || fingerprint.labelText),
      stableText: cleanValue(semantic.stableText || fingerprint.text),
      placeholder: cleanValue(semantic.placeholder || fingerprint.placeholder),
      title: cleanValue(semantic.title || fingerprint.title),
      name: cleanToken(semantic.name || fingerprint.name),
      inputType: cleanToken(semantic.inputType || fingerprint.type),
      stableAttributes: normalizeRecord(semantic.stableAttributes),
    },
    structural: {
      ancestorTokens: normalizeStringList(structural.ancestorTokens || fingerprint.ancestorTokens).slice(0, 3),
      platformScope: normalizePlatformScope(structural.platformScope || fingerprint.platformScope),
      frameScope: normalizeFrameScope(structural.frameScope || fingerprint.frameScope),
      repeatScope: normalizeRepeatScope(structural.repeatScope || fingerprint.repeatScope),
      regionDynamics: normalizeRegionDynamics(structural.regionDynamics || fingerprint.regionDynamics),
      formName: cleanToken(structural.formName || fingerprint.formName),
      relativeIndex: Number.isFinite(Number(structural.relativeIndex))
        ? Number(structural.relativeIndex)
        : null,
      nearbyLabel: cleanValue(structural.nearbyLabel || fingerprint.nearbyText),
    },
    technical: {
      tag: cleanToken(technical.tag || fingerprint.tag),
      id: cleanToken(technical.id || fingerprint.id),
      classes: normalizeStringList(technical.classes || fingerprint.classes).slice(0, 8),
      domPath: cleanValue(technical.domPath || fingerprint.domPath),
      shadowPath: normalizeShadowPath(technical.shadowPath || fingerprint.shadowPath),
    },
    behavioral: {
      capabilities: normalizeCapabilities(behavioral.capabilities),
      href: cleanValue(behavioral.href || fingerprint.href),
      state: normalizeRecord(behavioral.state),
      dynamicContext: behavioral.dynamicContext === true,
    },
    visual: {
      bounds: normalizeBounds(visual.bounds || fingerprint.bounds),
      viewportBounds: normalizeBounds(visual.viewportBounds),
      documentBounds: normalizeBounds(visual.documentBounds),
      viewport: normalizeRecord(visual.viewport),
    },
  };
}

function normalizeLocators(locators = []) {
  return (Array.isArray(locators) ? locators : [])
    .map((locator) => ({
      strategy: cleanToken(locator?.strategy),
      value: cleanValue(locator?.value),
      family: cleanToken(locator?.family),
      reliability: clampInteger(locator?.reliability, 0, 100, 50),
      selectedAtCapture: locator?.selectedAtCapture === true,
    }))
    .filter((locator) => locator.strategy && locator.value);
}

function normalizeCapabilities(capabilities = []) {
  return normalizeStringList(capabilities);
}

function normalizeShadowPath(path = []) {
  return (Array.isArray(path) ? path : [])
    .slice(0, 4)
    .map((boundary) => ({
      hostPath: cleanValue(boundary?.hostPath).slice(0, 320),
      innerPath: cleanValue(boundary?.innerPath).slice(0, 320),
    }))
    .filter((boundary) => boundary.hostPath && boundary.innerPath);
}

function inferCapabilities(fingerprint = {}) {
  const tag = fingerprint.technical?.tag || "";
  const role = fingerprint.semantic?.role || "";
  const inputType = fingerprint.semantic?.inputType || "";
  const capabilities = [];

  if (
    ["button", "a", "summary", "select"].includes(tag) ||
    ["button", "link", "menuitem", "tab", "checkbox", "radio"].includes(role)
  ) {
    capabilities.push("click");
  }
  if (["img", "picture", "svg", "canvas"].includes(tag) || role === "img") {
    capabilities.push("click", "screenshot");
  }
  if (
    ["textarea", "select"].includes(tag) ||
    (tag === "input" && !["button", "submit", "reset", "checkbox", "radio", "file"].includes(inputType)) ||
    role === "textbox"
  ) {
    capabilities.push("type", "clear");
  }
  if (tag === "select") capabilities.push("select");
  if (tag === "input" && inputType === "file") capabilities.push("upload");
  if (tag || role) capabilities.push("extract");
  return capabilities;
}

function allocateComponentNames(facts, profile) {
  const baseCounts = new Map();
  const nameParts = facts.map((fact) => ({
    site: profile.siteKey || "site",
    page: pageNameFromProfile(profile),
    component: toIdentifier(componentSeed(fact)) || "component",
    context: collectStructuralTokens(fact.fingerprint.structural)
      .map(toIdentifier)
      .filter(Boolean)
      .slice(0, 2)
      .join("_"),
  }));
  const baseNames = nameParts.map((parts) => {
    const safe = [parts.site, parts.page, parts.component].filter(Boolean).join("_") ||
      "site_page_component";
    baseCounts.set(safe, (baseCounts.get(safe) || 0) + 1);
    return safe;
  });

  const contextualNames = baseNames.map((base, index) => {
    if ((baseCounts.get(base) || 0) <= 1) return base;
    const parts = nameParts[index];
    return parts.context
      ? [parts.site, parts.page, parts.context, parts.component].filter(Boolean).join("_")
      : base;
  });

  const used = new Map();
  return contextualNames.map((name) => {
    const count = (used.get(name) || 0) + 1;
    used.set(name, count);
    return count === 1 ? name : `${name}_${count}`;
  });
}

function componentSeed(fact) {
  const semantic = fact.fingerprint.semantic || {};
  const attrs = semantic.stableAttributes || {};
  return [
    attrs["data-testid"],
    attrs["data-test"],
    attrs["data-qa"],
    semantic.accessibleName && `${semantic.accessibleName}_${semantic.role || "control"}`,
    semantic.altText && `${semantic.altText}_${semantic.role || "image"}`,
    semantic.labelText && `${semantic.labelText}_${semantic.role || semantic.inputType || "field"}`,
    semantic.stableText && `${semantic.stableText}_${semantic.role || "control"}`,
    semantic.name,
    semantic.placeholder,
    semantic.title,
    fact.fingerprint.technical?.id,
    semantic.role,
    fact.fingerprint.technical?.tag,
    "component",
  ].find((value) => cleanValue(value));
}

function createDisplayName(fact) {
  const semantic = fact.fingerprint.semantic || {};
  return cleanValue(
    semantic.accessibleName ||
      semantic.altText ||
      semantic.labelText ||
      semantic.stableText ||
      semantic.placeholder ||
      semantic.title ||
      semantic.name ||
      semantic.role ||
      fact.fingerprint.technical?.tag ||
      "Component",
  );
}

function selectPrimaryLocator(fact) {
  const selected = fact.locators.find((locator) => locator.selectedAtCapture);
  if (selected) return selected;
  return [...fact.locators].sort((a, b) => b.reliability - a.reliability)[0] || null;
}

function scoreSemantic(expected = {}, actual = {}) {
  const evidence = [];
  let score = 0;

  const expectedName = normalizedText(
    expected.accessibleName ||
      expected.altText ||
      expected.labelText ||
      expected.stableText ||
      expected.placeholder ||
      expected.title,
  );
  const actualName = normalizedText(
    actual.accessibleName ||
      actual.altText ||
      actual.labelText ||
      actual.stableText ||
      actual.placeholder ||
      actual.title,
  );

  if (expected.role && actual.role) {
    if (expected.role !== actual.role) {
      return {
        score: 0,
        evidence: ["semantic_contradiction"],
        disqualified: true,
        reason: "role_mismatch",
      };
    }
    score += 10;
    evidence.push("role");
  }

  if (expected.inputType && actual.inputType) {
    if (expected.inputType !== actual.inputType) {
      return {
        score: 0,
        evidence: ["semantic_contradiction"],
        disqualified: true,
        reason: "input_type_mismatch",
      };
    }
    score += 6;
    evidence.push("inputType");
  }

  if (expectedName && actualName) {
    if (expectedName === actualName) {
      score += 29;
      evidence.push("name");
    } else if (textOverlapScore(expectedName, actualName) >= 0.5) {
      score += 12;
      evidence.push("name_overlap");
    } else if (expected.accessibleName && actual.accessibleName) {
      return {
        score: 0,
        evidence: ["semantic_contradiction"],
        disqualified: true,
        reason: "accessible_name_mismatch",
      };
    }
  }

  if (expected.name && actual.name && expected.name === actual.name) {
    score += 5;
    evidence.push("name_attr");
  }

  return {
    score: Math.min(score, MapperScoringProfile.weights.semantic),
    evidence,
    disqualified: false,
  };
}

function scoreLocatorOverlap(component = {}, candidate = {}, maxScore = 15) {
  const expectedLocators = [
    component.primaryLocator,
    ...(component.fallbackLocators || []),
  ].filter(Boolean);
  if (!expectedLocators.length || !candidate.locators?.length) {
    return { score: 0 };
  }

  const matchCount = expectedLocators.filter((locator) => {
    return hasLocator(candidate.locators, locator);
  }).length;

  return {
    score: Math.min(maxScore, Math.round((matchCount / expectedLocators.length) * maxScore)),
  };
}

function scoreListOverlap(expected = [], actual = [], maxScore = 1) {
  const expectedSet = new Set(normalizeStringList(expected));
  const actualSet = new Set(normalizeStringList(actual));
  if (!expectedSet.size || !actualSet.size) return { score: 0 };

  let overlap = 0;
  for (const item of expectedSet) {
    if (actualSet.has(item)) overlap += 1;
  }

  return {
    score: Math.round((overlap / Math.max(expectedSet.size, actualSet.size)) * maxScore),
  };
}

function scoreBoundsSimilarity(expected, actual, maxScore = 2) {
  if (!expected || !actual) return 0;
  const widthDelta = Math.abs((expected.width || 0) - (actual.width || 0));
  const heightDelta = Math.abs((expected.height || 0) - (actual.height || 0));
  return widthDelta <= 8 && heightDelta <= 8 ? maxScore : 0;
}

function isActionCompatible(capabilities = [], action = "") {
  if (!action) return true;
  const capabilitySet = new Set(capabilities);
  if (action.includes("click") || action.includes("hover")) return capabilitySet.has("click");
  if (action.includes("type") || action.includes("clear")) return capabilitySet.has("type") || capabilitySet.has("clear");
  if (action.includes("select")) return capabilitySet.has("select");
  if (action.includes("toggle")) return capabilitySet.has("click") || capabilitySet.has("toggle");
  if (action.includes("upload")) return capabilitySet.has("upload");
  if (action.includes("extract") || action.startsWith("wait.element.")) return capabilitySet.has("extract") || capabilitySet.size > 0;
  return true;
}

function hasLocator(locators = [], expected = {}) {
  if (!expected?.strategy || !expected?.value) return false;
  return locators.some((locator) => {
    return locator.strategy === expected.strategy && locator.value === expected.value;
  });
}

function createResolutionResult(state, details = {}) {
  return {
    ok: state === MapperResolverStates.Resolved ||
      state === MapperResolverStates.ResolvedWithFallback,
    state,
    scoringProfile: MapperScoringProfile.version,
    ...details,
  };
}

function hasMeaningfulFingerprint(fingerprint = {}) {
  return Boolean(
    fingerprint.semantic?.accessibleName ||
      fingerprint.semantic?.altText ||
      fingerprint.semantic?.labelText ||
      fingerprint.semantic?.stableText ||
      fingerprint.semantic?.placeholder ||
      fingerprint.semantic?.name ||
      fingerprint.technical?.id ||
      fingerprint.technical?.domPath,
  );
}

function createMapVersionId(profile, now, facts) {
  return `map_${digestSerializable({
    siteKey: profile.siteKey,
    pageKey: profile.pageKey,
    now,
    facts: facts.map((fact) => fact.fingerprint),
  }).slice(0, 16)}`;
}

function createComponentUid(profile, fact) {
  return `uid_${digestSerializable({
    siteKey: profile.siteKey,
    pageKey: profile.pageKey,
    fingerprint: fact.fingerprint,
  }).slice(0, 20)}`;
}

function createSiteKey(hostname = "") {
  return toIdentifier(hostname.replace(/\./g, "_")) || "site";
}

function createPageKey(hostname = "", path = "/", query = "") {
  const site = createSiteKey(hostname);
  const page = pageNameFromPath(path);
  const queryToken = query ? toIdentifier(query) : "";
  return [site, page, queryToken].filter(Boolean).join("::");
}

function pageNameFromProfile(profile = {}) {
  return pageNameFromPath(profile.path);
}

function pageNameFromPath(path = "/") {
  const value = normalizePath(path);
  if (value === "/") return "home";
  return toIdentifier(value.replace(/^\/+|\/+$/g, "").replace(/\//g, "_")) || "page";
}

function collectStructuralTokens(structural = {}) {
  const scope = structural.platformScope || {};
  const repeat = structural.repeatScope || {};
  return [
    scope.family && scope.region ? `${scope.family} ${scope.region}` : "",
    scope.threadId ? `${scope.family} thread ${scope.threadId}` : "",
    scope.containerId ? `${scope.family} container ${scope.containerId}` : "",
    repeat.kind ? `repeat ${repeat.kind}` : "",
    repeat.containerId ? `repeat container ${repeat.containerId}` : "",
    repeat.itemKey ? `repeat item ${repeat.itemKey}` : "",
    ...(Array.isArray(structural.ancestorTokens) ? structural.ancestorTokens : []),
    structural.formName,
    structural.nearbyLabel,
  ].map(cleanValue).filter(Boolean);
}

function platformScopesCompatible(expected = {}, actual = {}) {
  const expectedFamily = cleanToken(expected?.family);
  if (!expectedFamily || expectedFamily === "generic") return true;

  const actualFamily = cleanToken(actual?.family);
  if (actualFamily !== expectedFamily) return false;
  if (cleanToken(actual?.region) !== cleanToken(expected?.region)) return false;

  for (const field of ["threadId", "containerId", "repeatedKind"]) {
    const expectedValue = cleanToken(expected?.[field]);
    if (expectedValue && cleanToken(actual?.[field]) !== expectedValue) return false;
  }

  return true;
}

function frameScopesCompatible(expected = {}, actual = {}) {
  const expectedPath = cleanValue(expected?.path || "top");
  const actualPath = cleanValue(actual?.path || "top");
  return expectedPath === actualPath;
}

function repeatScopesCompatible(expected = {}, actual = {}) {
  const expectedKind = cleanToken(expected?.kind);
  if (!expectedKind) return true;
  if (cleanToken(actual?.kind) !== expectedKind) return false;
  for (const field of ["containerId", "itemKey"]) {
    const expectedValue = cleanToken(expected?.[field]);
    if (expectedValue && cleanToken(actual?.[field]) !== expectedValue) return false;
  }
  return true;
}

function normalizeBounds(bounds = null) {
  if (!bounds || typeof bounds !== "object") return null;
  return {
    x: Math.round(Number(bounds.x) || 0),
    y: Math.round(Number(bounds.y) || 0),
    width: Math.round(Number(bounds.width) || 0),
    height: Math.round(Number(bounds.height) || 0),
  };
}

function digestSerializable(value) {
  const json = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < json.length; index++) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => {
      return `${JSON.stringify(key)}:${stableStringify(value[key])}`;
    }).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizePath(path = "") {
  const value = String(path || "/").replace(/\/+/g, "/");
  return value.startsWith("/") ? value : `/${value}`;
}

function normalizeStringList(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean))];
}

function normalizeRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? structuredClone(value)
    : {};
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function cleanValue(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function cleanToken(value) {
  return toIdentifier(value);
}

function normalizedText(value) {
  return cleanValue(value).toLowerCase();
}

function toIdentifier(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function textOverlapScore(a, b) {
  const aWords = new Set(normalizedText(a).split(/\s+/).filter((word) => word.length > 2));
  const bWords = new Set(normalizedText(b).split(/\s+/).filter((word) => word.length > 2));
  if (!aWords.size || !bWords.size) return 0;
  let overlap = 0;
  for (const word of aWords) {
    if (bWords.has(word)) overlap += 1;
  }
  return overlap / Math.max(aWords.size, bWords.size);
}
