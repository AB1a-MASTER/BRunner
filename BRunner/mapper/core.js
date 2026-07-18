export const MapperCoreVersion = "0.1.0";
export const MapperSchemaVersion = 1;

export const MapperPersistenceLimits = Object.freeze({
  maxTextLength: 480,
  maxTokenLength: 120,
  maxPathLength: 4096,
  maxLocatorValueLength: 1000,
  maxLocatorsPerComponent: 32,
  maxShadowPathDepth: 256,
  maxCapabilities: 16,
  maxEvidenceLabels: 8,
  maxEvidenceLabelLength: 80,
  maxRecordEntries: 32,
  maxRecordDepth: 3,
  maxNestedArrayItems: 100,
  maxNestedRecordDepth: 8,
  maxComponentsPerMap: 2000,
  maxResolverAttemptsPerMap: 100,
  maxHistoricalLinksPerComponent: 20,
});

export const MapperModes = Object.freeze({
  Automatic: "automatic",
  Explicit: "explicit",
});

export const MapperCaptureModes = Object.freeze({
  StaticBounded: "static_bounded",
});

export const MapperComponentLayers = Object.freeze({
  Static: "static",
  Dynamic: "dynamic",
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
    siteOverrides: normalizeMapperOverrides(settings?.siteOverrides),
    pageOverrides: normalizeMapperOverrides(settings?.pageOverrides),
  };
}

