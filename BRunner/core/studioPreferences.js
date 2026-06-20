export const STUDIO_PREFERENCES_KEY = "brunner.studio.preferences.v1";

export const StudioDensity = Object.freeze({
  Compact: "compact",
  Comfortable: "comfortable",
  Large: "large",
});

export const InspectorMode = Object.freeze({
  Pinned: "pinned",
  Auto: "auto",
});

export const LogHandlingPolicy = Object.freeze({
  DoNothing: "doNothing",
  ClearAfterRun: "clearAfterRun",
  ClearAndSaveAfterRun: "clearAndSaveAfterRun",
  SaveAfterRun: "saveAfterRun",
});

export const DEFAULT_STUDIO_PREFERENCES = Object.freeze({
  version: 1,
  density: StudioDensity.Comfortable,
  inspectorMode: InspectorMode.Pinned,
  activeInspectorTab: "workflow",
  overviewVisible: true,
  logPolicy: LogHandlingPolicy.DoNothing,
  panels: Object.freeze({
    nodeLibraryExpanded: true,
    executionLogsExpanded: true,
  }),
});

const DENSITIES = new Set(Object.values(StudioDensity));
const INSPECTOR_MODES = new Set(Object.values(InspectorMode));
const LOG_POLICIES = new Set(Object.values(LogHandlingPolicy));
const INSPECTOR_TABS = new Set(["workflow", "node", "data"]);

export function normalizeStudioPreferences(input = {}) {
  const panels = input?.panels && typeof input.panels === "object"
    ? input.panels
    : {};
  return {
    version: 1,
    density: DENSITIES.has(input.density)
      ? input.density
      : DEFAULT_STUDIO_PREFERENCES.density,
    inspectorMode: INSPECTOR_MODES.has(input.inspectorMode)
      ? input.inspectorMode
      : DEFAULT_STUDIO_PREFERENCES.inspectorMode,
    activeInspectorTab: INSPECTOR_TABS.has(input.activeInspectorTab)
      ? input.activeInspectorTab
      : DEFAULT_STUDIO_PREFERENCES.activeInspectorTab,
    overviewVisible: input.overviewVisible !== false,
    logPolicy: LOG_POLICIES.has(input.logPolicy)
      ? input.logPolicy
      : DEFAULT_STUDIO_PREFERENCES.logPolicy,
    panels: {
      nodeLibraryExpanded: panels.nodeLibraryExpanded !== false,
      executionLogsExpanded: panels.executionLogsExpanded !== false,
    },
  };
}

export async function loadStudioPreferences(storage = chrome.storage.local) {
  const stored = await storage.get(STUDIO_PREFERENCES_KEY);
  return normalizeStudioPreferences(stored?.[STUDIO_PREFERENCES_KEY]);
}

export async function saveStudioPreferences(preferences, storage = chrome.storage.local) {
  const normalized = normalizeStudioPreferences(preferences);
  await storage.set({ [STUDIO_PREFERENCES_KEY]: normalized });
  return normalized;
}

export async function updateStudioPreferences(patch, storage = chrome.storage.local) {
  const current = await loadStudioPreferences(storage);
  return saveStudioPreferences({
    ...current,
    ...patch,
    panels: {
      ...current.panels,
      ...(patch?.panels || {}),
    },
  }, storage);
}

export function applyStudioDensity(density, root = document.documentElement) {
  const normalized = DENSITIES.has(density)
    ? density
    : DEFAULT_STUDIO_PREFERENCES.density;
  root.dataset.studioDensity = normalized;
  return normalized;
}
