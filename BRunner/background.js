// background.js
// BRunner Orchestration Engine.
// Owns message routing, workflow execution, recording state, native bridge access,
// and tab lifecycle behavior.

import {
  Messages,
  Actions,
  NavigationTargets,
  Defaults,
} from "./core/constants.js";
import {
  NativeBridge,
  loadOrCreateProfileInstanceId,
} from "./core/nativeBridge.js";
import { createRecordingController } from "./core/recordingController.js";
import { createChromeMapStore } from "./core/mapStore.js";
import { createMapperCoordinator } from "./core/mapperCoordinator.js";
import { createRuntimeStateStore } from "./core/runtimeState.js";
import { createRuntimeSessionCoordinator } from "./core/runtimeSession.js";
import { createBridgeStatusTransitionTracker } from "./core/bridgeStatus.js";
import { safeExecutionFailure } from "./core/executionLog.js";
import { getNodeDefinition, getNodeDefinitions } from "./core/nodeRegistry.js";
import {
  evaluateNativeHostRequirement,
  formatNativeCapabilities,
  NativeHostCapabilities,
  NativeHostRequirementModes,
} from "./core/nativeHostRequirements.js";
import {
  VariableRegistry,
  resolveStepExpressions,
} from "./core/variableRegistry.js";
import {
  executeDataTransform,
  isDataTransformAction,
} from "./core/dataTransforms.js";
import { executeHttpRequest } from "./core/httpRequest.js";
import { executeClipboardAction } from "./core/clipboard.js";
import { waitForDownload } from "./core/downloadWait.js";
import { captureScreenshot } from "./core/screenshot.js";
import { resolveStepBypass } from "./core/stepBypass.js";
import {
  inferOutputVariableName,
  summarizeVariables,
} from "./core/variableInspector.js";
import {
  normalizeWorkflow,
  normalizeWorkflowSettings,
  extractDomainFromUrl,
  isBrowserInternalUrl,
  isStudioUrl,
  getPageContextFromUrl,
  pageContextsCompatible,
  resolveWaitDuration,
} from "./core/workflowUtils.js";
import {
  GraphEdgeHandles,
  MapperAttentionNodeType,
  WorkflowSchemaVersion,
  isMapperGraphWorkflow,
  validateGraphWorkflow,
} from "./core/workflowSchema.js";
import {
  buildStaticPageMap,
  createDefaultMapperSettings,
  deserializeWorkflowMapperState,
  MapperMapStatuses,
  normalizeMapperSettings,
  normalizePageProfile,
  pageMapMatchesUrl,
} from "./mapper/core.js";
import {
  MapperAcceptanceExportVersion,
  verifyMapperAcceptanceSnapshot,
} from "./mapper/acceptanceVerifier.js";
import {
  createTab,
  getActiveTab,
  getBestAutomationTab,
  getTabDomain,
  isAutomationTab,
  navigateTab,
  waitForTabComplete,
  normalizeNavigationUrl,
} from "./core/tabUtils.js";

const runtimeSession = createRuntimeSessionCoordinator({
  onPersistenceError: (error) => {
    console.warn("[BRunner] Runtime session checkpoint failed:", error);
  },
});
let runtimeSessionReady = null;
const runtimeState = createRuntimeStateStore({
  onStateChanged: (state) => {
    if (!runtimeSessionReady) return;
    runtimeSession
      .checkpointRuntime(state, recordingController.getState())
      .catch(() => {});
  },
});
let activeRun = null;
let offscreenClipboardCreation = null;
const MAPPER_FRAME_CONTEXT_BUDGET = 100;
const mapperStore = createChromeMapStore();
const mapperCoordinator = createMapperCoordinator({ mapStore: mapperStore });
const bridgeStatusTransitions = createBridgeStatusTransitionTracker();

const recordingController = createRecordingController({
  nativeBridge: NativeBridge,
  onStateChanged: (recording) => runtimeState.updateRecording(recording),
});

runtimeSessionReady = initializeRuntimeLifecycle();

chrome.runtime.onInstalled.addListener(() => {
  console.log("[BRunner] Orchestration Engine initialized.");
  NativeBridge.connect();
});

chrome.runtime.onStartup.addListener(() => {
  NativeBridge.connect();
});

NativeBridge.connect();

chrome.sidePanel
  .setPanelBehavior({
    openPanelOnActionClick: true,
  })
  .catch((error) => {
    console.warn("[BRunner] Failed to set side panel behavior:", error);
  });

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender)
    .then((response) => sendResponse(response))
    .catch((error) => {
      console.error("[BRunner] Message handler error:", error);

      sendResponse({
        ok: false,
        error: error.message || String(error),
        code: error.code || null,
        pairingState: error.pairingState || null,
        diagnostics: error.diagnostics || null,
      });
    });

  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;

  runtimeSessionReady
    .then(() => recordingController.handleTabCompleted(tabId, tab))
    .catch((error) => {
      console.warn("[BRunner] Recording tab sync failed:", error);
    });
});

chrome.tabs.onCreated.addListener((tab) => {
  runtimeSessionReady
    .then(() => recordingController.handleTabCreated(tab))
    .catch((error) => {
      console.warn("[BRunner] Recording new-tab tracking failed:", error);
    });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  runtimeSessionReady
    .then(() => recordingController.handleTabActivated(activeInfo))
    .catch((error) => {
      console.warn("[BRunner] Recording tab activation failed:", error);
    });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  runtimeSessionReady
    .then(() => recordingController.handleTabRemoved(tabId))
    .catch((error) => {
      console.warn("[BRunner] Recording tab removal sync failed:", error);
    });
});

async function handleMessage(request, sender) {
  await runtimeSessionReady;
  const type = request?.type || request?.command;

  switch (type) {
    case Messages.CheckBridgeStatus:
      try {
        await NativeBridge.refreshProfileSession();
        if (NativeBridge.getStatus().paired) {
          await NativeBridge.hostHello();
        }
      } catch (error) {
        console.warn("[BRunner] Native host readiness check failed:", error);
      }
      return {
        ok: true,
        ...NativeBridge.getStatus(),
      };

    case Messages.GetNativePairing: {
      const profileInstanceId = await loadOrCreateProfileInstanceId();
      try {
        await NativeBridge.refreshProfileSession();
        if (NativeBridge.getStatus().paired) {
          await NativeBridge.hostHello();
        }
      } catch {
        // The returned bridge state explains why the companion is not ready.
      }
      return {
        ok: true,
        profileInstanceId,
        bridge: NativeBridge.getStatus(),
      };
    }

    case Messages.PairNativeProfile:
      return await updateNativeProfilePairing(() => NativeBridge.pairProfile());

    case Messages.UnpairNativeProfile:
      return await updateNativeProfilePairing(() => NativeBridge.unpairProfile());

    case Messages.OsListWorkflows:
      return await NativeBridge.listWorkflows();

    case Messages.OsLoadWorkflow:
      return await NativeBridge.loadWorkflow(request.filename);

    case Messages.OsSaveWorkflow:
      return await persistAndRefresh(() => {
        return NativeBridge.saveWorkflow(request.filename, request.content);
      });

    case Messages.OsDeleteWorkflow:
      return await persistAndRefresh(() => {
        return NativeBridge.deleteWorkflow(request.filename);
      });

    case Messages.OsDuplicateWorkflow:
      return await persistAndRefresh(() => {
        return NativeBridge.duplicateWorkflow(
          request.filename,
          request.newFilename,
        );
      });

    case Messages.OsRenameWorkflow:
      return await persistAndRefresh(() => {
        return NativeBridge.renameWorkflow(
          request.filename,
          request.newFilename,
          request.content,
        );
      });

    case Messages.OsUpgradeWorkflow:
      return await persistAndRefresh(() => {
        return NativeBridge.upgradeWorkflow(
          request.filename,
          request.content,
        );
      });

    case Messages.OsSaveExecutionLog:
      return await NativeBridge.saveExecutionLog(
        request.workflowName,
        request.runId,
        request.logs,
      );

    case Messages.OsReadDataSource:
      return await NativeBridge.readDataSource(request.source);

    case Messages.OsListApprovedDirectories:
      return await NativeBridge.listApprovedDirectories();

    case Messages.OsFindApprovedFiles:
      return await NativeBridge.findApprovedFiles(request.request || request);

    case Messages.OsWriteApprovedFile:
      return await NativeBridge.writeApprovedFile(request.request || request);

    case Messages.OsExportDataFile:
      return await NativeBridge.exportDataFile(request.request || request);

    case Messages.ToggleRecording:
      if (request.enabled && runtimeState.isRunning()) {
        return {
          ok: false,
          error: "Cannot start recording while a workflow is running.",
        };
      }

      return {
        ok: true,
        recording: await recordingController.toggle(
          Boolean(request.enabled),
          request.tabPolicy,
        ),
      };

    case Messages.GetRuntimeState:
      return {
        ok: true,
        state: runtimeState.getState(),
        session: runtimeSession.getSession(),
      };

    case Messages.ClearExecutionLogs:
      return {
        ok: true,
        state: runtimeState.clearExecutionLogs(),
      };

    case Messages.GetNodeDefinitions:
      return {
        ok: true,
        definitions: getNodeDefinitions(),
      };

    case Messages.ListWorkflowMapperStates:
      return {
        ok: true,
        states: await mapperStore.getAllWorkflowMapperStates(),
      };

    case Messages.GetWorkflowMapperState:
      return {
        ok: true,
        state: await mapperStore.getWorkflowMapperState(request.workflowId),
      };

    case Messages.SaveWorkflowMapperState:
      return {
        ok: true,
        state: await mapperStore.saveWorkflowMapperState(
          request.workflowId || request.state?.workflowId,
          request.state,
        ),
      };

    case Messages.DeleteWorkflowMapperState:
      return {
        ok: true,
        deleted: await mapperStore.deleteWorkflowMapperState(request.workflowId),
      };

    case Messages.MapCurrentPage:
      return await mapCurrentPageForInspector(request, sender);

    case Messages.InspectCurrentPageMap:
      return await inspectCurrentPageMapForInspector(request, sender);

    case Messages.VerifyMapperAcceptance:
      return await verifyCurrentPageMapperAcceptance(request, sender);

    case Messages.HighlightMapperComponent:
      return await highlightMapperComponentForInspector(request, sender);

    case Messages.GetRecordingState:
      return {
        ok: true,
        recording: recordingController.getState(),
      };

    case Messages.RecordedStep:
      if (!runtimeSession.isCurrentRecordingMessage(request.sessionId)) {
        return {
          ok: false,
          code: "stale_recording_session",
          error: "Recorded step belongs to an inactive recording session.",
          sessionId: recordingController.getState().sessionId,
        };
      }
      const recordedStep = await mapperCoordinator.reconcileRecordedStep(
        request.step,
        {
          sessionId: recordingController.getState().sessionId,
        },
      );
      return {
        ok: true,
        recording: recordingController.addStep(
          recordedStep,
          sender?.tab || null,
        ),
      };

    case Messages.RunWorkflowByName:
      return await runWorkflowByName(request.filename);

    case Messages.StartWorkflow:
      return await runWorkflow(request.workflow || request.content);

    case Messages.StopWorkflow:
      return await stopActiveWorkflow(request.runId);

    case Messages.RequestHardwareKeystroke:
      return await NativeBridge.osKeystroke(request.keys);

    case Messages.StudioLoaded:
      return {
        ok: true,
        bridge: NativeBridge.getStatus(),
        recording: recordingController.getState(),
        runtime: runtimeState.getState(),
        session: runtimeSession.getSession(),
      };

    default:
      console.warn("[BRunner] Unknown message:", request);
      return {
        ok: false,
        error: `Unknown message type: ${type || "undefined"}`,
      };
  }
}

async function initializeRuntimeLifecycle() {
  const restored = await runtimeSession.initialize();
  runtimeState.replaceState({
    recording: restored.recording,
    execution: restored.execution,
  });

  const openTabs = await chrome.tabs.query({}).catch(() => []);
  await recordingController.restore(restored.recording, openTabs);

  NativeBridge.subscribeStatus(publishNativeBridgeStatus);

  return runtimeSession.getSession();
}

function publishNativeBridgeStatus(status = {}) {
  const bridge = bridgeStatusTransitions.next(status);
  if (!bridge) return false;

  runtimeSession.checkpointHost({
    connected: bridge.socketConnected,
    helloAccepted: Boolean(bridge.protocolVersion && bridge.host),
    pairedProfileAccepted: bridge.paired,
    profileInstanceId: bridge.profileInstanceId,
    protocolVersion: bridge.protocolVersion,
    capabilities: bridge.capabilities,
    error: bridge.pairingError,
  }).catch(() => {});

  chrome.runtime.sendMessage({
    type: Messages.BridgeStatus,
    bridge,
    ...bridge,
  }).catch(() => {});
  return true;
}

async function updateNativeProfilePairing(operation) {
  const profileInstanceId = await loadOrCreateProfileInstanceId();
  try {
    const pairing = await operation();
    if (pairing?.paired === true) {
      await NativeBridge.hostHello();
    }
    return {
      ok: true,
      profileInstanceId,
      pairing,
      bridge: NativeBridge.getStatus(),
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || String(error),
      code: error?.code || null,
      pairingState: error?.pairingState || NativeBridge.getStatus().pairingState,
      profileInstanceId,
      bridge: NativeBridge.getStatus(),
    };
  }
}

async function resolveInspectorMapperSettings(request = {}) {
  const requestedSettings = normalizeMapperSettings({
    ...createDefaultMapperSettings(),
    ...(request.settings || {}),
  });
  const workflowId = String(request.workflowId || "").trim();
  if (!workflowId) return requestedSettings;
  try {
    const state = await mapperStore.getWorkflowMapperState(workflowId);
    return state?.settings
      ? normalizeMapperSettings(state.settings)
      : requestedSettings;
  } catch {
    return requestedSettings;
  }
}

