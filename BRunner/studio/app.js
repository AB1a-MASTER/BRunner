// studio/app.js - Enterprise UI State Manager & OS Bridge

let workflowSteps = [];
const canvas = document.getElementById("workflow-canvas");
const workflowNameInput = document.getElementById("workflow-name");
const workflowListContainer = document.getElementById("workflow-list");

// ============================================================================
// 1. UI Layout & Toggles
// ============================================================================
document.getElementById("btn-toggle-sidebar").addEventListener("click", () => {
  document.getElementById("workflow-sidebar").classList.toggle("collapsed");
});

document.getElementById("btn-new").addEventListener("click", () => {
  workflowSteps = [];
  workflowNameInput.value = "Untitled";
  renderCanvas();
});

// ============================================================================
// 2. Native OS File System Integration
// ============================================================================
// SAVE to OS
document.getElementById("btn-save").addEventListener("click", () => {
  updateStateFromUI();
  let name = workflowNameInput.value.trim() || "Untitled";
  if (!name.endsWith(".json")) name += ".json";

  const payloadToSave = {
    boundDomain: document.getElementById("workflow-domain").value.trim(),
    steps: workflowSteps,
  };

  chrome.runtime.sendMessage(
    {
      type: "OS_SAVE_WORKFLOW",
      payload: { filename: name, content: payloadToSave },
    },
    (response) => {
      if (response && response.status === "success") {
        alert(`Workflow "${name}" saved securely to OS!`);
        refreshWorkflowList();
      } else {
        alert("Failed to save: " + (response?.error || "Unknown error"));
      }
    },
  );
});

// REFRESH List from OS
document
  .getElementById("btn-refresh")
  .addEventListener("click", refreshWorkflowList);

function refreshWorkflowList() {
  workflowListContainer.innerHTML = '<div class="empty-state">Loading...</div>';
  chrome.runtime.sendMessage({ type: "OS_LIST_WORKFLOWS" }, (response) => {
    if (response && response.status === "success") {
      renderWorkflowList(response.files);
    } else {
      workflowListContainer.innerHTML = `<div class="empty-state" style="color:#ef4444;">Failed to load from OS.<br>${response?.error || ""}</div>`;
    }
  });
}

// LOAD specific file from OS
function loadWorkflowFromOS(filename) {
  chrome.runtime.sendMessage(
    {
      type: "OS_LOAD_WORKFLOW",
      payload: { filename },
    },
    (response) => {
      if (response && response.status === "success") {
        // Backward compatibility check for older workflows
        if (Array.isArray(response.content)) {
          workflowSteps = response.content;
          document.getElementById("workflow-domain").value = "";
        } else {
          workflowSteps = response.content.steps || [];
          document.getElementById("workflow-domain").value =
            response.content.boundDomain || "";
        }
        workflowNameInput.value = filename.replace(".json", "");
        renderCanvas();
      } else {
        alert("Failed to load workflow.");
      }
    },
  );
}

