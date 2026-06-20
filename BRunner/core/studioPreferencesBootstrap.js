import {
  applyStudioDensity,
  DEFAULT_STUDIO_PREFERENCES,
  loadStudioPreferences,
  normalizeStudioPreferences,
  STUDIO_PREFERENCES_KEY,
} from "./studioPreferences.js";

export async function initializeStudioPreferences(options = {}) {
  const root = options.root || document.documentElement;
  const storage = options.storage || globalThis.chrome?.storage?.local;
  const changes = options.changes || globalThis.chrome?.storage?.onChanged;
  let preferences = DEFAULT_STUDIO_PREFERENCES;

  if (storage) {
    try {
      preferences = await loadStudioPreferences(storage);
    } catch {
      preferences = DEFAULT_STUDIO_PREFERENCES;
    }
  }
  applyStudioDensity(preferences.density, root);

  const listener = (updates, areaName) => {
    if (areaName !== "local" || !updates?.[STUDIO_PREFERENCES_KEY]) return;
    const next = normalizeStudioPreferences(
      updates[STUDIO_PREFERENCES_KEY].newValue,
    );
    applyStudioDensity(next.density, root);
  };
  changes?.addListener?.(listener);

  return {
    preferences,
    dispose() { changes?.removeListener?.(listener); },
  };
}
