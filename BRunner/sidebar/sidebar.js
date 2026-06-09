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
  ToggleRecording: "TOGGLE_RECORDING",
  GetRecordingState: "GET_RECORDING_STATE",
  RefreshWorkflowLists: "REFRESH_WORKFLOW_LISTS",
  CheckBridgeStatus: "CHECK_BRIDGE_STATUS",
});

let isRecording = false;
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

init();

function init() {
  wireControls();
  wireRuntimeMessages();
  installTabWatchers();

  syncRecordingState();
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
    });

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
      runWorkflow(file);
    });

    item
      .querySelector(".workflow-run-btn")
      .addEventListener("click", (event) => {
        event.stopPropagation();
        selectWorkflow(file);
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
}

async function runSelectedWorkflow() {
  if (!selectedWorkflow) {
    setSelectedLabel("Select a workflow first.", true);
    return;
  }

  await runWorkflow(selectedWorkflow);
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

  try {
    const response = await chrome.runtime.sendMessage({
      type: Messages.RunWorkflowByName,
      filename,
    });

    if (isSuccess(response)) {
      setSelectedLabel(`Completed ${filename.replace(/\.json$/i, "")}`);
    } else {
      setSelectedLabel(`Failed: ${response?.error || "Unknown error"}`, true);
    }
  } catch (error) {
    setSelectedLabel(`Failed: ${error.message || error}`, true);
  }
}
