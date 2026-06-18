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
  OsRenameWorkflow: "OS_RENAME_WORKFLOW",

  StartWorkflow: "START_WORKFLOW",
  CheckBridgeStatus: "CHECK_BRIDGE_STATUS",

  ToggleRecording: "TOGGLE_RECORDING",
  StudioReceiveStep: "STUDIO_RECEIVE_STEP",
  RefreshWorkflowLists: "REFRESH_WORKFLOW_LISTS",
  WorkflowComplete: "WORKFLOW_COMPLETE",
  GetRuntimeState: "GET_RUNTIME_STATE",
  RuntimeStateChanged: "RUNTIME_STATE_CHANGED",
  GetNodeDefinitions: "GET_NODE_DEFINITIONS",
});

const Actions = Object.freeze({
  BrowserNavigate: "browser.navigate",
  BrowserTabSwitch: "browser.tab.switch",
  ElementClick: "element.click",
  ElementType: "element.type",
  ElementExtract: "element.extract",
  KeyboardSendKeys: "keyboard.send_keys",
  ElementFocus: "element.focus",
  ElementSelect: "element.select",
  ElementToggle: "element.toggle",
  DataExtractText: "data.extract.text",
  DataExtractAttribute: "data.extract.attribute",
  DataExtractList: "data.extract.list",
  DataExtractTable: "data.extract.table",
  DataExtractPage: "data.extract.page",
  DataSet: "data.set",
  DataTemplate: "data.template",
  LogicWait: "logic.wait",
});

const NavigationTargets = Object.freeze({
  SameTab: "sameTab",
  NewTab: "newTab",
});

let workflow = {
  boundDomain: "",
  variables: {},
  steps: [],
};

let isRecording = false;
let loadedWorkflowFilename = "";
const nodeDefinitionsByType = new Map();

const canvas = document.getElementById("workflow-canvas");
const workflowNameInput = document.getElementById("workflow-name");
const workflowDomainInput = document.getElementById("workflow-domain");
const workflowListContainer = document.getElementById("workflow-list");
const btnRecord = document.getElementById("btn-record");
const btnRun = document.getElementById("btn-run");
const statusText = document.getElementById("status-text");
const recordingTabPolicyInput = document.getElementById(
  "recording-tab-policy",
);
const actionPalette = document.getElementById("action-palette");

init();

function init() {
  wireLayoutControls();
  wireWorkflowFileControls();
  wireActionPalette();
  loadNodeDefinitions();
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
  syncRuntimeState();
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
      variables: {},
      steps: [],
    };

    workflowNameInput.value = "Untitled";
    workflowDomainInput.value = "";
    loadedWorkflowFilename = "";

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
  actionPalette?.addEventListener("click", (event) => {
    const button = event.target.closest(".action-btn");
    if (!button || !actionPalette.contains(button)) return;
    addStepToWorkflow(button.dataset.action);
  });
}

async function loadNodeDefinitions() {
  if (!actionPalette) return;

  try {
    const response = await chrome.runtime.sendMessage({
      type: Messages.GetNodeDefinitions,
    });

    if (!response?.ok || !Array.isArray(response.definitions)) {
      throw new Error(response?.error || "Node definitions are unavailable.");
    }

    nodeDefinitionsByType.clear();
    response.definitions.forEach((definition) => {
      nodeDefinitionsByType.set(definition.type, definition);
    });

    actionPalette.innerHTML = response.definitions
      .map((definition) => {
        return `<div class="action-btn" data-action="${escapeAttr(definition.type)}" title="${escapeAttr(definition.description || "")}">${escapeHtml(definition.icon || "•")} ${escapeHtml(definition.label || definition.type)}</div>`;
      })
      .join("");
  } catch (error) {
    actionPalette.innerHTML = `<div class="empty-state" style="color:#ef4444;">Failed to load actions.<br>${escapeHtml(error.message || error)}</div>`;
  }
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
        tabPolicy: recordingTabPolicyInput?.value || "openerDescendants",
      });

      if (response?.ok === false) {
        throw new Error(response.error || "Failed to toggle recording.");
      }

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

    if (request?.type === Messages.RuntimeStateChanged) {
      applyRuntimeState(request.state);
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });
}