async function mapCurrentPageForInspector(request = {}, sender = null) {
  const settings = await resolveInspectorMapperSettings(request);
  let snapshot;
  try {
    snapshot = await getInspectorLiveMapperSnapshot({
      ...request,
      snapshotMode: "settled_current_dom",
    }, sender, settings);
  } catch (error) {
    return {
      ok: false,
      error: error.message || String(error),
    };
  }

  const snapshotCapturedAt = normalizeInspectorSnapshotCapturedAt(snapshot.page?.capturedAt);
  const pageSnapshot = {
    url: snapshot.page.url || snapshot.tab.url || "",
    title: snapshot.page.title || snapshot.tab.title || "",
    platformProfile: snapshot.page.platformProfile || null,
    materialMutationCount: Number(snapshot.page.materialMutationCount) || 0,
    frameSummary: snapshot.page.frameSummary || null,
    scanDiagnostics: snapshot.page.scanDiagnostics || null,
  };
  const temporaryMap = buildStaticPageMap({
    page: pageSnapshot,
    componentFacts: snapshot.mapperFacts,
    settings,
    now: snapshotCapturedAt,
  });
  const workflowId = String(
    request.workflowId ||
      temporaryMap.siteKey ||
      "inspector",
  ).trim();
  let previousMap = null;
  let pageMap = null;
  let discardedPageMap = null;
  let deferred = false;
  let persisted = true;
  const nextState = await mapperStore.updateWorkflowMapperState(
    workflowId,
    (currentState, context = {}) => {
      const activeSettings = context.exists ? currentState.settings : settings;
      const activePageProfileKey = normalizePageProfile(
        pageSnapshot,
        activeSettings,
      ).pageKey;
      previousMap = findLatestInspectorMap(currentState, activePageProfileKey);
      pageMap = buildStaticPageMap({
        page: pageSnapshot,
        componentFacts: snapshot.mapperFacts,
        settings: activeSettings,
        previousMap,
        now: snapshotCapturedAt,
      });
      const newestMap = newestInspectorPageMap(
        currentState.maps || [],
        pageMap.pageProfileKey,
      );
      if (isStrictlyOlderInspectorPageMap(pageMap, newestMap)) {
        discardedPageMap = pageMap;
        pageMap = newestMap;
        persisted = false;
        return undefined;
      }
      if (shouldKeepPreviousInspectorMap(pageMap, previousMap)) {
        deferred = true;
        return undefined;
      }
      return {
        ...currentState,
        workflowId,
        settings: activeSettings,
        maps: replaceInspectorPageMap(
          currentState.maps || [],
          pageMap,
          activeSettings,
        ),
      };
    },
  );
  if (!persisted) {
    return {
      ok: true,
      workflowId,
      tabId: snapshot.tab.id,
      pageMap,
      liveMap: discardedPageMap,
      persisted: false,
      reason: "stale_snapshot",
      state: deserializeWorkflowMapperState(nextState),
    };
  }
  if (deferred) {
    return {
      ok: true,
      workflowId,
      tabId: snapshot.tab.id,
      pageMap: previousMap,
      liveMap: pageMap,
      deferred: true,
      state: deserializeWorkflowMapperState(nextState),
    };
  }

  return {
    ok: true,
    workflowId,
    tabId: snapshot.tab.id,
    pageMap,
    persisted: true,
    state: deserializeWorkflowMapperState(nextState),
  };
}

function shouldKeepPreviousInspectorMap(pageMap = {}, previousMap = null) {
  return Boolean(
    previousMap?.mapVersionId &&
      (previousMap.components || []).length &&
      pageMap.status === MapperMapStatuses.Unsupported &&
      !(pageMap.components || []).length,
  );
}

async function inspectCurrentPageMapForInspector(request = {}, sender = null) {
  const settings = await resolveInspectorMapperSettings(request);
  let snapshot;
  try {
    snapshot = await getInspectorLiveMapperSnapshot(request, sender, settings);
  } catch (error) {
    return {
      ok: false,
      error: error.message || String(error),
    };
  }

  const liveMap = buildStaticPageMap({
    page: {
      url: snapshot.page.url || snapshot.tab.url || "",
      title: snapshot.page.title || snapshot.tab.title || "",
      platformProfile: snapshot.page.platformProfile || null,
      materialMutationCount: Number(snapshot.page.materialMutationCount) || 0,
      frameSummary: snapshot.page.frameSummary || null,
      scanDiagnostics: snapshot.page.scanDiagnostics || null,
    },
    componentFacts: snapshot.mapperFacts,
    settings,
    previousMap: request.pageMap || null,
    now: normalizeInspectorSnapshotCapturedAt(snapshot.page?.capturedAt),
  });
  const savedMap = request.pageMap || {};
  const liveComponentCount = liveMap.componentCount || 0;
  const savedComponentCount = savedMap.componentCount || savedMap.components?.length || 0;
  const fingerprintChanged = Boolean(
    savedMap.fingerprintDigest &&
      liveMap.fingerprintDigest &&
      savedMap.fingerprintDigest !== liveMap.fingerprintDigest,
  );
  const pageMismatch = Boolean(
    savedMap.pageProfileKey &&
      liveMap.pageProfileKey &&
      savedMap.pageProfileKey !== liveMap.pageProfileKey,
  );
  const classificationChanged = Boolean(
    savedMap.classification &&
      liveMap.classification &&
      savedMap.classification !== liveMap.classification,
  );
  const stale = pageMismatch ||
    fingerprintChanged ||
    classificationChanged ||
    liveComponentCount !== savedComponentCount ||
    liveMap.status === "refreshed" ||
    liveMap.classification === "dynamic_deferred";

  return {
    ok: true,
    stale,
    reason: liveMap.diagnostics?.reason ||
      (pageMismatch ? "page_profile_mismatch" : "") ||
      (classificationChanged ? "classification_changed" : "") ||
      (fingerprintChanged ? "fingerprint_changed" : "") ||
      (liveComponentCount !== savedComponentCount ? "component_count_changed" : "current"),
    live: {
      componentCount: liveComponentCount,
      status: liveMap.status || "",
      classification: liveMap.classification || "",
      fingerprintDigest: liveMap.fingerprintDigest || "",
      materialMutationCount: liveMap.diagnostics?.materialMutationCount || 0,
      diagnostics: liveMap.diagnostics || {},
      pageProfileKey: liveMap.pageProfileKey || "",
    },
    saved: {
      componentCount: savedComponentCount,
      status: savedMap.status || "",
      classification: savedMap.classification || "",
      fingerprintDigest: savedMap.fingerprintDigest || "",
      pageProfileKey: savedMap.pageProfileKey || "",
    },
  };
}

async function verifyCurrentPageMapperAcceptance(request = {}, sender = null) {
  const settings = await resolveInspectorMapperSettings(request);
  let snapshot;
  try {
    snapshot = await getInspectorLiveMapperSnapshot({
      ...request,
      snapshotMode: "settled_current_dom",
    }, sender, settings);
  } catch (error) {
    return {
      ok: false,
      error: error.message || String(error),
    };
  }

  const capturedAt = normalizeInspectorSnapshotCapturedAt(
    snapshot.page?.capturedAt,
  );
  const pageMap = buildStaticPageMap({
    page: {
      url: snapshot.page.url || snapshot.tab.url || "",
      title: snapshot.page.title || snapshot.tab.title || "",
      platformProfile: snapshot.page.platformProfile || null,
      materialMutationCount: 0,
      frameSummary: snapshot.page.frameSummary || null,
      scanDiagnostics: snapshot.page.scanDiagnostics || null,
    },
    componentFacts: snapshot.mapperFacts,
    settings,
    now: capturedAt,
  });
  const domManifest = await collectMapperAcceptanceDomManifest(
    snapshot.tab,
    Math.max(settings.maxComponents * 2, settings.maxComponents + 100),
  );
  const verification = verifyMapperAcceptanceSnapshot({
    pageMap,
    domManifest,
  });
  const exported = {
    schemaVersion: MapperAcceptanceExportVersion,
    exportedAt: new Date().toISOString(),
    tab: {
      id: snapshot.tab.id,
      url: snapshot.tab.url || "",
      title: snapshot.tab.title || "",
    },
    settings,
    pageMap,
    domManifest,
    verification,
  };

  return {
    ok: true,
    tabId: snapshot.tab.id,
    pageMap,
    domManifest,
    verification,
    export: exported,
  };
}

async function collectMapperAcceptanceDomManifest(tab, maxEntries = 1100) {
  if (!tab?.id) {
    throw new Error("Mapper acceptance verification requires an active website tab.");
  }
  const results = await chrome.scripting.executeScript({
    target: {
      tabId: tab.id,
      allFrames: true,
    },
    func: collectMapperAcceptanceFrameManifest,
    args: [maxEntries],
  });
  const entries = [];
  const frames = [];
  let truncated = false;
  for (const result of results || []) {
    const frame = result?.result || {};
    const frameEntries = Array.isArray(frame.entries) ? frame.entries : [];
    const normalizedFrameEntries = frameEntries.map((entry) => ({
      ...entry,
      expectedMapped:
        entry.eligible !== false &&
        (entry.hasStableIdentity === true || Number(result.frameId) === 0),
    }));
    frames.push({
      frameId: Number(result.frameId) || 0,
      documentId: String(result.documentId || ""),
      url: String(frame.url || ""),
      title: String(frame.title || ""),
      expectedMappedCount: normalizedFrameEntries.filter(
        (entry) => entry.expectedMapped,
      ).length,
      excludedCandidateCount: normalizedFrameEntries.filter(
        (entry) => entry.eligible === false,
      ).length,
      truncated: frame.truncated === true,
    });
    truncated = truncated || frame.truncated === true;
    for (const entry of normalizedFrameEntries) {
      entries.push({
        ...entry,
        frameId: Number(result.frameId) || 0,
        documentId: String(result.documentId || ""),
        frameUrl: String(frame.url || ""),
      });
    }
  }
  return {
    schemaVersion: "mapper.dom_manifest.v1",
    capturedAt: new Date().toISOString(),
    tabId: tab.id,
    url: tab.url || "",
    title: tab.title || "",
    frameCount: frames.length,
    frames,
    expectedMappedCount: entries.filter((entry) => entry.expectedMapped).length,
    excludedCandidateCount: entries.filter(
      (entry) => entry.eligible === false,
    ).length,
    truncated,
    entries,
  };
}

function collectMapperAcceptanceFrameManifest(maxEntries = 1100) {
  const selector = [
    "button",
    "a",
    "input",
    "textarea",
    "select",
    "img",
    "picture",
    "svg",
    "canvas",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "label",
    "li",
    "td",
    "th",
    "span",
    "pre",
    "output",
    "[role='button']",
    "[role='link']",
    "[role='textbox']",
    "[role='img']",
    "[role='heading']",
    "[role='status']",
    "[role='log']",
    "[contenteditable='true']",
  ].join(",");
  const limit = Math.max(1, Math.min(5000, Number(maxEntries) || 1100));
  const entries = [];
  const pendingRoots = [document];
  const seenRoots = new Set(pendingRoots);
  let rootIndex = 0;
  let truncated = false;

  while (rootIndex < pendingRoots.length && !truncated) {
    const root = pendingRoots[rootIndex++];
    const ownerDocument = root.ownerDocument || document;
    const walker = ownerDocument.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
    );
    let element = walker.nextNode();
    while (element) {
      if (element.shadowRoot && !seenRoots.has(element.shadowRoot)) {
        seenRoots.add(element.shadowRoot);
        pendingRoots.push(element.shadowRoot);
      }
      const identity = [
        "data-testid",
        "data-test",
        "data-qa",
      ].map((attribute) => ({
        attribute,
        value: String(element.getAttribute?.(attribute) || "").trim(),
      })).find((item) => item.value) || null;
      const id = String(element.id || "").trim();
      if (
        element.matches?.(selector) &&
        mapperAcceptanceElementIsVisible(element)
      ) {
        const expectation = mapperAcceptanceElementExpectation(element);
        entries.push({
          expectedMapped: expectation.eligible,
          eligible: expectation.eligible,
          exclusionReason: expectation.reason,
          hasStableIdentity: Boolean(identity || id),
          tag: String(element.tagName || "").toLowerCase(),
          id,
          identity,
          domPath: mapperAcceptanceDomPath(element),
        });
        if (entries.length >= limit) {
          truncated = true;
          break;
        }
      }
      element = walker.nextNode();
    }
  }

  return {
    url: window.location.href,
    title: document.title || "",
    rootCount: seenRoots.size,
    truncated,
    entries,
  };

  function mapperAcceptanceElementIsVisible(element) {
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle?.(element);
    return style?.display !== "none" && style?.visibility !== "hidden";
  }

  function mapperAcceptanceElementExpectation(element) {
    if (element.disabled) {
      return { eligible: false, reason: "disabled" };
    }
    if (element.getAttribute?.("aria-hidden") === "true") {
      return { eligible: false, reason: "aria_hidden" };
    }
    if (mapperAcceptanceIsPassiveText(element)) {
      if (mapperAcceptanceHasInteractiveAncestor(element)) {
        return { eligible: false, reason: "interactive_ancestor" };
      }
      const text = mapperAcceptanceText(element);
      if (text.length < 2 || text.length > 180) {
        return {
          eligible: false,
          reason: text.length > 180
            ? "passive_text_over_180_chars"
            : "passive_text_too_short",
        };
      }
      if (mapperAcceptanceHasNestedMappableText(element)) {
        return { eligible: false, reason: "nested_mappable_text" };
      }
    }
    if (mapperAcceptanceIsVisualMedia(element)) {
      const tag = String(element.tagName || "").toLowerCase();
      const hasSignal = tag === "canvas" ||
        Boolean(
          element.getAttribute?.("alt") ||
          element.getAttribute?.("aria-label") ||
          element.getAttribute?.("title") ||
          element.getAttribute?.("src") ||
          mapperAcceptanceText(element),
        );
      if (!hasSignal) {
        return { eligible: false, reason: "media_without_signal" };
      }
    }
    return { eligible: true, reason: "" };
  }

  function mapperAcceptanceIsPassiveText(element) {
    const tag = String(element?.tagName || "").toLowerCase();
    const role = String(element?.getAttribute?.("role") || "").toLowerCase();
    return [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "label",
      "li",
      "td",
      "th",
      "span",
      "pre",
      "output",
    ].includes(tag) || ["heading", "status", "log"].includes(role);
  }

  function mapperAcceptanceIsVisualMedia(element) {
    const tag = String(element?.tagName || "").toLowerCase();
    const role = String(element?.getAttribute?.("role") || "").toLowerCase();
    return ["img", "picture", "svg", "canvas"].includes(tag) || role === "img";
  }

  function mapperAcceptanceHasInteractiveAncestor(element) {
    const interactiveSelector = [
      "button",
      "a",
      "input",
      "textarea",
      "select",
      "[role='button']",
      "[role='link']",
      "[role='textbox']",
      "[contenteditable='true']",
    ].join(",");
    let current = element?.parentElement || null;
    while (current) {
      if (current.matches?.(interactiveSelector)) return true;
      current = current.parentElement;
    }
    return false;
  }

  function mapperAcceptanceHasNestedMappableText(element) {
    const passiveSelector = [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "label",
      "li",
      "td",
      "th",
      "span",
      "pre",
      "output",
      "[role='heading']",
      "[role='status']",
      "[role='log']",
    ].join(",");
    for (const child of element.querySelectorAll?.(passiveSelector) || []) {
      if (!mapperAcceptanceElementIsVisible(child)) continue;
      if (mapperAcceptanceHasInteractiveAncestor(child)) continue;
      const text = mapperAcceptanceText(child);
      if (text.length >= 2 && text.length <= 180) return true;
    }
    return false;
  }

  function mapperAcceptanceText(element) {
    return String(element?.innerText || element?.textContent || "")
      .trim()
      .replace(/\s+/g, " ");
  }

  function mapperAcceptanceDomPath(element) {
    const segments = [];
    let current = element;
    while (current?.nodeType === Node.ELEMENT_NODE) {
      const root = current.getRootNode();
      const parts = [];
      let nested = current;
      while (nested?.nodeType === Node.ELEMENT_NODE) {
        const parent = nested.parentElement;
        const tag = String(nested.tagName || "").toLowerCase();
        if (!parent) {
          parts.unshift(`${tag}:0`);
          break;
        }
        parts.unshift(`${tag}:${Array.prototype.indexOf.call(parent.children, nested)}`);
        nested = parent;
      }
      segments.unshift(parts.join("/"));
      if (!(root instanceof ShadowRoot) || !root.host) break;
      current = root.host;
    }
    return segments.filter(Boolean).join("::shadow::");
  }
}

