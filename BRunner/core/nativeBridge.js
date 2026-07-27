// core/nativeBridge.js
// WebSocket bridge to the local BRunner Python host.

import { Defaults, NativeCommands } from "./constants.js";
import { NativeHostCapabilities } from "./nativeHostRequirements.js";
import {
  ensureJsonFilename,
  ensureJsonWorkflowReference,
} from "./workflowUtils.js";

const PairingFailureCodes = new Set([
  "invalid_profile_instance_id",
  "pairing_required",
  "paired_to_other_profile",
  "paired_connection_active",
  "pairing_session_inactive",
  "pairing_state_error",
]);

const PairingFailureStates = new Set([
  "unpaired",
  "paired_to_other_profile",
  "paired_connection_active",
  "pairing_session_inactive",
  "pairing_failed",
]);

export class NativeBridgeClient {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.isPaired = false;
    this.sessionPromise = null;
    this.pairingState = "disconnected";
    this.lastPairingError = "";
    this.profileInstanceId = "";
    this.pendingRequests = new Map();
    this.nextRequestId = 1;
    this.lastHello = null;
    this.statusListeners = new Set();
  }

  connect() {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.pairingState = "connecting";
    this.lastPairingError = "";
    const socket = new WebSocket(Defaults.NativeHostUrl);
    this.socket = socket;
    this.notifyStatus();

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.isConnected = true;
      this.isPaired = false;
      this.pairingState = "checking";
      this.lastPairingError = "";
      this.startProfileSession();
      this.notifyStatus();
      console.log("[BRunner] Native host connected.");
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.isConnected = false;
      this.isPaired = false;
      this.sessionPromise = null;
      this.pairingState = "disconnected";
      this.lastPairingError = "";
      this.lastHello = null;
      this.rejectPendingRequests("Native host disconnected.");
      this.notifyStatus();
      console.warn("[BRunner] Native host disconnected.");
    };

    socket.onerror = (error) => {
      if (this.socket !== socket) return;
      this.isConnected = false;
      this.isPaired = false;
      this.sessionPromise = null;
      this.pairingState = "unavailable";
      this.lastPairingError = "Native host socket error.";
      this.lastHello = null;
      this.rejectPendingRequests("Native host socket error.");
      this.notifyStatus();
      console.error("[BRunner] Native host socket error:", error);
    };

    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.handleMessage(event.data);
    };
  }

  resetConnection() {
    this.isPaired = false;
    this.sessionPromise = null;
    this.pairingState = "disconnected";
    this.lastPairingError = "";
    this.lastHello = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        // Socket may already be closing.
      }
    }
    this.isConnected = false;
    this.rejectPendingRequests("Native host connection reset.");
    this.notifyStatus();
  }

  subscribeStatus(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("Native bridge status listener must be a function.");
    }
    this.statusListeners.add(listener);
    try {
      listener(this.getStatus());
    } catch (error) {
      console.warn("[BRunner] Native bridge status listener failed:", error);
    }
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  notifyStatus() {
    const status = this.getStatus();
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch (error) {
        console.warn("[BRunner] Native bridge status listener failed:", error);
      }
    }
  }

  sendRaw(payload) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Native host is not connected.");
    }

    this.socket.send(JSON.stringify(payload));
  }

  async announceProfile() {
    try {
      const profileInstanceId = await loadOrCreateProfileInstanceId();
      this.profileInstanceId = profileInstanceId;
      const response = await this.sendSessionRequest({
        command: NativeCommands.ProfileHello,
        profileInstanceId,
      });
      this.applyPairingResponse(response);
      return response;
    } catch (error) {
      this.applyPairingFailure(error);
      throw error;
    }
  }

  startProfileSession() {
    this.sessionPromise = this.announceProfile().catch((error) => {
      console.warn("[BRunner] Native host pairing check failed:", error);
      return null;
    });
    return this.sessionPromise;
  }

  async refreshProfileSession() {
    this.connect();
    await this.waitForSocketOpen();
    if (this.sessionPromise) {
      await this.sessionPromise;
    }
    return await this.announceProfile();
  }

  async pairProfile() {
    this.connect();
    await this.waitForSocketOpen();
    if (this.sessionPromise) {
      await this.sessionPromise;
    }
    const profileInstanceId = await loadOrCreateProfileInstanceId();
    this.profileInstanceId = profileInstanceId;
    this.lastHello = null;
    try {
      const response = await this.sendSessionRequest({
        command: NativeCommands.PairProfile,
        profileInstanceId,
      });
      this.applyPairingResponse(response);
      return response;
    } catch (error) {
      this.applyPairingFailure(error);
      throw error;
    }
  }

  async unpairProfile() {
    this.connect();
    await this.waitForSocketOpen();
    if (this.sessionPromise) {
      await this.sessionPromise;
    }
    const profileInstanceId = await loadOrCreateProfileInstanceId();
    this.profileInstanceId = profileInstanceId;
    this.lastHello = null;
    try {
      const response = await this.sendSessionRequest({
        command: NativeCommands.UnpairProfile,
        profileInstanceId,
      });
      this.applyPairingResponse(response);
      return response;
    } catch (error) {
      this.applyPairingFailure(error);
      throw error;
    }
  }

  async waitForSocketOpen() {
    this.connect();

    const startedAt = Date.now();
    while (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      if (Date.now() - startedAt > 5000) {
        throw new Error("Timed out connecting to native host.");
      }
      await delay(100);
    }
  }

  async waitForPairing() {
    await this.waitForSocketOpen();

    if (!this.sessionPromise) {
      this.startProfileSession();
    }

    await this.sessionPromise;
    if (!this.isPaired) {
      const error = new Error(
        this.lastPairingError || "Pair this Chrome profile with the companion before continuing.",
      );
      error.code = this.pairingState === "unpaired"
        ? "pairing_required"
        : this.pairingState || "pairing_required";
      error.pairingState = this.pairingState;
      throw error;
    }
  }

  sendSessionRequest(payload) {
    return new Promise((resolve, reject) => {
      const requestId = String(this.nextRequestId++);
      const timer = this.startRequestTimeout(requestId, reject);
      this.pendingRequests.set(requestId, { resolve, reject, timer });

      try {
        this.sendRaw({
          id: requestId,
          ...payload,
        });
      } catch (error) {
        this.pendingRequests.delete(requestId);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  async request(command, payload = {}, options = {}) {
    this.connect();
    await this.waitForPairing();

    return new Promise((resolve, reject) => {
      const requestId = String(this.nextRequestId++);
      const timeoutMs = normalizeTimeout(options.timeoutMs);
      const timer = this.startRequestTimeout(requestId, reject, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timer,
      });

      const sendWhenReady = () => {
        try {
          this.sendRaw({
            id: requestId,
            command,
            ...payload,
          });
        } catch (error) {
          this.pendingRequests.delete(requestId);
          reject(error);
        }
      };

      if (this.socket.readyState === WebSocket.OPEN) {
        sendWhenReady();
        return;
      }

      const startedAt = Date.now();
      const connectionTimer = setInterval(() => {
        if (!this.socket) {
          clearInterval(connectionTimer);
          this.pendingRequests.delete(requestId);
          reject(new Error("Native host socket was not created."));
          return;
        }

        if (this.socket.readyState === WebSocket.OPEN) {
          clearInterval(connectionTimer);
          sendWhenReady();
          return;
        }

        if (Date.now() - startedAt > 5000) {
          clearInterval(connectionTimer);
          this.pendingRequests.delete(requestId);
          reject(new Error("Timed out connecting to native host."));
        }
      }, 100);
    });
  }

  async requestCapability(capability, payload = {}, options = {}) {
    this.connect();
    await this.waitForPairing();

    return new Promise((resolve, reject) => {
      const requestId = String(this.nextRequestId++);
      const timeoutMs = normalizeTimeout(options.timeoutMs);
      const timer = this.startRequestTimeout(requestId, reject, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timer,
      });

      const sendWhenReady = () => {
        try {
          this.sendRaw({
            id: requestId,
            requestId,
            protocolVersion: 2,
            capability,
            payload,
          });
        } catch (error) {
          this.pendingRequests.delete(requestId);
          reject(error);
        }
      };

      if (this.socket.readyState === WebSocket.OPEN) {
        sendWhenReady();
        return;
      }

      const startedAt = Date.now();
      const connectionTimer = setInterval(() => {
        if (!this.socket) {
          clearInterval(connectionTimer);
          this.pendingRequests.delete(requestId);
          reject(new Error("Native host socket was not created."));
          return;
        }

        if (this.socket.readyState === WebSocket.OPEN) {
          clearInterval(connectionTimer);
          sendWhenReady();
          return;
        }

        if (Date.now() - startedAt > 5000) {
          clearInterval(connectionTimer);
          this.pendingRequests.delete(requestId);
          reject(new Error("Timed out connecting to native host."));
        }
      }, 100);
    });
  }

  applyPairingResponse(response = {}) {
    const paired = response?.paired === true && response?.connected === true;
    this.isPaired = paired;
    this.pairingState = String(
      response?.pairingState || (paired ? "paired" : "unpaired"),
    );
    this.lastPairingError = paired ? "" : String(response?.message || "");
    if (response?.profileInstanceId) {
      this.profileInstanceId = String(response.profileInstanceId);
    }
    if (!paired) {
      this.lastHello = null;
    }
    this.notifyStatus();
  }

  applyPairingFailure(error) {
    const code = String(error?.code || "");
    const state = String(
      error?.pairingState ||
      (code === "pairing_required" ? "unpaired" : code || "pairing_failed"),
    );
    this.isPaired = false;
    this.pairingState = state;
    this.lastPairingError = error?.message || String(error || "Pairing failed.");
    this.lastHello = null;
    this.notifyStatus();
  }

  handleMessage(raw) {
    let message;

    try {
      message = JSON.parse(raw);
    } catch {
      console.warn("[BRunner] Invalid native host message:", raw);
      return;
    }

    const requestId = String(message.id || "");
    const pending = this.pendingRequests.get(requestId);

    if (!pending) {
      console.log("[BRunner] Native host event:", message);
      return;
    }

    this.pendingRequests.delete(requestId);
    clearTimeout(pending.timer);

    if (message.error) {
      const error = new Error(message.error);
      error.code = String(message.code || "");
      error.pairingState = String(message.pairingState || "");
      if (isPairingFailure(error)) {
        this.applyPairingFailure(error);
      }
      pending.reject(error);
      return;
    }

    pending.resolve(message);
  }

  startRequestTimeout(requestId, reject, timeoutMs = Defaults.NativeRequestTimeoutMs) {
    return setTimeout(() => {
      if (!this.pendingRequests.has(requestId)) return;
      this.pendingRequests.delete(requestId);
      reject(new Error(`Timed out waiting for native host response (${requestId}).`));
    }, timeoutMs);
  }

  rejectPendingRequests(reason) {
    const pending = Array.from(this.pendingRequests.entries());
    this.pendingRequests.clear();
    for (const [, request] of pending) {
      clearTimeout(request.timer);
      request.reject(new Error(reason));
    }
  }

  async listWorkflows() {
    return this.request(NativeCommands.ListWorkflows);
  }

  async hostHello() {
    const response = await this.request(NativeCommands.HostHello);
    if (Array.isArray(response?.capabilities)) {
      this.lastHello = response;
      this.notifyStatus();
    }
    return response;
  }

  async hostWindow(request = {}) {
    return this.requestCapability(
      NativeHostCapabilities.HostWindow,
      request && typeof request === "object" ? request : {},
    );
  }

  async hostAction(request = {}) {
    return this.requestCapability(
      NativeHostCapabilities.HostAction,
      request && typeof request === "object" ? request : {},
    );
  }

  async hostVisualMatch(request = {}) {
    return this.requestCapability(
      NativeHostCapabilities.HostVisualMatch,
      request && typeof request === "object" ? request : {},
    );
  }

  async loadWorkflow(filename) {
    return this.request(NativeCommands.LoadWorkflow, {
      filename: ensureJsonWorkflowReference(filename),
    });
  }

  async saveWorkflow(filename, content) {
    return this.request(NativeCommands.SaveWorkflow, {
      filename: ensureJsonWorkflowReference(filename),
      content,
    });
  }

  async deleteWorkflow(filename) {
    return this.request(NativeCommands.DeleteWorkflow, {
      filename: ensureJsonWorkflowReference(filename),
    });
  }

  async duplicateWorkflow(filename, newFilename) {
    return this.request(NativeCommands.DuplicateWorkflow, {
      filename: ensureJsonWorkflowReference(filename),
      newFilename: ensureJsonFilename(newFilename),
    });
  }

  async renameWorkflow(filename, newFilename, content) {
    return this.request(NativeCommands.RenameWorkflow, {
      filename: ensureJsonWorkflowReference(filename),
      newFilename: ensureJsonFilename(newFilename),
      content,
    });
  }

  async upgradeWorkflow(filename, content) {
    return this.request(NativeCommands.UpgradeWorkflow, {
      filename: ensureJsonWorkflowReference(filename),
      content,
    });
  }

  async listMapperStates() {
    return this.request(NativeCommands.ListMapperStates, {}, {
      timeoutMs: Defaults.NativeMapperRequestTimeoutMs,
    });
  }

  async getMapperState(workflowId) {
    return this.request(NativeCommands.GetMapperState, {
      workflowId: String(workflowId || ""),
    }, {
      timeoutMs: Defaults.NativeMapperRequestTimeoutMs,
    });
  }

  async saveMapperState(workflowId, state) {
    return this.request(NativeCommands.SaveMapperState, {
      workflowId: String(workflowId || state?.workflowId || ""),
      state: state && typeof state === "object" ? state : {},
    }, {
      timeoutMs: Defaults.NativeMapperRequestTimeoutMs,
    });
  }

  async deleteMapperState(workflowId) {
    return this.request(NativeCommands.DeleteMapperState, {
      workflowId: String(workflowId || ""),
    }, {
      timeoutMs: Defaults.NativeMapperRequestTimeoutMs,
    });
  }

  async saveExecutionLog(workflowName, runId, logs) {
    return this.request(NativeCommands.SaveExecutionLog, {
      workflowName: String(workflowName || "Untitled"),
      runId: String(runId || "run"),
      logs: Array.isArray(logs) ? logs : [],
    });
  }

  async osKeystroke(keys) {
    return this.request(NativeCommands.OsKeystroke, {
      keys,
    });
  }

  async readLocalFile(request) {
    if (request && typeof request === "object") {
      const directoryAlias = String(request.directoryAlias || "").trim();
      const relativePath = String(request.relativePath || "").trim();
      if (!directoryAlias || !relativePath) {
        throw new Error("Local file read requires directoryAlias and relativePath.");
      }
      return this.request(NativeCommands.ReadFile, {
        request: {
          directoryAlias,
          relativePath,
        },
      });
    }
    const path = String(request || "").trim();
    if (!path) throw new Error("Local file path is required.");
    return this.request(NativeCommands.ReadFile, {
      path,
    });
  }

  async readDataSource(source) {
    return this.request(NativeCommands.ReadDataSource, {
      source: source && typeof source === "object" ? source : {},
    });
  }

  async listApprovedDirectories() {
    return this.request(NativeCommands.ListApprovedDirectories);
  }

  async findApprovedFiles(request) {
    return this.request(NativeCommands.FindApprovedFiles, {
      request: request && typeof request === "object" ? request : {},
    });
  }

  async writeApprovedFile(request) {
    return this.request(NativeCommands.WriteApprovedFile, {
      request: request && typeof request === "object" ? request : {},
    });
  }

  async exportDataFile(request) {
    return this.request(NativeCommands.ExportDataFile, {
      request: request && typeof request === "object" ? request : {},
    });
  }

  getStatus() {
    const fallbackCapabilities = [
      NativeHostCapabilities.OsKeystroke,
      NativeHostCapabilities.HostWindow,
      NativeHostCapabilities.HostAction,
      NativeHostCapabilities.HostVisualMatch,
      NativeHostCapabilities.LocalFileRead,
      NativeHostCapabilities.ApprovedDirectoryList,
      NativeHostCapabilities.ApprovedFileFind,
      NativeHostCapabilities.ApprovedFileWrite,
      NativeHostCapabilities.DataFileExport,
      NativeHostCapabilities.DataSourceRead,
      NativeHostCapabilities.ExecutionLogSave,
    ];
    const ready = Boolean(this.isConnected && this.isPaired && this.lastHello);
    return {
      connected: ready,
      ready,
      socketConnected: this.isConnected,
      paired: this.isPaired,
      pairingState: this.pairingState,
      pairingError: this.lastPairingError,
      profileInstanceId: this.profileInstanceId,
      protocolVersion: this.lastHello?.protocolVersion || null,
      host: this.lastHello?.host || null,
      capabilities: ready
        ? (Array.isArray(this.lastHello?.capabilities) ? this.lastHello.capabilities : fallbackCapabilities)
        : [],
    };
  }
}

function isPairingFailure(error) {
  const code = String(error?.code || "").trim();
  const state = String(error?.pairingState || "").trim();
  return PairingFailureCodes.has(code) || PairingFailureStates.has(state);
}

export async function loadOrCreateProfileInstanceId(
  storage = globalThis.chrome?.storage?.local,
) {
  if (!storage) {
    throw new Error("Extension profile storage is unavailable.");
  }
  const result = await storage.get(Defaults.ProfileInstanceStorageKey);
  const stored = normalizeProfileInstanceId(
    result?.[Defaults.ProfileInstanceStorageKey],
  );
  if (isValidProfileInstanceId(stored)) {
    return stored;
  }
  const profileInstanceId = generateProfileInstanceId();
  await storage.set({
    [Defaults.ProfileInstanceStorageKey]: profileInstanceId,
  });
  return profileInstanceId;
}

export function generateProfileInstanceId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID().toLowerCase();
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = Array.from(
    bytes,
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20),
  ].join("-");
}

export function normalizeProfileInstanceId(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function isValidProfileInstanceId(value = "") {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    normalizeProfileInstanceId(value),
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTimeout(value) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout > 0
    ? timeout
    : Defaults.NativeRequestTimeoutMs;
}

export const NativeBridge = new NativeBridgeClient();
