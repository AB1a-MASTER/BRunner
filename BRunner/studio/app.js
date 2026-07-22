// studio/app.js
// BRunner Studio UI.
// Owns workflow editing, local workflow file actions, recording controls,
// and execution requests.

import {
  canonicalWorkflowToSequentialView,
  sequentialViewToCanonicalWorkflow,
} from "../core/workflowSchema.js";

const Messages = Object.freeze({
  StudioLoaded: "STUDIO_LOADED",

  OsSaveWorkflow: "OS_SAVE_WORKFLOW",
  OsListWorkflows: "OS_LIST_WORKFLOWS",
  OsLoadWorkflow: "OS_LOAD_WORKFLOW",
  OsDeleteWorkflow: "OS_DELETE_WORKFLOW",
  OsDuplicateWorkflow: "OS_DUPLICATE_WORKFLOW",
  OsRenameWorkflow: "OS_RENAME_WORKFLOW",

  StartWorkflow: "START_WORKFLOW",
  StopWorkflow: "STOP_WORKFLOW",
  CheckBridgeStatus: "CHECK_BRIDGE_STATUS",
  BridgeStatus: "BRIDGE_STATUS",

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
  HttpRequest: "http.request",
  ClipboardRead: "clipboard.read",
  ClipboardWrite: "clipboard.write",
  FileInputUpload: "file.input.upload",
  FileLocalUpload: "file.local.upload",
  DownloadWait: "download.wait",
  ScreenshotCapture: "screenshot.capture",
  LogicWait: "logic.wait",
});

const NavigationTargets = Object.freeze({
  SameTab: "sameTab",
  NewTab: "newTab",
});

const STUDIO_SESSION_KEY = "brunner.studio.session.v1";
const STUDIO_KIND = "sequential";
const STUDIO_DRAFT_KEY = "brunner.studio.draft.sequential.v1";
const STUDIO_DRAFT_VERSION = 1;

const StudioValidation = globalThis.BRunnerStudioValidation;
const NodeAuthoring = globalThis.BRunnerNodeAuthoring;

let workflow = createEmptySequentialWorkflowView();

let isRecording = false;
let isWorkflowRunning = false;
let activeWorkflowRunId = "";
let isWorkflowDirty = false;
let loadedWorkflowFilename = "";
let workflowRevision = 0;
let queuedSaveCount = 0;
let draftPersistTimer = 0;
let draftRestorePromise = Promise.resolve(false);
let saveQueue = Promise.resolve();
let lastRunVariables = {};
let runtimeVariableEntries = [];
let bridgeReady = null;
const nodeDefinitionsByType = new Map();
const nodeDefinitionsByContract = new Map();
let autocompleteState = null;
let initialStudioSessionApplied = false;

const canvas = document.getElementById("workflow-canvas");
const workflowNameInput = document.getElementById("workflow-name");
const workflowDomainInput = document.getElementById("workflow-domain");
const workflowDescriptionInput = document.getElementById("workflow-description");
const workflowReuseTabsInput = document.getElementById("workflow-reuse-tabs");
const workflowListContainer = document.getElementById("workflow-list");
const btnRecord = document.getElementById("btn-record");
const btnRun = document.getElementById("btn-run");
const btnSave = document.getElementById("btn-save");
const draftStatus = document.getElementById("draft-status");
const validationStatus = document.getElementById("validation-status");
const statusText = document.getElementById("status-text");
const recordingTabPolicyInput = document.getElementById(
  "recording-tab-policy",
);
const actionPalette = document.getElementById("action-palette");
const actionPanel = document.getElementById("action-panel");
const workflowSidebar = document.getElementById("workflow-sidebar");
const btnTogglePalette = document.getElementById("btn-toggle-palette");
const btnToggleSidebar = document.getElementById("btn-toggle-sidebar");
const btnCollapsePalette = document.getElementById("btn-collapse-palette");
const btnCollapseSidebar = document.getElementById("btn-collapse-sidebar");
const workflowManagerPanel = document.getElementById("workflow-manager-panel");
const dataInspectorPanel = document.getElementById("data-inspector-panel");
const dataInspectorList = document.getElementById("data-inspector-list");
const dataInspectorSearch = document.getElementById("data-inspector-search");
const dataInspectorSummary = document.getElementById("data-inspector-summary");
const dataInspectorCount = document.getElementById("data-inspector-count");

init();

function init() {
  wireLayoutControls();
  wireWorkflowFileControls();
  wireDraftLifecycle();
  wireActionPalette();
  wireCanvasEditing();
  wireStudioSessionSync();
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
  renderDataInspector();
  draftRestorePromise = restoreRecoverableDraft().catch(() => false);
  checkBridgeStatus();
  syncRuntimeState();
}

function markWorkflowDirty(message = "Unsaved changes") {
  workflowRevision += 1;
  isWorkflowDirty = true;
  updateDraftStatus(message, "warning");
  scheduleRecoverableDraft();
}

function setWorkflowClean(message = "Saved") {
  isWorkflowDirty = false;
  updateDraftStatus(message, "success");
}

function updateDraftStatus(message, kind = "neutral") {
  if (!draftStatus) return;
  draftStatus.textContent = message;
  draftStatus.dataset.kind = kind;
}

function confirmDiscardDirtyDraft(action) {
  return !isWorkflowDirty || confirm(
    `Unsaved workflow changes will be discarded if you ${action}. Continue?`,
  );
}

function wireDraftLifecycle() {
  globalThis.addEventListener("beforeunload", (event) => {
    if (!isWorkflowDirty) return;
    void persistRecoverableDraft().catch(() => {});
    event.preventDefault();
    event.returnValue = "";
  });

  globalThis.addEventListener("pagehide", () => {
    if (isWorkflowDirty) void persistRecoverableDraft().catch(() => {});
  });

  document.getElementById("graph-studio-link")?.addEventListener("click", async (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (queuedSaveCount > 0) {
      event.preventDefault();
      alert("Wait for the current workflow save to finish before switching Studios.");
      return;
    }
    if (!isWorkflowDirty) return;
    event.preventDefault();
    if (!confirmDiscardDirtyDraft("open Graph Studio")) return;
    isWorkflowDirty = false;
    await clearRecoverableDraft().catch(() => {});
    globalThis.location.assign(event.currentTarget.href);
  });
}

function scheduleRecoverableDraft() {
  globalThis.clearTimeout(draftPersistTimer);
  draftPersistTimer = globalThis.setTimeout(() => {
    void persistRecoverableDraft().catch((error) => {
      updateDraftStatus(
        `Local draft backup failed: ${error.message || error}`,
        "error",
      );
    });
  }, 180);
}

function captureRecoverableDraft() {
  const content = getWorkflowFromUI();
  const workflowName = workflowNameInput.value || "Untitled";
  return {
    version: STUDIO_DRAFT_VERSION,
    studio: STUDIO_KIND,
    revision: workflowRevision,
    loadedFilename: loadedWorkflowFilename,
    workflowName,
    fingerprint: hashWorkflowSnapshot({ workflowName, content }),
    content,
    updatedAt: new Date().toISOString(),
  };
}

async function persistRecoverableDraft(snapshot = null) {
  if (!isWorkflowDirty && !snapshot) return false;
  const draft = snapshot || captureRecoverableDraft();
  await chrome.storage.local.set({ [STUDIO_DRAFT_KEY]: draft });
  return true;
}

async function clearRecoverableDraft() {
  globalThis.clearTimeout(draftPersistTimer);
  draftPersistTimer = 0;
  await chrome.storage.local.remove(STUDIO_DRAFT_KEY);
}