async function saveWorkflowToOS() {
  updateStateFromUI();

  const desiredFilename = ensureJsonFilename(
    workflowNameInput.value || "Untitled",
  );
  const filename = loadedWorkflowFilename || desiredFilename;
  const content = getWorkflowFromUI();

  try {
    const isRename =
      Boolean(loadedWorkflowFilename) &&
      desiredFilename !== loadedWorkflowFilename;

    const response = await chrome.runtime.sendMessage(
      isRename
        ? {
            type: Messages.OsRenameWorkflow,
            filename: loadedWorkflowFilename,
            newFilename: desiredFilename,
            content,
          }
        : {
            type: Messages.OsSaveWorkflow,
            filename,
            content,
          },
    );

    if (isSuccess(response)) {
      loadedWorkflowFilename =
        response.newFilename || response.filename || desiredFilename;
      workflowNameInput.value = loadedWorkflowFilename.replace(/\.json$/i, "");
      alert(`Workflow "${loadedWorkflowFilename}" saved.`);
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
    loadedWorkflowFilename = filename;

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
      if (loadedWorkflowFilename === filename) {
        loadedWorkflowFilename = "";
      }
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
  const definition = nodeDefinitionsByType.get(action);
  const step = {
    id: generateStepId(),
    action,
    target: "",
    targetType: "",
    targetFallbacks: [],
    targetSnapshot: null,
    friendlyName: "",
    payload: {},
    config: {},
  };

  for (const field of definition?.config || []) {
    if (field.default !== undefined) {
      step.config[field.key] = structuredClone(field.default);
    }
  }

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
    const tabRefInput = document.getElementById(`tabref-${step.id}`);

    if (payloadInput) {
      applyPayloadValueToStep(step, payloadInput.value);
    }

    if (openInSelect) {
      step.openIn = openInSelect.value;
      step.payload = step.payload || {};
      step.payload.openIn = openInSelect.value;
    }

    if (tabRefInput) {
      const tabRef = tabRefInput.value.trim();
      if (tabRef) {
        step.tabRef = tabRef;
      } else {
        delete step.tabRef;
      }
    }

    const definition = nodeDefinitionsByType.get(step.action);

    for (const field of definition?.config || []) {
      const input = document.getElementById(
        `config-${step.id}-${field.key}`,
      );
      if (!input) continue;

      step.config = step.config || {};
      step.config[field.key] = field.kind === "number"
        ? parseNumberOrExpression(input.value)
        : input.value;
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
      step.ms = parseNumberOrExpression(value || "1000");
      break;

    default:
      break;
  }
}

function getWorkflowFromUI() {
  updateStateFromUI();

  return {
    boundDomain: workflow.boundDomain || "",
    variables: workflow.variables || {},
    steps: workflow.steps.map(normalizeStep),
  };
}

function normalizeWorkflow(input) {
  if (Array.isArray(input)) {
    return {
      boundDomain: "",
      variables: {},
      steps: input.map(normalizeStep),
    };
  }

  return {
    boundDomain: input?.boundDomain || "",
    variables:
      input?.variables && typeof input.variables === "object"
        ? structuredClone(input.variables)
        : {},
    steps: Array.isArray(input?.steps) ? input.steps.map(normalizeStep) : [],
  };
}

function normalizeStep(step) {
  const action = step.action || step.type || Actions.ElementClick;
  const payload = step.payload && typeof step.payload === "object"
    ? { ...step.payload }
    : {};
  const structuredTarget =
    step.target && typeof step.target === "object" ? step.target : null;

  const normalized = {
    id: step.id || generateStepId(),
    action,
    target: step.target || "",
    targetType:
      step.targetType || structuredTarget?.primary?.strategy || "",
    targetFallbacks: Array.isArray(step.targetFallbacks)
      ? step.targetFallbacks
      : Array.isArray(structuredTarget?.fallbacks)
        ? structuredTarget.fallbacks
        : [],
    targetSnapshot:
      step.targetSnapshot || structuredTarget?.snapshot || null,
    friendlyName: step.friendlyName || "",
    payload,
    config:
      step.config && typeof step.config === "object"
        ? structuredClone(step.config)
        : {},
  };

  // Recorder metadata is part of the persisted step contract. Studio may edit
  // the actionable fields, but it must not discard the context needed for
  // cross-page recovery or diagnostics.
  for (const key of [
    "page",
    "pagePolicy",
    "recordedAt",
    "recordedBy",
    "tabRef",
    "openerTabRef",
  ]) {
    if (step[key] !== undefined) {
      normalized[key] = step[key];
    }
  }

  const primaryPayload = payload.primary;

  switch (action) {
    case Actions.BrowserNavigate:
      normalized.url = step.url ?? primaryPayload ?? "";
      normalized.openIn =
        step.openIn || payload.openIn || NavigationTargets.SameTab;
      break;

    case Actions.BrowserTabSwitch:
      normalized.url = step.url ?? primaryPayload ?? "";
      normalized.createIfMissing = step.createIfMissing !== false;
      break;

    case Actions.ElementType:
    case Actions.ElementSelect:
    case Actions.ElementToggle:
      if (step.value !== undefined || primaryPayload !== undefined) {
        normalized.value = step.value ?? primaryPayload;
      }
      break;

    case Actions.ElementExtract:
      if (step.variableName !== undefined || primaryPayload !== undefined) {
        normalized.variableName = step.variableName ?? primaryPayload;
      }
      break;

    case Actions.KeyboardSendKeys:
      if (step.keys !== undefined || primaryPayload !== undefined) {
        normalized.keys = step.keys ?? primaryPayload;
      }
      break;

    case Actions.LogicWait:
      normalized.ms = parseNumberOrExpression(
        step.ms ?? primaryPayload ?? 1000,
      );
      break;

    default:
      break;
  }

  return normalized;
}

async function syncRuntimeState() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: Messages.GetRuntimeState,
    });

    if (response?.ok) {
      applyRuntimeState(response.state);
    }
  } catch {
    // Background may still be starting. Existing controls remain usable.
  }
}