async function getInspectorLiveMapperSnapshot(request = {}, sender = null, settings = {}) {
  const policy = normalizeMapperSettings(settings);
  const tab = await getInspectorTargetTab(
    request.tabId,
    request.pageMap || null,
    sender,
    policy,
  );
  if (!tab?.id) {
    throw new Error("No website tab found. Open the page you want to map, then try again.");
  }

  let frameSnapshots;
  try {
    frameSnapshots = await getInspectorMapperFrameSnapshots(
      tab,
      request.snapshotMode || "",
      policy.maxComponents,
      policy,
    );
  } catch (error) {
    throw new Error(`Could not reach mapper content script in ${tab.url || "target tab"}: ${error.message || error}`);
  }

  const topSnapshot = frameSnapshots.find((snapshot) => snapshot.frameId === 0);
  if (!topSnapshot) {
    throw new Error(
      "Mapper content scan could not verify the top-frame page context; the previous map was left unchanged.",
    );
  }
  const accessible = frameSnapshots;
  const allMapperFacts = accessible.flatMap((snapshot) => {
    return (snapshot.controls || []).map((control) => control.mapperFact).filter(Boolean);
  });
  const mapperFacts = allMapperFacts.slice(0, policy.maxComponents);
  const scanDiagnostics = summarizeInspectorScanDiagnostics(
    accessible,
    policy.maxComponents,
    allMapperFacts.length > policy.maxComponents,
    mapperFacts.length,
  );
  const accessibleFramePaths = accessible
    .map((snapshot) => snapshot.frameScope?.path)
    .filter(Boolean);
  const incompleteFramePaths = scanDiagnostics.firstOmittedFramePath
    ? [scanDiagnostics.firstOmittedFramePath]
    : [];

  return {
    tab,
    page: {
      ...(topSnapshot.page || {}),
      platformProfile: accessible
        .map((snapshot) => snapshot.page?.platformProfile)
        .filter(Boolean)
        .sort((a, b) => Number(b.confidence) - Number(a.confidence))[0] || null,
      materialMutationCount: accessible.reduce((sum, snapshot) => {
        return sum + (Number(snapshot.page?.materialMutationCount) || 0);
      }, 0),
      scanDiagnostics,
      frameSummary: {
        sameOriginFrames: accessible.filter((snapshot) => snapshot.frameScope?.access === "same_origin").length,
        crossOriginFrames: accessible.filter((snapshot) => snapshot.frameScope?.access === "cross_origin").length,
        accessibleFramePaths,
        incompleteFramePaths,
        maxFrameContexts: scanDiagnostics.maxFrameContexts,
        discoveredFrameContextCount: scanDiagnostics.discoveredFrameContextCount,
        processedFrameContextCount: scanDiagnostics.processedFrameContextCount,
        reachableFrameContextCount: scanDiagnostics.reachableFrameContextCount,
        frameContextOverflow: scanDiagnostics.frameContextOverflow,
        frameScanIncomplete: scanDiagnostics.frameScanIncomplete,
        accessibleFramePathsComplete: scanDiagnostics.accessibleFramePathsComplete,
      },
    },
    frameContexts: accessible.map((snapshot) => snapshot.frameScope),
    mapperFacts,
  };
}

function selectBoundedInspectorMapperFrames(
  discovered = [],
  maxFrameContexts = MAPPER_FRAME_CONTEXT_BUDGET,
) {
  const results = Array.isArray(discovered) ? discovered : [];
  const requestedBudget = Math.floor(Number(maxFrameContexts));
  const boundedMaxFrameContexts = Math.max(
    1,
    Math.min(
      Number.isFinite(requestedBudget) ? requestedBudget : MAPPER_FRAME_CONTEXT_BUDGET,
      MAPPER_FRAME_CONTEXT_BUDGET,
    ),
  );
  const retained = [];
  let discoveredFrameContextCount = 0;

  results.forEach((result, discoveryIndex) => {
    if (!result?.result?.frameScope) return;
    discoveredFrameContextCount += 1;
    const numericFrameId = Number(result.frameId);
    const entry = {
      result,
      discoveryIndex,
      frameId: Number.isFinite(numericFrameId) ? numericFrameId : Number.MAX_SAFE_INTEGER,
    };
    const insertAt = retained.findIndex((candidate) => {
      return entry.frameId < candidate.frameId ||
        (entry.frameId === candidate.frameId && entry.discoveryIndex < candidate.discoveryIndex);
    });
    if (insertAt === -1) retained.push(entry);
    else retained.splice(insertAt, 0, entry);
    if (retained.length > boundedMaxFrameContexts + 1) retained.pop();
  });

  const frameContextOverflow = discoveredFrameContextCount > boundedMaxFrameContexts;
  const firstOmitted = frameContextOverflow
    ? retained[boundedMaxFrameContexts]?.result
    : null;
  return {
    frames: retained
      .slice(0, boundedMaxFrameContexts)
      .map((entry) => entry.result),
    maxFrameContexts: boundedMaxFrameContexts,
    discoveredResultCount: results.length,
    discoveredFrameContextCount,
    missingFrameContextCount: Math.max(results.length - discoveredFrameContextCount, 0),
    frameContextOverflow,
    firstOmittedFramePath: firstOmitted?.result?.frameScope?.path || "",
  };
}

async function getInspectorMapperFrameSnapshots(
  tab = {},
  snapshotMode = "",
  maxComponents = createDefaultMapperSettings().maxComponents,
  settings = {},
) {
  const boundedMaxComponents = normalizeMapperSettings({ maxComponents }).maxComponents;
  const collect = async () => {
    const discovered = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => {
        const mapper = window.__BRUNNER_MAPPER__;
        if (!mapper) return null;
        return {
          frameScope: mapper.getMapperFrameScope(),
        };
      },
    });
    const frameSelection = selectBoundedInspectorMapperFrames(
      discovered,
      MAPPER_FRAME_CONTEXT_BUDGET,
    );
    const discoveredMapperFrames = frameSelection.frames;
    const snapshots = [];
    let acceptedControlCount = 0;
    let scanOverflow = false;
    let processedFrameContextCount = 0;
    let responseFailureCount = 0;
    let stoppedDueToComponentLimit = false;
    let firstOmittedFramePath = frameSelection.firstOmittedFramePath;

    for (const result of discoveredMapperFrames) {
      if (scanOverflow) {
        stoppedDueToComponentLimit = true;
        firstOmittedFramePath = result.result.frameScope?.path || firstOmittedFramePath;
        break;
      }

      const remaining = Math.max(boundedMaxComponents - acceptedControlCount, 0);
      const frameMaxComponents = Math.max(1, remaining);
      processedFrameContextCount += 1;
      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: "GET_CONTROLS_TREE",
          snapshotMode,
          maxComponents: frameMaxComponents,
          settings: {
            queryAllowlist: Array.isArray(settings.queryAllowlist)
              ? settings.queryAllowlist
              : [],
          },
        }, { frameId: result.frameId });
        if (!response?.ok) {
          responseFailureCount += 1;
          snapshots.push(null);
          continue;
        }
        const responseControls = Array.isArray(response.controls) ? response.controls : [];
        const acceptedControls = responseControls.slice(0, remaining);
        const frameDiagnostics = response.scanDiagnostics || response.page?.scanDiagnostics || {};
        const frameOverflow = frameDiagnostics.overflow === true ||
          responseControls.length > remaining;
        const globalOverflow = frameOverflow ||
          (remaining === 0 && responseControls.length > 0);
        acceptedControlCount += acceptedControls.length;
        scanOverflow = globalOverflow;
        snapshots.push({
          frameId: result.frameId,
          controls: acceptedControls,
          page: response.page || {},
          frameScope: response.frameScope || result.result.frameScope,
          scanDiagnostics: {
            ...frameDiagnostics,
            acceptedComponentCount: acceptedControls.length,
            globalOverflow,
          },
        });
      } catch {
        responseFailureCount += 1;
        snapshots.push(null);
      }
    }
    const reachableSnapshots = snapshots.filter(Boolean);
    const frameScanIncomplete = frameSelection.frameContextOverflow ||
      frameSelection.missingFrameContextCount > 0 ||
      responseFailureCount > 0 ||
      processedFrameContextCount < frameSelection.discoveredFrameContextCount;
    const frameScanDiagnostics = {
      maxFrameContexts: frameSelection.maxFrameContexts,
      discoveredResultCount: frameSelection.discoveredResultCount,
      discoveredFrameContextCount: frameSelection.discoveredFrameContextCount,
      processedFrameContextCount,
      reachableFrameContextCount: reachableSnapshots.length,
      frameContextOverflow: frameSelection.frameContextOverflow,
      frameScanIncomplete,
      accessibleFramePathsComplete: !frameScanIncomplete,
      firstOmittedFramePath,
      stoppedDueToComponentLimit,
    };
    const decoratedSnapshots = decorateAccessibleMapperFrameSnapshots(reachableSnapshots);
    if (decoratedSnapshots.length) {
      decoratedSnapshots[0] = {
        ...decoratedSnapshots[0],
        scanDiagnostics: {
          ...(decoratedSnapshots[0].scanDiagnostics || {}),
          ...frameScanDiagnostics,
        },
      };
    }
    return {
      snapshots: decoratedSnapshots,
      incomplete: discoveredMapperFrames.length !== discovered.length ||
        reachableSnapshots.length !== discoveredMapperFrames.length ||
        frameScanIncomplete,
      requiresInjection: frameSelection.missingFrameContextCount > 0 ||
        responseFailureCount > 0,
    };
  };

  let collection = await collect();
  if (collection.snapshots.length && !collection.requiresInjection) return collection.snapshots;
  await injectMapperContentScripts(tab.id);
  collection = await collect();
  return collection.snapshots;
}

function summarizeInspectorScanDiagnostics(
  snapshots = [],
  maxComponents = createDefaultMapperSettings().maxComponents,
  aggregateOverflow = false,
  sampledComponentCount = 0,
) {
  const componentOverflow = aggregateOverflow || snapshots.some((snapshot) => {
    const diagnostics = snapshot.scanDiagnostics || snapshot.page?.scanDiagnostics || {};
    return diagnostics.overflow === true || diagnostics.globalOverflow === true;
  });
  const frameContextOverflow = snapshots.some((snapshot) => {
    const diagnostics = snapshot.scanDiagnostics || snapshot.page?.scanDiagnostics || {};
    return diagnostics.frameContextOverflow === true;
  });
  const frameScanIncomplete = snapshots.some((snapshot) => {
    const diagnostics = snapshot.scanDiagnostics || snapshot.page?.scanDiagnostics || {};
    return diagnostics.frameScanIncomplete === true;
  });
  const overflow = componentOverflow || frameContextOverflow || frameScanIncomplete;
  const exactCandidateCount = snapshots.reduce((count, snapshot) => {
    const diagnostics = snapshot.scanDiagnostics || snapshot.page?.scanDiagnostics || {};
    if (diagnostics.skippedDueToGlobalLimit === true) return count;
    return count + Math.max(Number(diagnostics.candidateCount) || 0, 0);
  }, 0);
  const frameDiagnostics = snapshots.reduce((summary, snapshot) => {
    const diagnostics = snapshot.scanDiagnostics || snapshot.page?.scanDiagnostics || {};
    return {
      maxFrameContexts: Math.max(
        summary.maxFrameContexts,
        Number(diagnostics.maxFrameContexts) || 0,
      ),
      discoveredFrameContextCount: Math.max(
        summary.discoveredFrameContextCount,
        Number(diagnostics.discoveredFrameContextCount) || 0,
      ),
      processedFrameContextCount: Math.max(
        summary.processedFrameContextCount,
        Number(diagnostics.processedFrameContextCount) || 0,
      ),
      reachableFrameContextCount: Math.max(
        summary.reachableFrameContextCount,
        Number(diagnostics.reachableFrameContextCount) || 0,
      ),
      firstOmittedFramePath: summary.firstOmittedFramePath ||
        String(diagnostics.firstOmittedFramePath || ""),
    };
  }, {
    maxFrameContexts: MAPPER_FRAME_CONTEXT_BUDGET,
    discoveredFrameContextCount: snapshots.length,
    processedFrameContextCount: snapshots.length,
    reachableFrameContextCount: snapshots.length,
    firstOmittedFramePath: "",
  });
  return {
    version: "mapper.scan.v1",
    maxComponents,
    sampledComponentCount: Math.min(sampledComponentCount, maxComponents),
    candidateCount: overflow
      ? maxComponents + 1
      : exactCandidateCount,
    candidateCountIsLowerBound: overflow,
    overflow,
    reason: frameContextOverflow
      ? "frame_context_overflow"
      : frameScanIncomplete
        ? "frame_scan_incomplete"
        : componentOverflow
          ? "component_scan_overflow"
          : "",
    ...frameDiagnostics,
    frameContextOverflow,
    frameScanIncomplete,
    accessibleFramePathsComplete: !frameScanIncomplete,
  };
}

function decorateAccessibleMapperFrameSnapshots(snapshots = []) {
  const scopes = decorateAccessibleMapperFrameScopes(snapshots.map((snapshot) => ({
    frameId: snapshot.frameId,
    frameScope: snapshot.frameScope,
  })));
  const scopeByFrameId = new Map(scopes.map((entry) => [entry.frameId, entry.frameScope]));
  return snapshots
    .slice()
    .sort((left, right) => Number(left.frameId) - Number(right.frameId))
    .map((snapshot) => {
      const frameScope = scopeByFrameId.get(snapshot.frameId) || snapshot.frameScope || {};
      return {
        ...snapshot,
        frameScope,
        controls: (snapshot.controls || []).map((control) => ({
          ...control,
          mapperFact: attachMapperFrameScope(control.mapperFact, frameScope),
        })),
      };
    });
}

function decorateAccessibleMapperFrameScopes(entries = []) {
  const ordered = entries
    .slice()
    .sort((left, right) => Number(left.frameId) - Number(right.frameId));
  const multiplicities = ordered.reduce((counts, entry) => {
    const scope = entry.frameScope || {};
    if (scope.access !== "cross_origin" || scope.extensionAccessible !== true) return counts;
    const contextKey = String(scope.contextKey || scope.path || "cross_origin");
    counts.set(contextKey, (counts.get(contextKey) || 0) + 1);
    return counts;
  }, new Map());
  const ordinals = new Map();
  return ordered
    .map((entry) => {
      const scope = entry.frameScope || {};
      if (scope.access !== "cross_origin" || scope.extensionAccessible !== true) {
        return {
          frameId: entry.frameId,
          frameScope: {
            ...scope,
            frameIdHint: Number(entry.frameId),
          },
        };
      }
      const contextKey = String(scope.contextKey || scope.path || "cross_origin");
      const ordinal = (ordinals.get(contextKey) || 0) + 1;
      ordinals.set(contextKey, ordinal);
      const contextMultiplicity = multiplicities.get(contextKey) || 1;
      const frameContextId = `${contextKey}_instance_${ordinal}`;
      return {
        frameId: entry.frameId,
        frameScope: {
          ...scope,
          path: `${String(scope.path || `isolated/${contextKey}`).replace(/\/$/, "")}/instance_${ordinal}`,
          contextKey,
          frameContextId,
          contextMultiplicity,
          identityAmbiguous: contextMultiplicity > 1,
          frameIdHint: Number(entry.frameId),
          extensionAccessible: true,
        },
      };
    });
}

