// studio/app.js
// BRunner Studio UI.
// Owns workflow editing, local workflow file actions, recording controls,
// and execution requests.

const Messages = Object.freeze({
  StudioLoaded: "STUDIO_LOADED",

  OsSaveWorkflow: "OS_SAVE_WORKFLOW",
  OsListWorkflows: "OS_LIST_WORKFLOWS",
  OsLoadWorkflow: "OS_LOAD_WORKFLOW",
  OsDeleteWorkflow: "OS_DELETE_WORKFLOW",
  OsDuplicateWorkflow: "OS_DUPLICATE_WORKFLOW",

  StartWorkflow: "START_WORKFLOW",
  CheckBridgeStatus: "CHECK_BRIDGE_STATUS",

  ToggleRecording: "TOGGLE_RECORDING",
  StudioReceiveStep: "STUDIO_RECEIVE_STEP",
  RefreshWorkflowLists: "REFRESH_WORKFLOW_LISTS",
  WorkflowComplete: "WORKFLOW_COMPLETE",
});

const Actions = Object.freeze({
  BrowserNavigate: "browser.navigate",
  ElementClick: "element.click",
  ElementType: "element.type",
  ElementExtract: "element.extract",
  KeyboardSendKeys: "keyboard.send_keys",
  ElementFocus: "element.focus",
  ElementSelect: "element.select",
  ElementToggle: "element.toggle",
  LogicWait: "logic.wait",
});

const NavigationTargets = Object.freeze({
  SameTab: "sameTab",
  NewTab: "newTab",
});

let workflow = {
  boundDomain: "",
  steps: [],
};

let isRecording = false;

const canvas = document.getElementById("workflow-canvas");
const workflowNameInput = document.getElementById("workflow-name");
const workflowDomainInput = document.getElementById("workflow-domain");
const workflowListContainer = document.getElementById("workflow-list");
const btnRecord = document.getElementById("btn-record");
const btnRun = document.getElementById("btn-run");
const statusText = document.getElementById("status-text");

init();

function init() {
  wireLayoutControls();
  wireWorkflowFileControls();
  wireActionPalette();
  wireExecutionControls();
  wireRecordingControls();
  wireRuntimeMessages();

  chrome.runtime
    .sendMessage({
      type: Messages.StudioLoaded,
    })
    .catch(() => {});

  renderCanvas();
  checkBridgeStatus();
}

function wireLayoutControls() {
  document
    .getElementById("btn-toggle-sidebar")
    ?.addEventListener("click", () => {
      document
        .getElementById("workflow-sidebar")
        ?.classList.toggle("collapsed");
    });

  document.getElementById("btn-new")?.addEventListener("click", () => {
    updateStateFromUI();

    workflow = {
      boundDomain: "",
      steps: [],
    };

    workflowNameInput.value = "Untitled";
    workflowDomainInput.value = "";

    renderCanvas();
  });
}

function wireWorkflowFileControls() {
  document
    .getElementById("btn-save")
    ?.addEventListener("click", saveWorkflowToOS);
  document
    .getElementById("btn-refresh")
    ?.addEventListener("click", refreshWorkflowList);
  document
    .getElementById("btn-reconnect")
    ?.addEventListener("click", checkBridgeStatus);
}

function wireActionPalette() {
  document.querySelectorAll(".action-btn").forEach((button) => {
    button.addEventListener("click", () => {
      addStepToWorkflow(button.getAttribute("data-action"));
    });
  });
}

function wireExecutionControls() {
  btnRun?.addEventListener("click", runCurrentWorkflow);
}

function wireRecordingControls() {
  btnRecord?.addEventListener("click", async () => {
    isRecording = !isRecording;
    updateRecordButton();

    try {
      const response = await chrome.runtime.sendMessage({
        type: Messages.ToggleRecording,
        enabled: isRecording,
      });

      const recording = response?.recording;

      if (recording?.boundDomain && !workflowDomainInput.value.trim()) {
        workflowDomainInput.value = recording.boundDomain;
        workflow.boundDomain = recording.boundDomain;
      }

      if (!isRecording) {
        refreshWorkflowList();
      }
    } catch (error) {
      isRecording = !isRecording;
      updateRecordButton();
      alert(`Failed to toggle recording: ${error.message || error}`);
    }
  });
}

