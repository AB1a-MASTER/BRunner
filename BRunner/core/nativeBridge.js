// core/nativeBridge.js
// WebSocket bridge to the local BRunner Python host.

import { Defaults, NativeCommands } from "./constants.js";
import { NativeHostCapabilities } from "./nativeHostRequirements.js";
import { ensureJsonFilename } from "./workflowUtils.js";

class NativeBridgeClient {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.pendingRequests = new Map();
    this.nextRequestId = 1;
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
      this.sendRaw({
        command: NativeCommands.Auth,
        key: Defaults.PairingKey,
      });
      console.log("[BRunner] Native host connected.");
    };

    this.socket.onclose = () => {
      this.isConnected = false;
      console.warn("[BRunner] Native host disconnected.");
    };

    this.socket.onerror = (error) => {
      this.isConnected = false;
      console.error("[BRunner] Native host socket error:", error);
    };

    this.socket.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  sendRaw(payload) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Native host is not connected.");
    }

    this.socket.send(JSON.stringify(payload));
  }

  request(command, payload = {}) {
    this.connect();

    return new Promise((resolve, reject) => {
      const requestId = String(this.nextRequestId++);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
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
      const timer = setInterval(() => {
        if (!this.socket) {
          clearInterval(timer);
          this.pendingRequests.delete(requestId);
          reject(new Error("Native host socket was not created."));
          return;
        }

        if (this.socket.readyState === WebSocket.OPEN) {
          clearInterval(timer);
          sendWhenReady();
          return;
        }

        if (Date.now() - startedAt > 5000) {
          clearInterval(timer);
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

    if (message.error) {
      pending.reject(new Error(message.error));
      return;
    }

    pending.resolve(message);
  }

  async listWorkflows() {
    return this.request(NativeCommands.ListWorkflows);
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

  getStatus() {
    return {
      connected: this.isConnected,
      capabilities: this.isConnected
        ? [
            NativeHostCapabilities.OsKeystroke,
            NativeHostCapabilities.LocalFileRead,
            NativeHostCapabilities.DataSourceRead,
            NativeHostCapabilities.ExecutionLogSave,
          ]
        : [],
    };
  }
}

export const NativeBridge = new NativeBridgeClient();
