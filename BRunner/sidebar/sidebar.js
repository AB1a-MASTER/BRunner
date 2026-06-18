// sidebar/sidebar.js
// BRunner Sidebar UI.
// Matches current sidebar.html body:
// - main-sidebar-view
// - studio-active-view
// - btn-open-studio
// - search-input
// - workflow-list
// - selected-label
// - btn-play
// - btn-toggle-record

const Messages = Object.freeze({
  OsListWorkflows: "OS_LIST_WORKFLOWS",
  RunWorkflowByName: "RUN_WORKFLOW_BY_NAME",
  StopWorkflow: "STOP_WORKFLOW",
  ToggleRecording: "TOGGLE_RECORDING",
  GetRecordingState: "GET_RECORDING_STATE",
  RefreshWorkflowLists: "REFRESH_WORKFLOW_LISTS",
  CheckBridgeStatus: "CHECK_BRIDGE_STATUS",
  GetRuntimeState: "GET_RUNTIME_STATE",
  RuntimeStateChanged: "RUNTIME_STATE_CHANGED",
});

let isRecording = false;
let isWorkflowRunning = false;
let activeWorkflowName = "";
let workflowExecutionStatus = "idle";
let selectedWorkflow = "";
let allWorkflows = [];

const mainSidebarView = document.getElementById("main-sidebar-view");
const studioActiveView = document.getElementById("studio-active-view");
const workflowList = document.getElementById("workflow-list");
const searchInput = document.getElementById("search-input");
const selectedLabel = document.getElementById("selected-label");
const playButton = document.getElementById("btn-play");
const recordButton = document.getElementById("btn-toggle-record");
const openStudioButton = document.getElementById("btn-open-studio");
const recordingTabPolicyInput = document.getElementById(
  "recording-tab-policy",
);

init();

function init() {
  wireControls();
  wireRuntimeMessages();
  installTabWatchers();

  syncRecordingState();
  syncRuntimeState();
  refreshWorkflowList();
  syncSidebarVisibilityForActiveTab();
}

function wireControls() {
  openStudioButton?.addEventListener("click", openStudio);
  recordButton?.addEventListener("click", toggleRecording);
  playButton?.addEventListener("click", runSelectedWorkflow);

  searchInput?.addEventListener("input", () => {
    renderWorkflowList(filterWorkflows(searchInput.value));
  });
}

function wireRuntimeMessages() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.type === Messages.RefreshWorkflowLists) {
      refreshWorkflowList();
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

function installTabWatchers() {
  chrome.tabs.onActivated.addListener(() => {
    syncSidebarVisibilityForActiveTab();
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "complete") {
      syncSidebarVisibilityForActiveTab();
    }
  });

  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) {
      syncSidebarVisibilityForActiveTab();
    }
  });
}

async function syncSidebarVisibilityForActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    const studioUrl = chrome.runtime.getURL("studio/index.html");
    const isStudio = Boolean(tab?.url?.startsWith(studioUrl));

    if (isStudio) {
      mainSidebarView.style.display = "none";
      studioActiveView.style.display = "flex";
    } else {
      mainSidebarView.style.display = "flex";
      studioActiveView.style.display = "none";
    }
  } catch {
    mainSidebarView.style.display = "flex";
    studioActiveView.style.display = "none";
  }
}

async function openStudio() {
  const studioUrl = chrome.runtime.getURL("studio/index.html");

  const tabs = await chrome.tabs.query({
    url: studioUrl,
  });

  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, {
      active: true,
    });

    if (tabs[0].windowId) {
      await chrome.windows.update(tabs[0].windowId, {
        focused: true,
      });
    }

    return;
  }

  await chrome.tabs.create({
    url: studioUrl,
    active: true,
  });
}

async function toggleRecording() {
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
    isRecording = Boolean(recording?.isRecording);

    updateRecordButton();

    if (!isRecording) {
      refreshWorkflowList();
    }
  } catch (error) {
    isRecording = !isRecording;
    updateRecordButton();
    setSelectedLabel(`Recording error: ${error.message || error}`, true);
  }
}

async function syncRecordingState() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: Messages.GetRecordingState,
    });

    isRecording = Boolean(response?.recording?.isRecording);
    updateRecordButton();
  } catch {
    isRecording = false;
    updateRecordButton();
  }
}

