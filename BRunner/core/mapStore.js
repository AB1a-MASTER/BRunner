import { Defaults } from "./constants.js";
import {
  createMapperStorageMetadata,
  createEmptyWorkflowMapperState,
  deserializeWorkflowMapperState,
  serializeWorkflowMapperState,
} from "../mapper/core.js";

export class MapStoreUnavailableError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "MapStoreUnavailableError";
    this.code = details.code || "map_store_unavailable";
    this.provider = details.provider || "unknown";
    this.cause = details.cause;
  }
}

export class ChromeMapStore {
  constructor(storage = globalThis.chrome?.storage?.local) {
    if (!storage) {
      throw new Error("Chrome storage is required for MapStore.");
    }
    this.storage = storage;
  }

  async getWorkflowMapperState(workflowId) {
    const id = normalizeWorkflowId(workflowId);
    if (!id) return null;
    const allStates = await this.loadAll();
    return deserializeWorkflowMapperState(allStates[id]);
  }

  async getAllWorkflowMapperStates() {
    const allStates = await this.loadAll();
    return Object.fromEntries(
      Object.entries(allStates)
        .map(([workflowId, state]) => [
          workflowId,
          deserializeWorkflowMapperState(state),
        ])
        .filter(([, state]) => Boolean(state)),
    );
  }

  async saveWorkflowMapperState(workflowId, state = {}) {
    const id = normalizeWorkflowId(workflowId || state.workflowId);
    if (!id) throw new Error("MapStore requires a workflow id.");

    const allStates = await this.loadAll();
    allStates[id] = serializeWorkflowMapperState({
      ...createEmptyWorkflowMapperState(id),
      ...state,
      workflowId: id,
      storage: createMapperStorageMetadata({
        ...(state.storage || {}),
        provider: "chrome",
        savedAt: new Date().toISOString(),
        lastWriter: "extension",
      }),
      updatedAt: new Date().toISOString(),
    });
    await this.storage.set({ [Defaults.MapperStorageKey]: allStates });
    return allStates[id];
  }

  async deleteWorkflowMapperState(workflowId) {
    const id = normalizeWorkflowId(workflowId);
    if (!id) return false;
    const allStates = await this.loadAll();
    const existed = Object.prototype.hasOwnProperty.call(allStates, id);
    delete allStates[id];
    await this.storage.set({ [Defaults.MapperStorageKey]: allStates });
    return existed;
  }

  async loadAll() {
    const result = await this.storage.get(Defaults.MapperStorageKey);
    const allStates = result?.[Defaults.MapperStorageKey];
    return allStates && typeof allStates === "object" && !Array.isArray(allStates)
      ? structuredClone(allStates)
      : {};
  }
}

export class NativeMapStore {
  constructor(nativeBridge) {
    if (!nativeBridge) {
      throw new Error("Native bridge is required for NativeMapStore.");
    }
    this.nativeBridge = nativeBridge;
    this.status = {
      provider: "native",
      available: true,
      state: "unknown",
      lastError: "",
      checkedAt: "",
    };
  }

  async getWorkflowMapperState(workflowId) {
    const id = normalizeWorkflowId(workflowId);
    if (!id) return null;
    const response = await this.callNative("get", () => {
      return this.nativeBridge.getMapperState(id);
    });
    return withNativeStorageMetadata(deserializeWorkflowMapperState(response?.state));
  }

  async getAllWorkflowMapperStates() {
    const response = await this.callNative("list", () => {
      return this.nativeBridge.listMapperStates();
    });
    const states = response?.states && typeof response.states === "object"
      ? response.states
      : {};
    return Object.fromEntries(
      Object.entries(states)
        .map(([workflowId, state]) => [
          workflowId,
          withNativeStorageMetadata(deserializeWorkflowMapperState(state)),
        ])
        .filter(([, state]) => Boolean(state)),
    );
  }

  async saveWorkflowMapperState(workflowId, state = {}) {
    const id = normalizeWorkflowId(workflowId || state.workflowId);
    if (!id) throw new Error("MapStore requires a workflow id.");
    const nextState = serializeWorkflowMapperState({
      ...createEmptyWorkflowMapperState(id),
      ...state,
      workflowId: id,
      storage: createMapperStorageMetadata({
        ...(state.storage || {}),
        provider: "native",
        savedAt: new Date().toISOString(),
        lastWriter: "extension",
      }),
      updatedAt: new Date().toISOString(),
    });
    const response = await this.callNative("save", () => {
      return this.nativeBridge.saveMapperState(id, nextState);
    });
    return withNativeStorageMetadata(serializeWorkflowMapperState(response?.state || nextState));
  }

  async deleteWorkflowMapperState(workflowId) {
    const id = normalizeWorkflowId(workflowId);
    if (!id) return false;
    const response = await this.callNative("delete", () => {
      return this.nativeBridge.deleteMapperState(id);
    });
    return response?.deleted === true;
  }

  getStatus() {
    return { ...this.status };
  }

  async callNative(operation, action) {
    try {
      const response = await action();
      this.status = {
        provider: "native",
        available: true,
        state: "available",
        operation,
        lastError: "",
        checkedAt: new Date().toISOString(),
      };
      return response;
    } catch (error) {
      const message = error?.message || String(error);
      const timedOut = /timed out/i.test(message);
      this.status = {
        provider: "native",
        available: false,
        state: timedOut ? "timeout" : "unavailable",
        operation,
        lastError: message,
        checkedAt: new Date().toISOString(),
      };
      throw new MapStoreUnavailableError(
        timedOut
          ? "Native mapper store timed out."
          : "Native mapper store is unavailable.",
        {
          code: timedOut ? "map_store_timeout" : "map_store_unavailable",
          provider: "native",
          cause: error,
        },
      );
    }
  }
}

export function createChromeMapStore(storage) {
  return new ChromeMapStore(storage);
}

export function createNativeMapStore(nativeBridge) {
  return new NativeMapStore(nativeBridge);
}

function normalizeWorkflowId(workflowId) {
  return String(workflowId || "").trim();
}

function withNativeStorageMetadata(state) {
  if (!state) return null;
  return serializeWorkflowMapperState({
    ...state,
    storage: createMapperStorageMetadata({
      ...(state.storage || {}),
      provider: "native",
      loadedAt: new Date().toISOString(),
    }),
  });
}
