import { Defaults } from "./constants.js";
import {
  createEmptyWorkflowMapperState,
  deserializeWorkflowMapperState,
  serializeWorkflowMapperState,
} from "../mapper/core.js";

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

  async saveWorkflowMapperState(workflowId, state = {}) {
    const id = normalizeWorkflowId(workflowId || state.workflowId);
    if (!id) throw new Error("MapStore requires a workflow id.");

    const allStates = await this.loadAll();
    allStates[id] = serializeWorkflowMapperState({
      ...createEmptyWorkflowMapperState(id),
      ...state,
      workflowId: id,
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

export function createChromeMapStore(storage) {
  return new ChromeMapStore(storage);
}

function normalizeWorkflowId(workflowId) {
  return String(workflowId || "").trim();
}
