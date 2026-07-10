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
  const dynamic = materialMutationCount > policy.materialMutationLimit;
  const overLimit = orderedFacts.length > policy.maxComponents;
  const classification = dynamic || overLimit
    ? MapperPageClassifications.DynamicDeferred
    : MapperPageClassifications.Static;
  const componentResult = classification === MapperPageClassifications.Static
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
    status: classification === MapperPageClassifications.Static
      ? refreshed
        ? MapperMapStatuses.Refreshed
        : MapperMapStatuses.Ready
      : MapperMapStatuses.Unsupported,
    classification,
    componentCount: componentResult.components.filter((component) => {
      return component.status !== MapperComponentStatuses.Removed;
    }).length,
    fingerprintDigest,
    components: componentResult.components,
    reconciliation: componentResult.reconciliation,
    diagnostics: {
      scoringProfile: MapperScoringProfile.version,
      materialMutationCount,
      maxComponents: policy.maxComponents,
      reason: dynamic
        ? "material_mutation_limit_exceeded"
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
  if (options.pageClassification === MapperPageClassifications.DynamicDeferred) {
    return createResolutionResult(MapperResolverStates.DynamicDeferred, {
      reason: "dynamic_deferred",
      component,
    });
  }

  const action = String(options.action || component.action || "");
  const candidates = candidateFacts
    .map((fact, index) => normalizeComponentFact(fact, index))
    .filter((fact) => isActionCompatible(fact.expectedCapabilities, action));

  if (!candidates.length) {
    return createResolutionResult(MapperResolverStates.NotFound, {
      reason: "no_compatible_candidates",
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

export function scoreCandidateAgainstComponent(component = {}, candidate = {}) {
  const expected = component.fingerprint || {};
  const actual = candidate.fingerprint || {};
  const evidence = [];
  let score = 0;

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
      reviewRequired: status === MapperComponentStatuses.Changed ||
        status === MapperComponentStatuses.Ambiguous,
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
      reviewRequired: true,
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
    const score = scoreCandidateAgainstComponent(exact, candidate).score;
    return {
      previous: exact,
      status: score >= 95
        ? MapperComponentStatuses.Same
        : MapperComponentStatuses.Changed,
      score,
    };
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
      status: MapperComponentStatuses.Ambiguous,
      score: best.score,
    };
  }

  if (best.score >= 80 && margin >= MapperScoringProfile.minimumMargin) {
    return {
      previous: best.component,
      status: MapperComponentStatuses.Changed,
      score: best.score,
    };
  }

  if (best.score >= 65 && margin >= MapperScoringProfile.minimumMargin) {
    return {
      previous: best.component,
      status: MapperComponentStatuses.Changed,
      score: best.score,
    };
  }

  return {
    previous: null,
    status: MapperComponentStatuses.New,
    score: best.score,
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
  };
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
      ancestorTokens: normalizeStringList(structural.ancestorTokens || fingerprint.ancestorTokens).slice(0, 2),
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
    },
    behavioral: {
      capabilities: normalizeCapabilities(behavioral.capabilities),
      href: cleanValue(behavioral.href || fingerprint.href),
      state: normalizeRecord(behavioral.state),
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
  return [
    ...(Array.isArray(structural.ancestorTokens) ? structural.ancestorTokens : []),
    structural.formName,
    structural.nearbyLabel,
  ].map(cleanValue).filter(Boolean);
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
