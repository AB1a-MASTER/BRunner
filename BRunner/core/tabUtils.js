// core/tabUtils.js
// Helpers for selecting tabs, navigating, and identifying valid automation targets.

import {
  extractDomainFromUrl,
  isBrowserInternalUrl,
  isStudioUrl,
} from "./workflowUtils.js";

export async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  return tab || null;
}

export async function getBestAutomationTab() {
  const tabs = await chrome.tabs.query({
    currentWindow: true,
  });

  const activeNonStudio = tabs.find((tab) => {
    return tab.active && isAutomationTab(tab);
  });

  if (activeNonStudio) return activeNonStudio;

  return tabs.find(isAutomationTab) || null;
}

export function isAutomationTab(tab) {
  if (!tab || !tab.url) return false;
  if (isStudioUrl(tab.url)) return false;
  if (isBrowserInternalUrl(tab.url)) return false;
  return /^https?:\/\//i.test(tab.url);
}

export function getTabDomain(tab) {
  return extractDomainFromUrl(tab?.url || "");
}

export async function waitForTabComplete(tabId, timeoutMs = 15000) {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const checkCurrent = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === "complete") {
          cleanup();
          resolve(tab);
        }
      } catch {
        cleanup();
        resolve(null);
      }
    };

    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearInterval(timer);
    };

    const onUpdated = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId) return;

      if (changeInfo.status === "complete") {
        cleanup();
        resolve(tab);
      }
    };

    const timer = setInterval(() => {
      if (Date.now() - startedAt > timeoutMs) {
        cleanup();
        resolve(null);
      } else {
        checkCurrent();
      }
    }, 250);

    chrome.tabs.onUpdated.addListener(onUpdated);
    checkCurrent();
  });
}

export async function navigateTab(tabId, url) {
  const tab = await chrome.tabs.update(tabId, { url });
  await waitForTabComplete(tabId);
  return tab;
}

export async function createTab(url, active = true) {
  const tab = await chrome.tabs.create({ url, active });
  await waitForTabComplete(tab.id);
  return tab;
}