function attachMapperFrameScope(mapperFact = null, frameScope = {}) {
  if (!mapperFact || typeof mapperFact !== "object") return mapperFact;
  return {
    ...mapperFact,
    fingerprint: {
      ...(mapperFact.fingerprint || {}),
      structural: {
        ...(mapperFact.fingerprint?.structural || {}),
        frameScope,
      },
    },
  };
}

async function highlightMapperComponentForInspector(request = {}, sender = null) {
  const settings = normalizeMapperSettings(request.settings || {});
  const tab = await getInspectorTargetTab(
    request.tabId,
    request.pageMap,
    sender,
    settings,
  );
  if (!tab?.id) {
    return {
      ok: true,
      mapperState: "map_stale",
      mapperReason: "page_profile_mismatch",
      confidence: 0,
      attempts: [],
      resolverLog: null,
      highlighted: false,
    };
  }

  try {
    return await sendInspectorMapperMessage(tab, {
      type: Messages.HighlightMapperComponent,
      component: request.component,
      containerTarget: request.containerTarget || null,
      pageMap: request.pageMap,
      settings,
      actionOverride: request.actionOverride || "",
      highlightRequestId: request.highlightRequestId,
    });
  } catch (error) {
    return {
      ok: false,
      error: `Could not reach mapper content script in ${tab.url || "target tab"}: ${error.message || error}`,
    };
  }
}

async function sendInspectorMapperMessage(tab = {}, payload = {}) {
  const frameComponent = payload.component || (payload.containerTarget?.frameScope
    ? {
        fingerprint: {
          structural: {
            frameScope: payload.containerTarget.frameScope,
          },
        },
      }
    : null);
  const frameId = await resolveMapperFrameId(tab.id, frameComponent);
  if (payload.pageMap?.pageProfileKey || payload.pageMap?.origin || payload.pageMap?.path) {
    const currentTab = await chrome.tabs.get(tab.id);
    if (!isInspectableWebsiteTab(currentTab, payload.pageMap, payload.settings || {})) {
      return {
        ok: true,
        mapperState: "map_stale",
        mapperReason: "page_profile_mismatch",
        confidence: 0,
        attempts: [],
        resolverLog: null,
        highlighted: false,
      };
    }
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, payload, { frameId });
  } catch (error) {
    if (!isMissingContentScriptError(error)) throw error;
  }

  await injectMapperContentScripts(tab.id);
  return await chrome.tabs.sendMessage(tab.id, payload, { frameId });
}

async function resolveMapperFrameId(tabId, component = null) {
  const scope = component?.fingerprint?.structural?.frameScope || {};
  const expectedPath = String(scope.path || "top");
  if (!component || expectedPath === "top") return 0;
  if (scope.access === "cross_origin" && scope.extensionAccessible !== true) {
    throw createUnreachableMapperFrameError(scope);
  }
  if (scope.access === "cross_origin" && scope.identityAmbiguous === true) {
    throw createAmbiguousMapperFrameError(scope);
  }

  const findFrame = async () => {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => window.__BRUNNER_MAPPER__?.getMapperFrameScope?.() || null,
    });
    const selection = selectBoundedMapperFrameResolutionContexts(
      results,
      scope,
      MAPPER_FRAME_CONTEXT_BUDGET,
    );
    const decorated = decorateAccessibleMapperFrameScopes(selection.contexts);
    const pathOrContextMatches = (entry) => {
      return entry.frameScope?.path === expectedPath ||
        (
          scope.frameContextId &&
          entry.frameScope?.frameContextId === scope.frameContextId
        ) ||
        (
          scope.access === "cross_origin" &&
          scope.contextKey &&
          entry.frameScope?.contextKey === scope.contextKey
        );
    };
    if (scope.access !== "cross_origin") {
      return {
        frameId: decorated.find(pathOrContextMatches)?.frameId,
        ambiguous: false,
        incomplete: selection.missingFrameContextCount > 0,
        ...selection.diagnostics,
      };
    }

    const expectedMultiplicity = Number(scope.contextMultiplicity) || 1;
    const exact = decorated.find((entry) => {
      return pathOrContextMatches(entry) &&
        entry.frameScope?.identityAmbiguous !== true &&
        (Number(entry.frameScope?.contextMultiplicity) || 1) === expectedMultiplicity;
    });
    const contextualMatches = decorated.filter((entry) => {
      return pathOrContextMatches(entry) ||
        (
          scope.contextKey &&
          entry.frameScope?.contextKey === scope.contextKey
        );
    });
    return {
      frameId: exact?.frameId,
      ambiguous: !exact && contextualMatches.some((entry) => {
        return entry.frameScope?.identityAmbiguous === true ||
          (Number(entry.frameScope?.contextMultiplicity) || 1) !== expectedMultiplicity;
      }),
      incomplete: selection.missingFrameContextCount > 0,
      ...selection.diagnostics,
    };
  };

  let resolution = await findFrame();
  if (scope.access !== "cross_origin" || !resolution.frameContextOverflow) {
    if (Number.isInteger(resolution.frameId)) return resolution.frameId;
    if (resolution.ambiguous) throw createAmbiguousMapperFrameError(scope);
  }
  if (resolution.frameContextOverflow && !resolution.incomplete) {
    throw createMapperFrameContextOverflowError(scope, resolution);
  }
  await injectMapperContentScripts(tabId);
  resolution = await findFrame();
  if (
    Number.isInteger(resolution.frameId) &&
    (scope.access !== "cross_origin" || !resolution.frameContextOverflow)
  ) {
    return resolution.frameId;
  }
  if (resolution.frameContextOverflow) {
    throw createMapperFrameContextOverflowError(scope, resolution);
  }
  if (resolution.ambiguous) throw createAmbiguousMapperFrameError(scope);
  if (scope.access === "cross_origin") {
    throw createUnreachableMapperFrameError(scope);
  }
  throw new Error(`Mapped frame is no longer available: ${expectedPath}`);
}

function selectBoundedMapperFrameResolutionContexts(
  results = [],
  expectedScope = {},
  maxFrameContexts = MAPPER_FRAME_CONTEXT_BUDGET,
) {
  const discovered = Array.isArray(results) ? results : [];
  const requestedBudget = Math.floor(Number(maxFrameContexts));
  const boundedMaxFrameContexts = Math.max(
    1,
    Math.min(
      Number.isFinite(requestedBudget) ? requestedBudget : MAPPER_FRAME_CONTEXT_BUDGET,
      MAPPER_FRAME_CONTEXT_BUDGET,
    ),
  );
  const expectedPath = String(expectedScope.path || "");
  const expectedContextKey = String(expectedScope.contextKey || "");
  const expectedFrameIdHint = Number(expectedScope.frameIdHint);
  const retained = [];
  let missingFrameContextCount = 0;
  const inspectedResultCount = Math.min(
    discovered.length,
    boundedMaxFrameContexts + 1,
  );

  const compareEntries = (left, right) => {
    return left.priority - right.priority ||
      left.frameId - right.frameId ||
      left.discoveryIndex - right.discoveryIndex;
  };

  for (let discoveryIndex = 0; discoveryIndex < inspectedResultCount; discoveryIndex += 1) {
    const result = discovered[discoveryIndex];
    const frameScope = result?.result;
    const numericFrameId = Number(result?.frameId);
    if (
      !frameScope ||
      typeof frameScope !== "object" ||
      !Number.isInteger(numericFrameId) ||
      numericFrameId < 0
    ) {
      missingFrameContextCount += 1;
      continue;
    }

    const exactPathMatch = expectedPath && frameScope.path === expectedPath;
    const exactContextMatch = expectedContextKey && frameScope.contextKey === expectedContextKey;
    const hintedFrameMatch = Number.isInteger(expectedFrameIdHint) &&
      numericFrameId === expectedFrameIdHint;
    const priority = exactPathMatch
      ? 0
      : exactContextMatch
        ? 1
        : hintedFrameMatch
          ? 2
          : numericFrameId === 0
            ? 3
            : 4;
    const entry = {
      frameId: numericFrameId,
      frameScope,
      priority,
      discoveryIndex,
    };
    const insertAt = retained.findIndex((candidate) => compareEntries(entry, candidate) < 0);
    if (insertAt === -1) retained.push(entry);
    else retained.splice(insertAt, 0, entry);
    if (retained.length > boundedMaxFrameContexts + 1) retained.pop();
  }

  const frameContextOverflow = discovered.length > boundedMaxFrameContexts;
  const firstOmitted = frameContextOverflow ? retained[boundedMaxFrameContexts] : null;
  const contexts = retained.slice(0, boundedMaxFrameContexts).map((entry) => ({
    frameId: entry.frameId,
    frameScope: entry.frameScope,
  }));
  return {
    contexts,
    missingFrameContextCount,
    diagnostics: {
      maxFrameContexts: boundedMaxFrameContexts,
      discoveredResultCount: discovered.length,
      discoveredFrameContextCount: discovered.length,
      inspectedResultCount,
      selectedFrameContextCount: contexts.length,
      missingFrameContextCount,
      frameContextOverflow,
      firstOmittedFrameId: firstOmitted?.frameId ?? null,
    },
  };
}

function createMapperFrameContextOverflowError(scope = {}, resolution = {}) {
  const maxFrameContexts = Number(resolution.maxFrameContexts) || MAPPER_FRAME_CONTEXT_BUDGET;
  const error = new Error(
    `Mapped frame identity could not be verified within ${maxFrameContexts} frame contexts: ${scope.path || "unknown"}`,
  );
  error.diagnostics = {
    mapperState: "dynamic_deferred",
    mapperReason: "frame_context_overflow",
    finalReason: "mapper_frame_context_overflow",
    framePath: scope.path || "",
    frameContextId: scope.frameContextId || "",
    maxFrameContexts,
    discoveredFrameContextCount: Number(resolution.discoveredFrameContextCount) || 0,
    inspectedResultCount: Number(resolution.inspectedResultCount) || 0,
    selectedFrameContextCount: Number(resolution.selectedFrameContextCount) || 0,
    missingFrameContextCount: Number(resolution.missingFrameContextCount) || 0,
    firstOmittedFrameId: Number.isInteger(resolution.firstOmittedFrameId)
      ? resolution.firstOmittedFrameId
      : null,
  };
  return error;
}

function createUnreachableMapperFrameError(scope = {}) {
  const error = new Error(`Mapped extension frame is unreachable: ${scope.path || "unknown"}`);
  error.diagnostics = {
    mapperState: "protected_unsupported",
    mapperReason: "cross_origin_frame_unreachable",
    finalReason: "mapper_protected_unsupported",
    framePath: scope.path || "",
    frameContextId: scope.frameContextId || "",
  };
  return error;
}

function createAmbiguousMapperFrameError(scope = {}) {
  const error = new Error(`Mapped extension frame identity is ambiguous: ${scope.path || "unknown"}`);
  error.diagnostics = {
    mapperState: "ambiguous",
    mapperReason: "cross_origin_frame_context_ambiguous",
    finalReason: "mapper_ambiguous",
    framePath: scope.path || "",
    frameContextId: scope.frameContextId || "",
  };
  return error;
}

async function injectMapperContentScripts(tabId) {
  await chrome.scripting.executeScript({
    target: {
      tabId,
      allFrames: true,
    },
    files: [
      "content/targetResolver.js",
      "content/filePayload.js",
      "content/mapper.js",
    ],
  });
}

function isMissingContentScriptError(error = null) {
  const message = String(error?.message || error || "");
  return message.includes("Receiving end does not exist") ||
    message.includes("Could not establish connection");
}

async function getInspectorTargetTab(tabId, pageMap = null, sender = null, settings = {}) {
  if (tabId) {
    const explicitTab = await chrome.tabs.get(Number(tabId));
    return isInspectableWebsiteTab(explicitTab, pageMap, settings) ? explicitTab : null;
  }

  const senderWindowId = sender?.tab?.windowId;
  if (senderWindowId) {
    const currentWindowTabs = await chrome.tabs.query({
      windowId: senderWindowId,
    });
    const currentWindowTarget = selectBestInspectorTargetTab(
      currentWindowTabs,
      pageMap,
      sender?.tab?.id,
      settings,
    );
    if (currentWindowTarget) return currentWindowTarget;
  }

  const allTabs = await chrome.tabs.query({});
  return selectBestInspectorTargetTab(allTabs, pageMap, sender?.tab?.id, settings);
}

function isInspectableWebsiteTab(tab = null, pageMap = null, settings = {}) {
  if (!tab?.id || !tab.url || isStudioUrl(tab.url)) return false;
  if (!/^https?:\/\//i.test(tab.url)) return false;
  if (!pageMap?.origin && !pageMap?.path && !pageMap?.pageProfileKey) return true;
  return pageMapMatchesUrl(pageMap, tab.url, settings);
}

function selectBestInspectorTargetTab(
  tabs = [],
  pageMap = null,
  senderTabId = null,
  settings = {},
) {
  return tabs
    .filter((tab) => tab.id !== senderTabId)
    .filter((tab) => isInspectableWebsiteTab(tab, pageMap, settings))
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0);
    })[0] || null;
}

function findLatestInspectorMap(state = null, pageProfileKey = "") {
  const maps = Array.isArray(state?.maps) ? state.maps : [];
  const usable = maps.filter(isUsableInspectorPageMap);
  return newestInspectorPageMap(usable, pageProfileKey) ||
    newestInspectorPageMap(maps, pageProfileKey);
}

function replaceInspectorPageMap(maps = [], pageMap = {}, settings = {}) {
  const newestExisting = newestInspectorPageMap(maps, pageMap.pageProfileKey);
  if (isStrictlyOlderInspectorPageMap(pageMap, newestExisting)) {
    return maps;
  }
  const maxVersions = Math.min(3, Math.max(1, Number(settings.maxVersions) || 3));
  const nextMaps = maps
    .filter((map) => {
      return map.pageProfileKey !== pageMap.pageProfileKey ||
        map.mapVersionId !== pageMap.mapVersionId;
    })
    .concat(pageMap);
  const samePageCandidates = nextMaps.filter((map) => map.pageProfileKey === pageMap.pageProfileKey);
  const usableSamePage = samePageCandidates.filter(isUsableInspectorPageMap);
  const retained = new Set((usableSamePage.length ? usableSamePage : samePageCandidates)
    .slice(-maxVersions)
    .map((map) => map.mapVersionId));

  return nextMaps.filter((map) => {
    return map.pageProfileKey !== pageMap.pageProfileKey ||
      retained.has(map.mapVersionId);
  });
}

function newestInspectorPageMap(maps = [], pageProfileKey = "") {
  return (Array.isArray(maps) ? maps : [])
    .filter((map) => map?.pageProfileKey === pageProfileKey)
    .reduce((newest, map) => {
      if (!newest) return map;
      const currentTime = Date.parse(map.createdAt || "");
      const newestTime = Date.parse(newest.createdAt || "");
      if (Number.isFinite(currentTime) && Number.isFinite(newestTime)) {
        return currentTime > newestTime ? map : newest;
      }
      if (Number.isFinite(currentTime)) return map;
      return newest;
    }, null);
}

