export const STUDIO_SESSION_KEY = "brunner.studio.session.v1";

export const StudioKind = Object.freeze({
  Sequential: "sequential",
  Graph: "graph",
});

export function normalizeStudioSession(input = {}) {
  const filename = String(input?.activeWorkflowFilename || "").trim();
  const activeStudio = Object.values(StudioKind).includes(input?.activeStudio)
    ? input.activeStudio
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
