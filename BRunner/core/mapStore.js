import { Defaults } from "./constants.js";
import {
  createMapperStorageMetadata,
  createEmptyWorkflowMapperState,
  deserializeWorkflowMapperState,
  MapperSchemaVersion,
  serializeWorkflowMapperState,
} from "../mapper/core.js";

const WORKFLOW_STORAGE_PREFIX = `${Defaults.MapperStorageKey}.workflow.`;
const DEFAULT_MAX_PAGE_PROFILES = 100;
const DEFAULT_MAX_WORKFLOW_STATES = 50;
const DEFAULT_MAX_WORKFLOW_TOMBSTONES = 100;
const GLOBAL_STORAGE_LOCK_KEY = `${WORKFLOW_STORAGE_PREFIX}__global__`;
const storageLocks = new WeakMap();

export class MapStoreUnavailableError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "MapStoreUnavailableError";
    this.code = details.code || "map_store_unavailable";
    this.provider = details.provider || "unknown";
    this.cause = details.cause;
  }
}

export class MapStoreConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "MapStoreConflictError";
    this.code = "map_store_revision_conflict";
    this.workflowId = details.workflowId || "";
    this.expectedRevision = details.expectedRevision || "";
    this.actualRevision = details.actualRevision || "";
    this.expectedGeneration = details.expectedGeneration || "";
    this.actualGeneration = details.actualGeneration || "";
  }
}

export class ChromeMapStore {
  constructor(
    storage = globalThis.chrome?.storage?.local,
    {
      clock = () => new Date().toISOString(),
      revisionGeneration = createRevisionGeneration,
    } = {},
  ) {
    if (!storage) {
      throw new Error("Chrome storage is required for MapStore.");
    }
    this.storage = storage;
    this.clock = clock;
    this.revisionGeneration = revisionGeneration;
  }

  async getWorkflowMapperState(workflowId) {
    const id = normalizeWorkflowId(workflowId);
    if (!id) return null;
    const record = await this.readWorkflowRecord(id);
    return record?.deleted === true ? null : record?.state || null;
  }

  async getAllWorkflowMapperStates() {
    const records = await this.storage.get(null);
    const legacy = records?.[Defaults.MapperStorageKey];
    const states = legacy && typeof legacy === "object" && !Array.isArray(legacy)
      ? Object.fromEntries(
          Object.entries(legacy)
            .map(([workflowId, state]) => {
              const id = normalizeWorkflowId(workflowId);
              return [id, deserializeLegacyWorkflowState(id, state)];
            })
            .filter(([workflowId, state]) => Boolean(workflowId && state)),
        )
      : {};

    Object.entries(records || {})
      .filter(([key]) => key.startsWith(WORKFLOW_STORAGE_PREFIX))
      .sort(([left], [right]) => left.localeCompare(right))
      .forEach(([key, record]) => {
        const directRecord = parseDirectWorkflowStorageRecord(key, record);
        if (!directRecord) return;
        if (directRecord.deleted === true) {
          delete states[directRecord.workflowId];
          return;
        }
        states[directRecord.workflowId] = directRecord.state;
      });

    return states;
  }

  async saveWorkflowMapperState(workflowId, state = {}) {
    const id = normalizeWorkflowId(workflowId || state.workflowId);
    if (!id) throw new Error("MapStore requires a workflow id.");

    return await withStorageLock(this.storage, GLOBAL_STORAGE_LOCK_KEY, async () => {
      const currentRecord = await this.readWorkflowRecord(id);
      assertExpectedRevision(id, currentRecord, state.storage);
      return await this.persistWorkflowState(id, state, currentRecord);
    });
  }

  async updateWorkflowMapperState(workflowId, updater) {
    const id = normalizeWorkflowId(workflowId);
    if (!id) throw new Error("MapStore requires a workflow id.");
    if (typeof updater !== "function") {
      throw new TypeError("MapStore update requires an updater function.");
    }

    return await withStorageLock(this.storage, GLOBAL_STORAGE_LOCK_KEY, async () => {
      const currentRecord = await this.readWorkflowRecord(id);
      const current = currentRecord?.deleted === true ? null : currentRecord?.state || null;
      const base = current || createEmptyWorkflowMapperState(id);
      const updated = await updater(structuredClone(base), {
        exists: Boolean(current),
        revision: String(currentRecord?.revision || ""),
      });
      if (updated === undefined) return current;
      return await this.persistWorkflowState(id, updated, currentRecord);
    });
  }