function isStrictlyOlderInspectorPageMap(pageMap = null, newest = null) {
  if (!pageMap || !newest) return false;
  const incomingTime = Date.parse(pageMap.createdAt || "");
  const newestTime = Date.parse(newest.createdAt || "");
  return Number.isFinite(incomingTime) &&
    Number.isFinite(newestTime) &&
    incomingTime < newestTime;
}

function normalizeInspectorSnapshotCapturedAt(value = "") {
  const capturedAt = String(value || "").trim();
  return Number.isFinite(Date.parse(capturedAt))
    ? capturedAt
    : new Date().toISOString();
}

function isUsableInspectorPageMap(map = {}) {
  return map.status !== MapperMapStatuses.Unsupported &&
    map.classification !== "dynamic_deferred" &&
    (map.components || []).length > 0;
}

async function persistAndRefresh(operation) {
  const result = await operation();

  chrome.runtime
    .sendMessage({
      type: Messages.RefreshWorkflowLists,
    })
    .catch(() => {});

  return result;
}

async function runWorkflowByName(filename) {
  const loaded = await NativeBridge.loadWorkflow(filename);

  const workflow =
    loaded?.content || loaded?.workflow || loaded?.data || loaded;

  return await runWorkflow(workflow, {
    workflowName: filename,
  });
}

async function runWorkflow(rawWorkflow, options = {}) {
  if (runtimeState.isRunning()) {
    return {
      ok: false,
      error: "Another workflow is already running.",
    };
  }

  if (runtimeState.isRecording()) {
    return {
      ok: false,
      error: "Stop recording before running a workflow.",
    };
  }

  const mapperGraphWorkflow = isMapperGraphWorkflow(rawWorkflow)
    ? normalizeMapperGraphWorkflowForRun(rawWorkflow)
    : null;
  const workflow = mapperGraphWorkflow || normalizeWorkflow(rawWorkflow);
  const steps = mapperGraphWorkflow
    ? mapperGraphWorkflow.nodes.map(graphNodeToStep)
    : workflow.steps;

  if (!Array.isArray(steps) || steps.length === 0) {
    return {
      ok: false,
      error: "Workflow has no steps.",
    };
  }

  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const workflowName =
    options.workflowName || rawWorkflow?.name || "Unsaved Workflow";

  runtimeState.updateExecution({
    status: "running",
    runId,
    workflowName,
    currentStepIndex: -1,
    currentNodeId: "",
    totalSteps: steps.length,
    currentAction: "",
    error: "",
    diagnostics: null,
    variables: [],
    skippedSteps: 0,
    completedNodeIds: [],
    skippedNodeIds: [],
    unresolvedNodeIds: [],
    logs: [],
  });
  const variableRegistry = new VariableRegistry(workflow.variables || {});
  const variableOrigins = Object.fromEntries(
    Object.keys(workflow.variables || {}).map((name) => [
      name,
      {
        source: "workflow",
        nodeId: "",
        action: "workflow.variable",
      },
    ]),
  );
  activeRun = {
    runId,
    cancelRequested: false,
    abortControllers: new Set(),
    variableRegistry,
    variableOrigins,
  };
  runtimeState.appendExecutionLog({
    runId,
    workflowName,
    status: "started",
    message: "Workflow started.",
  });
  runtimeState.updateExecution({
    variables: summarizeVariables(variableRegistry.snapshot(), variableOrigins),
  });

  try {
    await loadWorkflowDataSources({
      workflow,
      variableRegistry,
      variableOrigins,
      runId,
      workflowName,
    });
    runtimeState.updateExecution({
      variables: summarizeVariables(variableRegistry.snapshot(), variableOrigins),
    });

    let tab = await resolveStartingTab(workflow);
    const tabsByRef = new Map();
    const initialTabRef = steps.find((step) => step?.tabRef)?.tabRef;
    if (initialTabRef && tab?.id) {
      tabsByRef.set(initialTabRef, tab);
    }

    const executionResult = mapperGraphWorkflow
      ? await executeMapperGraphWorkflow({
        workflow,
        tab,
        tabsByRef,
        variableRegistry,
        variableOrigins,
        runId,
        workflowName,
      })
      : await executeLinearWorkflowSteps({
        steps,
        tab,
        tabsByRef,
        variableRegistry,
        variableOrigins,
        runId,
        workflowName,
      });

    const {
      executedCount,
      skippedCount,
      unresolvedCount,
    } = executionResult;
    tab = executionResult.tab;

    runtimeState.appendExecutionLog({
      runId,
      workflowName,
      status: "completed",
      message: `Workflow completed: ${executedCount} executed, ${skippedCount} bypassed, ${unresolvedCount || 0} unresolved.`,
    }, {
      status: "completed",
      currentStepIndex: steps.length - 1,
      currentNodeId: "",
      currentAction: "",
    });

    chrome.runtime
      .sendMessage({
        type: Messages.WorkflowComplete,
        workflow,
      })
      .catch(() => {});

    return {
      ok: true,
      executed: executedCount,
      skipped: skippedCount,
      runId,
      variables: variableRegistry.snapshot(),
    };
  } catch (error) {
    if (
      error?.name === "WorkflowCancelledError" ||
      (activeRun?.runId === runId && activeRun.cancelRequested)
    ) {
      runtimeState.appendExecutionLog({
        runId,
        workflowName,
        nodeId: runtimeState.getState().execution.currentNodeId,
        stepIndex: runtimeState.getState().execution.currentStepIndex,
        status: "cancelled",
        message: "Workflow stopped by user.",
        diagnostics: { finalReason: "workflow_cancelled" },
      }, {
        status: "cancelled",
        currentAction: "",
        error: "Workflow stopped by user.",
        diagnostics: { finalReason: "workflow_cancelled" },
      });

      return {
        ok: true,
        cancelled: true,
        runId,
      };
    }

    const failedExecution = runtimeState.getState().execution;
    const safeFailure = safeExecutionFailure(error, failedExecution.currentAction);
    runtimeState.appendExecutionLog({
      runId,
      workflowName,
      nodeId: failedExecution.currentNodeId,
      stepIndex: failedExecution.currentStepIndex,
      action: failedExecution.currentAction,
      status: "failed",
      message: safeFailure.message,
      diagnostics: safeFailure.diagnostics,
    }, {
      status: "failed",
      currentAction: "",
      error: safeFailure.message,
      diagnostics: safeFailure.diagnostics,
    });
    throw error;
  } finally {
    if (activeRun?.runId === runId) {
      activeRun = null;
    }
  }
}

async function executeLinearWorkflowSteps({
  steps = [],
  tab,
  tabsByRef,
  variableRegistry,
  variableOrigins,
  runId,
  workflowName,
}) {
  const progress = createExecutionProgress();
  let currentTab = tab;

  for (let index = 0; index < steps.length; index++) {
    const result = await executeWorkflowNode({
      step: steps[index],
      index,
      totalSteps: steps.length,
      tab: currentTab,
      tabsByRef,
      variableRegistry,
      variableOrigins,
      runId,
      workflowName,
      progress,
      allowUnresolvedRoute: false,
    });
    currentTab = result.tab;
  }

  return {
    ...progress,
    tab: currentTab,
  };
}

async function executeMapperGraphWorkflow({
  workflow,
  tab,
  tabsByRef,
  variableRegistry,
  variableOrigins,
  runId,
  workflowName,
}) {
  const progress = createExecutionProgress();
  const nodeById = new Map(workflow.nodes.map((node) => [node.id, node]));
  const outgoing = createGraphOutgoingIndex(workflow.edges);
  const maxVisits = Math.max(1, workflow.nodes.length + workflow.edges.length + 1);
  let currentNodeId = workflow.entryNodeId;
  let currentTab = tab;
  let visitCount = 0;

  while (currentNodeId) {
    throwIfRunCancelled(runId);
    visitCount += 1;
    if (visitCount > maxVisits) {
      const error = new Error("Mapper graph traversal exceeded the safe node limit.");
      error.diagnostics = {
        action: "workflow.graph",
        finalReason: "graph_traversal_limit_exceeded",
      };
      throw error;
    }

    const node = nodeById.get(currentNodeId);
    if (!node) {
      const error = new Error(`Mapper graph references missing node "${currentNodeId}".`);
      error.diagnostics = {
        action: "workflow.graph",
        finalReason: "graph_missing_node",
      };
      throw error;
    }

    const result = await executeWorkflowNode({
      step: graphNodeToStep(node),
      index: visitCount - 1,
      totalSteps: workflow.nodes.length,
      tab: currentTab,
      tabsByRef,
      variableRegistry,
      variableOrigins,
      runId,
      workflowName,
      progress,
      allowUnresolvedRoute: true,
    });
    currentTab = result.tab;

    const route = result.route || GraphEdgeHandles.Success;
    const nextEdge = outgoing.get(node.id)?.[route] || null;
    if (!nextEdge) {
      if (route === GraphEdgeHandles.Unresolved) {
        const error = new Error(`Mapper unresolved node "${node.id}" has no unresolved route.`);
        error.diagnostics = {
          action: node.type || "unknown",
          finalReason: "mapper_unresolved_route_missing",
        };
        throw error;
      }
      break;
    }

    currentNodeId = nextEdge.target || "";
  }

  return {
    ...progress,
    tab: currentTab,
  };
}

async function executeWorkflowNode({
  step,
  index,
  totalSteps,
  tab,
  tabsByRef,
  variableRegistry,
  variableOrigins,
  runId,
  workflowName,
  progress,
  allowUnresolvedRoute = false,
}) {
  throwIfRunCancelled(runId);

  let resolvedStep;

  runtimeState.updateExecution({
    currentStepIndex: index,
    currentNodeId: step?.id || "",
    currentAction: step?.action || step?.type || "unknown",
  });

  let bypassDecision;
  try {
    bypassDecision = resolveStepBypass(step, variableRegistry);
  } catch (error) {
    error.diagnostics = {
      action: step?.action || step?.type || "unknown",
      stepIndex: index,
      valuePath: `step.${step?.id || "unknown"}.skipWhen`,
      finalReason: "bypass_condition_failed",
    };
    throw error;
  }

  if (bypassDecision.skip) {
    progress.skippedCount += 1;
    if (step?.id) progress.skippedNodeIds.push(step.id);
    runtimeState.appendExecutionLog({
      runId,
      workflowName,
      nodeId: step?.id || "",
      stepIndex: index,
      action: step?.action || step?.type || "unknown",
      status: "skipped",
      message: "Node bypassed.",
    }, {
      skippedSteps: progress.skippedCount,
      skippedNodeIds: [...progress.skippedNodeIds],
    });
    console.log(
      `[BRunner] Bypassing step ${index + 1}/${totalSteps}:`,
      {
        id: step?.id || "",
        action: step?.action || step?.type || "unknown",
        mode: bypassDecision.mode,
      },
    );
    return { tab, route: GraphEdgeHandles.Success };
  }

  try {
    resolvedStep = resolveStepExpressions(step, variableRegistry);
  } catch (error) {
    error.diagnostics = {
      action: step?.action || step?.type || "unknown",
      stepIndex: index,
      variableName: error.variableName || "",
      valuePath: error.valuePath || "",
      finalReason: "variable_resolution_failed",
    };
    throw error;
  }

  runtimeState.updateExecution({
    currentStepIndex: index,
    currentAction:
      resolvedStep?.action || resolvedStep?.type || "unknown",
  });

  assertNativeHostRequirement(resolvedStep, index);

  runtimeState.appendExecutionLog({
    runId,
    workflowName,
    nodeId: resolvedStep?.id || "",
    stepIndex: index,
    action: resolvedStep?.action || resolvedStep?.type || "unknown",
    status: "running",
    message: "Node started.",
  });

  console.log(
    `[BRunner] Executing step ${index + 1}/${totalSteps}:`,
    {
      nodeId: String(resolvedStep?.id || "").slice(0, 160),
      action: String(resolvedStep?.action || resolvedStep?.type || "unknown").slice(0, 160),
      tabRef: String(resolvedStep?.tabRef || "").slice(0, 160),
      hasComponentRef: Boolean(resolvedStep?.componentRef),
    },
  );

  let currentTab = tab;
  if (resolvedStep?.tabRef && tabsByRef.has(resolvedStep.tabRef)) {
    const referencedTab = tabsByRef.get(resolvedStep.tabRef);

    try {
      currentTab = await chrome.tabs.get(referencedTab.id);
    } catch {
      tabsByRef.delete(resolvedStep.tabRef);
    }
  }

  try {
    currentTab = await executeStep(
      currentTab,
      resolvedStep,
      tabsByRef,
      variableRegistry,
      runId,
    );
  } catch (error) {
    if (!allowUnresolvedRoute || !isMapperUnresolvedError(error)) {
      throw error;
    }
    return handleMapperUnresolvedNode({
      error,
      step: resolvedStep,
      index,
      runId,
      workflowName,
      variableRegistry,
      variableOrigins,
      progress,
      tab: currentTab,
    });
  }

  progress.executedCount += 1;
  if (resolvedStep?.id) progress.completedNodeIds.push(resolvedStep.id);
  runtimeState.appendExecutionLog({
    runId,
    workflowName,
    nodeId: resolvedStep?.id || "",
    stepIndex: index,
    action: resolvedStep?.action || resolvedStep?.type || "unknown",
    status: "completed",
    message: "Node completed.",
  }, {
    completedNodeIds: [...progress.completedNodeIds],
  });

  registerNodeOutputVariable(resolvedStep, variableOrigins);
  runtimeState.updateExecution({
    variables: summarizeVariables(
      variableRegistry.snapshot(),
      variableOrigins,
    ),
  });

  throwIfRunCancelled(runId);

  if (
    resolvedStep?.tabRef &&
    currentTab?.id &&
    ![
      Actions.BrowserTabOpen,
      Actions.BrowserTabClose,
    ].includes(resolvedStep.action || resolvedStep.type)
  ) {
    tabsByRef.set(resolvedStep.tabRef, currentTab);
  }
  await delayWithRunCancellation(Defaults.StepDelayMs, runId);
  throwIfRunCancelled(runId);

  return { tab: currentTab, route: GraphEdgeHandles.Success };
}

function handleMapperUnresolvedNode({
  error,
  step,
  index,
  runId,
  workflowName,
  variableRegistry,
  variableOrigins,
  progress,
  tab,
}) {
  const diagnostics = createMapperUnresolvedDiagnostics(error, step, index);
  const output = {
    state: diagnostics.mapperState || "unresolved",
    componentId: diagnostics.componentId || step?.componentRef?.componentId || "",
    pageProfileKey: diagnostics.pageProfileKey || step?.componentRef?.pageProfileKey || "",
    mapVersionId: diagnostics.mapVersionId || step?.componentRef?.capturedMapVersionId || "",
    reason: diagnostics.mapperReason || diagnostics.finalReason || "",
  };
  const outputVariableName = inferOutputVariableName(step);
  if (outputVariableName) {
    variableRegistry?.set(outputVariableName, output);
    registerNodeOutputVariable(step, variableOrigins);
  }

  progress.unresolvedCount += 1;
  if (step?.id) progress.unresolvedNodeIds.push(step.id);
  runtimeState.appendExecutionLog({
    runId,
    workflowName,
    nodeId: step?.id || "",
    stepIndex: index,
    action: step?.action || step?.type || "unknown",
    status: "unresolved",
    message: `Mapper routed unresolved target: ${output.state}.`,
    diagnostics,
  }, {
    unresolvedNodeIds: [...progress.unresolvedNodeIds],
    variables: summarizeVariables(
      variableRegistry.snapshot(),
      variableOrigins,
    ),
  });

  return {
    tab,
    route: GraphEdgeHandles.Unresolved,
  };
}

