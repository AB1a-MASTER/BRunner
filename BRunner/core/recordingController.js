// core/recordingController.js
// Owns recording state, recorded steps, auto-binding, and auto-save behavior.

import { Messages } from "./constants.js";
import { createAutoSaveName, createEmptyWorkflow } from "./workflowUtils.js";
import {
  getBestAutomationTab,
  getTabDomain,
  isAutomationTab,
} from "./tabUtils.js";

export function createRecordingController({ nativeBridge }) {
  let isRecording = false;
  let boundDomain = "";
  let recordedSteps = [];

  async function start() {
    const tab = await getBestAutomationTab();

    boundDomain = tab ? getTabDomain(tab) : "";
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

    return {
      ...getState(),
      workflow,
      saveResult,
    };
  }

  async function toggle(enabled) {
    if (enabled) return start();
    return stop();
  }

  function addStep(step) {
    if (!isRecording || !step) {
      return getState();
    }

    recordedSteps.push(step);

    chrome.runtime
      .sendMessage({
        type: Messages.StudioReceiveStep,
        step,
      })
      .catch(() => {});

    return getState();
  }

  function getState() {
    return {
      isRecording,
      boundDomain,
      recordedSteps: [...recordedSteps],
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

  return {
    start,
    stop,
    toggle,
    addStep,
    getState,
    syncTab,
  };
}