function wireRuntimeMessages() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.type === Messages.RefreshWorkflowLists) {
      refreshWorkflowList();
      sendResponse({ ok: true });
      return true;
    }

    if (request?.type === Messages.StudioReceiveStep) {
      updateStateFromUI();

      const step = normalizeStep(request.step);
      workflow.steps.push(step);

      renderCanvas();
      canvas.scrollTop = canvas.scrollHeight;

      sendResponse({ ok: true });
      return true;
    }

    if (request?.type === Messages.WorkflowComplete) {
      setRunButtonRunning(false);
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });
}

async function saveWorkflowToOS() {
  updateStateFromUI();

  const filename = ensureJsonFilename(workflowNameInput.value || "Untitled");
  const content = getWorkflowFromUI();

  try {
    const response = await chrome.runtime.sendMessage({
      type: Messages.OsSaveWorkflow,
      filename,
      content,
    });

    if (isSuccess(response)) {
      alert(`Workflow "${filename}" saved.`);
      refreshWorkflowList();
    } else {
      alert(`Failed to save: ${response?.error || "Unknown error"}`);
    }
  } catch (error) {
    alert(`Failed to save: ${error.message || error}`);
  }
}

async function refreshWorkflowList() {
  workflowListContainer.innerHTML =
    '<div class="empty-state">Loading workflows...</div>';

  try {
    const response = await chrome.runtime.sendMessage({
      type: Messages.OsListWorkflows,
    });

    if (isSuccess(response)) {
      renderWorkflowList(response.files || response.workflows || []);
      return;
    }

    workflowListContainer.innerHTML = `
      <div class="empty-state" style="color:#ef4444;">
        Failed to load from OS.<br>${escapeHtml(response?.error || "")}
      </div>
    `;
  } catch (error) {
    workflowListContainer.innerHTML = `
      <div class="empty-state" style="color:#ef4444;">
        Failed to load from OS.<br>${escapeHtml(error.message || error)}
      </div>
    `;
  }
}

async function loadWorkflowFromOS(filename) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: Messages.OsLoadWorkflow,
      filename,
    });

    if (!isSuccess(response)) {
      alert(`Failed to load workflow: ${response?.error || "Unknown error"}`);
      return;
    }

    const content =
      response.content || response.workflow || response.data || response;

    workflow = normalizeWorkflow(content);

    workflowNameInput.value = filename.replace(/\.json$/i, "");
    workflowDomainInput.value = workflow.boundDomain || "";

    renderCanvas();
  } catch (error) {
    alert(`Failed to load workflow: ${error.message || error}`);
  }
}

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

    card.innerHTML = `
      <div class="workflow-card-title">${escapeHtml(file)}</div>
      <div class="workflow-card-actions">
        <button class="micro-btn load-btn" data-file="${escapeAttr(file)}" title="Load Workflow">📂 Load</button>
        <button class="micro-btn duplicate-btn" data-file="${escapeAttr(file)}" title="Duplicate Workflow">📋</button>
        <button class="micro-btn delete-btn" data-file="${escapeAttr(file)}" style="color:#ef4444;border-color:#ef4444;" title="Delete Workflow">🗑️</button>
      </div>
    `;

    workflowListContainer.appendChild(card);
  });

  workflowListContainer.querySelectorAll(".load-btn").forEach((button) => {
    button.addEventListener("click", () => {
      loadWorkflowFromOS(button.dataset.file);
    });
  });

  workflowListContainer.querySelectorAll(".duplicate-btn").forEach((button) => {
    button.addEventListener("click", () => {
      duplicateWorkflow(button.dataset.file);
    });
  });

  workflowListContainer.querySelectorAll(".delete-btn").forEach((button) => {
    button.addEventListener("click", () => {
      deleteWorkflow(button.dataset.file);
    });
  });
}

async function duplicateWorkflow(filename) {
  const suggestedName = filename.replace(/\.json$/i, "") + "_copy";

  const newFilename = prompt(
    `Enter a new name to duplicate "${filename}":`,
    suggestedName,
  );

  if (!newFilename || !newFilename.trim()) return;

  try {
    const response = await chrome.runtime.sendMessage({
      type: Messages.OsDuplicateWorkflow,
      filename,
      newFilename: newFilename.trim(),
    });

    if (isSuccess(response)) {
      refreshWorkflowList();
    } else {
      alert(
        `Failed to duplicate workflow: ${response?.error || "Unknown error"}`,
      );
    }
  } catch (error) {
    alert(`Failed to duplicate workflow: ${error.message || error}`);
  }
}

