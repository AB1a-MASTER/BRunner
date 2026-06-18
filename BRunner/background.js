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
import { NativeBridge } from "./core/nativeBridge.js";
import { createRecordingController } from "./core/recordingController.js";
import { createRuntimeStateStore } from "./core/runtimeState.js";
import { getNodeDefinitions } from "./core/nodeRegistry.js";
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
import {
  normalizeWorkflow,
  extractDomainFromUrl,
  isBrowserInternalUrl,
  isStudioUrl,
  getPageContextFromUrl,
  pageContextsCompatible,
  resolveWaitDuration,
} from "./core/workflowUtils.js";
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

const runtimeState = createRuntimeStateStore();
let activeRun = null;
let offscreenClipboardCreation = null;

const recordingController = createRecordingController({
  nativeBridge: NativeBridge,
  onStateChanged: (recording) => runtimeState.updateRecording(recording),
});

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
        diagnostics: error.diagnostics || null,
      });
    });

  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;

  recordingController.handleTabCompleted(tabId, tab).catch((error) => {
    console.warn("[BRunner] Recording tab sync failed:", error);
  });
});

chrome.tabs.onCreated.addListener((tab) => {
  recordingController.handleTabCreated(tab).catch((error) => {
    console.warn("[BRunner] Recording new-tab tracking failed:", error);
  });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  recordingController.handleTabActivated(activeInfo).catch((error) => {
    console.warn("[BRunner] Recording tab activation failed:", error);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  recordingController.handleTabRemoved(tabId);
});

async function handleMessage(request, sender) {
  const type = request?.type || request?.command;

  switch (type) {
    case Messages.CheckBridgeStatus:
      return {
        ok: true,
        ...NativeBridge.getStatus(),
      };

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
      };

    case Messages.GetNodeDefinitions:
      return {
        ok: true,
        definitions: getNodeDefinitions(),
      };

    case Messages.GetRecordingState:
      return {
        ok: true,
        recording: recordingController.getState(),
      };

    case Messages.RecordedStep:
      return {
        ok: true,
        recording: recordingController.addStep(
          request.step,
          sender?.tab || null,
        ),
      };

    case Messages.RunWorkflowByName:
      return await runWorkflowByName(request.filename);

    case Messages.StartWorkflow:
      return await runWorkflow(request.workflow || request.content);

    case Messages.StopWorkflow:
      return await stopActiveWorkflow();

    case Messages.RequestHardwareKeystroke:
      return await NativeBridge.osKeystroke(request.keys);

    case Messages.StudioLoaded:
      return {
        ok: true,
        bridge: NativeBridge.getStatus(),
        recording: recordingController.getState(),
        runtime: runtimeState.getState(),
      };

    default:
      console.warn("[BRunner] Unknown message:", request);
      return {
        ok: false,
        error: `Unknown message type: ${type || "undefined"}`,
      };
  }
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

  const workflow = normalizeWorkflow(rawWorkflow);
  const steps = workflow.steps;

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
    totalSteps: steps.length,
    currentAction: "",
    error: "",
    diagnostics: null,
  });
  activeRun = {
    runId,
    cancelRequested: false,
    abortControllers: new Set(),
  };

  try {
    let tab = await resolveStartingTab(workflow);
    const tabsByRef = new Map();
    const variableRegistry = new VariableRegistry(rawWorkflow?.variables || {});

    const initialTabRef = steps.find((step) => step?.tabRef)?.tabRef;
    if (initialTabRef && tab?.id) {
      tabsByRef.set(initialTabRef, tab);
    }

    for (let index = 0; index < steps.length; index++) {
      throwIfRunCancelled(runId);

      const step = steps[index];
      let resolvedStep;

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

      console.log(
        `[BRunner] Executing step ${index + 1}/${steps.length}:`,
        sanitizeStepForLog(resolvedStep),
      );

      if (resolvedStep?.tabRef && tabsByRef.has(resolvedStep.tabRef)) {
        const referencedTab = tabsByRef.get(resolvedStep.tabRef);

        try {
          tab = await chrome.tabs.get(referencedTab.id);
        } catch {
          tabsByRef.delete(resolvedStep.tabRef);
        }
      }

      tab = await executeStep(
        tab,
        resolvedStep,
        tabsByRef,
        variableRegistry,
        runId,
      );

      throwIfRunCancelled(runId);

      if (
        resolvedStep?.tabRef &&
        tab?.id &&
        ![
          Actions.BrowserTabOpen,
          Actions.BrowserTabClose,
        ].includes(resolvedStep.action || resolvedStep.type)
      ) {
        tabsByRef.set(resolvedStep.tabRef, tab);
      }
      await delayWithRunCancellation(Defaults.StepDelayMs, runId);
      throwIfRunCancelled(runId);
    }

    runtimeState.updateExecution({
      status: "completed",
      currentStepIndex: steps.length - 1,
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
      executed: steps.length,
      runId,
      variables: variableRegistry.snapshot(),
    };
  } catch (error) {
    if (
      error?.name === "WorkflowCancelledError" ||
      (activeRun?.runId === runId && activeRun.cancelRequested)
    ) {
      runtimeState.updateExecution({
        status: "cancelled",
        currentAction: "",
        error: "Workflow stopped by user.",
        diagnostics: {
          finalReason: "workflow_cancelled",
        },
      });

      return {
        ok: true,
        cancelled: true,
        runId,
      };
    }

    runtimeState.updateExecution({
      status: "failed",
      currentAction: "",
      error: error.message || String(error),
      diagnostics: error.diagnostics || null,
    });
    throw error;
  } finally {
    if (activeRun?.runId === runId) {
      activeRun = null;
    }
  }
}

async function stopActiveWorkflow() {
  if (!activeRun || runtimeState.getState().execution.status !== "running") {
    return {
      ok: false,
      error: "No workflow is currently running.",
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

  const response = await executeContentStep(contextReadyTab, step, runId);

  if (isExtractionAction(action)) {
    variableRegistry?.set(extractionVariableName, response?.value ?? "");
  }

  if (action === Actions.FileInputUpload) {
    variableRegistry?.set(fileUploadVariableName, response?.value ?? null);
  }

  return contextReadyTab;
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

function sanitizeStepForLog(step) {
  const action = step?.action || step?.type;

  if (action === Actions.ClipboardWrite) {
    return {
      ...step,
      config: {
        ...step.config,
        value: step.config?.value ? "[REDACTED]" : "",
      },
    };
  }

  if (action === Actions.FileInputUpload) {
    return {
      ...step,
      config: {
        ...step.config,
        content: step.config?.content ? "[REDACTED]" : "",
      },
    };
  }

  if (action !== Actions.HttpRequest) return step;

  return {
    ...step,
    config: {
      ...step.config,
      url: sanitizeHttpUrlForLog(step.config?.url),
      headers: step.config?.headers ? "[REDACTED]" : "",
      body: step.config?.body ? "[REDACTED]" : "",
    },
  };
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

function sanitizeHttpUrlForLog(value) {
  try {
    const url = new URL(String(value || ""));
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "[INVALID URL]";
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
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: Messages.ExecuteStep,
      step,
      runId,
    });

    if (response?.ok === false) {
      const executionError = new Error(
        response.error || "Content step failed.",
      );
      executionError.diagnostics = response.diagnostics || null;
      throw executionError;
    }

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
