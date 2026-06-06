// background.js - Enterprise Orchestration Engine & Hardware Simulator

// ============================================================================
// 1. Core State & Registries
// ============================================================================
const OrchestrationEngine = {
  VariableRegistry: {},
  ActionSchemaRegistry: [],
  TabManager: { activeTargetId: null, navigationFlags: {} },
  NetworkMonitor: { activeRequests: 0, isIdle: true },
};

// ============================================================================
// 2. Extension Lifecycle & Network Wait States
// ============================================================================
// chrome.runtime.onInstalled.addListener(() => {
//   console.log("[BRunner] Orchestration Engine Initialized.");
//   chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
// });

// Replace the chrome.runtime.onInstalled listener at the top of background.js with this:

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({ url: "studio/index.html" });
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("[BRunner] Orchestration Engine Initialized.");
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId >= 0) {
      OrchestrationEngine.NetworkMonitor.activeRequests++;
      OrchestrationEngine.NetworkMonitor.isIdle = false;
    }
  },
  { urls: ["<all_urls>"] },
);

const handleNetworkSettle = (details) => {
  if (details.tabId >= 0) {
    OrchestrationEngine.NetworkMonitor.activeRequests = Math.max(
      0,
      OrchestrationEngine.NetworkMonitor.activeRequests - 1,
    );
    if (OrchestrationEngine.NetworkMonitor.activeRequests === 0) {
      OrchestrationEngine.NetworkMonitor.isIdle = true;
    }
  }
};
chrome.webRequest.onCompleted.addListener(handleNetworkSettle, {
  urls: ["<all_urls>"],
});
chrome.webRequest.onErrorOccurred.addListener(handleNetworkSettle, {
  urls: ["<all_urls>"],
});

// ============================================================================
// PHASE 4: The Hardware Simulation Layer (CDP Bypasser)
// ============================================================================
const HardwareSimulator = {
  async attachDebugger(tabId) {
    const target = { tabId };
    try {
      const targets = await chrome.debugger.getTargets();
      const isAttached = targets.some((t) => t.tabId === tabId && t.attached);

      if (!isAttached) {
        await chrome.debugger.attach(target, "1.3");
        console.log(`[BRunner Hardware] Debugger attached to Tab ${tabId}`);
      }
      return target;
    } catch (error) {
      console.error(`[BRunner Hardware] Failed to attach debugger:`, error);
      throw error;
    }
  },

  async detachDebugger(target) {
    try {
      await chrome.debugger.detach(target);
      console.log(
        `[BRunner Hardware] Debugger detached from Tab ${target.tabId}`,
      );
    } catch (error) {
      // Ignore if already detached
    }
  },

  async executePhysicalClick(tabId, coordinates) {
    const target = await this.attachDebugger(tabId);
    const { centerX, centerY } = coordinates;

    console.log(
      `[BRunner Hardware] Dispatching CDP click at X:${centerX}, Y:${centerY}`,
    );

    try {
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: centerX,
        y: centerY,
      });

      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: centerX,
        y: centerY,
        button: "left",
        clickCount: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: centerX,
        y: centerY,
        button: "left",
        clickCount: 1,
      });

      console.log(`[BRunner Hardware] CDP click successful.`);
      return { status: "success", strategy_used: "Hardware_CDP" };
    } finally {
      await this.detachDebugger(target);
    }
  }, // <--- CRITICAL FIX: THIS COMMA WAS MISSING

  async executePhysicalKeystroke(tabId, keyToPress) {
    const target = await this.attachDebugger(tabId);
    console.log(`[BRunner Hardware] Dispatching CDP Keystroke: ${keyToPress}`);

    try {
      await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
        type: "keyDown",
        key: keyToPress,
        code: keyToPress,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key: keyToPress,
        code: keyToPress,
      });

      console.log(`[BRunner Hardware] CDP keystroke successful.`);
      return { status: "success", strategy_used: "Hardware_CDP_Key" };
    } finally {
      await this.detachDebugger(target);
    }
  },
};