async function deleteWorkflow(filename) {
  const confirmed = confirm(
    `Are you sure you want to permanently delete "${filename}"?`,
  );

  if (!confirmed) return;

  try {
    const response = await chrome.runtime.sendMessage({
      type: Messages.OsDeleteWorkflow,
      filename,
    });

    if (isSuccess(response)) {
      refreshWorkflowList();
    } else {
      alert(`Failed to delete workflow: ${response?.error || "Unknown error"}`);
    }
  } catch (error) {
    alert(`Failed to delete workflow: ${error.message || error}`);
  }
}

async function runCurrentWorkflow() {
  updateStateFromUI();

  if (workflow.steps.length === 0) {
    alert("Add at least one step.");
    return;
  }

  setRunButtonRunning(true);

  try {
    const response = await chrome.runtime.sendMessage({
      type: Messages.StartWorkflow,
      workflow: getWorkflowFromUI(),
    });

    if (!isSuccess(response)) {
      alert(`Workflow failed: ${response?.error || "Unknown error"}`);
    }
  } catch (error) {
    alert(`Workflow failed: ${error.message || error}`);
  } finally {
    setRunButtonRunning(false);
  }
}

function addStepToWorkflow(action) {
  updateStateFromUI();

  workflow.steps.push(createStep(action));
  renderCanvas();
}

function createStep(action) {
  const step = {
    id: generateStepId(),
    action,
    target: "",
    targetType: "",
    targetFallbacks: [],
    targetSnapshot: null,
    friendlyName: "",
    payload: {},
  };

  switch (action) {
    case Actions.BrowserNavigate:
      step.url = "";
      step.openIn = NavigationTargets.SameTab;
      step.payload.primary = "";
      step.payload.openIn = NavigationTargets.SameTab;
      break;

    case Actions.ElementType:
      step.value = "";
      step.payload.primary = "";
      break;

    case Actions.ElementExtract:
      step.variableName = "";
      step.payload.primary = "";
      break;

    case Actions.KeyboardSendKeys:
      step.keys = "";
      step.payload.primary = "";
      break;

    case Actions.LogicWait:
      step.ms = 1000;
      step.payload.primary = "1000";
      break;

    default:
      break;
  }

  return step;
}

function deleteStep(stepId) {
  updateStateFromUI();
  workflow.steps = workflow.steps.filter((step) => step.id !== stepId);
  renderCanvas();
}

function moveStep(index, direction) {
  updateStateFromUI();

  if (direction === "up" && index > 0) {
    [workflow.steps[index - 1], workflow.steps[index]] = [
      workflow.steps[index],
      workflow.steps[index - 1],
    ];
  }

  if (direction === "down" && index < workflow.steps.length - 1) {
    [workflow.steps[index + 1], workflow.steps[index]] = [
      workflow.steps[index],
      workflow.steps[index + 1],
    ];
  }

  renderCanvas();
}

function updateStateFromUI() {
  workflow.boundDomain = workflowDomainInput.value.trim();

  workflow.steps.forEach((step) => {
    const targetInput = document.getElementById(`target-${step.id}`);
    if (targetInput) {
      const visibleValue = targetInput.value.trim();

      if (step.friendlyName && visibleValue === step.friendlyName) {
        // Preserve structured target from recorder.
      } else if (visibleValue) {
        step.target = {
          strategy: "css_selector",
          value: visibleValue,
        };
        step.targetType = "css_selector";
        step.targetFallbacks = [];
        step.friendlyName = "";
      } else {
        step.target = "";
        step.targetType = "";
        step.targetFallbacks = [];
        step.friendlyName = "";
      }
    }

    const payloadInput = document.getElementById(`payload1-${step.id}`);
    const openInSelect = document.getElementById(`openin-${step.id}`);

    if (payloadInput) {
      applyPayloadValueToStep(step, payloadInput.value);
    }

    if (openInSelect) {
      step.openIn = openInSelect.value;
      step.payload = step.payload || {};
      step.payload.openIn = openInSelect.value;
    }
  });
}

function applyPayloadValueToStep(step, value) {
  step.payload = step.payload || {};
  step.payload.primary = value;

  switch (step.action) {
    case Actions.BrowserNavigate:
      step.url = value;
      break;

    case Actions.ElementType:
      step.value = value;
      break;

    case Actions.ElementExtract:
      step.variableName = value;
      break;

    case Actions.KeyboardSendKeys:
      step.keys = value;
      break;

    case Actions.LogicWait:
      step.ms = Number(value || 1000);
      break;

    default:
      break;
  }
}

