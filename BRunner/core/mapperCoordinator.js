import { createChromeMapStore } from "./mapStore.js";
import {
  buildStaticPageMap,
  createComponentRef as createPageComponentRef,
  createComponentRefFromRecord,
  createDefaultMapperSettings,
  getPageMap as getStoredPageMap,
  MapperResolverStates,
  MapperScoringProfile,
  normalizePageProfile,
  refreshPageMap as refreshStoredPageMap,
  recordMapperRuntimeResolution,
  resolveComponent as resolveStoredComponent,
  revalidateComponent as revalidateStoredComponent,
  scanPage as scanStoredPage,
} from "../mapper/core.js";

export function createMapperCoordinator({
  mapStore = createChromeMapStore(),
  clock = () => new Date().toISOString(),
} = {}) {
  async function reconcileRecordedStep(step = {}, options = {}) {
    if (!step?.mapperFact) return step;

    const workflowId = normalizeWorkflowId(
      options.workflowId ||
        step.workflowId ||
        options.sessionId ||
        "recording",
    );
    const settings = {
      ...createDefaultMapperSettings(),
      ...(options.settings || {}),
    };
    let reconciledStep = step;
    await mapStore.updateWorkflowMapperState(workflowId, (state, context = {}) => {
      const activeSettings = context.exists ? state.settings : settings;
      const pageProfile = normalizePageProfile(pageFromStep(step), activeSettings);
      const mapperFact = {
        ...step.mapperFact,
        siteKey: pageProfile.siteKey || step.mapperFact.siteKey || "",
        pageProfileKey: pageProfile.pageKey || step.mapperFact.pageProfileKey || "",
      };
      const incomingComponentRef = step.componentRef
        ? {
            ...step.componentRef,
            siteKey: mapperFact.siteKey,
            pageProfileKey: mapperFact.pageProfileKey,
          }
        : null;
      const previousMap = findPreviousPageMap(state, mapperFact);
      const effectiveSettings = effectiveMapperSettings(
        activeSettings,
        mapperFact,
        step.mapperFact.pageProfileKey,
      );
      if (effectiveSettings.mode === "explicit") {
        const component = findComponentForFact(previousMap || {}, mapperFact);
        const componentRef = component
          ? createComponentRefFromRecord(component, componentRefContext(workflowId, previousMap))
          : incomingComponentRef;
        reconciledStep = {
          ...step,
          mapperFact,
          ...(componentRef ? { componentRef } : {}),
          mapper: {
            schemaVersion: previousMap?.schemaVersion || 1,
            workflowId,
            mapVersionId: previousMap?.mapVersionId || "",
            siteKey: mapperFact.siteKey,
            pageProfileKey: mapperFact.pageProfileKey,
            classification: previousMap?.classification || "explicit_mapping_required",
            componentId: component?.componentId || "",
            mode: "explicit",
          },
        };
        return undefined;
      }

      const pageMap = attachIncomingFactLink(preserveRecordedComponentLocks(buildStaticPageMap({
        page: pageFromStep(step),
        componentFacts: collectPageFacts(previousMap, mapperFact),
        settings: activeSettings,
        previousMap,
        now: clock(),
      }), previousMap, mapperFact), mapperFact);
      const component = findComponentForFact(pageMap, mapperFact);
      const componentRef = component
        ? createComponentRefFromRecord(component, componentRefContext(workflowId, pageMap))
        : incomingComponentRef;
      reconciledStep = {
        ...step,
        mapperFact,
        ...(componentRef ? { componentRef } : {}),
        mapper: {
          schemaVersion: pageMap.schemaVersion,
          workflowId,
          mapVersionId: pageMap.mapVersionId,
          siteKey: pageMap.siteKey,
          pageProfileKey: pageMap.pageProfileKey,
          classification: pageMap.classification,
          componentId: componentRef?.componentId || "",
        },
      };
      return {
        ...state,
        workflowId,
        settings: activeSettings,
        maps: replacePageMap(state.maps || [], pageMap, activeSettings),
      };
    });

    return reconciledStep;
  }

  async function attachExecutionContext(step = {}) {
    if (!step?.componentRef) return step;
    const workflowId = step.mapper?.workflowId || step.workflowId || "";
    if (!workflowId) return step;
    if (
      step.componentRef.workflowId &&
      normalizeWorkflowId(step.componentRef.workflowId) !== normalizeWorkflowId(workflowId)
    ) {
      return {
        ...step,
        mapperContext: {
          state: MapperResolverStates.MapStale,
          reason: "workflow_mismatch",
          workflowId: normalizeWorkflowId(workflowId),
          componentRef: step.componentRef,
        },
      };
    }

    const state = await mapStore.getWorkflowMapperState(workflowId);
    const pageMap = findPageMapForComponent(state, step.componentRef);
    const component = findStoredComponent(pageMap, step.componentRef);
    if (!pageMap || !component) {
      return {
        ...step,
        mapperContext: {
          state: "not_found",
          reason: "component_record_missing",
          workflowId,
          componentRef: step.componentRef,
        },
      };
    }

    return {
      ...step,
      mapperContext: {
        state: "ready",
        workflowId,
        pageMap: {
          mapVersionId: pageMap.mapVersionId,
          siteKey: pageMap.siteKey,
          pageProfileKey: pageMap.pageProfileKey,
          classification: pageMap.classification,
          maxComponents: Number(state.settings?.maxComponents) ||
            Number(pageMap.diagnostics?.maxComponents) ||
            500,
        },
        component,
      },
    };
  }

  async function recordResolverOutcome(step = {}, outcome = {}) {
    const workflowId = step.mapper?.workflowId || step.workflowId || "";
    if (!workflowId || !step?.componentRef) return null;
    if (
      step.componentRef.workflowId &&
      normalizeWorkflowId(step.componentRef.workflowId) !== normalizeWorkflowId(workflowId)
    ) {
      return null;
    }
    let updatedMap = null;
    await mapStore.updateWorkflowMapperState(workflowId, (state, context = {}) => {
      if (!context.exists) return undefined;
      const pageMap = findPageMapForComponent(state, step.componentRef);
      if (!pageMap) return undefined;
      updatedMap = recordMapperRuntimeResolution(pageMap, {
        ...(outcome || {}),
        action: outcome?.action || step.action || step.type || "",
        componentId: outcome?.componentId || step.componentRef.componentId || "",
        componentUid: outcome?.componentUid || step.componentRef.componentUid || "",
        pageProfileKey: outcome?.pageProfileKey || step.componentRef.pageProfileKey || "",
        mapVersionId: outcome?.mapVersionId || pageMap.mapVersionId || "",
      }, clock());
      return {
        ...state,
        workflowId,
        maps: (state.maps || []).map((map) => {
          return map.mapVersionId === pageMap.mapVersionId &&
            map.pageProfileKey === pageMap.pageProfileKey
            ? updatedMap
            : map;
        }),
      };
    });
    return updatedMap;
  }

  async function scanPage(request = {}) {
    return await persistPageScan(request, { refresh: false });
  }

  async function refreshPageMap(request = {}) {
    return await persistPageScan(request, { refresh: true });
  }

  async function persistPageScan(request = {}, { refresh = false } = {}) {
    const workflowId = normalizeWorkflowId(request.workflowId || "mapper");
    const snapshotCapturedAt = normalizeSnapshotCapturedAt(
      request.capturedAt || request.page?.capturedAt || request.now,
      clock,
    );
    const buildMap = (state = null) => {
      const settings = {
        ...createDefaultMapperSettings(),
        ...(state?.settings || {}),
        ...(request.settings || {}),
      };
      const pageProfileKey = request.pageProfileKey ||
        normalizePageProfile(request.page || {}, settings).pageKey;
      const previousMap = request.previousMap || getStoredPageMap(state, {
        pageProfileKey,
        siteKey: request.siteKey || "",
      });
      const builder = refresh || previousMap ? refreshStoredPageMap : scanStoredPage;
      return {
        pageMap: builder({
          page: request.page || {},
          componentFacts: request.componentFacts || [],
          settings,
          previousMap,
          now: snapshotCapturedAt,
        }),
        settings,
      };
    };

    if (request.persist === false) {
      const state = await mapStore.getWorkflowMapperState(workflowId);
      const { pageMap } = buildMap(state);
      return { workflowId, pageMap, state };
    }

    let pageMap = null;
    let discardedPageMap = null;
    let persisted = true;
    const state = await mapStore.updateWorkflowMapperState(workflowId, (current) => {
      const built = buildMap(current);
      pageMap = built.pageMap;
      const newest = newestPageMap(current.maps || [], pageMap.pageProfileKey);
      if (isStrictlyOlderPageMap(pageMap, newest)) {
        discardedPageMap = pageMap;
        pageMap = newest;
        persisted = false;
        return undefined;
      }
      return {
        ...current,
        workflowId,
        settings: built.settings,
        maps: replacePageMap(current.maps || [], pageMap, built.settings),
      };
    });
    return {
      workflowId,
      pageMap,
      state,
      persisted,
      ...(persisted ? {} : { reason: "stale_snapshot", discardedPageMap }),
    };
  }

  async function getPageMap(workflowId, pageRef = {}) {
    const id = normalizeWorkflowId(workflowId);
    const state = await mapStore.getWorkflowMapperState(id);
    return getStoredPageMap(state, pageRef);
  }

  async function createComponentRef(workflowId, pageRef = {}, componentId = "") {
    const pageMap = await getPageMap(workflowId, pageRef);
    return createPageComponentRef(pageMap, componentId, {
      workflowId: normalizeWorkflowId(workflowId),
    });
  }

  async function resolveComponent(request = {}) {
    const componentRef = request.componentRef || null;
    const workflowMismatch = componentRefWorkflowMismatch(request.workflowId, componentRef);
    if (workflowMismatch) return coordinatorResolutionFailure("workflow_mismatch");
    const workflowId = normalizeWorkflowId(request.workflowId || componentRef?.workflowId || "");
    const pageMap = request.pageMap || await getPageMap(workflowId, {
      pageProfileKey: componentRef?.pageProfileKey || request.pageProfileKey || "",
      siteKey: componentRef?.siteKey || request.siteKey || "",
    });
    return resolveStoredComponent({
      pageMap,
      componentRef,
      candidateFacts: request.candidateFacts || [],
      requirements: resolutionRequirements(request),
    });
  }

  async function revalidateComponent(request = {}) {
    const componentRef = request.componentRef || null;
    const workflowMismatch = componentRefWorkflowMismatch(request.workflowId, componentRef);
    if (workflowMismatch) return {
      ...coordinatorResolutionFailure("workflow_mismatch"),
      operation: "revalidate",
    };
    const workflowId = normalizeWorkflowId(request.workflowId || componentRef?.workflowId || "");
    const pageMap = request.pageMap || await getPageMap(workflowId, {
      pageProfileKey: componentRef?.pageProfileKey || request.pageProfileKey || "",
      siteKey: componentRef?.siteKey || request.siteKey || "",
    });
    return revalidateStoredComponent({
      pageMap,
      componentRef,
      candidateFacts: request.candidateFacts || [],
      requirements: resolutionRequirements(request),
    });
  }

  return {
    scanPage,
    getPageMap,
    createComponentRef,
    resolveComponent,
    revalidateComponent,
    refreshPageMap,
    reconcileRecordedStep,
    attachExecutionContext,
    recordResolverOutcome,
  };
}