async function restoreRecoverableDraft() {
  const stored = await chrome.storage.local.get(STUDIO_DRAFT_KEY);
  const draft = stored?.[STUDIO_DRAFT_KEY];
  if (
    draft?.version !== STUDIO_DRAFT_VERSION
    || draft?.studio !== STUDIO_KIND
    || !draft.content
  ) return false;

  const label = draft.workflowName || draft.loadedFilename || "Untitled";
  if (!confirm(`Recover unsaved Sequential Studio draft "${label}"?`)) {
    await clearRecoverableDraft();
    return false;
  }

  workflow = normalizeWorkflow(draft.content);
  workflowRevision = Math.max(1, Number(draft.revision) || 1);
  loadedWorkflowFilename = String(draft.loadedFilename || "");
  workflowNameInput.value = String(draft.workflowName || "Untitled");
  workflowDomainInput.value = workflow.boundDomain || "";
  if (workflowDescriptionInput) workflowDescriptionInput.value = workflow.description || "";
  workflowReuseTabsInput.checked = workflow.settings?.reuseExistingTabs === true;
  lastRunVariables = {};
  runtimeVariableEntries = [];
  initialStudioSessionApplied = true;
  isWorkflowDirty = true;
  renderCanvas();
  renderDataInspector();
  refreshValidationUI();
  updateDraftStatus("Recovered unsaved draft", "warning");
  return true;
}