function getWorkflowFromUI() {
  updateStateFromUI();

  return {
    boundDomain: workflow.boundDomain || "",
    steps: workflow.steps.map(normalizeStep),
  };
}

function normalizeWorkflow(input) {
  if (Array.isArray(input)) {
    return {
      boundDomain: "",
      steps: input.map(normalizeStep),
    };
  }

  return {
    boundDomain: input?.boundDomain || "",
    steps: Array.isArray(input?.steps) ? input.steps.map(normalizeStep) : [],
  };
}

function normalizeStep(step) {
  const normalized = {
    id: step.id || generateStepId(),
    action: step.action || step.type || Actions.ElementClick,
    target: step.target || "",
    targetType: step.targetType || "",
    targetFallbacks: Array.isArray(step.targetFallbacks)
      ? step.targetFallbacks
      : [],
    targetSnapshot: step.targetSnapshot || null,
    friendlyName: step.friendlyName || "",
    payload: step.payload || {},
  };

  if (step.url || normalized.payload.primary) {
    normalized.url = step.url || normalized.payload.primary;
  }

  if (step.value || normalized.payload.primary) {
    normalized.value = step.value || normalized.payload.primary;
  }

  if (step.variableName || normalized.payload.primary) {
    normalized.variableName = step.variableName || normalized.payload.primary;
  }

  if (step.keys || normalized.payload.primary) {
    normalized.keys = step.keys || normalized.payload.primary;
  }

  if (step.ms || normalized.payload.primary) {
    normalized.ms = Number(step.ms || normalized.payload.primary || 1000);
  }

  if (step.openIn || normalized.payload.openIn) {
    normalized.openIn =
      step.openIn || normalized.payload.openIn || NavigationTargets.SameTab;
  }

  return normalized;
}

function renderCanvas() {
  canvas.innerHTML = "";

  if (workflow.steps.length === 0) {
    canvas.innerHTML =
      '<div class="empty-state">Click an action on the left to start building.</div>';
    return;
  }

  workflow.steps.forEach((step, index) => {
    const node = document.createElement("div");
    node.className = "node";

    const fields = getStepFieldsHtml(step);
    const title = step.action.replace(".", " ").toUpperCase();

    node.innerHTML = `
      <div class="node-header">
        <span>${index + 1}. ${escapeHtml(title)}</span>
        <div class="node-controls">
          <span class="node-move" data-index="${index}" data-dir="up" title="Move Up" style="cursor:pointer;margin-right:5px;opacity:${index === 0 ? "0.3" : "1"};">⬆️</span>
          <span class="node-move" data-index="${index}" data-dir="down" title="Move Down" style="cursor:pointer;margin-right:15px;opacity:${index === workflow.steps.length - 1 ? "0.3" : "1"};">⬇️</span>
          <span class="node-delete" data-id="${escapeAttr(step.id)}" title="Delete Step" style="color:#ef4444;cursor:pointer;">✕</span>
        </div>
      </div>
      <div style="font-size:0.75rem;color:#94a3b8;margin-bottom:8px;font-style:italic;">
        ${escapeHtml(getInstructionText(step.action))}
      </div>
      ${fields}
    `;

    canvas.appendChild(node);
  });

  canvas.querySelectorAll(".node-delete").forEach((button) => {
    button.addEventListener("click", () => {
      deleteStep(button.dataset.id);
    });
  });

  canvas.querySelectorAll(".node-move").forEach((button) => {
    button.addEventListener("click", () => {
      moveStep(Number(button.dataset.index), button.dataset.dir);
    });
  });
}