export function normalizePageProfile(input = {}, settings = {}) {
  const url = typeof input === "string" ? input : input.url;
  const allowlist = normalizeStringList(settings?.queryAllowlist);

  try {
    const parsed = new URL(String(url || ""));
    const path = normalizePath(parsed.pathname);
    const query = createAllowlistedQuery(parsed.searchParams, allowlist);

    return {
      origin: parsed.origin,
      hostname: parsed.hostname,
      path,
      query,
      title: typeof input?.title === "string" ? input.title.trim() : "",
      siteKey: createSiteKey(parsed.hostname),
      pageKey: createPageKey(parsed.origin, parsed.hostname, path, query),
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

export function pageMapMatchesUrl(pageMap = {}, url = "", settings = {}) {
  const current = normalizePageProfile(url, settings);
  if (!current.pageKey || !current.origin) return false;

  if (pageMap.origin && pageMap.origin !== current.origin) return false;
  if (pageMap.siteKey && pageMap.siteKey !== current.siteKey) return false;
  if (pageMap.path && normalizePath(pageMap.path) !== current.path) {
    return false;
  }
  if (typeof pageMap.query === "string" && pageMap.query !== current.query) {
    return false;
  }
  if (
    isCollisionSafePageKey(pageMap.pageProfileKey) &&
    pageMap.pageProfileKey !== current.pageKey
  ) return false;

  const hasPersistedExactIdentity = Boolean(
    pageMap.origin && pageMap.path && typeof pageMap.query === "string",
  );
  if (pageMap.pageProfileKey && !hasPersistedExactIdentity && !isCollisionSafePageKey(pageMap.pageProfileKey)) {
    return false;
  }

  return true;
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
      ((typeof value.id === "string" && value.id.trim()) ||
        (typeof value.componentId === "string" && value.componentId.trim() &&
          typeof value.pageProfileKey === "string" && value.pageProfileKey.trim())),
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
  assertSupportedMapperSchemaVersion(state.mapperSchemaVersion, "workflow mapper state");
  return {
    mapperSchemaVersion: MapperSchemaVersion,
    mapperCoreVersion: String(state.mapperCoreVersion || MapperCoreVersion),
    workflowId: String(state.workflowId || ""),
    settings: normalizeMapperSettings(state.settings),
    maps: normalizePersistedPageMaps(state.maps),
    storage: createMapperStorageMetadata(state.storage),
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : "",
  };
}

export function deserializeWorkflowMapperState(state = {}) {
  if (!state || typeof state !== "object") return null;
  if (Number(state.mapperSchemaVersion) !== MapperSchemaVersion) return null;
  return serializeWorkflowMapperState(state);
}

function assertSupportedMapperSchemaVersion(version, label) {
  if (version === undefined || version === null || version === "") return;
  if (Number(version) === MapperSchemaVersion) return;
  const error = new TypeError(
    `Unsupported ${label} schema version: ${String(version)}.`,
  );
  error.code = "mapper_schema_unsupported";
  throw error;
}

function normalizePersistedPageMaps(maps = []) {
  return (Array.isArray(maps) ? maps : [])
    .map((map) => normalizePersistedPageMap(map))
    .filter(Boolean);
}

function normalizePersistedPageMap(map = null) {
  if (!isPlainRecord(map)) return null;
  if (
    (map.schemaVersion !== undefined && Number(map.schemaVersion) !== MapperSchemaVersion) ||
    (map.mapperSchemaVersion !== undefined &&
      Number(map.mapperSchemaVersion) !== MapperSchemaVersion)
  ) {
    return null;
  }

  const normalized = {};
  copyPersistedNumber(map, normalized, "schemaVersion", 0, 1000);
  copyPersistedNumber(map, normalized, "mapperSchemaVersion", 0, 1000);
  copyPersistedText(map, normalized, "mapVersionId");
  copyPersistedText(map, normalized, "siteKey");
  copyPersistedText(map, normalized, "pageProfileKey");
  copyPersistedText(map, normalized, "pageKey");
  copyPersistedText(map, normalized, "pageId");
  copyPersistedText(map, normalized, "origin");
  copyPersistedText(map, normalized, "hostname");
  copyPersistedText(map, normalized, "path", MapperPersistenceLimits.maxPathLength);
  copyPersistedText(map, normalized, "query", MapperPersistenceLimits.maxPathLength);
  copyPersistedText(map, normalized, "title");
  copyPersistedText(map, normalized, "createdAt");
  copyPersistedText(map, normalized, "status", MapperPersistenceLimits.maxTokenLength);
  copyPersistedText(map, normalized, "classification", MapperPersistenceLimits.maxTokenLength);
  copyPersistedText(map, normalized, "fingerprintDigest");
  copyPersistedNumber(map, normalized, "componentCount", 0, MapperPersistenceLimits.maxComponentsPerMap);

  for (const key of [
    "architecture",
    "platformStructure",
    "layers",
    "reconciliation",
    "reliabilityMetrics",
    "diagnostics",
  ]) {
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      normalized[key] = normalizeBoundedJson(map[key]);
    }
  }
  if (Object.prototype.hasOwnProperty.call(map, "platformProfile")) {
    normalized.platformProfile = map.platformProfile === null
      ? null
      : normalizePlatformProfile(map.platformProfile);
  }
  if (Object.prototype.hasOwnProperty.call(map, "components")) {
    normalized.components = (Array.isArray(map.components) ? map.components : [])
      .map(normalizePersistedComponent)
      .filter(Boolean)
      .slice(0, MapperPersistenceLimits.maxComponentsPerMap);
  }
  if (Object.prototype.hasOwnProperty.call(map, "resolverAttempts")) {
    normalized.resolverAttempts = (Array.isArray(map.resolverAttempts)
      ? map.resolverAttempts
      : [])
      .filter(isPlainRecord)
      .slice(-MapperPersistenceLimits.maxResolverAttemptsPerMap)
      .map((attempt) => normalizeRuntimeResolutionOutcome(
        attempt,
        boundedText(attempt.createdAt),
      ));
  }
  return normalized;
}

function normalizePersistedComponent(component = null) {
  if (!isPlainRecord(component)) return null;
  if (
    component.mapperSchemaVersion !== undefined &&
    Number(component.mapperSchemaVersion) !== MapperSchemaVersion
  ) return null;

  const normalized = {};
  copyPersistedNumber(component, normalized, "mapperSchemaVersion", 0, 1000);
  for (const key of [
    "componentId",
    "componentUid",
    "displayName",
    "siteKey",
    "pageProfileKey",
    "capturedMapVersionId",
    "createdAt",
    "updatedAt",
    "status",
    "action",
  ]) {
    copyPersistedText(component, normalized, key);
  }
  if (Object.prototype.hasOwnProperty.call(component, "mappingLayer")) {
    normalized.mappingLayer = normalizeComponentLayer(component.mappingLayer);
  }
  copyPersistedNumber(
    component,
    normalized,
    "captureOrder",
    0,
    MapperPersistenceLimits.maxComponentsPerMap,
  );
  if (Object.prototype.hasOwnProperty.call(component, "reviewRequired")) {
    normalized.reviewRequired = component.reviewRequired === true;
  }
  for (const key of ["reconciliationDecision", "identityConfirmation"]) {
    if (Object.prototype.hasOwnProperty.call(component, key)) {
      normalized[key] = normalizeBoundedJson(component[key]);
    }
  }
  if (Object.prototype.hasOwnProperty.call(component, "primaryLocator")) {
    normalized.primaryLocator = component.primaryLocator === null
      ? null
      : normalizeLocators([component.primaryLocator])[0] || null;
  }
  if (Object.prototype.hasOwnProperty.call(component, "fallbackLocators")) {
    normalized.fallbackLocators = normalizeLocators(component.fallbackLocators);
  }
  if (Object.prototype.hasOwnProperty.call(component, "fingerprint")) {
    normalized.fingerprint = normalizeFingerprint(component.fingerprint);
  }
  if (Object.prototype.hasOwnProperty.call(component, "expectedCapabilities")) {
    normalized.expectedCapabilities = normalizeCapabilities(component.expectedCapabilities);
  }
  if (Object.prototype.hasOwnProperty.call(component, "historicalLinks")) {
    normalized.historicalLinks = (Array.isArray(component.historicalLinks)
      ? component.historicalLinks
      : [])
      .filter(isPlainRecord)
      .slice(-MapperPersistenceLimits.maxHistoricalLinksPerComponent)
      .map((link) => ({
        componentUid: boundedText(link.componentUid),
        mapVersionId: boundedText(link.mapVersionId),
        score: clampInteger(link.score, 0, 100, 0),
        status: boundedToken(link.status),
      }));
  }
  return normalized;
}

function copyPersistedText(source, target, key, maxLength = MapperPersistenceLimits.maxTextLength) {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return;
  target[key] = boundedText(source[key], maxLength);
}

function copyPersistedNumber(source, target, key, min, max) {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return;
  target[key] = clampInteger(source[key], min, max, min);
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
    generation: cleanValue(metadata.generation),
    savedAt: cleanValue(metadata.savedAt),
    loadedAt: cleanValue(metadata.loadedAt),
    lastWriter: cleanValue(metadata.lastWriter),
    conflictPolicy: cleanToken(metadata.conflictPolicy || "last_write_wins"),
    quotaPruned: metadata.quotaPruned === true,
    prunedMapCount: clampInteger(metadata.prunedMapCount, 0, 100000, 0),
    prunedComponentCount: clampInteger(metadata.prunedComponentCount, 0, 1000000, 0),
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
  const layerFacts = partitionComponentFactsByLayer(orderedFacts);
  const staticFacts = layerFacts[MapperComponentLayers.Static];
  const dynamicFacts = layerFacts[MapperComponentLayers.Dynamic];
  const materialMutationCount = Math.max(Number(page.materialMutationCount) || 0, 0);
  const platformProfile = normalizePlatformProfile(page.platformProfile);
  const frameSummary = normalizeFrameSummary(page.frameSummary);
  const scanDiagnostics = normalizeMapperScanDiagnostics(
    page.scanDiagnostics,
    policy.maxComponents,
  );
  const scanOverflow = scanDiagnostics.overflow;
  const pageMutationOverLimit = materialMutationCount > policy.materialMutationLimit;
  const staticOverLimit = staticFacts.length > policy.maxComponents;
  const dynamicOverLimit = dynamicFacts.length > policy.maxComponents;
  const dynamicRegionCount = dynamicFacts.length;
  const hasBoundedDynamicRegions = dynamicFacts.length > 0;
  const staticBlockedByUnboundedMutation = pageMutationOverLimit && !hasBoundedDynamicRegions;
  const hasPreviousStaticComponents = previousMapHasLayerComponents(previousMap, MapperComponentLayers.Static);
  const hasPreviousDynamicComponents = previousMapHasLayerComponents(previousMap, MapperComponentLayers.Dynamic);
  const staticSupported = (staticFacts.length > 0 || hasPreviousStaticComponents) &&
    !staticOverLimit &&
    !scanOverflow &&
    !staticBlockedByUnboundedMutation;
  const dynamicSupported = (dynamicFacts.length > 0 || hasPreviousDynamicComponents) &&
    !dynamicOverLimit &&
    !scanOverflow;
  const staticResult = staticSupported
    ? createComponentRecords({
        facts: staticFacts,
        profile,
        previousMap,
        now,
        layer: MapperComponentLayers.Static,
      })
    : {
        components: [],
        reconciliation: createEmptyReconciliation(previousMap),
      };
  const staticComponentIds = reservedStaticComponentIds(previousMap, staticResult.components);
  const dynamicResult = dynamicSupported
    ? createComponentRecords({
        facts: dynamicFacts,
        profile,
        previousMap,
        now,
        layer: MapperComponentLayers.Dynamic,
        reservedComponentIds: staticComponentIds,
      })
    : {
        components: [],
        reconciliation: createEmptyReconciliation(previousMap),
      };
  const components = sortComponentsByVisualOrder(staticResult.components.concat(dynamicResult.components));
  const hasMappedComponents = components.some((component) => {
    return component.status !== MapperComponentStatuses.Removed;
  });
  const classification = scanOverflow
    ? MapperPageClassifications.DynamicDeferred
    : !hasMappedComponents && (
      staticOverLimit ||
      dynamicOverLimit ||
      pageMutationOverLimit
    )
      ? MapperPageClassifications.DynamicDeferred
      : hasBoundedDynamicRegions || pageMutationOverLimit
        ? MapperPageClassifications.HybridDynamic
        : MapperPageClassifications.Static;
  const reconciliation = summarizeReconciliation(previousMap, components);
  const fingerprintDigest = digestSerializable(orderedFacts.map((fact) => fact.fingerprint));
  const refreshed = Boolean(previousMap?.mapVersionId) &&
    previousMap.fingerprintDigest &&
    previousMap.fingerprintDigest !== fingerprintDigest;
  const status = hasMappedComponents
    ? refreshed
      ? MapperMapStatuses.Refreshed
      : MapperMapStatuses.Ready
    : MapperMapStatuses.Unsupported;
  const reason = createMapClassificationReason({
    pageMutationOverLimit,
    hasBoundedDynamicRegions,
    staticOverLimit,
    dynamicOverLimit,
    hasMappedComponents,
    scanOverflow,
  });

  return {
    schemaVersion: MapperSchemaVersion,
    mapVersionId: createMapVersionId(profile, now, orderedFacts),
    siteKey: profile.siteKey,
    pageProfileKey: profile.pageKey,
    origin: profile.origin,
    hostname: profile.hostname,
    path: profile.path,
    query: profile.query,
    title: profile.title,
    createdAt: now,
    status,
    classification,
    architecture: {
      version: "mapper.architecture.v1",
      primaryLayer: MapperComponentLayers.Static,
      dynamicLayer: MapperComponentLayers.Dynamic,
      isolatedLayerReconciliation: true,
    },
    platformProfile,
    platformStructure: summarizePlatformStructure(components, platformProfile),
    componentCount: components.filter((component) => {
      return component.status !== MapperComponentStatuses.Removed;
    }).length,
    fingerprintDigest,
    components,
    layers: {
      [MapperComponentLayers.Static]: createMapLayerSummary({
        layer: MapperComponentLayers.Static,
        facts: staticFacts,
        components: staticResult.components,
        overLimit: staticOverLimit,
        blockedByUnboundedMutation: staticBlockedByUnboundedMutation,
        scanOverflow,
      }),
      [MapperComponentLayers.Dynamic]: createMapLayerSummary({
        layer: MapperComponentLayers.Dynamic,
        facts: dynamicFacts,
        components: dynamicResult.components,
        overLimit: dynamicOverLimit,
        blockedByUnboundedMutation: false,
        scanOverflow,
      }),
    },
    reconciliation,
    reliabilityMetrics: reconciliation.reliabilityMetrics,
    diagnostics: {
      scoringProfile: MapperScoringProfile.version,
      materialMutationCount,
      maxComponents: policy.maxComponents,
      platformProfileFamily: platformProfile.family,
      frameSummary,
      staticComponentCount: staticFacts.length,
      dynamicComponentCount: dynamicFacts.length,
      dynamicRegionCount,
      loadedContentOnly: classification === MapperPageClassifications.HybridDynamic,
      scanOverflow,
      scanSampledComponentCount: scanDiagnostics.sampledComponentCount,
      scanCandidateCount: scanDiagnostics.candidateCount,
      scanCandidateCountIsLowerBound: scanDiagnostics.candidateCountIsLowerBound,
      scanReason: scanDiagnostics.reason,
      scanOverflowKind: scanDiagnostics.overflowKind,
      maxFrameContexts: scanDiagnostics.maxFrameContexts,
      discoveredFrameContextCount: scanDiagnostics.discoveredFrameContextCount,
      processedFrameContextCount: scanDiagnostics.processedFrameContextCount,
      reachableFrameContextCount: scanDiagnostics.reachableFrameContextCount,
      frameContextOverflow: scanDiagnostics.frameContextOverflow,
      frameScanIncomplete: scanDiagnostics.frameScanIncomplete,
      accessibleFramePathsComplete: scanDiagnostics.accessibleFramePathsComplete,
      firstOmittedFramePath: scanDiagnostics.firstOmittedFramePath,
      reason,
    },
  };
}

export function scanPage(options = {}) {
  return buildStaticPageMap(options);
}

export function refreshPageMap({
  page = {},
  componentFacts = [],
  settings = {},
  previousMap = null,
  now = new Date().toISOString(),
} = {}) {
  return buildStaticPageMap({
    page,
    componentFacts,
    settings,
    previousMap,
    now,
  });
}

export function getPageMap(workflowState = null, pageRef = {}) {
  const maps = Array.isArray(workflowState?.maps) ? workflowState.maps : [];
  const reference = typeof pageRef === "string"
    ? { pageProfileKey: pageRef }
    : pageRef || {};
  if (reference.mapVersionId) {
    return maps.find((map) => {
      if (map.mapVersionId !== reference.mapVersionId) return false;
      if (reference.pageProfileKey && map.pageProfileKey !== reference.pageProfileKey) return false;
      if (reference.siteKey && map.siteKey !== reference.siteKey) return false;
      return true;
    }) || null;
  }
  const matching = maps.filter((map) => {
    if (reference.pageProfileKey && map.pageProfileKey !== reference.pageProfileKey) return false;
    if (reference.siteKey && map.siteKey !== reference.siteKey) return false;
    return true;
  });
  return matching.at(-1) || null;
}

export function createComponentRef(pageMap = null, componentId = "", options = {}) {
  if (!pageMap || !Array.isArray(pageMap.components)) return null;
  const id = String(componentId || "").trim();
  if (!id) return null;
  const component = pageMap.components.find((record) => {
    return record.componentId === id || record.componentUid === id;
  });
  if (!component || component.status === MapperComponentStatuses.Removed) return null;
  return createComponentRefFromRecord(component, {
    workflowId: options.workflowId || "",
    siteKey: pageMap.siteKey || component.siteKey || "",
    pageProfileKey: pageMap.pageProfileKey || component.pageProfileKey || "",
    mapVersionId: pageMap.mapVersionId || component.capturedMapVersionId || "",
  });
}

export function resolveComponent({
  pageMap = null,
  componentRef = null,
  candidateFacts = [],
  requirements = {},
} = {}) {
  if (!isComponentRef(componentRef)) {
    return createResolutionResult(MapperResolverStates.NotFound, {
      reason: "invalid_component_ref",
    });
  }
  if (!pageMap || !Array.isArray(pageMap.components)) {
    return createResolutionResult(MapperResolverStates.NotFound, {
      reason: "page_map_missing",
    });
  }
  if (
    componentRef.pageProfileKey &&
    pageMap.pageProfileKey &&
    componentRef.pageProfileKey !== pageMap.pageProfileKey
  ) {
    return createResolutionResult(MapperResolverStates.MapStale, {
      reason: "page_profile_mismatch",
    });
  }
  if (
    componentRef.siteKey &&
    pageMap.siteKey &&
    componentRef.siteKey !== pageMap.siteKey
  ) {
    return createResolutionResult(MapperResolverStates.MapStale, {
      reason: "site_key_mismatch",
    });
  }

  const component = findComponentForRef(pageMap, componentRef);
  if (!component || component.status === MapperComponentStatuses.Removed) {
    const versionChanged = Boolean(
      componentRef.capturedMapVersionId &&
        pageMap.mapVersionId &&
        componentRef.capturedMapVersionId !== pageMap.mapVersionId,
    );
    return createResolutionResult(
      versionChanged ? MapperResolverStates.MapStale : MapperResolverStates.NotFound,
      { reason: versionChanged ? "component_missing_after_refresh" : "component_record_missing" },
    );
  }

  return resolveMappedComponent(component, candidateFacts, {
    ...requirements,
    action: requirements.action || requirements.capability || component.action || "",
    pageClassification: pageMap.classification,
  });
}

export function revalidateComponent(options = {}) {
  return {
    ...resolveComponent(options),
    operation: "revalidate",
  };
}

function findComponentForRef(pageMap = {}, componentRef = {}) {
  const expectedLayer = cleanToken(componentRef.mappingLayer);
  return (pageMap.components || [])
    .filter((component) => {
      return !expectedLayer || componentMappingLayer(component) === expectedLayer;
    })
    .find((component) => {
      return component.componentId === componentRef.componentId ||
        component.componentUid === componentRef.componentUid ||
        (component.historicalLinks || []).some((link) => {
          return link.componentUid && link.componentUid === componentRef.componentUid;
        });
    }) || null;
}

function partitionComponentFactsByLayer(facts = []) {
  return facts.reduce((layers, fact) => {
    const layer = normalizeComponentLayer(fact.mappingLayer);
    layers[layer].push(fact);
    return layers;
  }, {
    [MapperComponentLayers.Static]: [],
    [MapperComponentLayers.Dynamic]: [],
  });
}

function reservedStaticComponentIds(previousMap = null, currentStaticComponents = []) {
  const reserved = new Set(currentStaticComponents
    .map((component) => component.componentId)
    .filter(Boolean));
  (Array.isArray(previousMap?.components) ? previousMap.components : [])
    .filter((component) => componentMappingLayer(component) === MapperComponentLayers.Static)
    .forEach((component) => {
      if (component.componentId) reserved.add(component.componentId);
    });
  return reserved;
}

function previousMapHasLayerComponents(previousMap = null, layer = MapperComponentLayers.Static) {
  return (Array.isArray(previousMap?.components) ? previousMap.components : [])
    .some((component) => {
      return component.status !== MapperComponentStatuses.Removed &&
        componentMappingLayer(component) === layer;
    });
}

function createMapLayerSummary({
  layer = MapperComponentLayers.Static,
  facts = [],
  components = [],
  overLimit = false,
  blockedByUnboundedMutation = false,
  scanOverflow = false,
} = {}) {
  const liveComponents = components.filter((component) => {
    return component.status !== MapperComponentStatuses.Removed;
  });
  const layerDeferred = overLimit || blockedByUnboundedMutation;
  return {
    version: "mapper.layer.v1",
    layer,
    status: scanOverflow
      ? "deferred"
      : facts.length
        ? layerDeferred
          ? "deferred"
          : "ready"
        : "empty",
    reason: scanOverflow
      ? "component_scan_overflow"
      : overLimit
        ? `${layer}_component_limit_exceeded`
        : blockedByUnboundedMutation
          ? "unbounded_page_mutation"
          : "",
    factCount: facts.length,
    componentCount: liveComponents.length,
    removedCount: components.length - liveComponents.length,
  };
}

function createMapClassificationReason({
  pageMutationOverLimit = false,
  hasBoundedDynamicRegions = false,
  staticOverLimit = false,
  dynamicOverLimit = false,
  hasMappedComponents = false,
  scanOverflow = false,
} = {}) {
  if (scanOverflow) return "component_scan_overflow";
  if (staticOverLimit && !hasMappedComponents) return "static_component_limit_exceeded";
  if (dynamicOverLimit && !hasMappedComponents) return "dynamic_component_limit_exceeded";
  if (pageMutationOverLimit && !hasBoundedDynamicRegions && !hasMappedComponents) {
    return "material_mutation_limit_exceeded";
  }
  if (pageMutationOverLimit && hasBoundedDynamicRegions) return "bounded_dynamic_regions";
  if (dynamicOverLimit) return "dynamic_component_limit_exceeded";
  if (staticOverLimit) return "static_component_limit_exceeded";
  return "";
}

function normalizeComponentLayer(value = "") {
  return value === MapperComponentLayers.Dynamic
    ? MapperComponentLayers.Dynamic
    : MapperComponentLayers.Static;
}

function componentMappingLayer(record = {}) {
  return normalizeComponentLayer(
    record.mappingLayer ||
      record.mapperLayer ||
      inferComponentLayerFromFingerprint(record.fingerprint || record),
  );
}

function inferComponentLayerFromFingerprint(fingerprint = {}) {
  const structural = fingerprint?.structural || {};
  const region = structural.regionDynamics || fingerprint.regionDynamics || {};
  const repeat = structural.repeatScope || fingerprint.repeatScope || {};
  const scope = structural.platformScope || fingerprint.platformScope || {};
  const classification = cleanToken(region.classification);
  if (["dynamic", "loaded_window", "ephemeral_context"].includes(classification)) {
    return MapperComponentLayers.Dynamic;
  }
  if (repeat.loadedContentOnly === true) return MapperComponentLayers.Dynamic;
  if (["loaded_window", "ephemeral"].includes(cleanToken(scope.durability))) {
    return MapperComponentLayers.Dynamic;
  }
  if (cleanToken(scope.dynamicKind)) return MapperComponentLayers.Dynamic;
  return MapperComponentLayers.Static;
}

function componentLayersCompatible(expected = {}, actual = {}) {
  return componentMappingLayer(expected) === componentMappingLayer(actual);
}

function summarizePlatformStructure(components = [], profile = {}) {
  const liveComponents = sortComponentsByVisualOrder(components).filter((component) => {
    return component.status !== MapperComponentStatuses.Removed;
  });
  const scopedFamily = liveComponents
    .map((component) => component.fingerprint?.structural?.platformScope?.family)
    .find((family) => family && family !== "generic");
  const family = profile?.family && profile.family !== "generic" ? profile.family : scopedFamily;
  if (!family) return null;
  const majorMap = new Map();

  liveComponents.forEach((component) => {
    const scope = component.fingerprint?.structural?.platformScope || {};
    if (!scope.majorRegion) return;
    if (!majorMap.has(scope.majorRegion)) {
      majorMap.set(scope.majorRegion, {
        id: scope.majorRegion,
        path: scope.majorRegionPath || "",
        componentCount: 0,
        subregions: new Map(),
      });
    }
    const major = majorMap.get(scope.majorRegion);
    major.componentCount += 1;
    const subregionId = scope.subregion || scope.region || "content";
    if (!major.subregions.has(subregionId)) {
      major.subregions.set(subregionId, {
        id: subregionId,
        path: scope.subregionPath || "",
        componentCount: 0,
        templates: new Map(),
      });
    }
    const subregion = major.subregions.get(subregionId);
    subregion.componentCount += 1;
    if (!scope.templateKind) return;
    const templateId = `${scope.templateKind}:${scope.templatePart || "content"}`;
    if (!subregion.templates.has(templateId)) {
      subregion.templates.set(templateId, {
        kind: scope.templateKind,
        part: scope.templatePart || "content",
        componentCount: 0,
        records: new Set(),
      });
    }
    const template = subregion.templates.get(templateId);
    template.componentCount += 1;
    template.records.add(scope.containerId || scope.loadedWindowIndex || "pattern");
  });

  return {
    version: "mapper.platform_structure.v1",
    family,
    majorRegions: Array.from(majorMap.values()).map((major) => ({
      id: major.id,
      path: major.path,
      componentCount: major.componentCount,
      subregions: Array.from(major.subregions.values()).map((subregion) => ({
        id: subregion.id,
        path: subregion.path,
        componentCount: subregion.componentCount,
        templates: Array.from(subregion.templates.values()).map((template) => ({
          kind: template.kind,
          part: template.part,
          componentCount: template.componentCount,
          recordCount: template.records.size,
        })),
      })),
    })),
  };
}

export function createComponentRefFromRecord(component = {}, context = {}) {
  const componentId = String(component.componentId || "");
  const pageProfileKey = String(context.pageProfileKey || component.pageProfileKey || "");
  const capturedMapVersionId = String(
    context.mapVersionId || component.capturedMapVersionId || "",
  );
  return {
    schema: "mapper.component_ref.v1",
    mapperSchemaVersion: MapperSchemaVersion,
    id: `${pageProfileKey}:${componentId}`,
    workflowId: String(context.workflowId || component.workflowId || ""),
    componentId,
    componentUid: String(component.componentUid || ""),
    mappingLayer: componentMappingLayer(component),
    siteKey: String(context.siteKey || component.siteKey || ""),
    pageProfileKey,
    capturedMapVersionId,
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
  if (
    frameScope.access === "cross_origin" &&
    frameScope.extensionAccessible !== true
  ) {
    return createResolutionResult(MapperResolverStates.ProtectedUnsupported, {
      reason: "cross_origin_frame_unreachable",
      component,
    });
  }
  if (
    frameScope.access === "cross_origin" &&
    frameScope.identityAmbiguous === true
  ) {
    return createResolutionResult(MapperResolverStates.Ambiguous, {
      reason: "cross_origin_frame_context_ambiguous",
      component,
    });
  }

  const liveFrameScopes = candidateFacts
    .map((candidate) => candidate?.fingerprint?.structural?.frameScope || {})
    .filter((scope) => scope && typeof scope === "object");
  if (
    frameScope.access === "cross_origin" &&
    liveFrameScopes.some((scope) => crossOriginFrameContextConflicts(frameScope, scope))
  ) {
    return createResolutionResult(MapperResolverStates.Ambiguous, {
      reason: "cross_origin_frame_context_ambiguous",
      component,
    });
  }

  const matchingAccessibleFramePaths = Array.isArray(options.accessibleFramePaths)
    ? new Set(options.accessibleFramePaths
      .filter((path) => framePathMatchesScope(frameScope, path))
      .map(cleanValue))
    : null;
  if (
    frameScope.access === "cross_origin" &&
    matchingAccessibleFramePaths?.size > 1
  ) {
    return createResolutionResult(MapperResolverStates.Ambiguous, {
      reason: "cross_origin_frame_context_ambiguous",
      component,
    });
  }
  if (
    frameScope.access === "cross_origin" &&
    frameScope.extensionAccessible === true &&
    matchingAccessibleFramePaths?.size === 0
  ) {
    return createResolutionResult(MapperResolverStates.ProtectedUnsupported, {
      reason: "cross_origin_frame_unreachable",
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
    return componentLayersCompatible(component, candidate) &&
      repeatScopesCompatible(
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
  const normalizedOutcome = normalizeRuntimeResolutionOutcome(outcome, now);
  const reliabilityMetrics = updateRuntimeReliabilityMetrics(
    pageMap.reliabilityMetrics ||
      pageMap.reconciliation?.reliabilityMetrics ||
      createReliabilityMetrics(null, pageMap.components || [], pageMap.reconciliation || null),
    normalizedOutcome,
  );
  const resolverAttempts = [
    ...(Array.isArray(pageMap.resolverAttempts) ? pageMap.resolverAttempts : []),
    normalizedOutcome,
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

  if (!componentLayersCompatible(component, candidate)) {
    return {
      score: 0,
      evidence: ["mapping_layer_contradiction"],
      disqualified: true,
      reason: "mapping_layer_mismatch",
    };
  }

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

function createComponentRecords({
  facts,
  profile,
  previousMap,
  now,
  layer = MapperComponentLayers.Static,
  reservedComponentIds = new Set(),
}) {
  const previousComponents = Array.isArray(previousMap?.components)
    ? previousMap.components.filter((component) => {
        return component.status !== MapperComponentStatuses.Removed &&
          componentMappingLayer(component) === layer;
      })
    : [];
  const previousByUid = new Map(previousComponents
    .map((component) => [component.componentUid, component]));
  const names = allocateComponentNames(facts, profile, {
    reservedNames: reservedComponentIds,
    collisionSuffix: layer === MapperComponentLayers.Dynamic ? "dynamic" : "",
  });
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

    const previousComponentId = previous?.componentId || "";
    const componentId = previousComponentId && !reservedComponentIds.has(previousComponentId)
      ? previousComponentId
      : names[index];
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
      mappingLayer: layer,
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
        evidence: normalizeEvidenceLabels(match.evidence),
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
      mappingLayer: layer,
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
    mappingLayer: fact.mappingLayer || inferComponentLayerFromFingerprint(fact.fingerprint || fact),
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
  summary.reliabilityMetrics = createReliabilityMetrics(previousMap, components, summary);
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
    reliabilityMetrics: createReliabilityMetrics(previousMap, [], null),
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
    evidence: normalizeEvidenceLabels(match.evidence),
  }).slice(0, 16);
}

function normalizeEvidenceLabels(evidence = []) {
  return normalizeStringList(evidence)
    .map((entry) => cleanToken(entry).slice(0, MapperPersistenceLimits.maxEvidenceLabelLength))
    .filter(Boolean)
    .slice(0, MapperPersistenceLimits.maxEvidenceLabels);
}

function createReliabilityMetrics(previousMap = null, components = [], summary = null) {
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

function normalizeRuntimeResolutionOutcome(outcome = {}, now = "") {
  const state = cleanToken(outcome.state || outcome.mapperState || "unresolved");
  const resolverLog = outcome.resolverLog && typeof outcome.resolverLog === "object"
    ? outcome.resolverLog
    : {};
  const selected = normalizeRuntimeCandidate(outcome.selected || resolverLog.selected);
  const runnerUp = normalizeRuntimeCandidate(outcome.runnerUp || resolverLog.runnerUp);
  const margin = Number.isFinite(Number(outcome.margin))
    ? Number(outcome.margin)
    : Number.isFinite(Number(resolverLog.margin))
      ? Number(resolverLog.margin)
      : selected && runnerUp
        ? selected.score - runnerUp.score
        : null;

  return {
    version: "mapper.runtime_resolution.v1",
    createdAt: boundedText(outcome.createdAt || now),
    action: boundedToken(outcome.action || resolverLog.action || ""),
    componentId: boundedText(outcome.componentId || resolverLog.componentId),
    componentUid: boundedText(outcome.componentUid || resolverLog.componentUid),
    pageProfileKey: boundedText(outcome.pageProfileKey),
    mapVersionId: boundedText(outcome.mapVersionId),
    state: boundedToken(state),
    reason: boundedToken(outcome.reason || outcome.mapperReason || resolverLog.reason),
    finalReason: boundedToken(outcome.finalReason),
    confidence: clampInteger(outcome.confidence ?? resolverLog.confidence, 0, 100, 0),
    margin,
    attemptCount: clampInteger(outcome.attemptCount ?? resolverLog.attemptCount, 0, 1000, 0),
    selected,
    runnerUp,
    evidence: normalizeEvidenceLabels(outcome.evidence || selected?.evidence || []),
    staleToResolved: outcome.staleToResolved === true,
  };
}

function normalizeRuntimeCandidate(candidate = null) {
  if (!candidate || typeof candidate !== "object") return null;
  return {
    rank: clampInteger(candidate.rank, 1, 100, 1),
    score: clampInteger(candidate.score, 0, 100, 0),
    evidence: normalizeEvidenceLabels(candidate.evidence),
    componentId: boundedText(candidate.componentId),
    componentUid: boundedText(candidate.componentUid),
    displayName: boundedText(candidate.displayName),
    primary: normalizeLocators(candidate.primary ? [candidate.primary] : [])[0] || null,
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
    action: boundedText(fact.action, MapperPersistenceLimits.maxTokenLength),
    componentId: boundedText(fact.componentId),
    componentUid: boundedText(fact.componentUid),
    mappingLayer: normalizeComponentLayer(fact.mappingLayer || fact.mapperLayer || inferComponentLayerFromFingerprint(fingerprint)),
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
      majorRegion: "",
      subregion: "",
      templateKind: "",
      templatePart: "",
      majorRegionPath: "",
      subregionPath: "",
      repeatedRecordPath: "",
      majorRegionDepth: null,
      subregionDepth: null,
      repeatedRecordDepth: null,
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
    majorRegion: cleanToken(scope?.majorRegion).slice(0, 80),
    subregion: cleanToken(scope?.subregion || scope?.region).slice(0, 80),
    templateKind: cleanToken(scope?.templateKind || scope?.repeatedKind).slice(0, 80),
    templatePart: cleanToken(scope?.templatePart).slice(0, 80),
    majorRegionPath: cleanValue(scope?.majorRegionPath).slice(0, 480),
    subregionPath: cleanValue(scope?.subregionPath).slice(0, 480),
    repeatedRecordPath: cleanValue(scope?.repeatedRecordPath).slice(0, 480),
    majorRegionDepth: scope?.majorRegionDepth === undefined || scope?.majorRegionDepth === null
      ? null
      : clampInteger(scope.majorRegionDepth, 0, 40, 0),
    subregionDepth: scope?.subregionDepth === undefined || scope?.subregionDepth === null
      ? null
      : clampInteger(scope.subregionDepth, 0, 40, 0),
    repeatedRecordDepth: scope?.repeatedRecordDepth === undefined || scope?.repeatedRecordDepth === null
      ? null
      : clampInteger(scope.repeatedRecordDepth, 0, 40, 0),
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
    contextKey: cleanToken(scope?.contextKey).slice(0, 120),
    frameContextId: cleanToken(scope?.frameContextId).slice(0, 160),
    frameIdHint: scope?.frameIdHint !== undefined && scope?.frameIdHint !== null &&
      Number.isInteger(Number(scope.frameIdHint))
      ? clampInteger(scope.frameIdHint, 0, 1000000, 0)
      : null,
    contextMultiplicity: clampInteger(scope?.contextMultiplicity, 1, 100, 1),
    identityAmbiguous: scope?.identityAmbiguous === true,
    extensionAccessible: scope?.extensionAccessible === true,
  };
}

function normalizeFrameSummary(summary = {}) {
  const maxFrameContexts = clampInteger(summary?.maxFrameContexts, 1, 100, 100);
  const frameScanIncomplete = summary?.frameScanIncomplete === true;
  return {
    sameOriginFrames: clampInteger(summary?.sameOriginFrames, 0, 100, 0),
    crossOriginFrames: clampInteger(summary?.crossOriginFrames, 0, 100, 0),
    accessibleFramePaths: normalizeStringList(summary?.accessibleFramePaths).slice(0, 100),
    incompleteFramePaths: normalizeStringList(summary?.incompleteFramePaths).slice(0, 1),
    maxFrameContexts,
    discoveredFrameContextCount: clampInteger(
      summary?.discoveredFrameContextCount,
      0,
      1000000,
      0,
    ),
    processedFrameContextCount: clampInteger(
      summary?.processedFrameContextCount,
      0,
      maxFrameContexts,
      0,
    ),
    reachableFrameContextCount: clampInteger(
      summary?.reachableFrameContextCount,
      0,
      maxFrameContexts,
      0,
    ),
    frameContextOverflow: summary?.frameContextOverflow === true,
    frameScanIncomplete,
    accessibleFramePathsComplete: summary?.accessibleFramePathsComplete !== false &&
      !frameScanIncomplete,
  };
}

function normalizeMapperScanDiagnostics(diagnostics = {}, fallbackMaxComponents = 500) {
  const maxComponents = clampInteger(
    diagnostics?.maxComponents,
    1,
    2000,
    fallbackMaxComponents,
  );
  const sampledComponentCount = clampInteger(
    diagnostics?.sampledComponentCount,
    0,
    maxComponents,
    0,
  );
  const overflow = diagnostics?.overflow === true;
  const candidateCount = clampInteger(
    diagnostics?.candidateCount,
    0,
    maxComponents + 1,
    overflow ? maxComponents + 1 : sampledComponentCount,
  );
  const maxFrameContexts = clampInteger(diagnostics?.maxFrameContexts, 1, 100, 100);
  const frameScanIncomplete = diagnostics?.frameScanIncomplete === true;
  return {
    maxComponents,
    sampledComponentCount,
    candidateCount: overflow
      ? Math.max(candidateCount, Math.min(maxComponents + 1, sampledComponentCount + 1))
      : candidateCount,
    candidateCountIsLowerBound: overflow || diagnostics?.candidateCountIsLowerBound === true,
    overflow,
    reason: cleanToken(diagnostics?.reason).slice(0, 80),
    overflowKind: cleanToken(diagnostics?.overflowKind).slice(0, 120),
    maxFrameContexts,
    discoveredFrameContextCount: clampInteger(
      diagnostics?.discoveredFrameContextCount,
      0,
      1000000,
      0,
    ),
    processedFrameContextCount: clampInteger(
      diagnostics?.processedFrameContextCount,
      0,
      maxFrameContexts,
      0,
    ),
    reachableFrameContextCount: clampInteger(
      diagnostics?.reachableFrameContextCount,
      0,
      maxFrameContexts,
      0,
    ),
    frameContextOverflow: diagnostics?.frameContextOverflow === true,
    frameScanIncomplete,
    accessibleFramePathsComplete: diagnostics?.accessibleFramePathsComplete !== false &&
      !frameScanIncomplete,
    firstOmittedFramePath: cleanValue(diagnostics?.firstOmittedFramePath).slice(0, 480),
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
      role: boundedToken(semantic.role || fingerprint.role),
      accessibleName: boundedText(
        semantic.accessibleName || semantic.ariaLabel || fingerprint.ariaLabel,
      ),
      altText: boundedText(semantic.altText || fingerprint.altText),
      labelText: boundedText(semantic.labelText || fingerprint.labelText),
      stableText: boundedText(semantic.stableText || fingerprint.text),
      placeholder: boundedText(semantic.placeholder || fingerprint.placeholder),
      title: boundedText(semantic.title || fingerprint.title),
      name: boundedToken(semantic.name || fingerprint.name),
      inputType: boundedToken(semantic.inputType || fingerprint.type),
      stableAttributes: normalizeBoundedRecord(semantic.stableAttributes),
    },
    structural: {
      ancestorTokens: normalizeBoundedStringList(
        structural.ancestorTokens || fingerprint.ancestorTokens,
        { maxItems: 3, maxLength: 160 },
      ),
      platformScope: normalizePlatformScope(structural.platformScope || fingerprint.platformScope),
      frameScope: normalizeFrameScope(structural.frameScope || fingerprint.frameScope),
      repeatScope: normalizeRepeatScope(structural.repeatScope || fingerprint.repeatScope),
      regionDynamics: normalizeRegionDynamics(structural.regionDynamics || fingerprint.regionDynamics),
      formName: boundedToken(structural.formName || fingerprint.formName),
      relativeIndex: structural.relativeIndex !== undefined &&
        structural.relativeIndex !== null &&
        Number.isFinite(Number(structural.relativeIndex))
        ? Number(structural.relativeIndex)
        : null,
      nearbyLabel: boundedText(structural.nearbyLabel || fingerprint.nearbyText),
    },
    technical: {
      tag: boundedToken(technical.tag || fingerprint.tag),
      id: boundedToken(technical.id || fingerprint.id),
      classes: normalizeBoundedStringList(technical.classes || fingerprint.classes, {
        maxItems: 8,
        maxLength: MapperPersistenceLimits.maxTokenLength,
      }),
      domPath: boundedText(
        technical.domPath || fingerprint.domPath,
        MapperPersistenceLimits.maxPathLength,
      ),
      shadowPath: normalizeShadowPath(technical.shadowPath || fingerprint.shadowPath),
    },
    behavioral: {
      capabilities: normalizeCapabilities(behavioral.capabilities),
      href: boundedText(
        behavioral.href || fingerprint.href,
        MapperPersistenceLimits.maxLocatorValueLength,
      ),
      state: normalizeBoundedRecord(behavioral.state),
      dynamicContext: behavioral.dynamicContext === true,
    },
    visual: {
      bounds: normalizeBounds(visual.bounds || fingerprint.bounds),
      viewportBounds: normalizeBounds(visual.viewportBounds),
      documentBounds: normalizeBounds(visual.documentBounds),
      viewport: normalizeBoundedRecord(visual.viewport),
    },
  };
}

function normalizeLocators(locators = []) {
  return (Array.isArray(locators) ? locators : [])
    .map((locator) => ({
      strategy: boundedToken(locator?.strategy),
      value: boundedText(locator?.value, MapperPersistenceLimits.maxLocatorValueLength),
      family: boundedToken(locator?.family),
      reliability: clampInteger(locator?.reliability, 0, 100, 50),
      selectedAtCapture: locator?.selectedAtCapture === true,
    }))
    .filter((locator) => locator.strategy && locator.value)
    .slice(0, MapperPersistenceLimits.maxLocatorsPerComponent);
}

function normalizeCapabilities(capabilities = []) {
  return normalizeBoundedStringList(capabilities, {
    maxItems: MapperPersistenceLimits.maxCapabilities,
    maxLength: MapperPersistenceLimits.maxTokenLength,
  });
}

function normalizeShadowPath(path = []) {
  return (Array.isArray(path) ? path : [])
    .map((boundary) => ({
      hostPath: boundedText(boundary?.hostPath, MapperPersistenceLimits.maxPathLength),
      innerPath: boundedText(boundary?.innerPath, MapperPersistenceLimits.maxPathLength),
    }))
    .filter((boundary) => boundary.hostPath && boundary.innerPath)
    .slice(0, MapperPersistenceLimits.maxShadowPathDepth);
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

function allocateComponentNames(facts, profile, options = {}) {
  const reservedNames = options.reservedNames instanceof Set
    ? options.reservedNames
    : new Set(options.reservedNames || []);
  const collisionSuffix = toIdentifier(options.collisionSuffix || "");
  const baseCounts = new Map();
  const nameParts = facts.map((fact) => ({
    site: profile.siteKey || "site",
    page: pageNameFromProfile(profile),
    component: toIdentifier(componentSeed(fact)) || "component",
    context: componentNamingContextTokens(fact.fingerprint.structural)
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
  reservedNames.forEach((name) => {
    if (name) used.set(name, Math.max(used.get(name) || 0, 1));
  });
  return contextualNames.map((name) => {
    const count = (used.get(name) || 0) + 1;
    if (count > 1 && collisionSuffix) {
      const suffixed = `${name}_${collisionSuffix}`;
      const suffixCount = (used.get(suffixed) || 0) + 1;
      used.set(suffixed, suffixCount);
      used.set(name, count);
      return suffixCount === 1 ? suffixed : `${suffixed}_${suffixCount}`;
    }
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

function createPageKey(origin = "", hostname = "", path = "/", query = "") {
  const site = createSiteKey(hostname);
  const page = pageNameFromPath(path).slice(0, 160);
  const identity = digestExactPageIdentity(origin, path, query);
  return `${site}::${page}::identity_v2_${identity}`;
}

function createAllowlistedQuery(searchParams = new URLSearchParams(), allowlist = []) {
  const query = new URLSearchParams();
  [...allowlist].sort().forEach((key) => {
    searchParams.getAll(key).forEach((value) => query.append(key, value));
  });
  return query.toString();
}

function digestExactPageIdentity(origin = "", path = "/", query = "") {
  const value = JSON.stringify([
    String(origin || ""),
    normalizePath(path),
    String(query || ""),
  ]);
  return `${fnv1a64(value)}${fnv1a64(value, 0x84222325cbf29ce4n, true)}`;
}

function fnv1a64(value = "", offset = 0xcbf29ce484222325n, reverse = false) {
  let hash = offset;
  const text = String(value || "");
  let index = reverse ? text.length - 1 : 0;
  const end = reverse ? -1 : text.length;
  const direction = reverse ? -1 : 1;
  for (; index !== end; index += direction) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function isCollisionSafePageKey(value = "") {
  return /::identity_v2_[0-9a-f]{32}$/.test(String(value || ""));
}

function pageNameFromProfile(profile = {}) {
  return pageNameFromPath(profile.path);
}

function pageNameFromPath(path = "/") {
  const value = normalizePath(path);
  if (value === "/") return "home";
  return toIdentifier(value.replace(/^\/+|\/+$/g, "").replace(/\//g, "_")) || "page";
}

function componentNamingContextTokens(structural = {}) {
  const scope = structural.platformScope || {};
  if (scope.family && scope.region) {
    return [
      `${scope.family} ${scope.subregion || scope.region}`,
      scope.containerId
        ? `${scope.family} container ${scope.containerId}`
        : scope.threadId
          ? `${scope.family} thread ${scope.threadId}`
          : scope.majorRegion
            ? `${scope.family} ${scope.majorRegion}`
            : "",
    ].filter(Boolean);
  }
  return collectStructuralTokens(structural);
}

function collectStructuralTokens(structural = {}) {
  const scope = structural.platformScope || {};
  const repeat = structural.repeatScope || {};
  return [
    scope.family && scope.majorRegion ? `${scope.family} ${scope.majorRegion}` : "",
    scope.family && (scope.subregion || scope.region) ? `${scope.family} ${scope.subregion || scope.region}` : "",
    scope.templateKind ? `${scope.family} template ${scope.templateKind}` : "",
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

  for (const field of ["majorRegion", "threadId", "containerId", "repeatedKind"]) {
    const expectedValue = cleanToken(expected?.[field]);
    if (expectedValue && cleanToken(actual?.[field]) !== expectedValue) return false;
  }

  return true;
}

function frameScopesCompatible(expected = {}, actual = {}) {
  const expectedPath = cleanValue(expected?.path || "top");
  const actualPath = cleanValue(actual?.path || "top");
  const expectedMultiplicity = Number(expected?.contextMultiplicity) || 1;
  const actualMultiplicity = Number(actual?.contextMultiplicity) || 1;
  if (expectedMultiplicity !== actualMultiplicity) return false;
  if (expected?.identityAmbiguous === true || actual?.identityAmbiguous === true) {
    return false;
  }
  if (expectedPath === actualPath) return true;
  const expectedContextKey = cleanToken(expected?.contextKey);
  return cleanToken(expected?.access) === "cross_origin" &&
    cleanToken(actual?.access) === "cross_origin" &&
    expectedContextKey &&
    cleanToken(actual?.contextKey) === expectedContextKey;
}

function framePathMatchesScope(scope = {}, path = "") {
  const expectedPath = cleanValue(scope?.path || "top");
  const actualPath = cleanValue(path);
  if (expectedPath === actualPath) return true;
  if (cleanToken(scope?.access) !== "cross_origin") return false;
  const contextKey = cleanToken(scope?.contextKey);
  if (!contextKey) return false;
  const contextPath = `isolated/${contextKey}`;
  return actualPath === contextPath || actualPath.startsWith(`${contextPath}/instance_`);
}

function crossOriginFrameContextConflicts(expected = {}, actual = {}) {
  if (
    cleanToken(expected?.access) !== "cross_origin" ||
    cleanToken(actual?.access) !== "cross_origin"
  ) {
    return false;
  }
  const expectedContextKey = cleanToken(expected?.contextKey);
  if (!expectedContextKey || cleanToken(actual?.contextKey) !== expectedContextKey) {
    return false;
  }
  return actual?.identityAmbiguous === true ||
    (Number(actual?.contextMultiplicity) || 1) !==
      (Number(expected?.contextMultiplicity) || 1);
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
  const value = String(path || "/");
  return value.startsWith("/") ? value : `/${value}`;
}

function normalizeStringList(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean))];
}

function normalizeBoundedStringList(
  value,
  {
    maxItems = MapperPersistenceLimits.maxCapabilities,
    maxLength = MapperPersistenceLimits.maxTextLength,
    tokens = false,
  } = {},
) {
  const normalize = tokens ? cleanToken : cleanValue;
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => normalize(item).slice(0, maxLength))
    .filter(Boolean))]
    .slice(0, maxItems);
}

function normalizeMapperOverrides(value) {
  const overrides = normalizeRecord(value);
  return Object.fromEntries(Object.entries(overrides).map(([key, override]) => {
    if (!override || typeof override !== "object" || Array.isArray(override)) {
      return [key, {}];
    }
    const normalized = {};
    if (override.enabled !== undefined) normalized.enabled = override.enabled !== false;
    if (Object.values(MapperModes).includes(override.mode)) normalized.mode = override.mode;
    if (override.maxComponents !== undefined) {
      normalized.maxComponents = clampInteger(override.maxComponents, 1, 2000, 500);
    }
    if (override.maxVersions !== undefined) {
      normalized.maxVersions = clampInteger(override.maxVersions, 1, 3, 3);
    }
    if (override.materialMutationLimit !== undefined) {
      normalized.materialMutationLimit = clampInteger(
        override.materialMutationLimit,
        1,
        500,
        50,
      );
    }
    if (override.queryAllowlist !== undefined) {
      normalized.queryAllowlist = normalizeStringList(override.queryAllowlist);
    }
    return [key, normalized];
  }));
}

function normalizeRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? structuredClone(value)
    : {};
}

function normalizeBoundedRecord(
  value,
  depth = 0,
) {
  if (!isPlainRecord(value) || depth >= MapperPersistenceLimits.maxRecordDepth) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, MapperPersistenceLimits.maxRecordEntries)
      .map(([key, entry]) => {
        const safeKey = boundedText(key, MapperPersistenceLimits.maxTokenLength);
        if (!safeKey) return null;
        if (isPlainRecord(entry)) {
          return [safeKey, normalizeBoundedRecord(entry, depth + 1)];
        }
        if (Array.isArray(entry)) {
          return [safeKey, normalizeBoundedStringList(entry)];
        }
        if (typeof entry === "number" || typeof entry === "boolean" || entry === null) {
          return [safeKey, entry];
        }
        return [safeKey, boundedText(entry)];
      })
      .filter(Boolean),
  );
}

function normalizeBoundedJson(value, depth = 0) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return boundedText(value);
  if (depth >= MapperPersistenceLimits.maxNestedRecordDepth) return null;
  if (Array.isArray(value)) {
    return value
      .slice(0, MapperPersistenceLimits.maxNestedArrayItems)
      .map((entry) => normalizeBoundedJson(entry, depth + 1));
  }
  if (!isPlainRecord(value)) return null;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, MapperPersistenceLimits.maxRecordEntries)
      .map(([key, entry]) => {
        const safeKey = boundedText(key, MapperPersistenceLimits.maxTokenLength);
        return safeKey
          ? [safeKey, normalizeBoundedJson(entry, depth + 1)]
          : null;
      })
      .filter(Boolean),
  );
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function cleanValue(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function boundedText(value, maxLength = MapperPersistenceLimits.maxTextLength) {
  return cleanValue(value).slice(0, maxLength);
}

function boundedToken(value, maxLength = MapperPersistenceLimits.maxTokenLength) {
  return cleanToken(value).slice(0, maxLength);
}

function cleanToken(value) {
  return toIdentifier(value);
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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
