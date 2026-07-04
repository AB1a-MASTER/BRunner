import { initializeStudioPreferences } from "../core/studioPreferencesBootstrap.js";
import {
  saveStudioPreferences,
  updateStudioPreferences,
} from "../core/studioPreferences.js";

const controller = await initializeStudioPreferences();
globalThis.BRunnerStudioPreferences = {
  get preferences() {
    return controller.preferences;
  },
  async update(patch) {
    controller.preferences = await updateStudioPreferences(patch);
    globalThis.dispatchEvent(new CustomEvent("brunner:studio-preferences", {
      detail: controller.preferences,
    }));
    return controller.preferences;
  },
};
globalThis.dispatchEvent(new CustomEvent("brunner:studio-preferences", {
  detail: controller.preferences,
}));

const densityInput = document.getElementById("studio-density");
if (densityInput) {
  densityInput.value = controller.preferences.density;
  densityInput.addEventListener("change", async () => {
    controller.preferences = await saveStudioPreferences({
      ...controller.preferences,
      density: densityInput.value,
    });
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    const next = changes?.["brunner.studio.preferences.v1"]?.newValue;
    if (areaName !== "local" || !next) return;
    controller.preferences = next;
    if (next.density) densityInput.value = next.density;
    globalThis.dispatchEvent(new CustomEvent("brunner:studio-preferences", {
      detail: controller.preferences,
    }));
  });
}