function findPreviousPageMap(state = null, mapperFact = {}) {
  const maps = Array.isArray(state?.maps) ? state.maps : [];
  const pageProfileKey = mapperFact.pageProfileKey ||
    mapperFact.componentRef?.pageProfileKey ||
    "";
  const matching = maps.filter((map) => map.pageProfileKey === pageProfileKey);
  return matching.at(-1) || null;
}

function componentRefContext(workflowId, pageMap = null) {
  return {
    workflowId,
    siteKey: pageMap?.siteKey || "",
    pageProfileKey: pageMap?.pageProfileKey || "",
    mapVersionId: pageMap?.mapVersionId || "",
  };
}

function resolutionRequirements(request = {}) {
  const requirements = { ...(request.requirements || {}) };
  const explicitPaths = Array.isArray(request.accessibleFramePaths)
    ? request.accessibleFramePaths
    : Array.isArray(request.frameContexts)
      ? request.frameContexts.map((scope) => scope?.path).filter(Boolean)
      : null;
  return explicitPaths ? { ...requirements, accessibleFramePaths: explicitPaths } : requirements;
}

function findPageMapForComponent(state = null, componentRef = {}) {
  const maps = Array.isArray(state?.maps) ? state.maps : [];
  const matching = maps.filter((map) => {
    if (componentRef.pageProfileKey && map.pageProfileKey !== componentRef.pageProfileKey) {
      return false;
    }
    if (componentRef.siteKey && map.siteKey !== componentRef.siteKey) return false;
    return true;
  });
  return matching.at(-1) || null;
}

