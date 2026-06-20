import { initializeStudioPreferences } from "../core/studioPreferencesBootstrap.js";
import { saveStudioPreferences } from "../core/studioPreferences.js";

const controller = await initializeStudioPreferences();
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
    if (areaName === "local" && next?.density) densityInput.value = next.density;
  });
}
