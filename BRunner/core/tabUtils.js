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
  const normalizedUrl = normalizeNavigationUrl(url);

  const tab = await chrome.tabs.update(tabId, {
    url: normalizedUrl,
  });

  await waitForTabComplete(tabId);
  return tab;
}

export async function createTab(url, active = true) {
  const normalizedUrl = normalizeNavigationUrl(url);

  const tab = await chrome.tabs.create({
    url: normalizedUrl,
    active,
  });

  await waitForTabComplete(tab.id);
  return tab;
}

export function normalizeNavigationUrl(input) {
  const raw = String(input || "").trim();

  if (!raw) {
    throw new Error("Navigation URL is empty.");
  }

  // Already absolute and valid for browser navigation.
  if (
    /^(https?:\/\/|file:\/\/|chrome:\/\/|chrome-extension:\/\/|about:)/i.test(
      raw,
    )
  ) {
    return raw;
  }

  // Common user input: www.google.com, google.com, example.org/path
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(raw)) {
    return `https://${raw}`;
  }

  // If it looks like localhost or an IP, also assume http.
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#].*)?$/i.test(raw)) {
    return `http://${raw}`;
  }

  // Last-resort browser search instead of extension-relative URL.
  return `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
}