// ============================================================================
// PHASE 6: The Native OS Bridge (WebSocket Client)
// ============================================================================
// ============================================================================
// PHASE 6: The Native OS Bridge (WebSocket Client)
// ============================================================================
const NativeBridge = {
  socket: null,
  isAuthenticated: false,
  // I grabbed this directly from your Python error logs!
  pairingKey: "ac1890957e38af28cd5d0961e6d0d530",

  connect() {
    return new Promise((resolve, reject) => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        return resolve(this.isAuthenticated);
      }

      console.log("[BRunner Bridge] Connecting to Local Python Host...");
      this.socket = new WebSocket("ws://127.0.0.1:8999");

      this.socket.onopen = () => {
        this.socket.send(
          JSON.stringify({
            command: "AUTH",
            payload: { key: this.pairingKey },
          }),
        );
      };

      this.socket.onmessage = (event) => {
        const response = JSON.parse(event.data);
        if (response.message === "Authenticated successfully.") {
          this.isAuthenticated = true;
          console.log("[BRunner Bridge] Securely paired with OS Host.");
          resolve(true);
        }
      };

      this.socket.onerror = (error) => {
        console.error("[BRunner Bridge] Connection failed.", error);
        reject("WebSocket Connection Failed");
      };
    });
  },

  sendOsCommand(command, payload = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        await this.connect();

        if (!this.isAuthenticated) {
          return reject("Bridge not authenticated.");
        }

        const listener = (event) => {
          const response = JSON.parse(event.data);
          this.socket.removeEventListener("message", listener);

          if (response.status === "success") resolve(response);
          else reject(response.error);
        };

        this.socket.addEventListener("message", listener);
        this.socket.send(JSON.stringify({ command, payload }));
      } catch (e) {
        reject(e);
      }
    });
  },

  async listWorkflows() {
    return await this.sendOsCommand("LIST_WORKFLOWS");
  },

  async saveWorkflow(filename, content) {
    return await this.sendOsCommand("SAVE_WORKFLOW", { filename, content });
  },

  async loadWorkflow(filename) {
    return await this.sendOsCommand("LOAD_WORKFLOW", { filename });
  },
};

// ============================================================================
// 3. Cross-Context Message Pipeline (Updated for Phase 4)
// ============================================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "SYSTEM_LOG") {
    // console.log(`[BRunner Agent - Tab ${sender.tab?.id}]:`, request.payload);
    sendResponse({ status: "success", received: true });
    return false;
  }

  // 1. Intercept Physical Click Requests
  if (request.type === "REQUEST_HARDWARE_SIMULATION") {
    console.warn(
      `[BRunner Brain] Hardware override requested for Tab ${sender.tab.id}. Reason: ${request.payload.reason}`,
    );

    HardwareSimulator.executePhysicalClick(
      sender.tab.id,
      request.payload.coordinates,
    )
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({ status: "failed", error: error.message }),
      );

    return true; // Keep port open for async response
  }

  // 2. Intercept Physical Keystroke Requests
  if (request.type === "REQUEST_HARDWARE_KEYSTROKE") {
    console.log(
      `[BRunner Brain] OS Keystroke requested for Tab ${sender.tab.id}.`,
    );

    // --- CRITICAL FIX: OS-LEVEL FOCUS ---
    // 1. Force the target window to the front of the OS screen
    // 2. Force the target tab to be the active tab in that window
    chrome.tabs
      .get(sender.tab.id)
      .then((tab) => {
        return chrome.windows
          .update(tab.windowId, { focused: true })
          .then(() => {
            return chrome.tabs.update(tab.id, { active: true });
          });
      })
      .then(() => {
        // 3. Give the OS a tiny 100ms window to finish rendering the UI switch
        setTimeout(() => {
          // 4. NOW tell Python to fire the keystroke
          NativeBridge.sendOsCommand("OS_KEYSTROKE", {
            key: request.payload.key,
          })
            .then((result) => sendResponse(result))
            .catch((error) =>
              sendResponse({ status: "failed", error: error.toString() }),
            );
        }, 100);
      })
      .catch((err) => {
        console.error("[BRunner Brain] Focus failed:", err);
        sendResponse({
          status: "failed",
          error: "Could not focus tab for OS keystroke.",
        });
      });

    return true; // Keep port open for async response
  }
});

