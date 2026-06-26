// core/recordingController.js
// Owns recording state, recorded steps, auto-binding, page transition capture,
// and auto-save behavior.

import { Actions, Messages } from "./constants.js";
import {
  createAutoSaveName,
  createEmptyWorkflow,
  getPageContextFromUrl,
  isStudioUrl,
} from "./workflowUtils.js";
import {
  getActiveTab,
  getBestAutomationTab,
  getTabDomain,
  isAutomationTab,
} from "./tabUtils.js";

export function createRecordingController({ nativeBridge, onStateChanged }) {
  let isRecording = false;
  let boundDomain = "";
  let recordedSteps = [];

  let recordingTabId = null;
  let activeRecordingTabId = null;
  let lastRecordedUrl = "";
  let lastNavigationRecordedAt = 0;
  let sessionId = "";
  let tabPolicy = "openerDescendants";
  let nextTabRef = 1;
  let trackedTabs = new Map();

  async function start(requestedTabPolicy = "openerDescendants") {
    const activeTab = await getActiveTab();
    const tab = activeTab && !isStudioUrl(activeTab.url || "")
      ? activeTab
      : await getBestAutomationTab();

    sessionId = createSessionId();
    tabPolicy = normalizeTabPolicy(requestedTabPolicy);
    nextTabRef = 1;
    trackedTabs = new Map();
    boundDomain = isAutomationTab(tab) ? getTabDomain(tab) : "";
    recordingTabId = tab?.id || null;
    activeRecordingTabId = tab?.id || null;
    lastRecordedUrl = normalizeUrlForCompare(tab?.url || "");
    lastNavigationRecordedAt = 0;

    if (tab) {
      registerTab(tab, {
        initializeUrl: true,
      });
    }

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

        chrome.runtime
          .sendMessage({
            type: Messages.RefreshWorkflowLists,
          })
          .catch(() => {});
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
    activeRecordingTabId = null;
    lastRecordedUrl = "";
    lastNavigationRecordedAt = 0;
    sessionId = "";
    nextTabRef = 1;
    trackedTabs = new Map();

    notifyStateChanged();

    return finalState;
  }

  async function toggle(enabled, requestedTabPolicy) {
    if (enabled) return start(requestedTabPolicy);
    return stop();
  }

  function addStep(step, senderTab = null) {
    if (!isRecording || !step) {
      return getState();
    }

    if (senderTab?.id && !recordingTabId) {
      recordingTabId = senderTab.id;
    }

    let trackedTab = senderTab?.id ? trackedTabs.get(senderTab.id) : null;

    if (senderTab?.id && !trackedTab && shouldTrackActivatedTab(senderTab)) {
      trackedTab = registerTab(senderTab, {
        initializeUrl: true,
      });
    }

    if (senderTab?.id && !trackedTab) {
      return getState();
    }

    const normalizedStep = {
      ...step,
      id: step.id || createRecordedStepId(),
      ...(trackedTab?.tabRef ? { tabRef: trackedTab.tabRef } : {}),
      recordedAt: step.recordedAt || new Date().toISOString(),
    };

    recordedSteps.push(normalizedStep);

    notifyStateChanged();

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

    if (!tabId || !tab || !isTrackableRecordingTab(tab)) return;

    let trackedTab = trackedTabs.get(tabId);

    if (!trackedTab && shouldTrackDescendantTab(tab)) {
      trackedTab = registerTab(tab, {
        openerTabId: tab.openerTabId,
        initializeUrl: false,
      });
    }

    if (!trackedTab && tabPolicy === "activeTab" && tab.active) {
      trackedTab = registerTab(tab, {
        initializeUrl: false,
      });
    }

    if (!trackedTab) return;

    if (!boundDomain && isAutomationTab(tab)) {
      boundDomain = getTabDomain(tab);
    }

    // If recording was started from Studio/sidebar and the first real content tab
    // was not known yet, bind the session to this tab.
    if (!recordingTabId) {
      recordingTabId = tabId;
    }

    const currentUrl = normalizeUrlForCompare(tab.url || "");

    if (!currentUrl) {
      await syncTab(tabId);
      return;
    }

    const previousUrl = trackedTab.lastUrl;

    await syncTab(tabId);

    if (!previousUrl) {
      trackedTab.lastUrl = currentUrl;

      if (tabId !== recordingTabId) {
        recordTabSwitch(tabId, tab);
      }

      return;
    }

    if (currentUrl === previousUrl) {
      return;
    }

    trackedTab.lastUrl = currentUrl;
    if (tabId === recordingTabId) {
      lastRecordedUrl = currentUrl;
    }

    // Avoid duplicate navigation steps caused by redirects or rapid history updates.
    const now = Date.now();
    if (now - trackedTab.lastNavigationRecordedAt < 500) {
      return;
    }

    trackedTab.lastNavigationRecordedAt = now;
    lastNavigationRecordedAt = now;

    const navigationStep = {
      id: createRecordedStepId(),
      action: Actions.BrowserNavigate,
      url: tab.url,
      openIn: "sameTab",
      tabRef: trackedTab.tabRef,
      friendlyName: `Navigate: ${tab.url}`,
      page: {
        ...getPageContextFromUrl(tab.url, tab.title || ""),
        access: isAutomationTab(tab) ? "content" : "restricted",
      },
      recordedAt: new Date().toISOString(),
      recordedBy: "background.navigation_observer",
    };

    recordedSteps.push(navigationStep);

    notifyStateChanged();

    chrome.runtime
      .sendMessage({
        type: Messages.StudioReceiveStep,
        step: navigationStep,
      })
      .catch(() => {});
  }

  async function handleTabCreated(tab) {
    if (!isRecording || !tab?.id) return;
    if (!shouldTrackDescendantTab(tab)) return;

    registerTab(tab, {
      openerTabId: tab.openerTabId,
      initializeUrl: false,
    });
  }

  async function handleTabActivated(activeInfo) {
    if (!isRecording || !activeInfo?.tabId) return;

    let tab;

    try {
      tab = await chrome.tabs.get(activeInfo.tabId);
    } catch {
      return;
    }

    if (!isTrackableRecordingTab(tab)) return;

    let trackedTab = trackedTabs.get(tab.id);

    if (!trackedTab && shouldTrackActivatedTab(tab)) {
      trackedTab = registerTab(tab, {
        initializeUrl: true,
      });
    }

    if (!trackedTab || activeRecordingTabId === tab.id) return;

    // New tabs commonly activate while they are still about:blank/loading.
    // Let onUpdated("complete") record the transition with the final URL.
    if (!trackedTab.lastUrl && tab.status !== "complete") return;

    if (!trackedTab.lastUrl) {
      trackedTab.lastUrl = normalizeUrlForCompare(tab.url || "");
    }

    recordTabSwitch(tab.id, tab);
    await syncTab(tab.id);
  }

  function handleTabRemoved(tabId) {
    if (!isRecording || !trackedTabs.has(tabId)) return;

    trackedTabs.delete(tabId);

    if (activeRecordingTabId !== tabId) return;

    // Keep this unset so the browser's subsequent onActivated event records
    // the return to the opener (or whichever tracked tab becomes active).
    activeRecordingTabId = null;
  }

  function recordTabSwitch(tabId, tab) {
    const trackedTab = trackedTabs.get(tabId);
    if (!trackedTab || activeRecordingTabId === tabId) return;

    activeRecordingTabId = tabId;

    const step = {
      id: createRecordedStepId(),
      action: Actions.BrowserTabSwitch,
      tabRef: trackedTab.tabRef,
      openerTabRef: trackedTab.openerTabRef || "",
      url: tab.url || trackedTab.lastUrl || "",
      createIfMissing: true,
      friendlyName: `Switch tab: ${tab.title || tab.url || trackedTab.tabRef}`,
      page: {
        ...getPageContextFromUrl(tab.url || "", tab.title || ""),
        access: isAutomationTab(tab) ? "content" : "restricted",
      },
      recordedAt: new Date().toISOString(),
      recordedBy: "background.tab_observer",
    };

    recordedSteps.push(step);
    notifyStateChanged();
    emitStepToStudio(step);
  }

  function registerTab(tab, options = {}) {
    if (!tab?.id) return null;

    const existing = trackedTabs.get(tab.id);
    if (existing) return existing;

    const opener = options.openerTabId
      ? trackedTabs.get(options.openerTabId)
      : null;

    const trackedTab = {
      tabId: tab.id,
      tabRef: `tab_${nextTabRef++}`,
      openerTabRef: opener?.tabRef || "",
      lastUrl: options.initializeUrl
        ? normalizeUrlForCompare(tab.url || "")
        : "",
      lastNavigationRecordedAt: 0,
    };

    trackedTabs.set(tab.id, trackedTab);
    return trackedTab;
  }

  function shouldTrackDescendantTab(tab) {
    return (
      tabPolicy === "openerDescendants" &&
      Boolean(tab?.openerTabId) &&
      trackedTabs.has(tab.openerTabId) &&
      !isStudioUrl(tab.url || "")
    );
  }

  function shouldTrackActivatedTab(tab) {
    return (
      tabPolicy === "activeTab" &&
      Boolean(tab?.active) &&
      isTrackableRecordingTab(tab)
    );
  }

  function isTrackableRecordingTab(tab) {
    return Boolean(tab?.id && tab?.url && !isStudioUrl(tab.url));
  }

  function emitStepToStudio(step) {
    chrome.runtime
      .sendMessage({
        type: Messages.StudioReceiveStep,
        step,
      })
      .catch(() => {});
  }

  function getState() {
    return {
      isRecording,
      sessionId,
      tabPolicy,
      boundDomain,
      recordedSteps: [...recordedSteps],
      recordingTabId,
      activeRecordingTabId,
      lastRecordedUrl,
      trackedTabs: Array.from(trackedTabs.values()).map((tab) => ({ ...tab })),
    };
  }

  async function broadcastRecordingState() {
    const tabs = await chrome.tabs.query({});

    await Promise.allSettled(
      tabs
        .filter((tab) => {
          return isAutomationTab(tab) && trackedTabs.has(tab.id);
        })
        .map((tab) => {
        return chrome.tabs.sendMessage(tab.id, {
          type: Messages.SetRecordingState,
          isRecording,
          boundDomain,
        });
        }),
    );

    notifyStateChanged();
  }

  function notifyStateChanged() {
    if (typeof onStateChanged === "function") {
      onStateChanged(getState());
    }
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

  function normalizeTabPolicy(value) {
    return value === "activeTab" ? "activeTab" : "openerDescendants";
  }

  function createSessionId() {
    return `recording_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function createRecordedStepId() {
    return `recorded_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
    handleTabCreated,
    handleTabActivated,
    handleTabRemoved,
  };
}