async function syncRuntimeState() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: Messages.GetRuntimeState,
    });

    if (response?.ok) applyRuntimeState(response.state);
  } catch {
    // Background may still be starting.
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

  const execution = state.execution || {};
  const running = ["running", "cancelling"].includes(execution.status);
  const stopping = execution.status === "cancelling";
  isWorkflowRunning = running;
  activeWorkflowName = execution.workflowName || "";
  workflowExecutionStatus = execution.status || "idle";

  if (recordButton) recordButton.disabled = running;
  if (playButton) {
    playButton.disabled =
      stopping || isRecording || (!running && !selectedWorkflow);
    playButton.classList.toggle(
      "active",
      running || Boolean(selectedWorkflow),
    );
    playButton.textContent = stopping
      ? "⏳ Stopping..."
      : running
        ? "⏹ Stop Workflow"
      : "▶ Run Selected";
  }

  updateWorkflowRunControls();

  if (running) {
    setSelectedLabel(
      `Running ${execution.workflowName || "workflow"} (${Number(execution.currentStepIndex || 0) + 1}/${execution.totalSteps || 0})...`,
    );
  } else if (execution.status === "failed" && execution.error) {
    setSelectedLabel(`Failed: ${execution.error}`, true);
  } else if (execution.status === "cancelled") {
    setSelectedLabel("Workflow stopped.");
  }
}

async function refreshWorkflowList() {
  workflowList.innerHTML = `
    <div style="color:#94a3b8;font-size:0.8rem;text-align:center;margin-top:20px;">
      Loading workflows...
    </div>
  `;

  try {
    const response = await chrome.runtime.sendMessage({
      type: Messages.OsListWorkflows,
    });

    if (!isSuccess(response)) {
      workflowList.innerHTML = `
        <div style="color:#ef4444;font-size:0.8rem;text-align:center;margin-top:20px;">
          Failed to load workflows.<br>${escapeHtml(response?.error || "")}
        </div>
      `;
      return;
    }

    allWorkflows = response.files || response.workflows || [];
    renderWorkflowList(filterWorkflows(searchInput?.value || ""));
  } catch (error) {
    workflowList.innerHTML = `
      <div style="color:#ef4444;font-size:0.8rem;text-align:center;margin-top:20px;">
        Failed to load workflows.<br>${escapeHtml(error.message || error)}
      </div>
    `;
  }
}

function filterWorkflows(query) {
  const normalizedQuery = String(query || "")
    .trim()
    .toLowerCase();

  if (!normalizedQuery) return allWorkflows;

  return allWorkflows.filter((file) => {
    return String(file).toLowerCase().includes(normalizedQuery);
  });
}

function renderWorkflowList(files) {
  if (!files || files.length === 0) {
    workflowList.innerHTML = `
      <div style="color:#94a3b8;font-size:0.8rem;text-align:center;margin-top:20px;">
        No workflows found.
      </div>
    `;
    return;
  }

  workflowList.innerHTML = "";

  files.forEach((fileEntry) => {
    const file = getWorkflowFilename(fileEntry);
    if (!file) return;

    const item = document.createElement("div");
    item.className = "workflow-item";
    item.dataset.file = file;

    item.innerHTML = `
      <div class="workflow-info">
        <div class="workflow-name">${escapeHtml(file.replace(/\.json$/i, ""))}</div>
        <div class="workflow-file">${escapeHtml(file)}</div>
      </div>
      <button class="workflow-run-btn" type="button" title="Run workflow">▶</button>
    `;

    item.addEventListener("click", () => {
      selectWorkflow(file);
    });

    item.addEventListener("dblclick", () => {
      selectWorkflow(file);

      if (isWorkflowRunning) {
        if (activeWorkflowName === file) stopRunningWorkflow();
        return;
      }

      runWorkflow(file);
    });

    item
      .querySelector(".workflow-run-btn")
      .addEventListener("click", (event) => {
        event.stopPropagation();
        selectWorkflow(file);

        if (isWorkflowRunning) {
          if (activeWorkflowName === file) stopRunningWorkflow();
          return;
        }

        runWorkflow(file);
      });

    workflowList.appendChild(item);
  });

  updateSelectedWorkflowVisual();
}