  async deleteWorkflowMapperState(workflowId) {
    const id = normalizeWorkflowId(workflowId);
    if (!id) return false;
    const key = mapperWorkflowStorageKey(id);
    return await withStorageLock(this.storage, GLOBAL_STORAGE_LOCK_KEY, async () => {
      const currentRecord = await this.readWorkflowRecord(id);
      if (!currentRecord || currentRecord.deleted === true) return false;
      const tombstone = createWorkflowTombstone(id, currentRecord, this.clock());
      const rollbackSnapshot = mapperStorageSnapshot(await this.storage.get(null));
      try {
        await this.storage.set({ [key]: tombstone });
      } catch (error) {
        if (!isQuotaError(error)) throw error;
        try {
          await writeWorkflowTombstoneAfterRemovingLegacyTarget(
            this.storage,
            key,
            id,
            tombstone,
          );
        } catch (fallbackError) {
          try {
            await restoreMapperStorageSnapshot(this.storage, rollbackSnapshot);
          } catch (rollbackError) {
            if (fallbackError && typeof fallbackError === "object") {
              fallbackError.rollbackError = rollbackError;
            }
          }
          throw fallbackError;
        }
      }
      await completeWorkflowStorageMaintenance(this.storage, key, this.clock);
      return true;
    });
  }

  async loadAll() {
    return await this.getAllWorkflowMapperStates();
  }

  async readWorkflowRecord(workflowId) {
    const id = normalizeWorkflowId(workflowId);
    if (!id) return null;
    const key = mapperWorkflowStorageKey(id);
    const direct = await this.storage.get(key);
    if (
      Object.prototype.hasOwnProperty.call(direct || {}, key) &&
      direct[key] !== undefined
    ) {
      const directRecord = parseDirectWorkflowStorageRecord(key, direct[key]);
      if (directRecord) return directRecord;
    }

    const legacyResult = await this.storage.get(Defaults.MapperStorageKey);
    const legacy = legacyResult?.[Defaults.MapperStorageKey];
    return createWorkflowStorageRecord(
      deserializeLegacyWorkflowState(id, legacy?.[id]),
      id,
      "legacy",
    );
  }

  async persistWorkflowState(workflowId, state, current = null) {
    const now = this.clock();
    const revision = String(revisionNumber(current) + 1);
    const generation = workflowRevisionGeneration(current) || this.revisionGeneration();
    const nextState = serializeWorkflowMapperState({
      ...createEmptyWorkflowMapperState(workflowId),
      ...state,
      workflowId,
      storage: createMapperStorageMetadata({
        ...(state.storage || {}),
        provider: "chrome",
        revision,
        generation,
        savedAt: now,
        lastWriter: "extension",
        conflictPolicy: "revision_match",
        quotaPruned: false,
        prunedMapCount: 0,
        prunedComponentCount: 0,
      }),
      updatedAt: now,
    });
    return await writeWorkflowStateWithQuotaFallback(
      this.storage,
      mapperWorkflowStorageKey(workflowId),
      nextState,
      this.clock,
    );
  }
}

export function mapperWorkflowStorageKey(workflowId) {
  const id = normalizeWorkflowId(workflowId);
  return id ? `${WORKFLOW_STORAGE_PREFIX}${encodeURIComponent(id)}` : "";
}

function workflowIdFromStorageKey(key) {
  if (!String(key || "").startsWith(WORKFLOW_STORAGE_PREFIX)) return "";
  try {
    return normalizeWorkflowId(decodeURIComponent(key.slice(WORKFLOW_STORAGE_PREFIX.length)));
  } catch {
    return "";
  }
}

function parseDirectWorkflowStorageRecord(key, record = null) {
  const workflowId = workflowIdFromStorageKey(key);
  if (!workflowId || !record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }
  if (normalizeWorkflowId(record.workflowId) !== workflowId) return null;

  if (record.deleted === true) {
    if (!isValidWorkflowTombstone(key, record)) return null;
    return {
      workflowId,
      source: "direct",
      deleted: true,
      revision: String(record.revision),
      generation: workflowRevisionGeneration(record),
      state: null,
    };
  }

  try {
    const state = deserializeWorkflowMapperState(record);
    if (!state || normalizeWorkflowId(state.workflowId) !== workflowId) return null;
    return createWorkflowStorageRecord(state, workflowId, "direct");
  } catch {
    return null;
  }
}