function applyRuntimeState(state) {
  if (!state) return;

  isRecording = Boolean(state.recording?.isRecording);
  updateRecordButton();

  if (recordingTabPolicyInput && state.recording?.tabPolicy) {
    recordingTabPolicyInput.value = state.recording.tabPolicy;
    recordingTabPolicyInput.disabled = isRecording;
  }

  setRunButtonRunning(state.execution?.status === "running");
  if (btnRun) btnRun.disabled = isRecording;
  if (btnRecord) btnRecord.disabled = state.execution?.status === "running";
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
  const handledConfigKeys = new Set();

  html += `
    <div class="node-input-group">
      <label>Run in Logical Tab (optional)</label>
      <input type="text" id="tabref-${escapeAttr(step.id)}" value="${escapeAttr(step.tabRef || "")}" placeholder="e.g. results_tab">
    </div>
  `;

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
    handledConfigKeys.add("value");
    html += `
      <div class="node-input-group">
        <label>Text to Type</label>
        <input type="text" id="payload1-${escapeAttr(step.id)}" value="${escapeAttr(step.value || step.payload?.primary || "")}" placeholder="Hello World or {{variable}}">
      </div>
    `;
  }

  if (step.action === Actions.ElementExtract) {
    handledConfigKeys.add("variableName");
    html += `
      <div class="node-input-group">
        <label>Variable Name</label>
        <input type="text" id="payload1-${escapeAttr(step.id)}" value="${escapeAttr(step.variableName || step.payload?.primary || "")}" placeholder="scraped_title">
      </div>
    `;
  }

  if (step.action === Actions.KeyboardSendKeys) {
    handledConfigKeys.add("keys");
    html += `
      <div class="node-input-group">
        <label>Key / Shortcut</label>
        <input type="text" id="payload1-${escapeAttr(step.id)}" value="${escapeAttr(step.keys || step.payload?.primary || "")}" placeholder="Enter, Escape, Ctrl+L">
      </div>
    `;
  }

  if (step.action === Actions.LogicWait) {
    handledConfigKeys.add("ms");
    html += `
      <div class="node-input-group">
        <label>Wait Time (ms)</label>
        <input type="text" id="payload1-${escapeAttr(step.id)}" value="${escapeAttr(String(step.ms || step.payload?.primary || 1000))}" placeholder="1000">
      </div>
    `;
  }

  const definition = nodeDefinitionsByType.get(step.action);

  for (const field of definition?.config || []) {
    if (handledConfigKeys.has(field.key)) continue;
    html += getConfigFieldHtml(step, field);
  }

  return html;
}

function getConfigFieldHtml(step, field) {
  const id = `config-${step.id}-${field.key}`;
  const value = step.config?.[field.key] ?? field.default ?? "";
  const required = field.required ? " *" : "";

  if (field.kind === "select") {
    const options = (field.options || [])
      .map((option) => {
        const selected = String(option) === String(value) ? "selected" : "";
        return `<option value="${escapeAttr(option)}" ${selected}>${escapeHtml(option)}</option>`;
      })
      .join("");

    return `
      <div class="node-input-group">
        <label>${escapeHtml(field.label || field.key)}${required}</label>
        <select id="${escapeAttr(id)}">${options}</select>
      </div>
    `;
  }

  return `
    <div class="node-input-group">
      <label>${escapeHtml(field.label || field.key)}${required}</label>
      <input type="text" ${field.kind === "number" ? 'inputmode="numeric"' : ""} id="${escapeAttr(id)}" value="${escapeAttr(value)}">
    </div>
  `;
}

function getInstructionText(action) {
  switch (action) {
    case Actions.BrowserNavigate:
      return "Opens a URL in the same tab or a new tab.";
    case Actions.BrowserTabSwitch:
      return "Switches to a recorded browser tab, recreating it when necessary.";
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
  const definition = nodeDefinitionsByType.get(action);
  if (definition) return Boolean(definition.targetRequired);

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

function parseNumberOrExpression(value) {
  const text = String(value ?? "").trim();
  return text.includes("{{") ? text : Number(text || 0);
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