function selectWorkflow(filename) {
  selectedWorkflow = filename;
  setSelectedLabel(filename.replace(/\.json$/i, ""));
  updateSelectedWorkflowVisual();
}

function updateSelectedWorkflowVisual() {
  workflowList.querySelectorAll(".workflow-item").forEach((item) => {
    item.classList.toggle("selected", item.dataset.file === selectedWorkflow);
  });

  if (playButton) {
    playButton.classList.toggle(
      "active",
      isWorkflowRunning || Boolean(selectedWorkflow),
    );
    playButton.disabled =
      workflowExecutionStatus === "cancelling" ||
      isRecording ||
      (!isWorkflowRunning && !selectedWorkflow);
  }

  updateWorkflowRunControls();
}

function updateWorkflowRunControls() {
  workflowList.querySelectorAll(".workflow-item").forEach((item) => {
    const button = item.querySelector(".workflow-run-btn");
    if (!button) return;

    const isActiveWorkflow =
      isWorkflowRunning && item.dataset.file === activeWorkflowName;
    const stopping =
      isActiveWorkflow && workflowExecutionStatus === "cancelling";

    button.textContent = stopping ? "…" : isActiveWorkflow ? "■" : "▶";
    button.title = stopping
      ? "Stopping workflow"
      : isActiveWorkflow
        ? "Stop workflow"
        : "Run workflow";
    button.disabled =
      isRecording ||
      stopping ||
      (isWorkflowRunning && !isActiveWorkflow);
    button.classList.toggle("stopping", stopping);
    button.classList.toggle("running", isActiveWorkflow && !stopping);
  });
}

async function runSelectedWorkflow() {
  if (isWorkflowRunning) {
    await stopRunningWorkflow();
    return;
  }

  if (!selectedWorkflow) {
    setSelectedLabel("Select a workflow first.", true);
    return;
  }

  await runWorkflow(selectedWorkflow);
}

async function stopRunningWorkflow() {
  setSelectedLabel("Stopping workflow...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: Messages.StopWorkflow,
    });

    if (!response?.ok) {
      setSelectedLabel(`Stop failed: ${response?.error || "Unknown error"}`, true);
    }
  } catch (error) {
    setSelectedLabel(`Stop failed: ${error.message || error}`, true);
  }
}

function updateRecordButton() {
  if (!recordButton) return;

  recordButton.textContent = isRecording
    ? "⏹ Stop Recording"
    : "🔴 Toggle Recording";

  recordButton.classList.toggle("recording", isRecording);
}

function setSelectedLabel(text, isError = false) {
  if (!selectedLabel) return;

  selectedLabel.textContent = text;
  selectedLabel.style.color = isError ? "#ef4444" : "";
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

function getWorkflowFilename(fileEntry) {
  if (typeof fileEntry === "string") {
    return fileEntry;
  }

  if (fileEntry && typeof fileEntry === "object") {
    return fileEntry.filename || fileEntry.name || fileEntry.file || "";
  }

  return "";
}

async function runWorkflow(filename) {
  if (!filename) {
    setSelectedLabel("No workflow selected.", true);
    return;
  }

  setSelectedLabel(`Running ${filename.replace(/\.json$/i, "")}...`);
  isWorkflowRunning = true;
  activeWorkflowName = filename;
  workflowExecutionStatus = "running";
  updateSelectedWorkflowVisual();

  try {
    const response = await chrome.runtime.sendMessage({
      type: Messages.RunWorkflowByName,
      filename,
    });

    if (isSuccess(response)) {
      setSelectedLabel(
        response.cancelled
          ? "Workflow stopped."
          : `Completed ${filename.replace(/\.json$/i, "")}`,
      );
    } else {
      setSelectedLabel(`Failed: ${response?.error || "Unknown error"}`, true);
    }
  } catch (error) {
    setSelectedLabel(`Failed: ${error.message || error}`, true);
  } finally {
    isWorkflowRunning = false;
    activeWorkflowName = "";
    workflowExecutionStatus = "idle";
    updateSelectedWorkflowVisual();
  }
}