// ============================================================================
// 5. Studio Connection & Workflow Execution Loop
// ============================================================================
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "brunner-studio") {
    console.log("[BRunner Brain] Studio UI Connected.");

    // Add this to your onConnect listener in background.js
    port.onMessage.addListener(async (msg) => {
      if (msg.type === "CHECK_BRIDGE_STATUS") {
        // Attempt to connect if not already
        const isConnected = await NativeBridge.connect().catch(() => false);
        port.postMessage({ type: "BRIDGE_STATUS", connected: isConnected });
      }

      if (msg.type === "START_WORKFLOW") {
        console.log(
          `[BRunner Brain] Starting Workflow: ${msg.payload.workflow_name}`,
        );
        await runWorkflowEngine(msg.payload.steps, port);
      }
    });
  }
});

async function runWorkflowEngine(steps, port) {
  let targetTabId = null;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    console.log(`[BRunner Brain] Executing Step ${i + 1}: ${step.action}`);

    // Special Case: Navigation handles tab creation/updating natively
    if (step.action === "browser.navigate") {
      // --- CRITICAL FIX: URL SANITIZER ---
      let targetUrl = step.payload.primary.trim();
      if (
        !targetUrl.startsWith("http://") &&
        !targetUrl.startsWith("https://")
      ) {
        targetUrl = "https://" + targetUrl;
      }
      // -----------------------------------

      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: false,
      });

      if (tabs.length > 0 && tabs[0].id) {
        // Navigate existing active browser tab
        targetTabId = tabs[0].id;
        await chrome.tabs.update(targetTabId, { url: targetUrl }); // Use sanitized URL
      } else {
        // Create a new tab if none found
        const newTab = await chrome.tabs.create({
          url: targetUrl,
          active: true,
        }); // Use sanitized URL
        targetTabId = newTab.id;
      }

      // Wait for page to fully load before proceeding
      await new Promise((resolve) => {
        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
          if (tabId === targetTabId && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            setTimeout(resolve, 1000); // Give the DOM 1 second to settle
          }
        });
      });
      continue;
    }

    // Special Case: Hard Wait
    if (step.action === "logic.wait") {
      const waitTime = parseInt(step.payload.primary) || 1000;
      await new Promise((res) => setTimeout(res, waitTime));
      continue;
    }

    // All other DOM actions are sent to the Content Script Execution Agent
    if (targetTabId) {
      try {
        const response = await chrome.tabs.sendMessage(targetTabId, {
          type: "EXECUTE_STEP",
          payload: step,
        });
        console.log(`[BRunner Brain] Step ${i + 1} Result:`, response);

        if (response && response.status === "failed") {
          console.error(
            `[BRunner Brain] Workflow halted. Step ${i + 1} failed:`,
            response.reason,
          );
          break; // Stop workflow on failure
        }
      } catch (error) {
        console.error(
          `[BRunner Brain] Failed to communicate with Content Script on Tab ${targetTabId}. Is the page loaded?`,
        );
      }
    } else {
      console.error(
        "[BRunner Brain] No active tab to execute action on. Ensure step 1 is 'Navigate URL'.",
      );
      break;
    }

    // Brief human-like pause between actions
    await new Promise((res) => setTimeout(res, 500));
  }

  console.log("[BRunner Brain] Workflow Execution Finished.");
  // Reset the Run button in the UI
  port.postMessage({ type: "WORKFLOW_COMPLETE" });
}