function createExecutionProgress() {
  return {
    executedCount: 0,
    skippedCount: 0,
    unresolvedCount: 0,
    completedNodeIds: [],
    skippedNodeIds: [],
    unresolvedNodeIds: [],
  };
}

function registerNodeOutputVariable(step = {}, variableOrigins = {}) {
  const outputVariableName = inferOutputVariableName(step);
  if (!outputVariableName) return;
  variableOrigins[outputVariableName] = {
    source: "node",
    nodeId: step.id || "",
    action: step.action || step.type || "unknown",
  };
}

function isMapperUnresolvedError(error) {
  const state = String(error?.diagnostics?.mapperState || "").trim();
  if (!state) return false;
  return !["resolved", "resolved_with_fallback"].includes(state);
}

function createMapperUnresolvedDiagnostics(error, step = {}, stepIndex = -1) {
  const diagnostics = error?.diagnostics && typeof error.diagnostics === "object"
    ? error.diagnostics
    : {};
  const componentRef = step?.componentRef || {};
  return {
    action: diagnostics.action || step?.action || step?.type || "unknown",
    stepIndex,
    finalReason: diagnostics.finalReason || `mapper_${diagnostics.mapperState || "unresolved"}`,
    mapperState: diagnostics.mapperState || "unresolved",
    mapperReason: diagnostics.mapperReason || diagnostics.reason || "",
    componentId: diagnostics.componentId || componentRef.componentId || "",
    pageProfileKey: diagnostics.pageProfileKey || componentRef.pageProfileKey || "",
    mapVersionId: diagnostics.mapVersionId || componentRef.capturedMapVersionId || "",
    confidence: Number.isFinite(diagnostics.confidence) ? diagnostics.confidence : undefined,
    runnerUpConfidence: Number.isFinite(diagnostics.runnerUpConfidence)
      ? diagnostics.runnerUpConfidence
      : undefined,
  };
}

function normalizeMapperGraphWorkflowForRun(input = {}) {
  const validation = validateGraphWorkflow(input);
  if (!validation.valid) {
    throw new Error(`Invalid mapper graph workflow: ${validation.errors.join(" ")}`);
  }
  return {
    schemaVersion: WorkflowSchemaVersion.MapperGraph,
    id: String(input.id || "workflow-v3"),
    name: String(input.name || "Untitled"),
    description: typeof input.description === "string" ? input.description : "",
    boundDomain: typeof input.boundDomain === "string" ? input.boundDomain : "",
    variables:
      input.variables && typeof input.variables === "object"
        ? structuredClone(input.variables)
        : {},
    datasets:
      input.datasets && typeof input.datasets === "object" && !Array.isArray(input.datasets)
        ? structuredClone(input.datasets)
        : {},
    dataSources: Array.isArray(input.dataSources)
      ? structuredClone(input.dataSources)
      : [],
    settings: normalizeWorkflowSettings(input.settings),
    entryNodeId: String(input.entryNodeId || ""),
    nodes: structuredClone(input.nodes || []),
    edges: structuredClone(input.edges || []),
  };
}

function graphNodeToStep(node = {}) {
  return {
    ...(node.data && typeof node.data === "object" ? structuredClone(node.data) : {}),
    id: node.id || "",
    action: node.type || "",
    type: node.type || "",
    version: Number(node.version) || 1,
    config: node.config && typeof node.config === "object"
      ? structuredClone(node.config)
      : {},
  };
}

function createGraphOutgoingIndex(edges = []) {
  const outgoing = new Map();
  for (const edge of edges) {
    const source = String(edge?.source || "");
    if (!source) continue;
    const sourceHandle = edge.sourceHandle || GraphEdgeHandles.Success;
    const entry = outgoing.get(source) || {};
    entry[sourceHandle] = edge;
    outgoing.set(source, entry);
  }
  return outgoing;
}

async function loadWorkflowDataSources({
  workflow,
  variableRegistry,
  variableOrigins,
  runId,
  workflowName,
}) {
  const sources = Array.isArray(workflow?.dataSources)
    ? workflow.dataSources
    : [];
  if (!sources.length) return;

  const requirement = {
    mode: NativeHostRequirementModes.Required,
    capabilities: [NativeHostCapabilities.DataSourceRead],
  };
  const evaluation = evaluateNativeHostRequirement(
    requirement,
    NativeBridge.getStatus(),
  );
  if (!evaluation.ok) {
    const error = new Error(evaluation.message || "Native host is required for data sources.");
    error.diagnostics = {
      action: "data.source.load",
      finalReason: evaluation.finalReason,
      capabilities: evaluation.missingCapabilities,
    };
    throw error;
  }

  for (const source of sources) {
    const variableName = normalizeDataSourceVariableName(
      source?.variableName || source?.id || source?.name,
    );
    if (!variableName) {
      const error = new Error("Data source requires a safe source name.");
      error.diagnostics = {
        action: "data.source.load",
        finalReason: "invalid_data_source_name",
      };
      throw error;
    }

    runtimeState.appendExecutionLog({
      runId,
      workflowName,
      action: "data.source.load",
      status: "started",
      message: `Loading data source ${variableName}.`,
    });

    const result = await NativeBridge.readDataSource(source);
    variableRegistry.set(variableName, result.data);
    variableOrigins[variableName] = {
      source: "dataSource",
      nodeId: "",
      action: "data.source.load",
      filename: result.filename || "",
      format: result.format || "",
      kind: result.kind || "",
    };
    runtimeState.appendExecutionLog({
      runId,
      workflowName,
      action: "data.source.load",
      status: "completed",
      message: `Loaded data source ${variableName}: ${result.preview || "data available"}.`,
      diagnostics: {
        sourceId: source?.id || "",
        format: result.format || "",
        kind: result.kind || "",
        rows: result.rows || 0,
        columns: result.columns || 0,
      },
    });
  }
}

function normalizeDataSourceVariableName(value) {
  const name = String(value || "").trim();
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : "";
}

async function stopActiveWorkflow(expectedRunId = "") {
  if (!activeRun || runtimeState.getState().execution.status !== "running") {
    return {
      ok: false,
      error: "No workflow is currently running.",
    };
  }

  if (expectedRunId && expectedRunId !== activeRun.runId) {
    return {
      ok: false,
      code: "stale_execution_session",
      error: "Stop request belongs to an inactive workflow run.",
      runId: activeRun.runId,
    };
  }

  const runId = activeRun.runId;
  activeRun.cancelRequested = true;
  for (const controller of activeRun.abortControllers || []) {
    controller.abort();
  }
  runtimeState.updateExecution({
    status: "cancelling",
    currentAction: "",
    error: "",
  });

  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs.filter(isAutomationTab).map((tab) => {
      return chrome.tabs.sendMessage(tab.id, {
        type: Messages.CancelExecution,
        runId,
      });
    }),
  );

  return {
    ok: true,
    runId,
    status: "cancelling",
  };
}

function throwIfRunCancelled(runId) {
  if (activeRun?.runId === runId && activeRun.cancelRequested) {
    const error = new Error("Workflow stopped by user.");
    error.name = "WorkflowCancelledError";
    throw error;
  }
}

async function delayWithRunCancellation(ms, runId) {
  let remaining = Math.max(Number(ms) || 0, 0);

  while (remaining > 0) {
    throwIfRunCancelled(runId);
    const chunk = Math.min(remaining, 100);
    await delay(chunk);
    remaining -= chunk;
  }

  throwIfRunCancelled(runId);
}

async function resolveStartingTab(workflow) {
  const activeTab = await getActiveTab();
  const boundDomain = String(workflow.boundDomain || "").trim();
  const reuseExistingTabs = workflow.settings?.reuseExistingTabs === true;

  if (boundDomain) {
    const boundUrl = normalizeBoundDomainUrl(boundDomain);
    const boundHostname = extractDomainFromUrl(boundUrl) || boundDomain;

    if (reuseExistingTabs) {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const matchingTab = tabs.find((tab) => {
        return (
          isAutomationTab(tab) &&
          isDomainCompatible(tab.url || "", boundHostname)
        );
      });

      if (matchingTab) {
        await chrome.tabs.update(matchingTab.id, { active: true });
        return matchingTab;
      }
    }

    if (isReplaceableStartupTab(activeTab)) {
      if (isDomainCompatible(activeTab.url || "", boundHostname)) {
        return activeTab;
      }

      await navigateTab(activeTab.id, boundUrl);
      await delay(Defaults.PageSettleDelayMs);
      return await chrome.tabs.get(activeTab.id);
    }

    return await createTab(boundUrl, true);
  }

  if (isAutomationTab(activeTab)) return activeTab;

  if (reuseExistingTabs) {
    const bestTab = await getBestAutomationTab();
    if (bestTab) return bestTab;
  }

  throw new Error("No suitable browser tab found for workflow execution.");
}

