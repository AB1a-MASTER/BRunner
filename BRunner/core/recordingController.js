// core/recordingController.js
// Owns recording state, recorded steps, auto-binding, page transition capture,
// and auto-save behavior.

import { Actions, Messages } from "./constants.js";
import {
  createAutoSaveName,
  createEmptyWorkflow,
  getPageContextFromUrl,
} from "./workflowUtils.js";
import {
  getBestAutomationTab,
  getTabDomain,
  isAutomationTab,
} from "./tabUtils.js";

export function createRecordingController({ nativeBridge }) {
  let isRecording = false;
  let boundDomain = "";
  let recordedSteps = [];

  let recordingTabId = null;
  let lastRecordedUrl = "";
  let lastNavigationRecordedAt = 0;

  async function start() {
    const tab = await getBestAutomationTab();

    boundDomain = tab ? getTabDomain(tab) : "";
    recordingTabId = tab?.id || null;
    lastRecordedUrl = normalizeUrlForCompare(tab?.url || "");
    lastNavigationRecordedAt = 0;

    recordedSteps = [];
    isRecording = true;

    await broadcastRecordingState();

    return getState();
  }

  async function stop() {
    isRecording = false;

    await broadcastRecordingState();

    const workflow = createEmptyWorkflow(boundDomain);
    workflow.steps = [...recordedSteps];

    let saveResult = null;

    if (recordedSteps.length > 0) {
      try {
        saveResult = await nativeBridge.saveWorkflow(
          createAutoSaveName(),
          workflow,
        );
      } catch (error) {
        console.warn("[BRunner] Auto-save failed:", error);
      }
    }

    const finalState = {
      ...getState(),
      workflow,
      saveResult,
    };

    recordingTabId = null;
    lastRecordedUrl = "";
    lastNavigationRecordedAt = 0;

    return finalState;
  }

  async function toggle(enabled) {
    if (enabled) return start();
    return stop();
  }

  function addStep(step, senderTab = null) {
    if (!isRecording || !step) {
      return getState();
    }

    if (senderTab?.id && !recordingTabId) {
      recordingTabId = senderTab.id;
    }

    const normalizedStep = {
      ...step,
      recordedAt: step.recordedAt || new Date().toISOString(),
    };

    recordedSteps.push(normalizedStep);

    chrome.runtime
      .sendMessage({
        type: Messages.StudioReceiveStep,
        step: normalizedStep,
      })
      .catch(() => {});

    return getState();
  }

  async function handleTabCompleted(tabId, tab) {
    if (!isRecording) return;

    if (!tabId || !tab || !isAutomationTab(tab)) return;

    // If recording was started from Studio/sidebar and the first real content tab
    // was not known yet, bind the session to this tab.
    if (!recordingTabId) {
      recordingTabId = tabId;
    }

    // For now, one recording session tracks one main tab.
    // This avoids accidental recordings from unrelated tabs.
    if (tabId !== recordingTabId) {
      return;
    }

    const currentUrl = normalizeUrlForCompare(tab.url || "");

    if (!currentUrl) {
      await syncTab(tabId);
      return;
    }

    const previousUrl = lastRecordedUrl;

    await syncTab(tabId);

    if (!previousUrl) {
      lastRecordedUrl = currentUrl;
      return;
    }

    if (currentUrl === previousUrl) {
      return;
    }

    lastRecordedUrl = currentUrl;

    // Avoid duplicate navigation steps caused by redirects or rapid history updates.
    const now = Date.now();
    if (now - lastNavigationRecordedAt < 500) {
      return;
    }

    lastNavigationRecordedAt = now;

    const navigationStep = {
      action: Actions.BrowserNavigate,
      url: tab.url,
      openIn: "sameTab",
      friendlyName: `Navigate: ${tab.url}`,
      page: getPageContextFromUrl(tab.url, tab.title || ""),
      recordedAt: new Date().toISOString(),
      recordedBy: "background.navigation_observer",
    };

    recordedSteps.push(navigationStep);

    chrome.runtime
      .sendMessage({
        type: Messages.StudioReceiveStep,
        step: navigationStep,
      })
      .catch(() => {});
  }

  function getState() {
    return {
      isRecording,
      boundDomain,
      recordedSteps: [...recordedSteps],
      recordingTabId,
      lastRecordedUrl,
    };
  }

  async function broadcastRecordingState() {
    const tabs = await chrome.tabs.query({});

    await Promise.allSettled(
      tabs.filter(isAutomationTab).map((tab) => {
        return chrome.tabs.sendMessage(tab.id, {
          type: Messages.SetRecordingState,
          isRecording,
          boundDomain,
        });
      }),
    );
  }

  async function syncTab(tabId) {
    if (!tabId) return;

    try {
      const tab = await chrome.tabs.get(tabId);
      if (!isAutomationTab(tab)) return;

      await chrome.tabs.sendMessage(tabId, {
        type: Messages.SetRecordingState,
        isRecording,
        boundDomain,
      });
    } catch {
      // Content script may not be injected yet. Safe to ignore.
    }
  }

  function normalizeUrlForCompare(url) {
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return "";
    }
  }

  function safeUrlPart(url, key) {
    try {
      return new URL(url)[key] || "";
    } catch {
      return "";
    }
  }

  return {
    start,
    stop,
    toggle,
    addStep,
    getState,
    syncTab,
    handleTabCompleted,
  };
}