// Render the Sidebar Cards
function renderWorkflowList(files) {
  if (!files || files.length === 0) {
    workflowListContainer.innerHTML =
      '<div class="empty-state">No saved workflows found.</div>';
    return;
  }

  workflowListContainer.innerHTML = "";
  files.forEach((file) => {
    const card = document.createElement("div");
    card.className = "workflow-card";
    // Using just emojis for actions to save space on the card
    card.innerHTML = `
      <div class="workflow-card-title">${file}</div>
      <div class="workflow-card-actions">
        <button class="micro-btn load-btn" data-file="${file}" title="Load Workflow">📂 Load</button>
        <button class="micro-btn duplicate-btn" data-file="${file}" title="Duplicate Workflow">📋</button>
        <button class="micro-btn delete-btn" data-file="${file}" style="color: #ef4444; border-color: #ef4444;" title="Delete Workflow">🗑️</button>
      </div>
    `;
    workflowListContainer.appendChild(card);
  });

  // Attach listeners to load buttons
  document.querySelectorAll(".load-btn").forEach((btn) => {
    btn.addEventListener("click", (e) =>
      loadWorkflowFromOS(e.target.getAttribute("data-file")),
    );
  });

  // Attach listeners to the new duplicate buttons
  document.querySelectorAll(".duplicate-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const originalFile = e.target.getAttribute("data-file");
      const suggestedName = originalFile.replace(".json", "") + "_copy";
      const newName = prompt(
        `Enter a new name to duplicate "${originalFile}":`,
        suggestedName,
      );

      if (newName && newName.trim() !== "") {
        chrome.runtime.sendMessage(
          {
            type: "OS_DUPLICATE_WORKFLOW",
            payload: { filename: originalFile, newFilename: newName.trim() },
          },
          (response) => {
            if (response && response.status === "success") {
              refreshWorkflowList(); // Instantly update the UI
            } else {
              alert(
                "Failed to duplicate workflow: " +
                  (response?.error || "Unknown error"),
              );
            }
          },
        );
      }
    });
  });

  // Attach listeners to the delete buttons
  document.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const filename = e.target.getAttribute("data-file");
      if (
        confirm(
          `Are you sure you want to permanently delete "${filename}" from your OS?`,
        )
      ) {
        chrome.runtime.sendMessage(
          {
            type: "OS_DELETE_WORKFLOW",
            payload: { filename },
          },
          (response) => {
            if (response && response.status === "success") {
              refreshWorkflowList();
            } else {
              alert(
                "Failed to delete workflow: " +
                  (response?.error || "Unknown error"),
              );
            }
          },
        );
      }
    });
  });
}

// ============================================================================
// 3. Workflow Execution Loop
// ============================================================================
// RUN Workflow
document.getElementById("btn-run").addEventListener("click", () => {
  if (workflowSteps.length === 0) return alert("Add at least one step.");
  updateStateFromUI();

  const executionPort = chrome.runtime.connect({ name: "brunner-studio" });

  executionPort.onMessage.addListener((msg) => {
    if (msg.type === "WORKFLOW_COMPLETE") {
      const runBtn = document.getElementById("btn-run");
      runBtn.innerText = "▶ Run Workflow";
      runBtn.style.backgroundColor = "var(--accent)";
      executionPort.disconnect();
    }
  });

  // Package the new schema
  executionPort.postMessage({
    type: "START_WORKFLOW",
    payload: {
      workflow_name: workflowNameInput.value,
      boundDomain: document.getElementById("workflow-domain").value.trim(),
      steps: workflowSteps,
    },
  });

  const runBtn = document.getElementById("btn-run");
  runBtn.innerText = "⏳ Running...";
  runBtn.style.backgroundColor = "#d97706";
});
// ============================================================================
// 4. Node Management & Rendering
// ============================================================================
document.querySelectorAll(".action-btn").forEach((btn) => {
  btn.addEventListener("click", () =>
    addStepToWorkflow(btn.getAttribute("data-action")),
  );
});

function generateStepId() {
  return "step_" + Math.random().toString(36).substr(2, 9);
}

function addStepToWorkflow(actionType) {
  updateStateFromUI();
  workflowSteps.push({
    id: generateStepId(),
    action: actionType,
    target: "",
    payload: {},
  });
  renderCanvas();
}

function deleteStep(stepId) {
  updateStateFromUI();
  workflowSteps = workflowSteps.filter((s) => s.id !== stepId);
  renderCanvas();
}

// Shifts a node up or down in the array while preserving its typed state
function moveStep(index, direction) {
  updateStateFromUI(); // Save current canvas state before moving

  if (direction === "up" && index > 0) {
    const temp = workflowSteps[index];
    workflowSteps[index] = workflowSteps[index - 1];
    workflowSteps[index - 1] = temp;
  } else if (direction === "down" && index < workflowSteps.length - 1) {
    const temp = workflowSteps[index];
    workflowSteps[index] = workflowSteps[index + 1];
    workflowSteps[index + 1] = temp;
  }

  renderCanvas(); // Redraw the newly ordered array
}

