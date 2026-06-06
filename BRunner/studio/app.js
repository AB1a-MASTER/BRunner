// studio/app.js - Enterprise UI State Manager

//const port = chrome.runtime.connect({ name: "brunner-studio" });
let workflowSteps = [];

const canvas = document.getElementById("workflow-canvas");
const workflowNameInput = document.getElementById("workflow-name");

// ============================================================================
// 1. Persistence (Save / Load / Run)
// ============================================================================
document.getElementById("btn-save").addEventListener("click", () => {
  updateStateFromUI(); // Save current typing to memory
  const name = workflowNameInput.value || "Untitled";
  chrome.storage.local.set({ [name]: workflowSteps }, () => {
    alert(`Workflow "${name}" saved!`);
  });
});

document.getElementById("btn-load").addEventListener("click", () => {
  const name = workflowNameInput.value || "Untitled";
  chrome.storage.local.get([name], (result) => {
    if (result[name]) {
      workflowSteps = result[name];
      renderCanvas();
    } else {
      alert(`No workflow found named "${name}".`);
    }
  });
});

document.getElementById("btn-run").addEventListener("click", () => {
  if (workflowSteps.length === 0) return alert("Add at least one step.");
  updateStateFromUI(); // Ensure latest text is captured

  // 1. Wake up the Brain & establish a fresh, guaranteed connection
  const executionPort = chrome.runtime.connect({ name: "brunner-studio" });

  // 2. Listen for the completion signal on this specific connection
  executionPort.onMessage.addListener((msg) => {
    if (msg.type === "WORKFLOW_COMPLETE") {
      const runBtn = document.getElementById("btn-run");
      runBtn.innerText = "▶ Run Workflow";
      runBtn.style.backgroundColor = "var(--accent)";
      executionPort.disconnect(); // Hang up the phone cleanly when finished
    }
  });

  // 3. Dispatch the workflow instructions
  executionPort.postMessage({
    type: "START_WORKFLOW",
    payload: { workflow_name: workflowNameInput.value, steps: workflowSteps },
  });

  const runBtn = document.getElementById("btn-run");
  runBtn.innerText = "⏳ Running...";
  runBtn.style.backgroundColor = "#d97706";
});

// Reset the run button when the background script finishes
// port.onMessage.addListener((msg) => {
//   if (msg.type === "WORKFLOW_COMPLETE") {
//     const runBtn = document.getElementById('btn-run');
//     runBtn.innerText = "▶ Run Workflow";
//     runBtn.style.backgroundColor = "var(--accent)";
//   }
// });

// ============================================================================
// 2. Node Management & State Syncing
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
  updateStateFromUI(); // CRITICAL FIX: Save existing typed data before adding!

  const step = {
    id: generateStepId(),
    action: actionType,
    target: "",
    payload: {},
  };

  workflowSteps.push(step);
  renderCanvas();
}

function deleteStep(stepId) {
  updateStateFromUI(); // Save data for remaining nodes
  workflowSteps = workflowSteps.filter((s) => s.id !== stepId);
  renderCanvas();
}

// Scrapes the physical input fields and saves them to the JS array
function updateStateFromUI() {
  workflowSteps.forEach((step) => {
    const targetInput = document.getElementById(`target-${step.id}`);
    if (targetInput) step.target = targetInput.value;

    const payloadInput1 = document.getElementById(`payload1-${step.id}`);
    if (payloadInput1) step.payload.primary = payloadInput1.value;
  });
}

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

    // Generate Contextual Instructions & Fields
    switch (step.action) {
      case "browser.navigate":
        instructionText =
          "Opens a new tab or updates the current one to this URL.";
        payloadHtml = `<div class="node-input-group"><label>URL</label><input type="text" id="payload1-${step.id}" value="${step.payload.primary || ""}" placeholder="https://google.com"></div>`;
        break;
      case "element.click":
        instructionText = "Finds an element and simulates a human mouse click.";
        targetHtml = `<div class="node-input-group"><label>${targetLabel}</label><input type="text" id="target-${step.id}" value="${step.target || ""}" placeholder="${targetPlaceholder}"></div>`;
        break;
      case "element.type":
        instructionText =
          "Focuses an input field and types the text. Supports {{variables}}.";
        targetHtml = `<div class="node-input-group"><label>${targetLabel}</label><input type="text" id="target-${step.id}" value="${step.target || ""}" placeholder="${targetPlaceholder}"></div>`;
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
      default:
        instructionText = "Interact with the specified target element.";
        targetHtml = `<div class="node-input-group"><label>${targetLabel}</label><input type="text" id="target-${step.id}" value="${step.target || ""}" placeholder="${targetPlaceholder}"></div>`;
        break;
    }

    // Build the inner HTML. Note: No inline onclick handlers here anymore!
    nodeEl.innerHTML = `
      <div class="node-header">
        <span>${index + 1}. ${step.action.replace(".", " ").toUpperCase()}</span>
        <span class="node-delete" data-id="${step.id}" style="color:#ef4444; cursor:pointer;">✕</span>
      </div>
      <div style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 8px; font-style: italic;">
        ${instructionText}
      </div>
      ${targetHtml}
      ${payloadHtml}
    `;

    canvas.appendChild(nodeEl);
  });

  // CRITICAL FIX: Attach event listeners AFTER the nodes are added to the DOM (Manifest V3 Compliant)
  document.querySelectorAll(".node-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idToDelete = e.target.getAttribute("data-id");
      deleteStep(idToDelete);
    });
  });
}

// --- Connection Status UI Logic ---
const statusText = document.getElementById("status-text");

function updateStatus(connected) {
  statusText.innerText = connected ? "Connected to Host" : "Disconnected";
  statusText.style.color = connected ? "#22c55e" : "#ef4444";
}

function checkBridgeStatus() {
  // Open a temporary port just to check the status
  const tempPort = chrome.runtime.connect({ name: "brunner-studio" });

  // Listen for the status reply
  tempPort.onMessage.addListener((msg) => {
    if (msg.type === "BRIDGE_STATUS") {
      updateStatus(msg.connected);
      tempPort.disconnect(); // Close the port once we have our answer
    }
  });

  // Send the request
  tempPort.postMessage({ type: "CHECK_BRIDGE_STATUS" });
}

// Ensure the button works
document
  .getElementById("btn-reconnect")
  .addEventListener("click", checkBridgeStatus);

// Initial check
checkBridgeStatus();