function hashWorkflowSnapshot(snapshot) {
  const source = stableStringify(snapshot);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  )).join(",")}}`;
}

function wireLayoutControls() {
  [workflowNameInput, workflowDomainInput, workflowDescriptionInput, workflowReuseTabsInput]
    .filter(Boolean)
    .forEach((control) => control.addEventListener("input", () => {
      updateStateFromUI();
      markWorkflowDirty();
      refreshValidationUI();
    }));
  [btnTogglePalette, btnCollapsePalette].filter(Boolean).forEach((button) => {
    button.addEventListener("click", () => {
      const expanded = actionPanel?.classList.contains("collapsed") === true;
      setPanelPreference("nodeLibraryExpanded", expanded);
    });
  });

  [btnToggleSidebar, btnCollapseSidebar].filter(Boolean).forEach((button) => {
    button.addEventListener("click", () => {
      const expanded = workflowSidebar?.classList.contains("collapsed") === true;
      setPanelPreference("workflowManagerExpanded", expanded);
    });
  });

  globalThis.addEventListener("brunner:studio-preferences", (event) => {
    applyPanelPreferences(event.detail);
  });
  applyPanelPreferences(globalThis.BRunnerStudioPreferences?.preferences);

  document.getElementById("tab-workflows")?.addEventListener("click", () => {
    setManagerPanel("workflows");
  });
  document.getElementById("tab-data")?.addEventListener("click", () => {
    setManagerPanel("data");
  });
  dataInspectorSearch?.addEventListener("input", renderDataInspector);
  dataInspectorList?.addEventListener("click", handleDataInspectorClick);

  document.getElementById("btn-new")?.addEventListener("click", async () => {
    updateStateFromUI();
    if (queuedSaveCount > 0) {
      alert("Wait for the current workflow save to finish before creating a new workflow.");
      return;
    }
    if (!confirmDiscardDirtyDraft("create a new workflow")) return;

    workflow = createEmptySequentialWorkflowView();

    workflowNameInput.value = "Untitled";
    workflowDomainInput.value = "";
    if (workflowDescriptionInput) workflowDescriptionInput.value = "";
    workflowReuseTabsInput.checked = false;
    loadedWorkflowFilename = "";
    lastRunVariables = {};
    runtimeVariableEntries = [];
    await clearRecoverableDraft().catch(() => {});
    markWorkflowDirty("New workflow has unsaved changes");

    renderCanvas();
    renderDataInspector();
    saveStudioSession({
      activeWorkflowFilename: "",
      activeStudio: STUDIO_KIND,
    }).catch(() => {});
  });
}

function applyPanelPreferences(preferences = {}) {
  const panels = preferences?.panels || {};
  const actionExpanded = panels.nodeLibraryExpanded !== false;
  const managerExpanded = panels.workflowManagerExpanded !== false;

  setPanelExpanded({
    panel: actionPanel,
    expanded: actionExpanded,
    buttons: [btnTogglePalette, btnCollapsePalette],
    expandedLabel: "Hide action browser",
    collapsedLabel: "Show action browser",
  });

  setPanelExpanded({
    panel: workflowSidebar,
    expanded: managerExpanded,
    buttons: [btnToggleSidebar, btnCollapseSidebar],
    expandedLabel: "Hide workflow details",
    collapsedLabel: "Show workflow details",
  });
}

function setPanelExpanded({
  panel,
  expanded,
  buttons,
  expandedLabel,
  collapsedLabel,
}) {
  panel?.classList.toggle("collapsed", !expanded);
  for (const button of buttons || []) {
    if (!button) continue;
    button.setAttribute("aria-expanded", String(expanded));
    button.title = expanded ? expandedLabel : collapsedLabel;
    button.setAttribute("aria-label", expanded ? expandedLabel : collapsedLabel);
  }
}

async function setPanelPreference(key, expanded) {
  const current = globalThis.BRunnerStudioPreferences?.preferences || {};
  const panels = {
    ...(current.panels || {}),
    [key]: Boolean(expanded),
  };

  if (globalThis.BRunnerStudioPreferences?.update) {
    await globalThis.BRunnerStudioPreferences.update({ panels }).catch(() => {
      applyPanelPreferences({ panels });
    });
    return;
  }

  applyPanelPreferences({ panels });
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
    nodeDefinitionsByContract.clear();
    response.definitions.forEach((definition) => {
      nodeDefinitionsByType.set(definition.type, definition);
    });
    (response.definitionVersions || response.definitions).forEach((definition) => {
      nodeDefinitionsByContract.set(
        nodeContractKey(definition.type, definition.version),
        definition,
      );
    });

    actionPalette.innerHTML = response.definitions
      .map((definition) => {
        return `<div class="action-btn" data-action="${escapeAttr(definition.type)}" title="${escapeAttr(definition.description || "")}">${escapeHtml(definition.icon || "•")} ${escapeHtml(definition.label || definition.type)}</div>`;
      })
      .join("");
    renderCanvas();
  } catch (error) {
    actionPalette.innerHTML = `<div class="empty-state" style="color:#ef4444;">Failed to load actions.<br>${escapeHtml(error.message || error)}</div>`;
  }
}

function wireExecutionControls() {
  btnRun?.addEventListener("click", () => {
    if (isWorkflowRunning) {
      stopCurrentWorkflow();
    } else {
      runCurrentWorkflow();
    }
  });
}

function wireCanvasEditing() {
  canvas?.addEventListener("input", (event) => {
    const input = event.target.closest("input, textarea, select");
    if (!input || !canvas.contains(input)) return;
    updateStateFromUI();
    markWorkflowDirty();
    refreshContextualFieldVisibility();
    refreshValidationUI();
    if (input.matches("[data-expression='true']")) {
      updateVariableAutocomplete(input);
    } else {
      closeVariableAutocomplete();
    }
  });

  canvas?.addEventListener("focusin", (event) => {
    if (event.target.matches?.("[data-expression='true']")) {
      updateVariableAutocomplete(event.target);
    }
  });

  canvas?.addEventListener("keydown", handleAutocompleteKeydown);
  canvas?.addEventListener("mousedown", (event) => {
    const option = event.target.closest(".variable-option");
    if (!option) return;
    event.preventDefault();
    insertAutocompleteVariable(option.dataset.variable || "");
  });

  document.addEventListener("mousedown", (event) => {
    if (!event.target.closest(".variable-autocomplete, [data-expression='true']")) {
      closeVariableAutocomplete();
    }
  });
}

async function stopCurrentWorkflow() {
  if (!isWorkflowRunning) return;

  setRunButtonRunning(true, true);

  try {
    const response = await chrome.runtime.sendMessage({
      type: Messages.StopWorkflow,
      runId: activeWorkflowRunId,
    });

    if (!response?.ok) {
      alert(`Failed to stop workflow: ${response?.error || "Unknown error"}`);
    }
  } catch (error) {
    alert(`Failed to stop workflow: ${error.message || error}`);
  }
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
        markWorkflowDirty("Workflow domain auto-bound from recording");
        refreshValidationUI();
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

      if (workflow.structureLocked) {
        sendResponse({ ok: false, error: "Graph-routed workflow structure is locked in Sequential Studio." });
        return true;
      }

      const step = normalizeStep(request.step);
      workflow.steps.push(step);
      markWorkflowDirty("Recorded step is unsaved");

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

    if (request?.type === Messages.BridgeStatus) {
      applyBridgeStatus(request.bridge || request);
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });
}

function saveWorkflowToOS() {
  updateStateFromUI();
  if (!validateCurrentWorkflow({ focusFirst: true })) return Promise.resolve(false);

  queuedSaveCount += 1;
  updateDraftStatus(queuedSaveCount > 1 ? "Save queued" : "Saving...", "neutral");
  refreshValidationUI();

  const queued = saveQueue.then(
    () => performWorkflowSave(),
    () => performWorkflowSave(),
  );
  saveQueue = queued.catch(() => {});
  return queued.finally(() => {
    queuedSaveCount = Math.max(0, queuedSaveCount - 1);
    refreshValidationUI();
  });
}

async function performWorkflowSave() {
  updateStateFromUI();
  if (!validateCurrentWorkflow({ focusFirst: true })) return false;

  const desiredFilename = ensureJsonFilename(
    workflowNameInput.value || "Untitled",
  );
  const filename = loadedWorkflowFilename || desiredFilename;
  const submittedDraft = captureRecoverableDraft();
  const submittedState = {
    revision: submittedDraft.revision,
    fingerprint: submittedDraft.fingerprint,
  };
  const content = submittedDraft.content;

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

    if (!isSuccess(response)) throw new Error(response?.error || "Unknown error");

    const savedFilename = response.newFilename || response.filename || desiredFilename;
    loadedWorkflowFilename = savedFilename;
    const currentDraft = captureRecoverableDraft();
    const submittedStillCurrent = submittedState.revision === workflowRevision
      && submittedState.fingerprint === currentDraft.fingerprint;

    if (submittedStillCurrent) {
      const savedView = canonicalWorkflowToSequentialView(content);
      workflow.canonicalGraph = savedView.canonicalGraph;
      workflow.structureSignature = savedView.structureSignature;
      workflow.structureLocked = savedView.structureLocked;
      setWorkflowClean(`Saved ${savedFilename}`);
      await clearRecoverableDraft().catch(() => {});
    } else {
      isWorkflowDirty = true;
      updateDraftStatus("Older snapshot saved; newer edits remain", "warning");
      await persistRecoverableDraft().catch(() => {});
    }

    refreshValidationUI();
    await saveStudioSession({
      activeWorkflowFilename: savedFilename,
      activeStudio: STUDIO_KIND,
    }).catch(() => {});
    alert(submittedStillCurrent
      ? `Workflow "${savedFilename}" saved.`
      : `Workflow "${savedFilename}" saved. Newer edits remain unsaved.`);
    void refreshWorkflowList();
    return true;
  } catch (error) {
    isWorkflowDirty = true;
    await persistRecoverableDraft().catch(() => {});
    updateDraftStatus("Save failed; draft kept locally", "error");
    alert(`Failed to save: ${error.message || error}`);
    return false;
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
      const files = response.files || response.workflows || [];
      renderWorkflowList(files);
      applyInitialStudioSession(files);
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

async function loadWorkflowFromOS(filename, options = {}) {
  updateStateFromUI();
  if (queuedSaveCount > 0) {
    alert("Wait for the current workflow save to finish before loading another workflow.");
    return false;
  }
  if (options.skipDirtyPrompt !== true && !confirmDiscardDirtyDraft(`load "${filename}"`)) {
    return false;
  }
  const loadStartedAtRevision = workflowRevision;

  try {
    const response = await chrome.runtime.sendMessage({
      type: Messages.OsLoadWorkflow,
      filename,
    });

    if (!isSuccess(response)) {
      alert(`Failed to load workflow: ${response?.error || "Unknown error"}`);
      return false;
    }

    if (
      isWorkflowDirty
      && workflowRevision !== loadStartedAtRevision
      && !confirmDiscardDirtyDraft(`finish loading "${filename}"`)
    ) return false;

    const content =
      response.content || response.workflow || response.data || response;

    workflow = normalizeWorkflow(content);
    loadedWorkflowFilename = filename;

    workflowNameInput.value = filename.replace(/\.json$/i, "");
    workflowDomainInput.value = workflow.boundDomain || "";
    if (workflowDescriptionInput) workflowDescriptionInput.value = workflow.description || "";
    workflowReuseTabsInput.checked =
      workflow.settings?.reuseExistingTabs === true;
    lastRunVariables = {};
    runtimeVariableEntries = [];
    workflowRevision += 1;
    setWorkflowClean(`Loaded ${filename}`);
    await clearRecoverableDraft().catch(() => {});

    renderCanvas();
    renderDataInspector();
    if (options.publishSession !== false) {
      await saveStudioSession({
        activeWorkflowFilename: filename,
        activeStudio: STUDIO_KIND,
      }).catch(() => {});
    }
    return true;
  } catch (error) {
    alert(`Failed to load workflow: ${error.message || error}`);
    return false;
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
        <button class="micro-btn load-btn" data-file="${escapeAttr(file)}" title="Load workflow">Load</button>
        <button class="micro-btn duplicate-btn" data-file="${escapeAttr(file)}" title="Duplicate workflow" aria-label="Duplicate workflow">Copy</button>
        <button class="micro-btn delete-btn" data-file="${escapeAttr(file)}" style="color:#ef4444;border-color:#ef4444;" title="Delete workflow" aria-label="Delete workflow">Delete</button>
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
        markWorkflowDirty("Saved source deleted; this open workflow is now an unsaved draft");
        refreshValidationUI();
        saveStudioSession({
          activeWorkflowFilename: "",
          activeStudio: STUDIO_KIND,
        }).catch(() => {});
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
  if (!validateCurrentWorkflow({ focusFirst: true })) return;

  isWorkflowRunning = true;
  lastRunVariables = {};
  renderDataInspector();
  renderCanvas();
  setRunButtonRunning(true);

  try {
    const response = await chrome.runtime.sendMessage({
      type: Messages.StartWorkflow,
      workflow: getWorkflowFromUI(),
    });

    if (!isSuccess(response)) {
      alert(`Workflow failed: ${response?.error || "Unknown error"}`);
    } else {
      lastRunVariables = response?.variables && typeof response.variables === "object"
        ? structuredClone(response.variables)
        : {};
      renderDataInspector();
      renderCanvas();
    }
  } catch (error) {
    alert(`Workflow failed: ${error.message || error}`);
  } finally {
    isWorkflowRunning = false;
    setRunButtonRunning(false);
  }

}

function addStepToWorkflow(action) {
  updateStateFromUI();
  if (!allowSequentialStructureEdit()) return;

  workflow.steps.push(createStep(action));
  markWorkflowDirty();
  renderCanvas();
}

function createStep(action) {
  const definition = nodeDefinitionsByType.get(action);
  const step = {
    id: generateStepId(),
    action,
    version: definition?.version || 1,
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
  if (!allowSequentialStructureEdit()) return;
  workflow.steps = workflow.steps.filter((step) => step.id !== stepId);
  markWorkflowDirty();
  renderCanvas();
}

function moveStep(index, direction) {
  updateStateFromUI();
  if (!allowSequentialStructureEdit()) return;
  let moved = false;

  if (direction === "up" && index > 0) {
    [workflow.steps[index - 1], workflow.steps[index]] = [
      workflow.steps[index],
      workflow.steps[index - 1],
    ];
    moved = true;
  }

  if (direction === "down" && index < workflow.steps.length - 1) {
    [workflow.steps[index + 1], workflow.steps[index]] = [
      workflow.steps[index],
      workflow.steps[index + 1],
    ];
    moved = true;
  }

  if (moved) markWorkflowDirty();
  renderCanvas();
}

function allowSequentialStructureEdit() {
  if (!workflow.structureLocked) return true;
  alert("This workflow has explicit graph routes. Sequential Studio preserves them and can edit node settings, but route structure must be edited in Graph Studio.");
  return false;
}

function updateStateFromUI() {
  workflow.boundDomain = workflowDomainInput.value.trim();
  workflow.description = workflowDescriptionInput?.value.trim() || "";
  workflow.settings = {
    ...(workflow.settings || {}),
    reuseExistingTabs: Boolean(workflowReuseTabsInput?.checked),
  };

  workflow.steps.forEach((step) => {
    updateTargetFromUI(step);

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
      step.config = step.config || {};
      step.config.openIn = openInSelect.value;
    }

    if (tabRefInput) {
      const tabRef = tabRefInput.value.trim();
      if (tabRef) {
        step.tabRef = tabRef;
      } else {
        delete step.tabRef;
      }
    }

    const definition = getStepDefinition(step);

    for (const field of definition?.config || []) {
      const input = document.getElementById(
        `config-${step.id}-${field.key}`,
      );
      if (!input) continue;

      step.config = step.config || {};
      step.config[field.key] = field.kind === "boolean"
        ? input.checked
        : field.kind === "number"
        ? parseNumberOrExpression(input.value)
        : field.kind === "value"
          ? parseStructuredOrTextValue(input.value)
          : input.value;
    }
  });
}

function applyPayloadValueToStep(step, value) {
  step.payload = step.payload || {};
  step.payload.primary = value;
  step.config = step.config || {};

  switch (step.action) {
    case Actions.BrowserNavigate:
      step.url = value;
      step.config.url = value;
      break;

    case Actions.ElementType:
      step.value = value;
      step.config.value = value;
      break;

    case Actions.ElementExtract:
      step.variableName = value;
      step.config.variableName = value;
      break;

    case Actions.KeyboardSendKeys:
      step.keys = value;
      step.config.keys = value;
      break;

    case Actions.LogicWait:
      step.ms = parseNumberOrExpression(value || "1000");
      step.config.ms = step.ms;
      break;

    default:
      break;
  }
}

function getWorkflowFromUI() {
  updateStateFromUI();

  return sequentialViewToCanonicalWorkflow({
    ...workflow,
    name: workflowNameInput.value || workflow.name || "Untitled",
    steps: workflow.steps.map(normalizeStep),
  });
}

function normalizeWorkflow(input) {
  const view = canonicalWorkflowToSequentialView(input);
  view.steps = view.steps.map(normalizeStep);
  return view;
}

function createEmptySequentialWorkflowView() {
  return canonicalWorkflowToSequentialView({
    id: crypto.randomUUID(),
    name: "Untitled",
    description: "",
    boundDomain: "",
    variables: {},
    datasets: {},
    dataSources: [],
    settings: { reuseExistingTabs: false },
    steps: [],
  });
}

function normalizeStep(step) {
  const action = step.action || step.type || Actions.ElementClick;
  const payload = step.payload && typeof step.payload === "object"
    ? { ...step.payload }
    : {};
  const structuredTarget =
    step.target && typeof step.target === "object" ? step.target : null;

  const normalized = {
    ...structuredClone(step),
    id: step.id || generateStepId(),
    action,
    version:
      step.version === undefined || step.version === null || step.version === ""
        ? 1
        : step.version,
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

function wireStudioSessionSync() {
  chrome.storage?.onChanged?.addListener?.((changes, areaName) => {
    if (areaName !== "local" || !changes?.[STUDIO_SESSION_KEY]) return;
    const session = changes[STUDIO_SESSION_KEY].newValue || {};
    if (session.activeStudio === STUDIO_KIND) return;
    const filename = session.activeWorkflowFilename || "";
    if (!filename || filename === loadedWorkflowFilename || isWorkflowDirty) return;
    loadWorkflowFromOS(filename, { publishSession: false });
  });
}

async function applyInitialStudioSession(files = []) {
  await draftRestorePromise.catch(() => false);
  if (initialStudioSessionApplied || loadedWorkflowFilename || isWorkflowDirty) return;
  initialStudioSessionApplied = true;
  const session = await loadStudioSession().catch(() => null);
  const filename = session?.activeWorkflowFilename || "";
  if (!filename || !files.includes(filename)) return;
  await loadWorkflowFromOS(filename, { publishSession: false });
}

async function loadStudioSession() {
  const stored = await chrome.storage.local.get(STUDIO_SESSION_KEY);
  return stored?.[STUDIO_SESSION_KEY] || {};
}

async function saveStudioSession(patch = {}) {
  const current = await loadStudioSession().catch(() => ({}));
  const session = {
    version: 1,
    activeWorkflowFilename: String(
      patch.activeWorkflowFilename ?? current.activeWorkflowFilename ?? "",
    ),
    activeStudio: String(patch.activeStudio || current.activeStudio || ""),
    updatedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [STUDIO_SESSION_KEY]: session });
  return session;
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

  const executionStatus = state.execution?.status || "idle";
  const running = ["running", "cancelling"].includes(executionStatus);
  const stopping = executionStatus === "cancelling";
  isWorkflowRunning = running;
  activeWorkflowRunId = state.execution?.runId || "";

  setRunButtonRunning(running, stopping);
  if (btnRecord) btnRecord.disabled = running;

  runtimeVariableEntries = Array.isArray(state.execution?.variables)
    ? state.execution.variables
    : [];
  renderDataInspector();
}

function setManagerPanel(panel) {
  const showData = panel === "data";
  if (workflowManagerPanel) workflowManagerPanel.hidden = showData;
  if (dataInspectorPanel) dataInspectorPanel.hidden = !showData;

  const workflowTab = document.getElementById("tab-workflows");
  const dataTab = document.getElementById("tab-data");
  workflowTab?.classList.toggle("active", !showData);
  dataTab?.classList.toggle("active", showData);
  workflowTab?.setAttribute("aria-selected", String(!showData));
  dataTab?.setAttribute("aria-selected", String(showData));

  if (showData) {
    renderDataInspector();
    dataInspectorSearch?.focus();
  }
}

function renderDataInspector() {
  if (!dataInspectorList) return;

  const entries = buildInspectorEntries();
  const query = String(dataInspectorSearch?.value || "").trim().toLowerCase();
  const filtered = entries.filter((entry) => {
    const origin = formatVariableOrigin(entry.origin);
    return !query || [entry.name, entry.type, entry.preview, origin]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });

  if (dataInspectorCount) dataInspectorCount.textContent = String(entries.length);
  if (dataInspectorSummary) {
    const seedCount = entries.filter((entry) => entry.source === "Seed").length;
    const runCount = entries.length - seedCount;
    dataInspectorSummary.textContent = entries.length
      ? `${seedCount} seed · ${runCount} run`
      : "No variables available";
  }

  if (!filtered.length) {
    dataInspectorList.innerHTML = `
      <div class="empty-state data-empty">
        ${entries.length ? "No variables match this search." : "Run a workflow or load seed variables."}
      </div>
    `;
    return;
  }

  dataInspectorList.innerHTML = filtered.map(renderVariableCard).join("");
}

function buildInspectorEntries() {
  const entries = new Map();

  for (const [name, value] of Object.entries(workflow.variables || {})) {
    entries.set(name, {
      name,
      ...summarizeInspectorValue(value, true),
      source: "Seed",
      origin: {
        source: "workflow",
        nodeId: "",
        action: "workflow.variable",
      },
      fullValue: value,
      hasFullValue: true,
    });
  }

  for (const entry of runtimeVariableEntries) {
    if (!entry?.name) continue;
    entries.set(entry.name, {
      ...entry,
      source: entry.origin?.source === "workflow" ? "Seed" : "Current run",
      hasFullValue: false,
    });
  }

  for (const [name, value] of Object.entries(lastRunVariables || {})) {
    const runtimeEntry = runtimeVariableEntries.find((entry) => entry.name === name);
    entries.set(name, {
      name,
      ...summarizeInspectorValue(value, true),
      source: runtimeEntry?.origin?.source === "workflow" ? "Seed" : "Last run",
      origin: runtimeEntry?.origin || {
        source: "workflow",
        nodeId: "",
        action: "workflow.variable",
      },
      fullValue: value,
      hasFullValue: true,
    });
  }

  return Array.from(entries.values()).sort((left, right) => {
    return left.name.localeCompare(right.name);
  });
}

function validateCurrentWorkflow({ focusFirst = false } = {}) {
  const issues = refreshValidationUI();
  if (issues.length === 0) return true;

  if (focusFirst) {
    const firstIssue = issues[0];
    const node = [...canvas.querySelectorAll(".node")]
      .find((item) => item.dataset.stepId === firstIssue.stepId);
    const group = node?.querySelector(`[data-field="${firstIssue.fieldKey}"]`);
    (group?.querySelector("input, textarea, select") || node)?.focus();
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
    alert(`Fix ${issues.length} workflow validation ${issues.length === 1 ? "error" : "errors"} before continuing.`);
  }
  return false;
}

function refreshValidationUI() {
  if (!StudioValidation) return [];

  const issues = StudioValidation.validateWorkflow(
    workflow,
    nodeDefinitionsByContract,
  );

  canvas.querySelectorAll(".node").forEach((node) => {
    node.classList.remove("node-invalid");
    node.querySelectorAll(".node-input-group").forEach((group) => {
      group.classList.remove("field-invalid");
      group.querySelector("input, textarea, select")?.removeAttribute("aria-invalid");
      group.querySelector(".field-error")?.remove();
    });
    const summary = node.querySelector(".node-validation-summary");
    if (summary) {
      summary.hidden = true;
      summary.textContent = "";
    }
  });

  issues.forEach((validationIssue) => {
    const node = [...canvas.querySelectorAll(".node")]
      .find((item) => item.dataset.stepId === validationIssue.stepId);
    if (!node) return;
    node.classList.add("node-invalid");

    const group = node.querySelector(`[data-field="${validationIssue.fieldKey}"]`);
    if (group) {
      group.classList.add("field-invalid");
      group.querySelector("input, textarea, select")?.setAttribute("aria-invalid", "true");
      if (!group.querySelector(".field-error")) {
        const error = document.createElement("span");
        error.className = "field-error";
        error.textContent = validationIssue.message;
        group.appendChild(error);
      }
    }

    const summary = node.querySelector(".node-validation-summary");
    if (summary) {
      summary.hidden = false;
      const messages = issues
        .filter((item) => item.stepId === validationIssue.stepId)
        .map((item) => item.message);
      summary.textContent = [...new Set(messages)].join(" ");
    }
  });

  if (validationStatus) {
    validationStatus.textContent = issues.length === 0
      ? "Valid"
      : `${issues.length} ${issues.length === 1 ? "error" : "errors"}`;
    validationStatus.classList.toggle("has-errors", issues.length > 0);
  }
  if (btnSave) {
    btnSave.disabled = Boolean(
      issues.length
      || !isWorkflowDirty
      || isWorkflowRunning
      || isRecording
      || queuedSaveCount > 0,
    );
    btnSave.title = issues.length
      ? "Fix validation errors before saving"
      : queuedSaveCount > 0
        ? "Workflow save in progress"
        : !isWorkflowDirty ? "No unsaved workflow changes" : "Save workflow changes";
  }
  if (btnRun && !isWorkflowRunning) {
    btnRun.title = issues.length ? "Fix validation errors before running" : "Run workflow";
  }

  return issues;
}

function updateVariableAutocomplete(input) {
  const cursor = input.selectionStart ?? input.value.length;
  const beforeCursor = input.value.slice(0, cursor);
  const token = beforeCursor.match(/\{\{\s*([A-Za-z0-9_$.]*)$/);
  if (!token) {
    closeVariableAutocomplete();
    return;
  }

  const node = input.closest(".node");
  const stepIndex = Number(node?.dataset.stepIndex);
  const query = token[1].toLowerCase();
  const suggestions = StudioValidation
    .collectAvailableVariableNames(workflow, stepIndex)
    .filter((name) => name.toLowerCase().includes(query));

  if (suggestions.length === 0) {
    closeVariableAutocomplete();
    return;
  }

  closeVariableAutocomplete();
  const list = document.createElement("div");
  list.className = "variable-autocomplete";
  list.id = `variable-autocomplete-${node?.dataset.stepId || "field"}`;
  list.setAttribute("role", "listbox");
  list.innerHTML = suggestions
    .map((name, index) => `<button type="button" class="variable-option${index === 0 ? " active" : ""}" role="option" aria-selected="${index === 0}" data-variable="${escapeAttr(name)}"><code>${escapeHtml(name)}</code><span>{{${escapeHtml(name)}}}</span></button>`)
    .join("");
  input.closest(".node-input-group")?.appendChild(list);
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-controls", list.id);
  autocompleteState = {
    input,
    list,
    suggestions,
    activeIndex: 0,
    start: cursor - token[0].length,
  };
}

function handleAutocompleteKeydown(event) {
  if (!autocompleteState || event.target !== autocompleteState.input) return;
  const { suggestions } = autocompleteState;

  if (["ArrowDown", "ArrowUp"].includes(event.key)) {
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    autocompleteState.activeIndex = (
      autocompleteState.activeIndex + direction + suggestions.length
    ) % suggestions.length;
    renderAutocompleteSelection();
    return;
  }

  if (["Enter", "Tab"].includes(event.key)) {
    event.preventDefault();
    insertAutocompleteVariable(suggestions[autocompleteState.activeIndex]);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeVariableAutocomplete();
  }
}

function renderAutocompleteSelection() {
  autocompleteState?.list.querySelectorAll(".variable-option").forEach((option, index) => {
    const active = index === autocompleteState.activeIndex;
    option.classList.toggle("active", active);
    option.setAttribute("aria-selected", String(active));
    if (active) option.scrollIntoView({ block: "nearest" });
  });
}

function insertAutocompleteVariable(name) {
  if (!autocompleteState || !name) return;
  const { input, start } = autocompleteState;
  const cursor = input.selectionStart ?? input.value.length;
  const insertion = `{{${name}}}`;
  input.value = `${input.value.slice(0, start)}${insertion}${input.value.slice(cursor)}`;
  const nextCursor = start + insertion.length;
  input.setSelectionRange(nextCursor, nextCursor);
  closeVariableAutocomplete();
  input.focus();
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function closeVariableAutocomplete() {
  if (!autocompleteState) return;
  autocompleteState.input.removeAttribute("aria-expanded");
  autocompleteState.input.removeAttribute("aria-controls");
  autocompleteState.list.remove();
  autocompleteState = null;
}

function summarizeInspectorValue(value, includePreview = false) {
  if (value === null) return { type: "null", size: 0, preview: "null" };

  if (Array.isArray(value)) {
    const table = value.length > 0 && value.every(isPlainObject);
    return {
      type: table ? "table" : "list",
      size: value.length,
      preview: `${value.length} ${table ? "rows" : "items"}`,
    };
  }

  if (isPlainObject(value)) {
    const size = Object.keys(value).length;
    return { type: "object", size, preview: `${size} fields` };
  }

  if (typeof value === "string") {
    if (/^data:image\//i.test(value)) {
      return { type: "image", size: value.length, preview: "Image data available" };
    }
    return {
      type: "string",
      size: value.length,
      preview: includePreview ? truncateText(value, 160) : `${value.length} characters`,
    };
  }

  return {
    type: typeof value,
    size: 1,
    preview: includePreview ? String(value) : "Value available",
  };
}

function renderVariableCard(entry) {
  const origin = formatVariableOrigin(entry.origin);
  const details = entry.hasFullValue
    ? renderVariableDetails(entry.fullValue, entry.type)
    : "";

  return `
    <article class="data-card">
      <div class="data-card-heading">
        <code class="data-name">${escapeHtml(entry.name)}</code>
        <span class="data-type">${escapeHtml(entry.type)}</span>
      </div>
      <div class="data-meta">
        <span>${escapeHtml(entry.source)}</span>
        <span title="${escapeAttr(origin)}">${escapeHtml(origin)}</span>
      </div>
      <div class="data-preview">${escapeHtml(entry.preview || "Value available")}</div>
      ${details}
      <div class="data-actions">
        <button class="data-action copy-expression" data-variable="${escapeAttr(entry.name)}">Copy expression</button>
        ${entry.hasFullValue ? `<button class="data-action copy-value" data-variable="${escapeAttr(entry.name)}">Copy value</button>` : ""}
      </div>
    </article>
  `;
}

function renderVariableDetails(value, type) {
  if (!["object", "list", "table"].includes(type)) return "";

  if (type === "table") {
    const rows = value.slice(0, 5);
    const columns = Array.from(new Set(
      rows.flatMap((row) => Object.keys(row || {})),
    )).slice(0, 6);
    const header = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
    const body = rows.map((row) => {
      const cells = columns.map((column) => {
        return `<td>${escapeHtml(formatCellValue(row?.[column]))}</td>`;
      }).join("");
      return `<tr>${cells}</tr>`;
    }).join("");

    return `
      <details class="data-details">
        <summary>Preview first ${rows.length} rows</summary>
        <div class="data-table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>
      </details>
    `;
  }

  const json = truncateText(
    JSON.stringify(sanitizeInspectableValue(value), null, 2),
    6000,
  );
  return `
    <details class="data-details">
      <summary>Structured preview</summary>
      <pre>${escapeHtml(json)}</pre>
    </details>
  `;
}

async function handleDataInspectorClick(event) {
  const button = event.target.closest(".data-action");
  if (!button || !dataInspectorList?.contains(button)) return;

  const name = button.dataset.variable || "";
  let text = `{{${name}}}`;

  if (button.classList.contains("copy-value")) {
    const entry = buildInspectorEntries().find((item) => item.name === name);
    if (!entry?.hasFullValue) return;
    text = serializeInspectorValue(entry.fullValue);
  }

  try {
    await copyText(text);
    const original = button.textContent;
    button.textContent = "Copied";
    window.setTimeout(() => { button.textContent = original; }, 1000);
  } catch {
    alert("Could not copy variable data to the clipboard.");
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Copy command failed.");
}

function serializeInspectorValue(value) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function formatVariableOrigin(origin = {}) {
  if (origin.source === "workflow") return "Workflow seed";
  const action = origin.action || "Node output";
  return origin.nodeId ? `${action} · ${origin.nodeId}` : action;
}

function formatCellValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    return truncateText(JSON.stringify(sanitizeInspectableValue(value)), 80);
  }
  if (typeof value === "string" && /^data:image\//i.test(value)) {
    return `[image data omitted: ${value.length} characters]`;
  }
  return truncateText(String(value), 80);
}

function sanitizeInspectableValue(value, depth = 0) {
  if (depth > 6) return "[nested value omitted]";
  if (typeof value === "string") {
    if (/^data:image\//i.test(value)) {
      return `[image data omitted: ${value.length} characters]`;
    }
    return truncateText(value, 1000);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => {
      return sanitizeInspectableValue(item, depth + 1);
    });
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).slice(0, 50).map(([key, item]) => {
        return [key, sanitizeInspectableValue(item, depth + 1)];
      }),
    );
  }
  return value;
}

function truncateText(value, limit) {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function parseStructuredOrTextValue(value) {
  const text = String(value ?? "");
  const trimmed = text.trim();

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return text;
    }
  }

  return text;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function renderCanvas() {
  closeVariableAutocomplete();
  canvas.innerHTML = "";

  if (workflow.steps.length === 0) {
    canvas.innerHTML =
      '<div class="empty-state">Click an action on the left to start building.</div>';
    refreshValidationUI();
    return;
  }

  workflow.steps.forEach((step, index) => {
    const node = document.createElement("div");
    node.className = "node";
    node.dataset.stepId = step.id;
    node.dataset.stepIndex = String(index);

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
      ${getNodeGuidanceHtml(step)}
      <div class="node-validation-summary" role="alert" hidden></div>
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
  refreshValidationUI();
  refreshContextualFieldVisibility();
}

function getNodeGuidanceHtml(step) {
  const action = step.action || step.type;
  const definition = getStepDefinition(step);
  const guidance = definition?.guidance || {};
  if (!definition) return "";

  const inputs = guidance.inputs || definition.inputs || [];
  const outputs = guidance.outputs || definition.outputs || [];

  return `
    <details class="node-guidance">
      <summary>How to use ${escapeHtml(definition.label || action)}</summary>
      <p>${escapeHtml(guidance.description || definition.description || "")}</p>
      <dl>
        <div><dt>When</dt><dd>${escapeHtml(guidance.whenToUse || "")}</dd></div>
        <div><dt>Example</dt><dd>${escapeHtml(guidance.example || "")}</dd></div>
        <div><dt>I/O</dt><dd>Inputs: ${escapeHtml(formatInlineList(inputs))} · Outputs: ${escapeHtml(formatInlineList(outputs))}</dd></div>
        <div><dt>Config</dt><dd>${escapeHtml(guidance.configuration || "")}</dd></div>
        <div><dt>Safety</dt><dd>${escapeHtml(guidance.safety || "")}</dd></div>
      </dl>
    </details>
  `;
}

function getStepFieldsHtml(step) {
  let html = "";
  const handledConfigKeys = new Set();

  html += `
    <div class="node-input-group" data-field="tabRef">
      <label>Run in Logical Tab (optional)</label>
      <input type="text" id="tabref-${escapeAttr(step.id)}" value="${escapeAttr(step.tabRef || "")}" placeholder="e.g. results_tab">
    </div>
  `;

  if (needsTarget(step)) {
    html += getTargetEditorHtml(step);
  }

  if (step.action === Actions.BrowserNavigate) {
    html += `
      <div class="node-input-group" data-field="url">
        <label>URL *</label>
        <input type="text" data-expression="true" autocomplete="off" id="payload1-${escapeAttr(step.id)}" value="${escapeAttr(step.url || step.config?.url || step.payload?.primary || "")}" placeholder="https://example.com or {{url}}">
      </div>
      <div class="node-input-group" data-field="openIn">
        <label>Open In</label>
        <select id="openin-${escapeAttr(step.id)}">
          <option value="sameTab" ${(step.openIn || step.config?.openIn || step.payload?.openIn || "sameTab") === "sameTab" ? "selected" : ""}>Same Tab</option>
          <option value="newTab" ${(step.openIn || step.config?.openIn || step.payload?.openIn) === "newTab" ? "selected" : ""}>New Tab</option>
        </select>
      </div>
    `;
    return html;
  }

  if (step.action === Actions.ElementType) {
    handledConfigKeys.add("value");
    html += `
      <div class="node-input-group" data-field="value">
        <label>Text to Type *</label>
        <input type="text" data-expression="true" autocomplete="off" id="payload1-${escapeAttr(step.id)}" value="${escapeAttr(step.value || step.config?.value || step.payload?.primary || "")}" placeholder="Hello World or {{variable}}">
      </div>
    `;
  }

  if (step.action === Actions.ElementExtract) {
    handledConfigKeys.add("variableName");
    html += `
      <div class="node-input-group" data-field="variableName">
        <label>Variable Name *</label>
        <input type="text" id="payload1-${escapeAttr(step.id)}" value="${escapeAttr(step.variableName || step.config?.variableName || step.payload?.primary || "")}" placeholder="scraped_title">
      </div>
    `;
  }

  if (step.action === Actions.KeyboardSendKeys) {
    handledConfigKeys.add("keys");
    html += `
      <div class="node-input-group" data-field="keys">
        <label>Key / Shortcut *</label>
        <input type="text" data-expression="true" autocomplete="off" id="payload1-${escapeAttr(step.id)}" value="${escapeAttr(step.keys || step.config?.keys || step.payload?.primary || "")}" placeholder="Enter, Escape, Ctrl+L">
      </div>
    `;
  }

  if (step.action === Actions.LogicWait) {
    handledConfigKeys.add("ms");
    html += `
      <div class="node-input-group" data-field="ms">
        <label>Wait Time (ms)</label>
        <input type="text" data-expression="true" autocomplete="off" id="payload1-${escapeAttr(step.id)}" value="${escapeAttr(String(step.ms || step.config?.ms || step.payload?.primary || 1000))}" placeholder="1000 or {{delay_ms}}">
      </div>
    `;
  }

  const definition = getStepDefinition(step);

  for (const field of definition?.config || []) {
    if (handledConfigKeys.has(field.key)) continue;
    html += getConfigFieldHtml(step, field);
  }

  if (isExtractionNode(step.action)) {
    html += getExtractionOutputSampleHtml(step);
  }

  return html;
}

function getConfigFieldHtml(step, field, options = {}) {
  const idPrefix = options.idPrefix || "config";
  const id = `${idPrefix}-${step.id}-${field.key}`;
  const value = options.values?.[field.key] ?? step.config?.[field.key] ?? field.default ?? "";
  const displayValue = value && typeof value === "object"
    ? JSON.stringify(value, null, 2)
    : value;
  const required = field.required ? " *" : "";
  const help = field.help
    ? `<span class="field-help">${escapeHtml(field.help)}</span>`
    : "";
  const example = field.example
    ? `<span class="field-help field-example">Example: <code>${escapeHtml(field.example)}</code></span>`
    : "";
  const placeholder = field.placeholder
    ? ` placeholder="${escapeAttr(field.placeholder)}"`
    : "";
  const autocompleteOptions = getFieldAutocompleteOptions(field, step);
  const listId = autocompleteOptions.length ? `${id}-options` : "";
  const listAttribute = listId ? ` list="${escapeAttr(listId)}"` : "";
  const datalist = listId
    ? `<datalist id="${escapeAttr(listId)}">${autocompleteOptions.map((option) => `<option value="${escapeAttr(option)}"></option>`).join("")}</datalist>`
    : "";
  const expressionAttribute = field.expressionMode !== "none"
    ? ' data-expression="true" autocomplete="off"'
    : "";
  const visibility = field.visibleWhen
    ? ` data-visible-field="${escapeAttr(field.visibleWhen.field)}" data-visible-value="${escapeAttr(field.visibleWhen.equals)}" data-visible-controller="${escapeAttr(`${idPrefix}-${step.id}-${field.visibleWhen.field}`)}"`
    : "";
  const dataField = options.dataFieldPrefix
    ? `${options.dataFieldPrefix}.${field.key}`
    : field.key;

  if (field.kind === "select") {
    const options = (field.options || [])
      .map((option) => {
        const optionValue = typeof option === "object" ? option.value : option;
        const optionLabel = typeof option === "object" ? option.label : option;
        const selected = String(optionValue) === String(displayValue) ? "selected" : "";
        return `<option value="${escapeAttr(optionValue)}" ${selected}>${escapeHtml(optionLabel)}</option>`;
      })
      .join("");

    return `
      <div class="node-input-group" data-field="${escapeAttr(dataField)}"${visibility}>
        <label>${escapeHtml(field.label || field.key)}${required}</label>
        <select id="${escapeAttr(id)}">${options}</select>
        ${help}
        ${example}
      </div>
    `;
  }

  if (field.kind === "boolean") {
    return `
      <div class="node-input-group" data-field="${escapeAttr(dataField)}"${visibility}>
        <label class="field-checkbox"><input type="checkbox" id="${escapeAttr(id)}" ${displayValue === true ? "checked" : ""}> ${escapeHtml(field.label || field.key)}${required}</label>
        ${help}
        ${example}
      </div>
    `;
  }

  if (["textarea", "value"].includes(field.kind)) {
    return `
      <div class="node-input-group" data-field="${escapeAttr(dataField)}"${visibility}>
        <label>${escapeHtml(field.label || field.key)}${required}</label>
        <textarea id="${escapeAttr(id)}"${expressionAttribute}${placeholder}${listAttribute} rows="4">${escapeHtml(displayValue)}</textarea>
        ${datalist}
        ${help}
        ${example}
      </div>
    `;
  }

  return `
    <div class="node-input-group" data-field="${escapeAttr(dataField)}"${visibility}>
      <label>${escapeHtml(field.label || field.key)}${required}</label>
      <input type="text" ${field.kind === "number" ? 'inputmode="numeric"' : ""}${expressionAttribute}${placeholder}${listAttribute} id="${escapeAttr(id)}" value="${escapeAttr(displayValue)}">
      ${datalist}
      ${help}
      ${example}
    </div>
  `;
}

function getFieldAutocompleteOptions(field, step) {
  if (!NodeAuthoring) return [];
  const stepIndex = Math.max(0, workflow.steps.indexOf(step));
  const variables = Object.fromEntries(
    StudioValidation.collectAvailableVariableNames(workflow, stepIndex)
      .map((name) => [name, true]),
  );
  return NodeAuthoring.collectFieldAutocompleteOptions(field, {
    variables,
    nodeIds: workflow.steps.slice(0, stepIndex).map((item) => item.id),
    tabReferences: workflow.steps
      .slice(0, stepIndex)
      .map((item) => item.tabRef || item.config?.saveTabReferenceAs)
      .filter(Boolean),
  });
}

function getTargetEditorHtml(step) {
  const definition = getStepDefinition(step);
  const schema = definition?.targetSchema;
  if (!NodeAuthoring || !schema?.fields) return "";
  const source = step.target || (step.componentRef ? { componentRef: step.componentRef } : "");
  const values = NodeAuthoring.normalizeTargetEditorValue(source);
  const fields = schema.fields
    .map((field) => getConfigFieldHtml(step, field, {
      idPrefix: "target",
      values,
      dataFieldPrefix: "target",
    }))
    .join("");
  const extractionHelp = isExtractionNode(step.action)
    ? '<span class="field-help">Extraction selectors run inside this resolved target.</span>'
    : "";
  return `
    <fieldset class="target-editor" data-field="target">
      <legend>Target Element *</legend>
      ${extractionHelp}
      ${fields}
    </fieldset>
  `;
}

function updateTargetFromUI(step) {
  const definition = getStepDefinition(step);
  const fields = definition?.targetSchema?.fields;
  if (!NodeAuthoring || !Array.isArray(fields)) return;
  const originalSource = step.target || (step.componentRef ? { componentRef: step.componentRef } : "");
  const original = NodeAuthoring.normalizeTargetEditorValue(originalSource);
  const edited = { ...original };
  let found = false;
  for (const field of fields) {
    const input = document.getElementById(`target-${step.id}-${field.key}`);
    if (!input) continue;
    found = true;
    edited[field.key] = field.kind === "boolean" ? input.checked : input.value;
  }
  if (!found || JSON.stringify(edited) === JSON.stringify(original)) return;
  const identifierValue = typeof edited.identifierValue === "string"
    ? edited.identifierValue.trim()
    : edited.identifierValue;
  if (!identifierValue && edited.identifierType !== "coordinates") {
    step.target = "";
    step.targetType = "";
  } else {
    step.target = NodeAuthoring.buildTargetEditorValue(edited);
    step.targetType = edited.identifierType;
  }
  step.targetFallbacks = [];
  step.friendlyName = "";
}

function refreshContextualFieldVisibility() {
  canvas.querySelectorAll("[data-visible-field]").forEach((group) => {
    const node = group.closest(".node");
    const stepId = node?.dataset.stepId;
    const expected = group.dataset.visibleValue;
    const controller = document.getElementById(
      group.dataset.visibleController || `config-${stepId}-${group.dataset.visibleField}`,
    );
    group.hidden = String(controller?.value ?? "") !== expected;
  });
}

function getExtractionOutputSampleHtml(step) {
  const sample = StudioValidation.getLastRunOutputSample(step, lastRunVariables);
  if (!sample.name) {
    return `
      <section class="extract-sample extract-sample-empty" aria-label="Last run output">
        <span>Last run output</span>
        <p>Set an output variable to preview extracted data here.</p>
      </section>
    `;
  }

  if (!sample.hasValue) {
    return `
      <section class="extract-sample extract-sample-empty" aria-label="Last run output for ${escapeAttr(sample.name)}">
        <div class="extract-sample-heading"><span>Last run output</span><code>${escapeHtml(sample.name)}</code></div>
        <p>Run the workflow to populate this preview.</p>
      </section>
    `;
  }

  const summary = summarizeInspectorValue(sample.value, true);
  return `
    <section class="extract-sample" aria-label="Last run output for ${escapeAttr(sample.name)}">
      <div class="extract-sample-heading">
        <span>Last run output</span>
        <span><code>${escapeHtml(sample.name)}</code><b>${escapeHtml(summary.type)}</b></span>
      </div>
      <div class="extract-sample-preview">${escapeHtml(summary.preview)}</div>
      ${renderVariableDetails(sample.value, summary.type)}
    </section>
  `;
}

function isExtractionNode(action) {
  return [
    Actions.ElementExtract,
    Actions.DataExtractText,
    Actions.DataExtractAttribute,
    Actions.DataExtractList,
    Actions.DataExtractTable,
    Actions.DataExtractPage,
  ].includes(action);
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
    case Actions.HttpRequest:
      return "Sends a background HTTP request and stores its structured response.";
    case Actions.ClipboardRead:
      return "Reads clipboard text only when this node explicitly allows access.";
    case Actions.ClipboardWrite:
      return "Writes expression-enabled text to the system clipboard.";
    case Actions.FileInputUpload:
      return "Creates a text/base64 file and assigns it to a web file input.";
    case Actions.FileLocalUpload:
      return "Reads an approved local file path through the native host and assigns it to a web file input.";
    case Actions.DownloadWait:
      return "Waits for a recent browser download and stores safe metadata.";
    case Actions.ScreenshotCapture:
      return "Captures the visible workflow tab to memory or Downloads.";
    default:
      return "Interact with the specified target element.";
  }
}

function needsTarget(step) {
  const action = step.action || step.type;
  const definition = getStepDefinition(step);
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

function getStepDefinition(step = {}) {
  const type = step.action || step.type || "";
  return nodeDefinitionsByContract.get(
    nodeContractKey(type, step.version),
  ) || null;
}

function nodeContractKey(type, version) {
  return `${String(type || "").trim()}@${String(version ?? "").trim()}`;
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
    applyBridgeStatus(response);
  } catch {
    applyBridgeStatus({ connected: false, ready: false });
  }
}

function applyBridgeStatus(bridge = {}) {
  const previousReady = bridgeReady;
  bridgeReady = bridge.ready === true || bridge.connected === true;
  statusText.innerText = bridgeReady ? "Connected to Host" : "Disconnected";
  statusText.className = bridgeReady
    ? "status-connected"
    : "status-disconnected";

  if (bridgeReady && previousReady !== true) {
    refreshWorkflowList();
  }
}

function updateRecordButton() {
  if (!btnRecord) return;

  btnRecord.innerText = isRecording ? "Stop Recording" : "Record";
  btnRecord.title = isRecording ? "Stop recording browser actions" : "Record browser actions";

  btnRecord.style.backgroundColor = isRecording
    ? "var(--bg-main)"
    : "var(--danger)";

  btnRecord.style.border = isRecording ? "1px solid var(--danger)" : "none";
}

function setRunButtonRunning(running, stopping = false) {
  if (!btnRun) return;

  btnRun.innerText = stopping
    ? "Stopping..."
    : running
      ? "Stop"
      : "Run";
  btnRun.title = running ? "Stop workflow execution" : "Run workflow";
  btnRun.style.backgroundColor = running ? "#dc2626" : "var(--accent)";
  btnRun.disabled = stopping || isRecording;
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

function formatInlineList(values = []) {
  return Array.isArray(values) && values.length ? values.join(", ") : "none";
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