function findStoredComponent(pageMap = null, componentRef = {}) {
  if (!Array.isArray(pageMap?.components)) return null;
  const expectedLayer = componentRef.mappingLayer || "";
  const candidates = expectedLayer
    ? pageMap.components.filter((component) => recordMappingLayer(component) === expectedLayer)
    : pageMap.components;
  return candidates.find((component) => {
    return component.componentId === componentRef.componentId ||
      component.componentUid === componentRef.componentUid ||
      (component.historicalLinks || []).some((link) => {
        return link.componentUid === componentRef.componentUid;
      });
  }) || null;
}

function collectPageFacts(previousMap = null, mapperFact = {}) {
  const previousFacts = (previousMap?.components || [])
    .filter((component) => component.status !== "removed")
    .filter((component) => {
      return component.componentUid !== mapperFact.componentUid &&
        component.componentId !== mapperFact.componentId &&
        !(component.historicalLinks || []).some((link) => {
          return link.componentUid === mapperFact.componentUid;
        });
    })
    .map((component) => ({
      action: component.action || "",
      componentId: component.componentId || "",
      componentUid: component.componentUid || "",
      mappingLayer: recordMappingLayer(component),
      locatorCandidates: [
        component.primaryLocator,
        ...(component.fallbackLocators || []),
      ].filter(Boolean),
      fingerprint: component.fingerprint,
      expectedCapabilities: component.expectedCapabilities,
    }));
  return previousFacts.concat(mapperFact);
}