function normalizeBoundDomainUrl(boundDomain) {
  const value = String(boundDomain || "").trim();
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function isReplaceableStartupTab(tab) {
  if (!tab?.id || !tab.url || isStudioUrl(tab.url)) return false;
  if (isAutomationTab(tab)) return true;

  return /^(chrome|edge):\/\/newtab\/?$/i.test(tab.url) ||
    /^about:blank$/i.test(tab.url);
}

function isDomainCompatible(url, boundDomain) {
  if (!boundDomain) return true;

  const currentDomain = extractDomainFromUrl(url);
  if (!currentDomain) return false;

  return (
    currentDomain === boundDomain || currentDomain.endsWith(`.${boundDomain}`)
  );
}

async function executeStep(
  currentTab,
  step,
  tabsByRef = new Map(),
  variableRegistry = null,
  runId = "",
) {
  const action = step.action || step.type;

  if (action === MapperAttentionNodeType) {
    return currentTab;
  }

  if (action === Actions.BrowserTabSwitch) {
    return await executeTabSwitch(currentTab, step, tabsByRef);
  }

  if (action === Actions.BrowserSearch) {
    return await executeBrowserSearchStep(currentTab, step);
  }

  if (
    [
      Actions.BrowserBack,
      Actions.BrowserForward,
      Actions.BrowserReload,
      Actions.BrowserTabOpen,
      Actions.BrowserTabClose,
    ].includes(action)
  ) {
    return await executeBrowserLifecycleStep(currentTab, step, tabsByRef);
  }

  if (action === Actions.BrowserNavigate) {
    return await executeNavigateStep(currentTab, step);
  }

  if (action === Actions.HttpRequest) {
    await executeHttpRequestStep(step, variableRegistry, runId);
    return currentTab;
  }

  if ([Actions.ClipboardRead, Actions.ClipboardWrite].includes(action)) {
    await executeClipboardStep(action, step, variableRegistry, runId);
    return currentTab;
  }

  if (action === Actions.DownloadWait) {
    await executeDownloadWaitStep(step, variableRegistry, runId);
    return currentTab;
  }

  if (isApprovedDirectoryAction(action)) {
    await executeApprovedDirectoryStep(action, step, variableRegistry);
    return currentTab;
  }

  if (action === Actions.ScreenshotCapture) {
    const captureTab = step?.page?.url
      ? await ensureStepPageContext(currentTab, step)
      : currentTab?.id ? await chrome.tabs.get(currentTab.id) : currentTab;

    if (!isAutomationTab(captureTab) || isStudioUrl(captureTab?.url || "")) {
      const error = new Error(
        "Screenshot Capture supports only normal HTTP(S) workflow tabs.",
      );
      error.diagnostics = {
        action,
        finalReason: "screenshot_restricted_page",
      };
      throw error;
    }

    await executeScreenshotCaptureStep(
      captureTab,
      step,
      variableRegistry,
      runId,
    );
    return captureTab;
  }

  const contextReadyTab = await ensureStepPageContext(currentTab, step);

  if (action === Actions.LogicWait) {
    await delayWithRunCancellation(resolveWaitDuration(step), runId);
    return contextReadyTab;
  }

  if (action === "keyboard.send_keys") {
    await NativeBridge.osKeystroke(step.keys || step.value || step.text || "");
    return contextReadyTab;
  }

  if ([Actions.DataSet, Actions.DataTemplate].includes(action)) {
    const variableName = String(
      step.config?.variableName || step.variableName || "",
    ).trim();

    if (!variableName) {
      throw new Error(`${action} requires an output variable name.`);
    }

    const value = action === Actions.DataTemplate
      ? step.config?.template ?? ""
      : step.config?.value;

    variableRegistry?.set(variableName, value);
    return contextReadyTab;
  }

  if (isDataTransformAction(action)) {
    const variableName = String(step.config?.variableName || "").trim();

    if (!variableName) {
      throw new Error(`${action} requires an output variable name.`);
    }

    const value = executeDataTransform(action, step.config || {});
    variableRegistry?.set(variableName, value);
    return contextReadyTab;
  }

  if (
    step?.page?.access === "restricted" ||
    isBrowserInternalUrl(contextReadyTab?.url || "")
  ) {
    const error = new Error(
      `Content action ${action || "unknown"} cannot run on a restricted browser page.`,
    );
    error.diagnostics = {
      action: action || "unknown",
      expectedPage: step?.page || null,
      actualPage: getPageContextFromUrl(
        contextReadyTab?.url || "",
        contextReadyTab?.title || "",
      ),
      finalReason: "restricted_page_content_action",
    };
    throw error;
  }

  if (action === Actions.FileLocalUpload) {
    await executeLocalFileUploadStep(
      contextReadyTab,
      step,
      variableRegistry,
      runId,
    );
    return contextReadyTab;
  }

  let extractionVariableName = "";
  if (isExtractionAction(action)) {
    extractionVariableName = String(
      step.config?.variableName || step.variableName || "",
    ).trim();

    if (!extractionVariableName) {
      throw new Error("Extract Data requires an output variable name.");
    }
  }

  let fileUploadVariableName = "";
  if (action === Actions.FileInputUpload) {
    fileUploadVariableName = String(
      step.config?.variableName || step.variableName || "",
    ).trim();

    if (!fileUploadVariableName) {
      const error = new Error("File Input Upload requires an output variable name.");
      error.diagnostics = {
        action,
        finalReason: "file_upload_output_variable_missing",
      };
      throw error;
    }
  }

  const response = await executeContentStepWithVisibleHostFallback(
    contextReadyTab,
    step,
    runId,
  );

  if (isExtractionAction(action)) {
    variableRegistry?.set(extractionVariableName, response?.value ?? "");
  }

  if (action === Actions.FileInputUpload) {
    variableRegistry?.set(fileUploadVariableName, response?.value ?? null);
  }

  return contextReadyTab;
}

function assertNativeHostRequirement(step, stepIndex = -1) {
  const action = step?.action || step?.type || "unknown";
  const definition = getNodeDefinition(action);
  if (!definition?.nativeHost) return;

  const result = evaluateNativeHostRequirement(
    definition.nativeHost,
    NativeBridge.getStatus(),
  );
  if (result.ok) return;

  const error = new Error(result.message);
  error.diagnostics = {
    action,
    nodeId: step?.id || "",
    stepIndex,
    nativeHostRequirement: result.requirement.mode,
    requiredCapabilities: result.requirement.capabilities,
    missingCapabilities: result.missingCapabilities,
    requiredCapabilityLabels: formatNativeCapabilities(result.missingCapabilities),
    finalReason: result.finalReason,
  };
  throw error;
}

async function executeHttpRequestStep(step, variableRegistry, runId) {
  const variableName = String(
    step.config?.variableName || step.variableName || "",
  ).trim();

  if (!variableName) {
    const error = new Error("HTTP Request requires an output variable name.");
    error.diagnostics = {
      action: Actions.HttpRequest,
      finalReason: "http_output_variable_missing",
    };
    throw error;
  }

  throwIfRunCancelled(runId);
  const controller = new AbortController();
  const controllers = activeRun?.runId === runId
    ? activeRun.abortControllers
    : null;
  controllers?.add(controller);

  try {
    const value = await executeHttpRequest(step.config || {}, {
      signal: controller.signal,
    });
    throwIfRunCancelled(runId);
    variableRegistry?.set(variableName, value);
  } finally {
    controllers?.delete(controller);
  }
}

function isApprovedDirectoryAction(action) {
  return [
    Actions.ApprovedFilesFind,
    Actions.ApprovedFileWrite,
    Actions.DataFileExport,
  ].includes(action);
}

async function executeApprovedDirectoryStep(action, step, variableRegistry) {
  const variableName = String(
    step.config?.variableName || step.variableName || "",
  ).trim();

  if (!variableName) {
    const error = new Error(`${action} requires an output variable name.`);
    error.diagnostics = {
      action,
      finalReason: "approved_directory_output_variable_missing",
    };
    throw error;
  }

  let value;
  if (action === Actions.ApprovedFilesFind) {
    value = await NativeBridge.findApprovedFiles(step.config || {});
  } else if (action === Actions.ApprovedFileWrite) {
    value = await NativeBridge.writeApprovedFile(step.config || {});
  } else if (action === Actions.DataFileExport) {
    value = await NativeBridge.exportDataFile(step.config || {});
  } else {
    throw new Error(`Unsupported approved directory action: ${action || "unknown"}`);
  }

  variableRegistry?.set(variableName, value);
}

async function executeClipboardStep(action, step, variableRegistry, runId) {
  const variableName = String(
    step.config?.variableName || step.variableName || "",
  ).trim();

  if (action === Actions.ClipboardRead && !variableName) {
    const error = new Error("Clipboard Read requires an output variable name.");
    error.diagnostics = {
      action,
      finalReason: "clipboard_output_variable_missing",
    };
    throw error;
  }

  throwIfRunCancelled(runId);
  const result = await executeClipboardAction(action, step.config || {}, {
    readText: () => sendOffscreenClipboardOperation("readText"),
    writeText: (value) => {
      return sendOffscreenClipboardOperation("writeText", value);
    },
  });
  throwIfRunCancelled(runId);

  if (variableName) variableRegistry?.set(variableName, result);
}

async function executeDownloadWaitStep(step, variableRegistry, runId) {
  const variableName = String(
    step.config?.variableName || step.variableName || "",
  ).trim();

  if (!variableName) {
    const error = new Error("Download Wait requires an output variable name.");
    error.diagnostics = {
      action: Actions.DownloadWait,
      finalReason: "download_output_variable_missing",
    };
    throw error;
  }

  throwIfRunCancelled(runId);
  const controller = new AbortController();
  const controllers = activeRun?.runId === runId
    ? activeRun.abortControllers
    : null;
  controllers?.add(controller);

  try {
    const value = await waitForDownload(step.config || {}, {
      downloadsApi: chrome.downloads,
      signal: controller.signal,
    });
    throwIfRunCancelled(runId);
    variableRegistry?.set(variableName, value);
  } finally {
    controllers?.delete(controller);
  }
}

async function executeScreenshotCaptureStep(
  tab,
  step,
  variableRegistry,
  runId,
) {
  const variableName = String(
    step.config?.variableName || step.variableName || "",
  ).trim();

  if (!variableName) {
    const error = new Error("Screenshot Capture requires an output variable name.");
    error.diagnostics = {
      action: Actions.ScreenshotCapture,
      finalReason: "screenshot_output_variable_missing",
    };
    throw error;
  }

  throwIfRunCancelled(runId);
  const value = await captureScreenshot(tab, step.config || {}, {
    activateTab: async (tabId, windowId) => {
      await chrome.windows.update(windowId, { focused: true });
      await chrome.tabs.update(tabId, { active: true });
      await delay(150);
    },
    captureVisibleTab: async (windowId, options) => {
      try {
        return await chrome.tabs.captureVisibleTab(windowId, options);
      } catch {
        await delay(150);
        return await chrome.tabs.captureVisibleTab(windowId, options);
      }
    },
    download: (options) => chrome.downloads.download(options),
  });
  throwIfRunCancelled(runId);
  variableRegistry?.set(variableName, value);
}

async function executeLocalFileUploadStep(
  tab,
  step,
  variableRegistry,
  runId,
) {
  const config = step.config || {};
  const approved = [true, "true", "allow"].includes(config.allowLocalFileRead);
  const variableName = String(config.variableName || step.variableName || "").trim();

  if (!approved) {
    const error = new Error(
      "Local File Upload requires explicit node-level file-read approval.",
    );
    error.diagnostics = {
      action: Actions.FileLocalUpload,
      finalReason: "local_file_read_not_approved",
    };
    throw error;
  }

  if (!variableName) {
    const error = new Error("Local File Upload requires an output variable name.");
    error.diagnostics = {
      action: Actions.FileLocalUpload,
      finalReason: "local_file_output_variable_missing",
    };
    throw error;
  }

  throwIfRunCancelled(runId);
  let fileData;
  try {
    fileData = await NativeBridge.readLocalFile(config.path || "");
  } catch (error) {
    const wrapped = new Error(error.message || "Native local file read failed.");
    wrapped.diagnostics = {
      action: Actions.FileLocalUpload,
      finalReason: "local_file_read_failed",
    };
    throw wrapped;
  }
  throwIfRunCancelled(runId);

  const response = await executeContentStep(tab, {
    ...step,
    action: Actions.FileInputUpload,
    config: {
      sourceType: "base64",
      filename: fileData.filename,
      mimeType: fileData.mimeType,
      content: fileData.content,
      variableName,
    },
  }, runId);
  throwIfRunCancelled(runId);
  variableRegistry?.set(variableName, response?.value ?? null);
}

async function sendOffscreenClipboardOperation(operation, value = "") {
  await ensureClipboardOffscreenDocument();

  const response = await chrome.runtime.sendMessage({
    target: "offscreen.clipboard",
    operation,
    ...(operation === "writeText" ? { value } : {}),
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Clipboard operation failed.");
  }

  return operation === "readText" ? String(response.value ?? "") : undefined;
}

async function ensureClipboardOffscreenDocument() {
  if (!chrome.offscreen?.createDocument) {
    throw new Error("Chrome offscreen documents are unavailable.");
  }

  const documentUrl = chrome.runtime.getURL("offscreen/clipboard.html");
  let exists = false;

  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [documentUrl],
    });
    exists = contexts.length > 0;
  } else if (chrome.offscreen.hasDocument) {
    exists = await chrome.offscreen.hasDocument();
  }

  if (exists) return;

  if (!offscreenClipboardCreation) {
    offscreenClipboardCreation = chrome.offscreen.createDocument({
      url: "offscreen/clipboard.html",
      reasons: ["CLIPBOARD"],
      justification: "Read or write clipboard text for an explicit workflow node.",
    });
  }

  try {
    await offscreenClipboardCreation;
  } finally {
    offscreenClipboardCreation = null;
  }
}

async function executeBrowserLifecycleStep(currentTab, step, tabsByRef) {
  const action = step.action || step.type;

  if (action === Actions.BrowserTabOpen) {
    const url = normalizeNavigationUrl(step.config?.url || step.url || "");
    const continueIn = step.config?.continueIn || (
      step.config?.switchToNewTab === "false" ? "currentTab" : "newTab"
    );
    const switchToNewTab = continueIn === "newTab";
    const openedTab = await createTab(url, switchToNewTab);
    const logicalRef = String(step.config?.tabRef || step.tabRef || "").trim();

    if (logicalRef) tabsByRef.set(logicalRef, openedTab);
    return switchToNewTab ? openedTab : currentTab;
  }

  if (!currentTab?.id) {
    throw new Error(`${action} requires a current browser tab.`);
  }

  if (action === Actions.BrowserBack) {
    const navigated = await navigateBrowserHistory(
      "back",
      currentTab,
      step.config?.ifUnavailable || "continue",
    );
    if (!navigated) return await chrome.tabs.get(currentTab.id);
    await waitForTabComplete(currentTab.id);
    return await chrome.tabs.get(currentTab.id);
  }

  if (action === Actions.BrowserForward) {
    const navigated = await navigateBrowserHistory(
      "forward",
      currentTab,
      step.config?.ifUnavailable || "continue",
    );
    if (!navigated) return await chrome.tabs.get(currentTab.id);
    await waitForTabComplete(currentTab.id);
    return await chrome.tabs.get(currentTab.id);
  }

  if (action === Actions.BrowserReload) {
    await chrome.tabs.reload(currentTab.id);
    await waitForTabComplete(currentTab.id);
    return await chrome.tabs.get(currentTab.id);
  }

  if (action === Actions.BrowserTabClose) {
    const shouldContinue =
      (step.config?.continueIn || "openerOrAvailable") !== "none";
    const fallbackTab = shouldContinue
      ? await resolveCloseFallback(currentTab)
      : null;

    for (const [tabRef, mappedTab] of tabsByRef.entries()) {
      if (mappedTab?.id === currentTab.id) tabsByRef.delete(tabRef);
    }

    await chrome.tabs.remove(currentTab.id);

    if (!fallbackTab?.id) return null;

    await chrome.tabs.update(fallbackTab.id, { active: true });
    return await chrome.tabs.get(fallbackTab.id);
  }

  throw new Error(`Unsupported browser lifecycle action: ${action}`);
}

async function executeBrowserSearchStep(currentTab, step) {
  const query = String(step.config?.query || step.query || "").trim();

  if (!query) {
    throw new Error("Browser Search requires a search query.");
  }

  const openIn = step.config?.openIn || "currentTab";
  const useCurrentTab = openIn !== "newTab" && Boolean(currentTab?.id);
  const tabsBefore = useCurrentTab
    ? null
    : new Set(
        (await chrome.tabs.query({ currentWindow: true })).map((tab) => tab.id),
      );

  await chrome.search.query({
    text: query,
    disposition: useCurrentTab ? "CURRENT_TAB" : "NEW_TAB",
    ...(useCurrentTab ? { tabId: currentTab.id } : {}),
  });

  if (useCurrentTab) {
    await waitForTabComplete(currentTab.id);
    return await chrome.tabs.get(currentTab.id);
  }

  const resultTab = await waitForNewTab(tabsBefore, Defaults.TabSwitchWaitMs);
  if (!resultTab) {
    throw new Error("Default-provider search did not open a results tab.");
  }

  await waitForTabComplete(resultTab.id);
  return await chrome.tabs.get(resultTab.id);
}

async function waitForNewTab(existingTabIds, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const newTab = tabs.find((tab) => !existingTabIds.has(tab.id));

    if (newTab) return newTab;
    await delay(100);
  }

  return null;
}

async function navigateBrowserHistory(direction, tab, ifUnavailable) {
  try {
    if (direction === "back") {
      await chrome.tabs.goBack(tab.id);
    } else {
      await chrome.tabs.goForward(tab.id);
    }

    return true;
  } catch (error) {
    const message = error?.message || String(error);
    const unavailable = /history|next page|previous page/i.test(message);

    if (unavailable && ifUnavailable !== "fail") {
      console.warn(
        `[BRunner] Browser ${direction} skipped because no history entry is available.`,
      );
      return false;
    }

    if (unavailable) {
      throw new Error(
        `Cannot navigate ${direction}: no matching page exists in tab history.`,
      );
    }

    throw error;
  }
}

async function resolveCloseFallback(currentTab) {
  if (currentTab.openerTabId) {
    try {
      return await chrome.tabs.get(currentTab.openerTabId);
    } catch {
      // The opener may already be closed. Continue to another safe tab.
    }
  }

  const tabs = await chrome.tabs.query({ currentWindow: true });
  const fallback = tabs.find((tab) => {
    return tab.id !== currentTab.id && isAutomationTab(tab);
  });

  return fallback || null;
}

function isExtractionAction(action) {
  return [
    Actions.ElementExtract,
    Actions.DataExtractText,
    Actions.DataExtractAttribute,
    Actions.DataExtractList,
    Actions.DataExtractTable,
    Actions.DataExtractPage,
  ].includes(action);
}

async function ensureStepPageContext(currentTab, step) {
  if (!step?.page?.url) {
    return currentTab;
  }

  const tab = currentTab?.id
    ? await chrome.tabs.get(currentTab.id)
    : currentTab;

  const currentPage = getPageContextFromUrl(tab?.url || "", tab?.title || "");
  const stepPage = step.page;

  if (pageContextsCompatible(currentPage, stepPage)) {
    return tab;
  }

  console.warn(
    "[BRunner] Step page context mismatch. Recovering by navigation.",
    {
      currentPage,
      stepPage,
      step,
    },
  );

  if (!stepPage.url) {
    throw new Error(
      `Step belongs to ${stepPage.host || stepPage.domain || "another page"}, but no recovery URL is available.`,
    );
  }

  await navigateTab(tab.id, stepPage.url);
  await delay(Defaults.PageSettleDelayMs);

  return await chrome.tabs.get(tab.id);
}

async function executeNavigateStep(currentTab, step) {
  const url = normalizeNavigationUrl(
    step.url || step.value || step.payload?.primary,
  );

  const openIn = step.openIn || step.targetTab || NavigationTargets.SameTab;

  if (openIn === NavigationTargets.NewTab) {
    return await createTab(url, true);
  }

  const tabId = currentTab?.id;

  if (!tabId) {
    return await createTab(url, true);
  }

  await navigateTab(tabId, url);
  await delay(Defaults.PageSettleDelayMs);

  return await chrome.tabs.get(tabId);
}

async function executeContentStep(tab, step, runId = "") {
  if (!tab?.id) {
    throw new Error("Cannot execute content step without a target tab.");
  }

  try {
    const executableStep = await mapperCoordinator.attachExecutionContext(step);
    const frameId = await resolveMapperFrameId(
      tab.id,
      executableStep.mapperContext?.component,
    );
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: Messages.ExecuteStep,
      step: executableStep,
      runId,
    }, { frameId });

    if (response?.ok === false) {
      await recordMapperResolutionOutcome(
        executableStep,
        response.diagnostics?.targetResolution?.mapperResolution ||
          response.mapperResolution ||
          null,
      );
      const executionError = new Error(
        response.error || "Content step failed.",
      );
      executionError.diagnostics = response.diagnostics || null;
      throw executionError;
    }

    await recordMapperResolutionOutcome(executableStep, response?.mapperResolution || null);
    return response || { ok: true };
  } catch (error) {
    console.warn("[BRunner] Content step failed:", error);

    const wrappedError = new Error(
      `Failed to execute step in tab ${tab.id}: ${error.message || error}`,
    );
    wrappedError.diagnostics = error.diagnostics || {
      action: step?.action || step?.type || "unknown",
      expectedPage: step?.page || null,
      actualPage: getPageContextFromUrl(tab.url || "", tab.title || ""),
      finalReason: "content_script_transport_failed",
    };
    throw wrappedError;
  }
}

