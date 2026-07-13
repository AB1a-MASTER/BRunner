import { createChromeMapStore } from "./mapStore.js";
import {
  buildStaticPageMap,
  createComponentRefFromRecord,
  createDefaultMapperSettings,
  recordMapperRuntimeResolution,
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
    const state = await mapStore.getWorkflowMapperState(workflowId);
    const previousMap = findPreviousPageMap(state, step.mapperFact);
    const activeSettings = state?.settings || settings;
    const effectiveSettings = effectiveMapperSettings(activeSettings, step.mapperFact);
    if (effectiveSettings.mode === "explicit") {
      const component = findComponentForFact(previousMap || {}, step.mapperFact);
      const componentRef = component
        ? createComponentRefFromRecord(component)
        : step.componentRef || null;
      return {
        ...step,
        ...(componentRef ? { componentRef } : {}),
        mapper: {
          schemaVersion: previousMap?.schemaVersion || 1,
          workflowId,
          mapVersionId: previousMap?.mapVersionId || "",
          siteKey: step.mapperFact.siteKey || "",
          pageProfileKey: step.mapperFact.pageProfileKey || "",
          classification: previousMap?.classification || "explicit_mapping_required",
          componentId: component?.componentId || "",
          mode: "explicit",
        },
      };
    }
    const pageMap = attachIncomingFactLink(preserveRecordedComponentLocks(buildStaticPageMap({
      page: pageFromStep(step),
      componentFacts: collectPageFacts(previousMap, step.mapperFact),
      settings: activeSettings,
      previousMap,
      now: clock(),
    }), previousMap, step.mapperFact), step.mapperFact);
    const component = findComponentForFact(pageMap, step.mapperFact);
    const componentRef = component
      ? createComponentRefFromRecord(component)
      : step.componentRef || null;

    await mapStore.saveWorkflowMapperState(workflowId, {
      ...(state || {}),
      workflowId,
      settings: activeSettings,
      maps: replacePageMap(
        state?.maps || [],
        pageMap,
        activeSettings,
      ),
    });

    return {
      ...step,
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
  }

  async function attachExecutionContext(step = {}) {
    if (!step?.componentRef) return step;
    const workflowId = step.mapper?.workflowId || step.workflowId || "";
    if (!workflowId) return step;

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
        },
        component,
      },
    };
  }

  async function recordResolverOutcome(step = {}, outcome = {}) {
    const workflowId = step.mapper?.workflowId || step.workflowId || "";
    if (!workflowId || !step?.componentRef) return null;

    const state = await mapStore.getWorkflowMapperState(workflowId);
    const pageMap = findPageMapForComponent(state, step.componentRef);
    if (!pageMap) return null;

    const updatedMap = recordMapperRuntimeResolution(pageMap, {
      ...(outcome || {}),
      action: outcome?.action || step.action || step.type || "",
      componentId: outcome?.componentId || step.componentRef.componentId || "",
      componentUid: outcome?.componentUid || step.componentRef.componentUid || "",
      pageProfileKey: outcome?.pageProfileKey || step.componentRef.pageProfileKey || "",
      mapVersionId: outcome?.mapVersionId || pageMap.mapVersionId || "",
    }, clock());

    await mapStore.saveWorkflowMapperState(workflowId, {
      ...(state || {}),
      workflowId,
      maps: (state?.maps || []).map((map) => {
        return map.mapVersionId === pageMap.mapVersionId &&
          map.pageProfileKey === pageMap.pageProfileKey
          ? updatedMap
          : map;
      }),
    });

    return updatedMap;
  }

  return {
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

function findPageMapForComponent(state = null, componentRef = {}) {
  const maps = Array.isArray(state?.maps) ? state.maps : [];
  const matching = maps.filter((map) => {
    return map.pageProfileKey === componentRef.pageProfileKey;
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

function pageFromStep(step = {}) {
  const page = step.page || {};
  return {
    url: page.url || "",
    title: page.title || "",
    materialMutationCount: Number(page.materialMutationCount) || 0,
  };
}

function effectiveMapperSettings(settings = {}, mapperFact = {}) {
  return {
    ...(settings || {}),
    ...(settings.siteOverrides?.[mapperFact.siteKey] || {}),
    ...(settings.pageOverrides?.[mapperFact.pageProfileKey] || {}),
  };
}

function normalizeWorkflowId(value) {
  return String(value || "recording").trim() || "recording";
}
