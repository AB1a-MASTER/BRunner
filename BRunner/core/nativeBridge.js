// core/nativeBridge.js
// WebSocket bridge to the local BRunner Python host.

import { Defaults, NativeCommands } from "./constants.js";
import { NativeHostCapabilities } from "./nativeHostRequirements.js";
import { ensureJsonFilename } from "./workflowUtils.js";

class NativeBridgeClient {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.isAuthenticated = false;
    this.authPromise = null;
    this.lastAuthError = "";
    this.pendingRequests = new Map();
    this.nextRequestId = 1;
    this.lastHello = null;
  }

  connect() {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.socket = new WebSocket(Defaults.NativeHostUrl);

    this.socket.onopen = () => {
      this.isConnected = true;
      this.isAuthenticated = false;
      this.startAuthentication();
      console.log("[BRunner] Native host connected.");
    };

    this.socket.onclose = () => {
      this.isConnected = false;
      this.isAuthenticated = false;
      this.authPromise = null;
      this.lastHello = null;
      this.rejectPendingRequests("Native host disconnected.");
      console.warn("[BRunner] Native host disconnected.");
    };

    this.socket.onerror = (error) => {
      this.isConnected = false;
      this.isAuthenticated = false;
      this.authPromise = null;
      this.lastHello = null;
      this.rejectPendingRequests("Native host socket error.");
      console.error("[BRunner] Native host socket error:", error);
    };

    this.socket.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  resetConnection() {
    this.isAuthenticated = false;
    this.authPromise = null;
    this.lastHello = null;
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // Socket may already be closing.
      }
    }
    this.socket = null;
    this.isConnected = false;
    this.rejectPendingRequests("Native host connection reset.");
  }

  sendRaw(payload) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Native host is not connected.");
    }

    this.socket.send(JSON.stringify(payload));
  }

  async authenticate() {
    try {
      const pairingKey = await this.getPairingKey();
      if (!pairingKey) {
        throw new Error("Native host pairing key is not configured.");
      }

      const response = await this.sendAuthenticatedRequest({
        command: NativeCommands.Auth,
        key: pairingKey,
        extensionId: globalThis.chrome?.runtime?.id || "",
      });
      this.isAuthenticated = true;
      this.lastAuthError = "";
      return response;
    } catch (error) {
      this.isAuthenticated = false;
      this.lastAuthError = error?.message || String(error);
      throw error;
    }
  }

  startAuthentication() {
    this.authPromise = this.authenticate().catch((error) => {
      console.warn("[BRunner] Native host authentication failed:", error);
      return null;
    });
    return this.authPromise;
  }

  async getPairingKey() {
    const pairing = await loadNativePairing();
    return pairing.key || Defaults.PairingKey;
  }

  async waitForAuthentication() {
    this.connect();

    const startedAt = Date.now();
    while (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      if (Date.now() - startedAt > 5000) {
        throw new Error("Timed out connecting to native host.");
      }
      await delay(100);
    }

    if (!this.authPromise) {
      this.startAuthentication();
    }

    await this.authPromise;
    if (!this.isAuthenticated) {
      throw new Error(this.lastAuthError || "Native host authentication failed.");
    }
  }

  sendAuthenticatedRequest(payload) {
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
        reject(error);
      }
    });
  }

  async request(command, payload = {}, options = {}) {
    this.connect();
    await this.waitForAuthentication();

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
    await this.waitForAuthentication();

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
      pending.reject(new Error(message.error));
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
      filename: ensureJsonFilename(filename),
    });
  }

  async saveWorkflow(filename, content) {
    return this.request(NativeCommands.SaveWorkflow, {
      filename: ensureJsonFilename(filename),
      content,
    });
  }

  async deleteWorkflow(filename) {
    return this.request(NativeCommands.DeleteWorkflow, {
      filename: ensureJsonFilename(filename),
    });
  }

  async duplicateWorkflow(filename, newFilename) {
    return this.request(NativeCommands.DuplicateWorkflow, {
      filename: ensureJsonFilename(filename),
      newFilename: ensureJsonFilename(newFilename),
    });
  }

  async renameWorkflow(filename, newFilename, content) {
    return this.request(NativeCommands.RenameWorkflow, {
      filename: ensureJsonFilename(filename),
      newFilename: ensureJsonFilename(newFilename),
      content,
    });
  }

  async upgradeWorkflow(filename, content) {
    return this.request(NativeCommands.UpgradeWorkflow, {
      filename: ensureJsonFilename(filename),
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

  async readLocalFile(path) {
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
    return {
      connected: this.isConnected,
      authenticated: this.isAuthenticated,
      authError: this.lastAuthError,
      protocolVersion: this.lastHello?.protocolVersion || null,
      host: this.lastHello?.host || null,
      capabilities: this.isConnected
        ? (Array.isArray(this.lastHello?.capabilities) ? this.lastHello.capabilities : fallbackCapabilities)
        : [],
    };
  }
}

export async function loadNativePairing(storage = globalThis.chrome?.storage?.local) {
  if (!storage) {
    return { key: Defaults.PairingKey };
  }
  const result = await storage.get(Defaults.NativePairingStorageKey);
  const value = result?.[Defaults.NativePairingStorageKey];
  if (!value || typeof value !== "object") {
    return { key: Defaults.PairingKey };
  }
  return {
    key: String(value.key || "").trim() || Defaults.PairingKey,
  };
}

export async function saveNativePairing(pairing = {}, storage = globalThis.chrome?.storage?.local) {
  const key = String(pairing.key || "").trim();
  if (!key) {
    throw new Error("Pairing key is required.");
  }
  if (!storage) {
    throw new Error("Extension storage is unavailable.");
  }
  await storage.set({
    [Defaults.NativePairingStorageKey]: { key },
  });
  NativeBridge.resetConnection();
  return { key };
}

export function generateNativePairingKey() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
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