function findComponentForFact(pageMap = {}, mapperFact = {}) {
  if (!Array.isArray(pageMap.components)) return null;
  const index = findIncomingComponentIndex(pageMap.components, mapperFact);
  return index >= 0 ? pageMap.components[index] : null;
}

function preserveRecordedComponentLocks(pageMap = {}, previousMap = null, mapperFact = {}) {
  if (!previousMap?.components?.length || !Array.isArray(pageMap.components)) {
    return pageMap;
  }

  const previousByUid = new Map(previousMap.components.map((component) => [
    component.componentUid,
    component,
  ]));
  const previousByIncomingUid = new Map();
  previousMap.components.forEach((component) => {
    (component.historicalLinks || []).forEach((link) => {
      if (link.componentUid) previousByIncomingUid.set(link.componentUid, component);
    });
  });
  return {
    ...pageMap,
    components: pageMap.components.map((component, currentIndex) => {
      const historicalUid = (component.historicalLinks || [])
        .map((link) => link.componentUid)
        .find((uid) => previousByUid.has(uid));
      const incomingPrevious = previousByIncomingUid.get(mapperFact.componentUid);
      const uidPrevious = previousByUid.get(component.componentUid);
      const historicalPrevious = previousByUid.get(historicalUid);
      const componentIdPrevious = component.componentId === mapperFact.componentId
        ? previousByIncomingUid.get(mapperFact.componentUid)
        : null;
      const previous = (
        incomingPrevious && isIncomingComponent(component, mapperFact)
          ? incomingPrevious
          : null
      ) || sameLayerPrevious(component, uidPrevious) ||
        sameLayerPrevious(component, historicalPrevious) ||
        sameLayerPrevious(component, componentIdPrevious);
      if (!previous) return component;
      return {
        ...component,
        componentId: previous.componentId,
        createdAt: previous.createdAt || component.createdAt,
      };
    }),
  };
}

