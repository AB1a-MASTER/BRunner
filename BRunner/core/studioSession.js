export const STUDIO_SESSION_KEY = "brunner.studio.session.v1";

export const StudioKind = Object.freeze({
  Graph: "graph",
  // Retained only to migrate sessions written by the retired Studio.
  Sequential: "sequential",
});

export function normalizeStudioSession(input = {}) {
  const filename = String(input?.activeWorkflowFilename || "").trim();
  const activeStudio = [
    StudioKind.Graph,
    StudioKind.Sequential,
  ].includes(input?.activeStudio)
    ? StudioKind.Graph
    : "";

  return {
    version: 1,
    activeWorkflowFilename: filename,
    activeStudio,
    updatedAt: typeof input?.updatedAt === "string" ? input.updatedAt : "",
  };
}

export async function loadStudioSession(storage = chrome.storage.local) {
  const stored = await storage.get(STUDIO_SESSION_KEY);
  return normalizeStudioSession(stored?.[STUDIO_SESSION_KEY]);
}

export async function saveStudioSession(patch = {}, storage = chrome.storage.local) {
  const current = await loadStudioSession(storage).catch(() => normalizeStudioSession());
  const next = normalizeStudioSession({
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
  await storage.set({ [STUDIO_SESSION_KEY]: next });
  return next;
}