function isValidWorkflowTombstone(key, record = null) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  if (record.deleted !== true) return false;
  if (Number(record.mapperSchemaVersion) !== MapperSchemaVersion) return false;
  const workflowId = workflowIdFromStorageKey(key);
  if (!workflowId || normalizeWorkflowId(record.workflowId) !== workflowId) return false;
  const revision = Number(record.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) return false;
  const deletedAt = String(record.deletedAt || "").trim();
  return Boolean(deletedAt && Number.isFinite(Date.parse(deletedAt)));
}

function deserializeLegacyWorkflowState(workflowId, record = null) {
  const id = normalizeWorkflowId(workflowId);
  if (!id) return null;
  try {
    const state = deserializeWorkflowMapperState(record);
    return state ? { ...state, workflowId: id } : null;
  } catch {
    return null;
  }
}

function createWorkflowStorageRecord(state = null, workflowId = "", source = "direct") {
  if (!state) return null;
  const id = normalizeWorkflowId(workflowId || state.workflowId);
  if (!id) return null;
  return {
    workflowId: id,
    source,
    deleted: false,
    revision: String(state.storage?.revision || ""),
    generation: String(state.storage?.generation || ""),
    state: { ...state, workflowId: id },
  };
}

function assertExpectedRevision(workflowId, current, expectedStorage = {}) {
  const expected = String(expectedStorage?.revision || "");
  const expectedGeneration = String(expectedStorage?.generation || "");
  if (!current) {
    if (!expected) return;
    throw new MapStoreConflictError(
      `Mapper state for ${workflowId} no longer exists. Reload and retry.`,
      {
        workflowId,
        expectedRevision: expected,
        actualRevision: "",
        expectedGeneration,
        actualGeneration: "",
      },
    );
  }
  const actual = String(current.revision || "");
  const actualGeneration = String(current.generation || "");
  const generationMismatch = Boolean(expectedGeneration || actualGeneration)
    && expectedGeneration !== actualGeneration;
  if ((!expected && actual) || (expected && expected !== actual) || generationMismatch) {
    throw new MapStoreConflictError(
      `Mapper state for ${workflowId} changed before this save. Reload and retry.`,
      {
        workflowId,
        expectedRevision: expected,
        actualRevision: actual,
        expectedGeneration,
        actualGeneration,
      },
    );
  }
}

function createRevisionGeneration() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function workflowRevisionGeneration(state = null) {
  return String(state?.generation || state?.storage?.generation || "");
}