// Scrapes the physical input fields and saves them to the JS array
function updateStateFromUI() {
  workflowSteps.forEach((step) => {
    const targetInput = document.getElementById(`target-${step.id}`);
    if (targetInput) {
      // SMART LOGIC: If the text in the input perfectly matches our friendlyName,
      // the user hasn't edited it, so keep the hidden ctrl_hash target intact.
      // If they DID type something else (like '#my-custom-btn'), overwrite the target.
      if (step.friendlyName && targetInput.value === step.friendlyName) {
        // Do nothing, preserve the step.target under the hood
      } else {
        step.target = targetInput.value;
        step.friendlyName = null; // Clear friendly name since it's now a manual selector
      }
    }

    const payloadInput1 = document.getElementById(`payload1-${step.id}`);
    if (payloadInput1) step.payload.primary = payloadInput1.value;
  });
}

// ============================================================================
// 4. Intelligent Macro Recorder Logic
// ============================================================================
let isRecording = false;
const btnRecord = document.getElementById("btn-record");

if (btnRecord) {
  btnRecord.addEventListener("click", () => {
    isRecording = !isRecording;

    // Toggle UI State
    btnRecord.innerText = isRecording
      ? "⏹️ Stop Recording"
      : "🔴 Record Actions";
    btnRecord.style.backgroundColor = isRecording
      ? "var(--bg-main)"
      : "var(--danger)";
    btnRecord.style.border = isRecording ? "1px solid var(--danger)" : "none";

    // Tell Background Worker to activate the Content Script observer
    chrome.runtime.sendMessage({
      type: "TOGGLE_RECORDING",
      payload: { isRecording: isRecording },
    });
  });
}

// Listen for incoming messages from the Background Worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Update the side manager if an auto-save happened
  if (request.type === "REFRESH_WORKFLOW_LISTS") {
    refreshWorkflowList();
  }

  // Append a live step if the user is watching the canvas
  if (request.type === "STUDIO_RECEIVE_STEP") {
    updateStateFromUI(); // Save current canvas state

    // Push the pre-formatted step directly
    workflowSteps.push(request.step);
    renderCanvas();

    // Auto-scroll to bottom of canvas
    canvas.scrollTop = canvas.scrollHeight;
    sendResponse({ status: "success" });
  }
});

