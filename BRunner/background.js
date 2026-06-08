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
import {
  normalizeWorkflow,
  extractDomainFromUrl,
  isStudioUrl,
} from "./core/workflowUtils.js";
import {
  createTab,
  getActiveTab,
  getBestAutomationTab,
  getTabDomain,
  navigateTab,
  waitForTabComplete,
} from "./core/tabUtils.js";

const recordingController = createRecordingController({
  nativeBridge: NativeBridge,
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("[BRunner] Orchestration Engine initialized.");
  NativeBridge.connect();
});

chrome.runtime.onStartup.addListener(() => {
  NativeBridge.connect();
});

NativeBridge.connect();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender)
    .then((response) => sendResponse(response))
    .catch((error) => {
      console.error("[BRunner] Message handler error:", error);

      sendResponse({
        ok: false,
        error: error.message || String(error),
      });
    });

  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  recordingController.syncTab(tabId);
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
      return await NativeBridge.saveWorkflow(request.filename, request.content);

    case Messages.OsDeleteWorkflow:
      return await NativeBridge.deleteWorkflow(request.filename);

    case Messages.OsDuplicateWorkflow:
      return await NativeBridge.duplicateWorkflow(
        request.filename,
        request.newFilename,
      );

    case Messages.ToggleRecording:
      return {
        ok: true,
        recording: await recordingController.toggle(Boolean(request.enabled)),
      };

    case Messages.GetRecordingState:
      return {
        ok: true,
        recording: recordingController.getState(),
      };

    case Messages.RecordedStep:
      return {
        ok: true,
        recording: recordingController.addStep(request.step),
      };

    case Messages.RunWorkflowByName:
      return await runWorkflowByName(request.filename);

    case Messages.StartWorkflow:
      return await runWorkflow(request.workflow || request.content);

    case Messages.RequestHardwareKeystroke:
      return await NativeBridge.osKeystroke(request.keys);

    case Messages.StudioLoaded:
      return {
        ok: true,
        bridge: NativeBridge.getStatus(),
        recording: recordingController.getState(),
      };

    default:
      console.warn("[BRunner] Unknown message:", request);
      return {
        ok: false,
        error: `Unknown message type: ${type || "undefined"}`,
      };
  }
}

async function runWorkflowByName(filename) {
  const loaded = await NativeBridge.loadWorkflow(filename);

  const workflow =
    loaded?.content || loaded?.workflow || loaded?.data || loaded;

  return await runWorkflow(workflow);
}

async function runWorkflow(rawWorkflow) {
  const workflow = normalizeWorkflow(rawWorkflow);
  const steps = workflow.steps;

  if (!Array.isArray(steps) || steps.length === 0) {
    return {
      ok: false,
      error: "Workflow has no steps.",
    };
  }

  let tab = await resolveStartingTab(workflow);

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];

    console.log(`[BRunner] Executing step ${index + 1}/${steps.length}:`, step);

    tab = await executeStep(tab, step);
    await delay(Defaults.StepDelayMs);
  }

  chrome.runtime
    .sendMessage({
      type: Messages.WorkflowComplete,
      workflow,
    })
    .catch(() => {});

  return {
    ok: true,
    executed: steps.length,
  };
}

async function resolveStartingTab(workflow) {
  const activeTab = await getActiveTab();

  if (
    activeTab &&
    activeTab.url &&
    !isStudioUrl(activeTab.url) &&
    isDomainCompatible(activeTab.url, workflow.boundDomain)
  ) {
    return activeTab;
  }

  const bestTab = await getBestAutomationTab();

  if (
    bestTab &&
    bestTab.url &&
    isDomainCompatible(bestTab.url, workflow.boundDomain)
  ) {
    return bestTab;
  }

  if (workflow.boundDomain) {
    const url = `https://${workflow.boundDomain}`;
    return await createTab(url, true);
  }

  if (bestTab) return bestTab;

  throw new Error("No suitable browser tab found for workflow execution.");
}

function isDomainCompatible(url, boundDomain) {
  if (!boundDomain) return true;

  const currentDomain = extractDomainFromUrl(url);
  if (!currentDomain) return false;

  return (
    currentDomain === boundDomain || currentDomain.endsWith(`.${boundDomain}`)
  );
}

async function executeStep(currentTab, step) {
  const action = step.action || step.type;

  if (action === Actions.BrowserNavigate) {
    return await executeNavigateStep(currentTab, step);
  }

  if (action === Actions.LogicWait) {
    await delay(Number(step.ms || step.duration || 1000));
    return currentTab;
  }

  if (action === "keyboard.send_keys") {
    await NativeBridge.osKeystroke(step.keys || step.value || step.text || "");
    return currentTab;
  }

  return await executeContentStep(currentTab, step);
}

async function executeNavigateStep(currentTab, step) {
  const url = step.url || step.value;

  if (!url) {
    throw new Error("browser.navigate step is missing a URL.");
  }

  const openIn = step.openIn || step.targetTab || NavigationTargets.SameTab;

  if (openIn === NavigationTargets.NewTab) {
    return await createTab(url, true);
  }

  const tabId = currentTab?.id;

  if (!tabId) {
    return await createTab(url, true);
  }

  await navigateTab(tabId, url);
  const updatedTab = await waitForTabComplete(tabId);
  await delay(Defaults.PageSettleDelayMs);

  return updatedTab || currentTab;
}

async function executeContentStep(tab, step) {
  if (!tab?.id) {
    throw new Error("Cannot execute content step without a target tab.");
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: Messages.ExecuteStep,
      step,
    });

    if (response?.ok === false) {
      throw new Error(response.error || "Content step failed.");
    }

    return tab;
  } catch (error) {
    console.warn("[BRunner] Content step failed:", error);

    throw new Error(
      `Failed to execute step in tab ${tab.id}: ${error.message || error}`,
    );
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