function revisionNumber(state = null) {
  const value = Number(state?.storage?.revision || state?.revision || 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

async function withStorageLock(storage, key, action) {
  let locks = storageLocks.get(storage);
  if (!locks) {
    locks = new Map();
    storageLocks.set(storage, locks);
  }
  const previous = locks.get(key) || Promise.resolve();
  const operation = previous.catch(() => {}).then(action);
  locks.set(key, operation);
  try {
    return await operation;
  } finally {
    if (locks.get(key) === operation) locks.delete(key);
  }
}

async function writeWorkflowStateWithQuotaFallback(storage, key, state, clock) {
  const profiles = [
    null,
    { maxVersions: 1, maxComponents: 250, maxPageProfiles: 50, maxResolverAttempts: 10 },
    { maxVersions: 1, maxComponents: 100, maxPageProfiles: 25, maxResolverAttempts: 5 },
    { maxVersions: 1, maxComponents: 25, maxPageProfiles: 10, maxResolverAttempts: 1 },
    { maxVersions: 1, maxComponents: 5, maxPageProfiles: 5, maxResolverAttempts: 0 },
    { maxVersions: 1, maxComponents: 1, maxPageProfiles: 1, maxResolverAttempts: 0 },
  ];
  let attempt = await tryWorkflowStateProfiles(storage, key, state, profiles.slice(0, 1), clock);
  if (attempt.saved) return attempt.state;
  let lastQuotaError = attempt.error;
  const rollbackSnapshot = mapperStorageSnapshot(await storage.get(null));

  try {
    await removeLegacyMapperWorkflow(
      storage,
      workflowIdFromStorageKey(key),
    );
    await pruneWorkflowTombstones(
      storage,
      "",
      Math.floor(DEFAULT_MAX_WORKFLOW_TOMBSTONES / 2),
    );
    attempt = await tryWorkflowStateProfiles(storage, key, state, profiles.slice(0, 1), clock);
    if (attempt.saved) return attempt.state;
    lastQuotaError = attempt.error;

    const records = await storage.get(null);
    const evictable = liveWorkflowStorageRecords(records, key);
    for (const entry of evictable) {
      await storage.set({
        [entry.key]: createWorkflowTombstone(
          entry.workflowId,
          entry.record,
          clock(),
          "aggregate_quota_eviction",
        ),
      });
      attempt = await tryWorkflowStateProfiles(storage, key, state, profiles.slice(0, 1), clock);
      if (attempt.saved) return attempt.state;
      lastQuotaError = attempt.error;
    }

    attempt = await tryWorkflowStateProfiles(storage, key, state, profiles.slice(1), clock);
    if (attempt.saved) return attempt.state;
    lastQuotaError = attempt.error;

    throw lastQuotaError || new Error("Mapper state could not be persisted within storage quota.");
  } catch (error) {
    try {
      await restoreMapperStorageSnapshot(storage, rollbackSnapshot);
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  }
}

function mapperStorageSnapshot(records = {}) {
  return Object.fromEntries(
    Object.entries(records || {})
      .filter(([entryKey]) => {
        return entryKey === Defaults.MapperStorageKey ||
          entryKey.startsWith(WORKFLOW_STORAGE_PREFIX);
      })
      .map(([entryKey, value]) => [entryKey, structuredClone(value)]),
  );
}

async function restoreMapperStorageSnapshot(storage, snapshot = {}) {
  const current = mapperStorageSnapshot(await storage.get(null));
  const extraKeys = Object.keys(current).filter((entryKey) => {
    return !Object.prototype.hasOwnProperty.call(snapshot, entryKey);
  });
  if (extraKeys.length) {
    if (typeof storage.remove !== "function") {
      throw new Error("Chrome mapper storage does not support quota rollback cleanup.");
    }
    await storage.remove(extraKeys);
  }
  for (const [entryKey, value] of Object.entries(snapshot)) {
    await storage.set({ [entryKey]: structuredClone(value) });
  }
}

async function writeWorkflowTombstoneAfterRemovingLegacyTarget(
  storage,
  key,
  workflowId,
  tombstone,
) {
  const result = await storage.get(Defaults.MapperStorageKey);
  const legacy = result?.[Defaults.MapperStorageKey];
  const updates = { [key]: tombstone };
  if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
    const retained = structuredClone(legacy);
    let removed = false;
    for (const legacyKey of Object.keys(retained)) {
      if (normalizeWorkflowId(legacyKey) !== workflowId) continue;
      delete retained[legacyKey];
      removed = true;
    }
    if (removed) updates[Defaults.MapperStorageKey] = retained;
  }
  await storage.set(updates);
}

async function tryWorkflowStateProfiles(storage, key, state, profiles, clock) {
  let lastQuotaError = null;
  for (const profile of profiles) {
    const candidate = boundWorkflowMapperState(state, profile || {});
    try {
      await storage.set({ [key]: candidate });
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      lastQuotaError = error;
      continue;
    }
    await completeWorkflowStorageMaintenance(storage, key, clock);
    return { saved: true, state: candidate, error: null };
  }
  return { saved: false, state: null, error: lastQuotaError };
}

async function completeWorkflowStorageMaintenance(storage, protectedKey, clock) {
  try {
    await enforceGlobalWorkflowStateLimit(storage, protectedKey, clock);
    await pruneWorkflowTombstones(storage, protectedKey);
  } catch (error) {
    // The workflow revision has already committed. Do not report a false save
    // failure; the next write will retry bounded retention/compaction.
    console.warn("BRunner mapper storage maintenance was deferred.", error);
  }
}

async function enforceGlobalWorkflowStateLimit(
  storage,
  protectedKey,
  clock,
  maxWorkflowStates = DEFAULT_MAX_WORKFLOW_STATES,
) {
  const records = await storage.get(null);
  const directLive = liveWorkflowStorageRecords(records, protectedKey, {
    includeProtected: true,
  });
  const directWorkflowIds = new Set(
    Object.entries(records || {})
      .filter(([key]) => key.startsWith(WORKFLOW_STORAGE_PREFIX))
      .map(([key, record]) => parseDirectWorkflowStorageRecord(key, record)?.workflowId)
      .filter(Boolean),
  );
  const legacy = records?.[Defaults.MapperStorageKey];
  const legacyCorpus = legacy && typeof legacy === "object" && !Array.isArray(legacy)
    ? structuredClone(legacy)
    : {};
  const legacyLive = Object.entries(legacyCorpus)
    .map(([legacyKey, record]) => {
      const workflowId = normalizeWorkflowId(legacyKey);
      const state = deserializeLegacyWorkflowState(workflowId, record);
      return {
        key: "",
        legacyKey,
        record: state,
        workflowId,
        savedAt: String(state?.storage?.savedAt || state?.updatedAt || ""),
        source: "legacy",
      };
    })
    .filter((entry) => {
      return Boolean(
        entry.workflowId
        && entry.record
        && !directWorkflowIds.has(entry.workflowId),
      );
    });
  const live = [
    ...directLive.map((entry) => ({ ...entry, source: "direct" })),
    ...legacyLive,
  ].sort((left, right) => {
    return left.savedAt.localeCompare(right.savedAt)
      || left.workflowId.localeCompare(right.workflowId);
  });
  const excess = Math.max(0, live.length - maxWorkflowStates);
  const protectedWorkflowId = workflowIdFromStorageKey(protectedKey);
  const victims = live
    .filter((entry) => {
      return entry.key !== protectedKey && entry.workflowId !== protectedWorkflowId;
    })
    .slice(0, excess);

  let legacyChanged = false;
  for (const legacyKey of Object.keys(legacyCorpus)) {
    if (!directWorkflowIds.has(normalizeWorkflowId(legacyKey))) continue;
    delete legacyCorpus[legacyKey];
    legacyChanged = true;
  }
  for (const entry of victims.filter((candidate) => candidate.source === "legacy")) {
    if (!Object.prototype.hasOwnProperty.call(legacyCorpus, entry.legacyKey)) continue;
    delete legacyCorpus[entry.legacyKey];
    legacyChanged = true;
  }
  if (legacyChanged) {
    await storage.set({ [Defaults.MapperStorageKey]: legacyCorpus });
  }

  for (const entry of victims.filter((candidate) => candidate.source === "direct")) {
    await storage.set({
      [entry.key]: createWorkflowTombstone(
        entry.workflowId,
        entry.record,
        clock(),
        "global_retention_eviction",
      ),
    });
  }
  return victims.length;
}

function liveWorkflowStorageRecords(
  records = {},
  protectedKey = "",
  { includeProtected = false } = {},
) {
  return Object.entries(records || {})
    .filter(([key]) => {
      return key.startsWith(WORKFLOW_STORAGE_PREFIX)
        && (includeProtected || key !== protectedKey);
    })
    .map(([key, record]) => {
      const directRecord = parseDirectWorkflowStorageRecord(key, record);
      if (!directRecord || directRecord.deleted === true) return null;
      const state = directRecord.state;
      return {
        key,
        record: state,
        workflowId: directRecord.workflowId,
        savedAt: String(state?.storage?.savedAt || state?.updatedAt || ""),
      };
    })
    .filter((entry) => Boolean(entry?.workflowId && entry.record))
    .sort((left, right) => {
      return left.savedAt.localeCompare(right.savedAt)
        || left.key.localeCompare(right.key);
    });
}

function createWorkflowTombstone(
  workflowId,
  currentRecord,
  deletedAt,
  reason = "workflow_deleted",
) {
  return {
    mapperSchemaVersion: MapperSchemaVersion,
    workflowId,
    deleted: true,
    revision: String(revisionNumber(currentRecord) + 1),
    generation: workflowRevisionGeneration(currentRecord),
    deletedAt,
    reason,
  };
}

async function pruneWorkflowTombstones(
  storage,
  protectedKey = "",
  maxTombstones = DEFAULT_MAX_WORKFLOW_TOMBSTONES,
) {
  const records = await storage.get(null);
  const tombstones = Object.entries(records || {})
    .filter(([key, record]) => {
      return isValidWorkflowTombstone(key, record);
    })
    .map(([key, record]) => ({
      key,
      deletedAt: String(record?.deletedAt || ""),
    }))
    .sort((left, right) => {
      return left.deletedAt.localeCompare(right.deletedAt)
        || left.key.localeCompare(right.key);
    });
  const excess = Math.max(0, tombstones.length - maxTombstones);
  if (!excess) return 0;
  const victims = tombstones
    .filter((entry) => entry.key !== protectedKey)
    .slice(0, excess)
    .map((entry) => entry.key);
  if (!victims.length) return 0;
  if (typeof storage.remove !== "function") {
    throw new Error("Chrome mapper storage does not support tombstone compaction.");
  }
  await storage.remove(victims);
  return victims.length;
}

async function removeLegacyMapperWorkflow(storage, workflowId) {
  const id = normalizeWorkflowId(workflowId);
  if (!id) return false;
  const result = await storage.get(Defaults.MapperStorageKey);
  const legacy = result?.[Defaults.MapperStorageKey];
  if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) return false;
  const retained = structuredClone(legacy);
  let changed = false;
  for (const key of Object.keys(retained)) {
    if (normalizeWorkflowId(key) !== id) continue;
    delete retained[key];
    changed = true;
  }
  if (!changed) return false;
  await storage.set({ [Defaults.MapperStorageKey]: retained });
  return true;
}

function boundWorkflowMapperState(state = {}, limits = {}) {
  const normalized = serializeWorkflowMapperState(state);
  const maxVersions = Math.min(
    normalized.settings.maxVersions,
    positiveInteger(limits.maxVersions, normalized.settings.maxVersions),
  );
  const maxComponents = Math.min(
    normalized.settings.maxComponents,
    positiveInteger(limits.maxComponents, normalized.settings.maxComponents),
  );
  const maxPageProfiles = positiveInteger(limits.maxPageProfiles, DEFAULT_MAX_PAGE_PROFILES);
  const maxResolverAttempts = nonNegativeInteger(limits.maxResolverAttempts, 25);
  const maps = Array.isArray(normalized.maps) ? normalized.maps : [];
  const profileKeys = maps.map((map, index) => pageProfileStorageKey(map, index));
  const latestProfileIndexes = new Map();
  profileKeys.forEach((profileKey, index) => latestProfileIndexes.set(profileKey, index));
  const retainedProfiles = new Set(
    [...latestProfileIndexes.entries()]
      .sort((left, right) => left[1] - right[1])
      .slice(-maxPageProfiles)
      .map(([profileKey]) => profileKey),
  );
  const retainedIndexes = new Set();

  retainedProfiles.forEach((profileKey) => {
    const indexes = profileKeys
      .map((value, index) => ({ value, index }))
      .filter((entry) => entry.value === profileKey)
      .map((entry) => entry.index)
      .slice(-maxVersions);
    indexes.forEach((index) => retainedIndexes.add(index));
  });

  const retainedMaps = maps
    .filter((_, index) => retainedIndexes.has(index))
    .map((map) => {
      const hasComponents = Array.isArray(map?.components);
      const components = hasComponents ? map.components.slice(0, maxComponents) : [];
      const resolverAttempts = Array.isArray(map?.resolverAttempts)
        ? maxResolverAttempts > 0
          ? map.resolverAttempts.slice(-maxResolverAttempts)
          : []
        : [];
      return {
        ...structuredClone(map),
        ...(hasComponents
          ? {
              components,
              componentCount: components.filter((component) => component?.status !== "removed").length,
            }
          : {}),
        ...(resolverAttempts.length || Array.isArray(map?.resolverAttempts)
          ? { resolverAttempts }
          : {}),
      };
    });
  const originalComponentCount = maps.reduce((total, map) => {
    return total + (Array.isArray(map?.components) ? map.components.length : 0);
  }, 0);
  const retainedComponentCount = retainedMaps.reduce((total, map) => {
    return total + (Array.isArray(map.components) ? map.components.length : 0);
  }, 0);
  const prunedMapCount = Math.max(0, maps.length - retainedMaps.length);
  const prunedComponentCount = Math.max(0, originalComponentCount - retainedComponentCount);
  const quotaPruned = Object.keys(limits).length > 0;

  return serializeWorkflowMapperState({
    ...normalized,
    maps: retainedMaps,
    storage: createMapperStorageMetadata({
      ...(normalized.storage || {}),
      quotaPruned,
      prunedMapCount,
      prunedComponentCount,
    }),
  });
}

function pageProfileStorageKey(map = {}, index = 0) {
  return String(
    map.pageProfileKey ||
      map.pageKey ||
      map.pageId ||
      map.siteKey ||
      `map_${index}`,
  );
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function isQuotaError(error = null) {
  return /quota|quota_bytes|bytes.*exceed/i.test(String(error?.message || error || ""));
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