// ============================================================================
// 3. Dynamic Rendering Engine
// ============================================================================
function renderCanvas() {
  canvas.innerHTML = "";
  if (workflowSteps.length === 0) {
    canvas.innerHTML =
      '<div class="empty-state">Click an action on the left to start building.</div>';
    return;
  }

  workflowSteps.forEach((step, index) => {
    const nodeEl = document.createElement("div");
    nodeEl.className = "node";

    let targetHtml = "";
    let payloadHtml = "";
    let instructionText = "";

    const targetLabel = "Target Element (ID, Class, Name, or Text)";
    const targetPlaceholder = "e.g., #email, .btn-submit, or 'Login'";

    // Use friendlyName if available, otherwise show the target selector
    const displayTarget = step.friendlyName
      ? step.friendlyName
      : step.target || "";

    // Generate Contextual Instructions & Fields
    switch (step.action) {
      case "browser.navigate":
        instructionText =
          "Opens a new tab or updates the current one to this URL.";
        payloadHtml = `<div class="node-input-group"><label>URL</label><input type="text" id="payload1-${step.id}" value="${step.payload.primary || ""}" placeholder="https://google.com"></div>`;
        break;
      case "element.click":
        instructionText = "Finds an element and simulates a human mouse click.";
        targetHtml = `<div class="node-input-group"><label>${targetLabel}</label><input type="text" id="target-${step.id}" value="${displayTarget}" placeholder="${targetPlaceholder}"></div>`;
        break;
      case "element.type":
        instructionText =
          "Focuses an input field and types the text. Supports {{variables}}.";
        targetHtml = `<div class="node-input-group"><label>${targetLabel}</label><input type="text" id="target-${step.id}" value="${displayTarget}" placeholder="${targetPlaceholder}"></div>`;
        payloadHtml = `<div class="node-input-group"><label>Text to Type</label><input type="text" id="payload1-${step.id}" value="${step.payload.primary || ""}" placeholder="Hello World"></div>`;
        break;
      case "keyboard.send_keys":
        instructionText =
          "Dispatches a specific keyboard stroke to the active page.";
        payloadHtml = `<div class="node-input-group"><label>Key</label><input type="text" id="payload1-${step.id}" value="${step.payload.primary || ""}" placeholder="Enter, Escape, Tab"></div>`;
        break;
      case "logic.wait":
        instructionText =
          "Forces the bot to pause for a specific amount of time.";
        payloadHtml = `<div class="node-input-group"><label>Wait Time (ms)</label><input type="text" id="payload1-${step.id}" value="${step.payload.primary || "1000"}" placeholder="1000"></div>`;
        break;
      case "element.extract":
        instructionText =
          "Extracts text/value from the target and saves it to a variable.";
        targetHtml = `<div class="node-input-group"><label>${targetLabel}</label><input type="text" id="target-${step.id}" value="${displayTarget}" placeholder="${targetPlaceholder}"></div>`;
        payloadHtml = `<div class="node-input-group"><label>Variable Name</label><input type="text" id="payload1-${step.id}" value="${step.payload.primary || ""}" placeholder="e.g., scraped_title"></div>`;
        break;
      default:
        instructionText = "Interact with the specified target element.";
        targetHtml = `<div class="node-input-group"><label>${targetLabel}</label><input type="text" id="target-${step.id}" value="${displayTarget}" placeholder="${targetPlaceholder}"></div>`;
        break;
    }

    // Build the inner HTML with the new Move controls
    nodeEl.innerHTML = `
      <div class="node-header">
        <span>${index + 1}. ${step.action.replace(".", " ").toUpperCase()}</span>
        <div class="node-controls">
          <span class="node-move" data-index="${index}" data-dir="up" title="Move Up" style="cursor:pointer; margin-right: 5px; opacity: ${index === 0 ? "0.3" : "1"};">⬆️</span>
          <span class="node-move" data-index="${index}" data-dir="down" title="Move Down" style="cursor:pointer; margin-right: 15px; opacity: ${index === workflowSteps.length - 1 ? "0.3" : "1"};">⬇️</span>
          <span class="node-delete" data-id="${step.id}" title="Delete Step" style="color:#ef4444; cursor:pointer;">✕</span>
        </div>
      </div>
      <div style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 8px; font-style: italic;">
        ${instructionText}
      </div>
      ${targetHtml}
      ${payloadHtml}
    `;
    canvas.appendChild(nodeEl);
  });

  // Attach Delete Event Listeners
  document.querySelectorAll(".node-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idToDelete = e.target.getAttribute("data-id");
      deleteStep(idToDelete);
    });
  });

  // Attach Move Event Listeners
  document.querySelectorAll(".node-move").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const index = parseInt(e.target.getAttribute("data-index"));
      const dir = e.target.getAttribute("data-dir");
      moveStep(index, dir);
    });
  });
}

// --- Connection Status UI Logic ---
const statusText = document.getElementById("status-text");

function checkBridgeStatus() {
  const tempPort = chrome.runtime.connect({ name: "brunner-studio" });
  tempPort.onMessage.addListener((msg) => {
    if (msg.type === "BRIDGE_STATUS") {
      statusText.innerText = msg.connected
        ? "Connected to Host"
        : "Disconnected";
      statusText.className = msg.connected
        ? "status-connected"
        : "status-disconnected";
      tempPort.disconnect();
      if (msg.connected) refreshWorkflowList(); // Auto-fetch on connect
    }
  });
  tempPort.postMessage({ type: "CHECK_BRIDGE_STATUS" });
}

document
  .getElementById("btn-reconnect")
  .addEventListener("click", checkBridgeStatus);
checkBridgeStatus();