function getStepFieldsHtml(step) {
  let html = "";

  if (needsTarget(step.action)) {
    html += `
      <div class="node-input-group">
        <label>Target Element</label>
        <input type="text" id="target-${escapeAttr(step.id)}" value="${escapeAttr(getDisplayTarget(step))}" placeholder="CSS selector, recorded identifier, or text">
      </div>
    `;
  }

  if (step.action === Actions.BrowserNavigate) {
    html += `
      <div class="node-input-group">
        <label>URL</label>
        <input type="text" id="payload1-${escapeAttr(step.id)}" value="${escapeAttr(step.url || step.payload?.primary || "")}" placeholder="https://example.com">
      </div>
      <div class="node-input-group">
        <label>Open In</label>
        <select id="openin-${escapeAttr(step.id)}">
          <option value="sameTab" ${(step.openIn || step.payload?.openIn || "sameTab") === "sameTab" ? "selected" : ""}>Same Tab</option>
          <option value="newTab" ${(step.openIn || step.payload?.openIn) === "newTab" ? "selected" : ""}>New Tab</option>
        </select>
      </div>
    `;
    return html;
  }

  if (step.action === Actions.ElementType) {
    html += `
      <div class="node-input-group">
        <label>Text to Type</label>
        <input type="text" id="payload1-${escapeAttr(step.id)}" value="${escapeAttr(step.value || step.payload?.primary || "")}" placeholder="Hello World or {{variable}}">
      </div>
    `;
  }

  if (step.action === Actions.ElementExtract) {
    html += `
      <div class="node-input-group">
        <label>Variable Name</label>
        <input type="text" id="payload1-${escapeAttr(step.id)}" value="${escapeAttr(step.variableName || step.payload?.primary || "")}" placeholder="scraped_title">
      </div>
    `;
  }

  if (step.action === Actions.KeyboardSendKeys) {
    html += `
      <div class="node-input-group">
        <label>Key / Shortcut</label>
        <input type="text" id="payload1-${escapeAttr(step.id)}" value="${escapeAttr(step.keys || step.payload?.primary || "")}" placeholder="Enter, Escape, Ctrl+L">
      </div>
    `;
  }

  if (step.action === Actions.LogicWait) {
    html += `
      <div class="node-input-group">
        <label>Wait Time (ms)</label>
        <input type="text" id="payload1-${escapeAttr(step.id)}" value="${escapeAttr(String(step.ms || step.payload?.primary || 1000))}" placeholder="1000">
      </div>
    `;
  }

  return html;
}

function getInstructionText(action) {
  switch (action) {
    case Actions.BrowserNavigate:
      return "Opens a URL in the same tab or a new tab.";
    case Actions.ElementClick:
      return "Finds an element and simulates a click.";
    case Actions.ElementType:
      return "Focuses an input field and types text. Supports {{variables}} later.";
    case Actions.ElementExtract:
      return "Extracts text or value from the target and stores it under a variable name.";
    case Actions.KeyboardSendKeys:
      return "Sends a keyboard key or shortcut through the native/hardware path.";
    case Actions.ElementFocus:
      return "Focuses the target element.";
    case Actions.ElementSelect:
      return "Selects an option in a dropdown.";
    case Actions.ElementToggle:
      return "Toggles a checkbox or radio input.";
    case Actions.LogicWait:
      return "Pauses execution for a fixed amount of time.";
    default:
      return "Interact with the specified target element.";
  }
}

function needsTarget(action) {
  return [
    Actions.ElementClick,
    Actions.ElementType,
    Actions.ElementExtract,
    Actions.ElementFocus,
    Actions.ElementSelect,
    Actions.ElementToggle,
  ].includes(action);
}

function getDisplayTarget(step) {
  if (step.friendlyName) return step.friendlyName;

  if (step.target && typeof step.target === "object") {
    return step.target.value || "";
  }

  return step.target || "";
}

async function checkBridgeStatus() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: Messages.CheckBridgeStatus,
    });

    const connected = Boolean(response?.connected);

    statusText.innerText = connected ? "Connected to Host" : "Disconnected";
    statusText.className = connected
      ? "status-connected"
      : "status-disconnected";

    if (connected) {
      refreshWorkflowList();
    }
  } catch {
    statusText.innerText = "Disconnected";
    statusText.className = "status-disconnected";
  }
}

function updateRecordButton() {
  if (!btnRecord) return;

  btnRecord.innerText = isRecording ? "⏹️ Stop Recording" : "🔴 Record Actions";

  btnRecord.style.backgroundColor = isRecording
    ? "var(--bg-main)"
    : "var(--danger)";

  btnRecord.style.border = isRecording ? "1px solid var(--danger)" : "none";
}

function setRunButtonRunning(running) {
  if (!btnRun) return;

  btnRun.innerText = running ? "⏳ Running..." : "▶ Run Workflow";
  btnRun.style.backgroundColor = running ? "#d97706" : "var(--accent)";
}

function generateStepId() {
  return `step_${Math.random().toString(36).slice(2, 11)}`;
}

function ensureJsonFilename(name) {
  const clean = String(name || "Untitled")
    .trim()
    .replace(/\.json$/i, "");

  return `${clean || "Untitled"}.json`;
}

function isSuccess(response) {
  return (
    response?.ok === true ||
    response?.status === "success" ||
    response?.success === true
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