function sameLayerPrevious(component = {}, previous = null) {
  if (!previous) return null;
  return recordMappingLayer(component) === recordMappingLayer(previous) ? previous : null;
}

function attachIncomingFactLink(pageMap = {}, mapperFact = {}) {
  if (!mapperFact.componentUid || !Array.isArray(pageMap.components)) {
    return pageMap;
  }

  const index = findIncomingComponentIndex(pageMap.components, mapperFact);
  if (index < 0) return pageMap;

  return {
    ...pageMap,
    components: pageMap.components.map((component, currentIndex) => {
      if (currentIndex !== index) return component;
      const links = component.historicalLinks || [];
      if (links.some((link) => link.componentUid === mapperFact.componentUid)) {
        return component;
      }
      return {
        ...component,
        historicalLinks: links.concat({
          componentUid: mapperFact.componentUid,
          mapVersionId: mapperFact.capturedMapVersionId || "",
          source: "recorded_mapper_fact",
        }),
      };
    }),
  };
}

function findIncomingComponentIndex(components = [], mapperFact = {}) {
  const compatibleComponents = components
    .map((component, index) => ({ component, index }))
    .filter(({ component }) => {
      return recordMappingLayer(component) === recordMappingLayer(mapperFact);
    });
  const direct = compatibleComponents.find(({ component }) => isIncomingComponent(component, mapperFact));
  if (direct) return direct.index;

  const incomingLocatorValues = new Set((mapperFact.locatorCandidates || [])
    .map((locator) => locator?.value)
    .filter(Boolean));
  if (incomingLocatorValues.size) {
    const locatorMatch = compatibleComponents.find(({ component }) => {
      return [
        component.primaryLocator,
        ...(component.fallbackLocators || []),
      ].some((locator) => incomingLocatorValues.has(locator?.value));
    });
    if (locatorMatch) return locatorMatch.index;
  }

  const incomingBounds = visualBounds(mapperFact);
  if (incomingBounds) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    compatibleComponents.forEach(({ component, index }) => {
      const bounds = visualBounds(component);
      if (!bounds) return;
      const distance = Math.abs(bounds.x - incomingBounds.x) + Math.abs(bounds.y - incomingBounds.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0) return bestIndex;
  }

  return -1;
}

function isIncomingComponent(component = {}, mapperFact = {}) {
  return Boolean(
    recordMappingLayer(component) === recordMappingLayer(mapperFact) &&
      ((mapperFact.componentUid && component.componentUid === mapperFact.componentUid) ||
      (mapperFact.componentId && component.componentId === mapperFact.componentId) ||
      (mapperFact.componentUid && (component.historicalLinks || []).some((link) => {
        return link.componentUid === mapperFact.componentUid;
      }))),
  );
}

function recordMappingLayer(record = {}) {
  if (record.mappingLayer === "dynamic") return "dynamic";
  const structural = record.fingerprint?.structural || {};
  const region = structural.regionDynamics || {};
  const repeat = structural.repeatScope || {};
  const scope = structural.platformScope || {};
  if (["dynamic", "loaded_window", "ephemeral_context"].includes(region.classification)) return "dynamic";
  if (repeat.loadedContentOnly === true) return "dynamic";
  if (["loaded_window", "ephemeral"].includes(scope.durability)) return "dynamic";
  if (scope.dynamicKind) return "dynamic";
  return "static";
}

function visualBounds(record = {}) {
  const bounds = record.fingerprint?.visual?.documentBounds ||
    record.fingerprint?.visual?.bounds ||
    record.fingerprint?.visual?.viewportBounds ||
    null;
  if (!bounds) return null;
  const x = Number(bounds.x ?? bounds.left);
  const y = Number(bounds.y ?? bounds.top);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function replacePageMap(maps = [], pageMap = {}, settings = {}) {
  if (isStrictlyOlderPageMap(pageMap, newestPageMap(maps, pageMap.pageProfileKey))) {
    return maps;
  }
  const maxVersions = Math.min(3, Math.max(1, Number(settings.maxVersions) || 3));
  const filtered = maps.filter((map) => {
    return map.pageProfileKey !== pageMap.pageProfileKey ||
      map.mapVersionId !== pageMap.mapVersionId;
  });
  const nextMaps = filtered.concat(pageMap);
  const samePage = nextMaps
    .filter((map) => map.pageProfileKey === pageMap.pageProfileKey)
    .slice(-maxVersions);
  const retainedVersionIds = new Set(samePage.map((map) => map.mapVersionId));
  return nextMaps.filter((map) => {
    return map.pageProfileKey !== pageMap.pageProfileKey ||
      retainedVersionIds.has(map.mapVersionId);
  });
}

function newestPageMap(maps = [], pageProfileKey = "") {
  return maps
    .filter((map) => map.pageProfileKey === pageProfileKey)
    .reduce((newest, map) => {
      if (!newest) return map;
      const currentTime = Date.parse(map.createdAt || "");
      const newestTime = Date.parse(newest.createdAt || "");
      if (Number.isFinite(currentTime) && Number.isFinite(newestTime)) {
        return currentTime > newestTime ? map : newest;
      }
      return map;
    }, null);
}

function isStrictlyOlderPageMap(pageMap = null, newest = null) {
  if (!pageMap || !newest) return false;
  const incomingTime = Date.parse(pageMap.createdAt || "");
  const newestTime = Date.parse(newest.createdAt || "");
  return Number.isFinite(incomingTime) &&
    Number.isFinite(newestTime) &&
    incomingTime < newestTime;
}

function normalizeSnapshotCapturedAt(value, clock) {
  const requested = String(value || "").trim();
  if (requested && Number.isFinite(Date.parse(requested))) return requested;
  const captured = String(clock()).trim();
  if (Number.isFinite(Date.parse(captured))) return captured;
  return new Date().toISOString();
}

function pageFromStep(step = {}) {
  const page = step.page || {};
  return {
    url: page.url || "",
    title: page.title || "",
    materialMutationCount: Number(page.materialMutationCount) || 0,
  };
}

function effectiveMapperSettings(settings = {}, mapperFact = {}, legacyPageProfileKey = "") {
  return {
    ...(settings || {}),
    ...(settings.siteOverrides?.[mapperFact.siteKey] || {}),
    ...(legacyPageProfileKey && legacyPageProfileKey !== mapperFact.pageProfileKey
      ? settings.pageOverrides?.[legacyPageProfileKey] || {}
      : {}),
    ...(settings.pageOverrides?.[mapperFact.pageProfileKey] || {}),
  };
}

function componentRefWorkflowMismatch(requestWorkflowId = "", componentRef = null) {
  const requested = String(requestWorkflowId || "").trim();
  const referenced = String(componentRef?.workflowId || "").trim();
  return Boolean(requested && referenced && requested !== referenced);
}

function coordinatorResolutionFailure(reason = "") {
  return {
    ok: false,
    state: MapperResolverStates.MapStale,
    scoringProfile: MapperScoringProfile.version,
    reason,
  };
}

function normalizeWorkflowId(value) {
  return String(value || "recording").trim() || "recording";
}
