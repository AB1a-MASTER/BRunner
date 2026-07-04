import { createChromeMapStore } from "./mapStore.js";
import {
  buildStaticPageMap,
  createComponentRefFromRecord,
  createDefaultMapperSettings,
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
    const pageMap = attachIncomingFactLink(preserveRecordedComponentLocks(buildStaticPageMap({
      page: pageFromStep(step),
      componentFacts: collectPageFacts(previousMap, step.mapperFact),
      settings: state?.settings || settings,
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
      settings: state?.settings || settings,
      maps: replacePageMap(
        state?.maps || [],
        pageMap,
        state?.settings || settings,
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

  return {
    reconcileRecordedStep,
    attachExecutionContext,
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
  return pageMap.components.find((component) => {
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
  if (mapperFact.componentUid) {
    const byUid = pageMap.components.find((component) => {
      return component.componentUid === mapperFact.componentUid;
    });
    if (byUid) return byUid;
  }
  if (mapperFact.componentUid) {
    for (const component of pageMap.components) {
      const matchedHistory = (component.historicalLinks || []).some((link) => {
        return link.componentUid === mapperFact.componentUid;
      });
      if (matchedHistory) return component;
    }
  }
  if (mapperFact.componentId) {
    const byId = pageMap.components.find((component) => {
      return component.componentId === mapperFact.componentId;
    });
    if (byId) return byId;
  }
  return pageMap.components.at(-1) || null;
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
      const previous = (
        incomingPrevious && currentIndex === pageMap.components.length - 1
          ? incomingPrevious
          : null
      ) || previousByUid.get(component.componentUid) ||
        previousByUid.get(historicalUid) ||
        (component.componentId === mapperFact.componentId
          ? previousByIncomingUid.get(mapperFact.componentUid)
          : null);
      if (!previous) return component;
      return {
        ...component,
        componentId: previous.componentId,
        createdAt: previous.createdAt || component.createdAt,
      };
    }),
  };
}

function attachIncomingFactLink(pageMap = {}, mapperFact = {}) {
  if (!mapperFact.componentUid || !Array.isArray(pageMap.components)) {
    return pageMap;
  }

  const componentIndex = pageMap.components.findIndex((component) => {
    return component.componentId === mapperFact.componentId ||
      component.componentUid === mapperFact.componentUid;
  });
  const index = componentIndex >= 0 ? componentIndex : pageMap.components.length - 1;
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

function replacePageMap(maps = [], pageMap = {}, settings = {}) {
  const maxVersions = Math.max(1, Number(settings.maxVersions) || 20);
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

function normalizeWorkflowId(value) {
  return String(value || "recording").trim() || "recording";
}