async function recordMapperResolutionOutcome(step = {}, outcome = null) {
  if (!outcome || !step?.componentRef) return;
  try {
    await mapperCoordinator.recordResolverOutcome(step, outcome);
  } catch (error) {
    console.warn("[BRunner] Mapper reliability outcome was not persisted:", error);
  }
}

async function executeContentStepWithVisibleHostFallback(tab, step, runId = "") {
  try {
    return await executeContentStep(tab, step, runId);
  } catch (error) {
    if (isMapperUnresolvedError(error)) {
      throw error;
    }

    if (!shouldAllowVisibleHostFallback(step)) {
      throw error;
    }

    try {
      return await executeVisibleHostFallback(tab, step, runId, error);
    } catch (fallbackError) {
      const wrapped = new Error(
        fallbackError.message || "Visible host fallback failed.",
      );
      wrapped.diagnostics = {
        action: step?.action || step?.type || "unknown",
        nodeId: step?.id || "",
        browserFailure: error.diagnostics || null,
        fallbackFailure: fallbackError.diagnostics || null,
        finalReason: fallbackError.diagnostics?.finalReason || "host_fallback_failed",
      };
      throw wrapped;
    }
  }
}

async function executeVisibleHostFallback(tab, step, runId, browserError) {
  const action = step?.action || step?.type || "unknown";
  const executableStep = await mapperCoordinator.attachExecutionContext(step);
  const frameScope = executableStep.mapperContext?.component?.fingerprint?.structural?.frameScope || {};
  if (frameScope.path && frameScope.path !== "top") {
    const error = new Error("Visible host fallback is not available for nested frame coordinates.");
    error.diagnostics = {
      action,
      finalReason: "frame_host_fallback_unsupported",
      framePath: frameScope.path,
    };
    throw error;
  }
  throwIfRunCancelled(runId);

  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tab.id, { active: true });
  await delay(150);
  throwIfRunCancelled(runId);

  let prepared = await sendContentRequest(tab, {
    type: Messages.PrepareHostFallback,
    step,
    runId,
  });

  if (!prepared?.ok) {
    const error = new Error(prepared?.error || "Host fallback target preparation failed.");
    error.diagnostics = prepared?.diagnostics || {
      action,
      finalReason: "host_fallback_prepare_failed",
    };
    throw error;
  }

  await NativeBridge.hostWindow({
    expectedWindowTitle: prepared.window?.title || tab.title || "",
  });

  let visualRecovery = null;
  let hostResult = null;
  let hostActionError = null;
  try {
    hostResult = await NativeBridge.hostAction({
      action: prepared.action,
      text: prepared.text || "",
      coordinateSpace: prepared.coordinateSpace,
      clientPoint: prepared.clientPoint,
      clientBounds: prepared.clientBounds,
      devicePixelRatio: prepared.devicePixelRatio,
      coordinateConfidence: prepared.confidence,
      expectedWindowTitle: prepared.window?.title || tab.title || "",
      browserFailure: browserError?.diagnostics || null,
      nodeId: step?.id || "",
      workflowRunId: runId || "",
    });
  } catch (error) {
    hostActionError = error;
    if (shouldRetryVisibleHostGeometry(error)) {
      await delay(160);
      throwIfRunCancelled(runId);
      const refreshed = await sendContentRequest(tab, {
        type: Messages.PrepareHostFallback,
        step,
        runId,
      });
      if (refreshed?.ok) {
        prepared = refreshed;
        await NativeBridge.hostWindow({
          expectedWindowTitle: prepared.window?.title || tab.title || "",
        });
        try {
          hostResult = await NativeBridge.hostAction({
            action: prepared.action,
            text: prepared.text || "",
            coordinateSpace: prepared.coordinateSpace,
            clientPoint: prepared.clientPoint,
            clientBounds: prepared.clientBounds,
            devicePixelRatio: prepared.devicePixelRatio,
            coordinateConfidence: prepared.confidence,
            expectedWindowTitle: prepared.window?.title || tab.title || "",
            browserFailure: browserError?.diagnostics || null,
            nodeId: step?.id || "",
            workflowRunId: runId || "",
          });
          hostActionError = null;
        } catch (retryError) {
          hostActionError = retryError;
        }
      }
    }
    if (!hostResult && !shouldAllowVisualMatchFallback(step)) {
      throw hostActionError || error;
    }
  }
  throwIfRunCancelled(runId);

  let verified = hostResult
    ? await verifyVisibleHostFallback(tab, step, runId)
    : {
        ok: false,
        error: hostActionError?.message || "Coordinate host fallback failed.",
        diagnostics: {
          action,
          finalReason: "host_coordinate_fallback_failed",
          coordinateError: hostActionError?.message || null,
        },
      };

  let debuggerRecovery = null;
  if (!verified?.ok && hostResult) {
    debuggerRecovery = await recoverVisibleHostFallbackWithDebugger(
      tab,
      prepared,
      runId,
    );
    if (debuggerRecovery?.ok) {
      verified = await verifyVisibleHostFallback(tab, step, runId);
      if (verified?.ok) {
        verified.verification = "debugger_pointer_recovery";
      }
    }
  }

  if (!verified?.ok && shouldAllowVisualMatchFallback(step)) {
    visualRecovery = await recoverVisibleHostFallbackWithVisualMatch(
      tab,
      step,
      prepared,
      runId,
      browserError,
    );
    if (visualRecovery?.ok) {
      verified = await verifyVisibleHostFallback(tab, step, runId);
      if (verified?.ok) {
        verified.verification = "visual_match_recovery";
      }
    }
  }

  if (!verified?.ok) {
    const error = new Error(verified?.error || "Host fallback verification failed.");
    error.diagnostics = verified?.diagnostics || {
      action,
      finalReason: "host_fallback_verification_failed",
    };
    error.diagnostics.debuggerRecovery = debuggerRecovery?.skipped || debuggerRecovery?.error || null;
    error.diagnostics.visualRecovery = visualRecovery?.skipped || visualRecovery?.error || null;
    error.diagnostics.coordinateError = hostActionError?.message || null;
    throw error;
  }

  return {
    ok: true,
    usedStrategy: "visible_host_fallback",
    hostAction: hostResult?.action || visualRecovery?.action || prepared.action,
    browserFailure: browserError?.diagnostics || null,
    verification: verified.verification || "target_resolved",
    visualRecovery: visualRecovery?.ok === true,
  };
}

async function verifyVisibleHostFallback(tab, step, runId) {
  return await sendContentRequest(tab, {
    type: Messages.VerifyHostFallback,
    step,
    runId,
  });
}

async function recoverVisibleHostFallbackWithDebugger(tab, prepared, runId) {
  const action = prepared?.action;
  if (![ "click", "doubleClick" ].includes(action)) {
    return { ok: false, skipped: "unsupported_debugger_recovery_action" };
  }

  const point = prepared?.clientPoint;
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, skipped: "missing_debugger_recovery_point" };
  }

  throwIfRunCancelled(runId);
  const target = { tabId: tab.id };
  let attachedHere = false;

  const targets = await chrome.debugger.getTargets();
  const alreadyAttached = targets.some((item) => {
    return item.tabId === tab.id && item.attached;
  });

  if (!alreadyAttached) {
    await chrome.debugger.attach(target, "1.3");
    attachedHere = true;
  }

  try {
    const clicks = action === "doubleClick" ? 2 : 1;
    for (let index = 0; index < clicks; index++) {
      const clickCount = index + 1;
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
      });
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        clickCount,
      });
      await delay(40);
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        clickCount,
      });
      await delay(60);
      throwIfRunCancelled(runId);
    }

    return { ok: true, method: "debugger_pointer_recovery" };
  } finally {
    if (attachedHere) {
      try {
        await chrome.debugger.detach(target);
      } catch {
        // The debugger may already be detached if Chrome navigated or closed.
      }
    }
  }
}

async function recoverVisibleHostFallbackWithVisualMatch(
  tab,
  step,
  prepared,
  runId,
  browserError,
) {
  const action = prepared?.action;
  if (![ "click", "doubleClick" ].includes(action)) {
    return { ok: false, skipped: "unsupported_visual_match_action" };
  }

  try {
    throwIfRunCancelled(runId);
    const componentImage = await capturePreparedComponentImage(tab, prepared);
    const config = step?.config || {};
    const matchConfidence = normalizeVisualMatchConfidence(
      config.visualMatchConfidence,
      prepared.confidence,
    );
    const hostResult = await NativeBridge.hostVisualMatch({
      action,
      imageDataUrl: componentImage.dataUrl,
      imageWidth: componentImage.width,
      imageHeight: componentImage.height,
      matchConfidence,
      expectedWindowTitle: prepared.window?.title || tab.title || "",
      browserFailure: browserError?.diagnostics || null,
      nodeId: step?.id || "",
      workflowRunId: runId || "",
    });
    throwIfRunCancelled(runId);

    return {
      ok: true,
      action: hostResult?.action || action,
      method: hostResult?.method || "visible_host_visual_match",
      x: hostResult?.x,
      y: hostResult?.y,
      matchConfidence: hostResult?.matchConfidence ?? matchConfidence,
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || String(error),
    };
  }
}

async function capturePreparedComponentImage(tab, prepared) {
  const bounds = prepared?.clientBounds || {};
  const width = Number(bounds.width);
  const height = Number(bounds.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Visual match fallback is missing target bounds.");
  }

  const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: "png",
  });
  const imageBitmap = await dataUrlToImageBitmap(screenshot);
  const viewportWidth = positiveNumber(
    bounds.viewportWidth,
    imageBitmap.width,
  );
  const viewportHeight = positiveNumber(
    bounds.viewportHeight,
    imageBitmap.height,
  );
  const scaleX = imageBitmap.width / viewportWidth;
  const scaleY = imageBitmap.height / viewportHeight;
  const paddingX = Math.max(4, Math.ceil(4 * scaleX));
  const paddingY = Math.max(4, Math.ceil(4 * scaleY));
  const sourceLeft = Math.max(
    0,
    Math.floor(Number(bounds.left) * scaleX) - paddingX,
  );
  const sourceTop = Math.max(
    0,
    Math.floor(Number(bounds.top) * scaleY) - paddingY,
  );
  const sourceRight = Math.min(
    imageBitmap.width,
    Math.ceil(
      Number(bounds.right ?? bounds.left + bounds.width) * scaleX,
    ) + paddingX,
  );
  const sourceBottom = Math.min(
    imageBitmap.height,
    Math.ceil(
      Number(bounds.bottom ?? bounds.top + bounds.height) * scaleY,
    ) + paddingY,
  );
  const sourceWidth = Math.max(1, sourceRight - sourceLeft);
  const sourceHeight = Math.max(1, sourceBottom - sourceTop);

  const canvas = new OffscreenCanvas(sourceWidth, sourceHeight);
  const context = canvas.getContext("2d");
  context.drawImage(
    imageBitmap,
    sourceLeft,
    sourceTop,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  );

  const blob = await canvas.convertToBlob({ type: "image/png" });
  return {
    dataUrl: await blobToDataUrl(blob),
    width: sourceWidth,
    height: sourceHeight,
  };
}

async function dataUrlToImageBitmap(dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return await createImageBitmap(blob);
}

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
}

function normalizeVisualMatchConfidence(value, fallback) {
  const number = Number(value);
  if (Number.isFinite(number) && number >= 0 && number <= 1) {
    return number;
  }
  const fallbackNumber = Number(fallback);
  if (Number.isFinite(fallbackNumber) && fallbackNumber >= 0 && fallbackNumber <= 1) {
    return Math.max(0.75, fallbackNumber);
  }
  return 0.9;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function shouldRetryVisibleHostGeometry(error) {
  return /(?:coordinate mapping|renderer viewport|client point|viewport dimensions|window changed)/i
    .test(String(error?.message || error || ""));
}

async function sendContentRequest(tab, payload) {
  if (!tab?.id) {
    throw new Error("Cannot send content request without a target tab.");
  }

  return await chrome.tabs.sendMessage(tab.id, payload);
}

function shouldAllowVisibleHostFallback(step = {}) {
  const action = step.action || step.type;
  if (![Actions.ElementClick, Actions.ElementDoubleClick, Actions.ElementType].includes(action)) {
    return false;
  }

  const config = step.config || {};
  return [true, "true", "allow"].includes(config.allowVisibleHostFallback);
}

function shouldAllowVisualMatchFallback(step = {}) {
  const action = step.action || step.type;
  if (![Actions.ElementClick, Actions.ElementDoubleClick].includes(action)) {
    return false;
  }

  const config = step.config || {};
  return [true, "true", "allow"].includes(config.allowVisualMatchFallback);
}

async function executeTabSwitch(currentTab, step, tabsByRef) {
  const tabRef = step.tabRef;
  const mappedTab = tabRef ? tabsByRef.get(tabRef) : null;

  if (mappedTab?.id) {
    try {
      const tab = await chrome.tabs.get(mappedTab.id);
      await chrome.tabs.update(tab.id, { active: true });
      return tab;
    } catch {
      tabsByRef.delete(tabRef);
    }
  }

  const recoveryUrl = step.url || step.page?.url || "";
  const matchingTab = await waitForMatchingTab(
    currentTab,
    recoveryUrl,
    Defaults.TabSwitchWaitMs,
    Boolean(step.openerTabRef),
  );

  if (matchingTab) {
    await chrome.tabs.update(matchingTab.id, { active: true });
    if (tabRef) tabsByRef.set(tabRef, matchingTab);
    return matchingTab;
  }

  if (step.createIfMissing === false || !recoveryUrl) {
    throw new Error(
      `Recorded tab ${tabRef || "unknown"} is unavailable and cannot be recovered.`,
    );
  }

  const createdTab = await createTab(recoveryUrl, true);
  if (tabRef) tabsByRef.set(tabRef, createdTab);
  return createdTab;
}

async function waitForMatchingTab(
  currentTab,
  expectedUrl,
  timeoutMs,
  requireOpenerMatch,
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const candidates = tabs.filter((tab) => {
      if (!tab?.id || tab.id === currentTab?.id) return false;

      const openerMatches =
        currentTab?.id && tab.openerTabId === currentTab.id;
      const urlMatches =
        expectedUrl && pageContextsCompatible(
          getPageContextFromUrl(tab.url || ""),
          getPageContextFromUrl(expectedUrl),
        );

      return requireOpenerMatch
        ? openerMatches && (!expectedUrl || urlMatches)
        : !expectedUrl || urlMatches;
    });

    const match =
      candidates.find((tab) => tab.url === expectedUrl) || candidates[0];

    if (match) return match;
    await delay(100);
  }

  return null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
