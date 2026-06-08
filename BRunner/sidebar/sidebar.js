let selectedWorkflow = null;
const workflowListEl = document.getElementById("workflow-list");
const searchInput = document.getElementById("search-input");
const btnPlay = document.getElementById("btn-play");
const selectedLabel = document.getElementById("selected-label");

// 1. Fetch and Render Workflows
function loadWorkflows() {
  chrome.runtime.sendMessage({ type: "OS_LIST_WORKFLOWS" }, (response) => {
    workflowListEl.innerHTML = "";
    if (
      response &&
      response.status === "success" &&
      response.files.length > 0
    ) {
      response.files.forEach((file) => {
        const div = document.createElement("div");
        div.className = "workflow-item";
        div.innerText = file;
        div.dataset.name = file;

        div.addEventListener("click", () => selectWorkflow(div, file));
        workflowListEl.appendChild(div);
      });
    } else {
      workflowListEl.innerHTML =
        '<div style="color: #ef4444; font-size: 0.8rem;">No workflows found.</div>';
    }
  });
}

// 2. Selection Logic
function selectWorkflow(element, fileName) {
  // Clear previous selection
  document
    .querySelectorAll(".workflow-item")
    .forEach((el) => el.classList.remove("selected"));

  // Highlight new selection
  element.classList.add("selected");
  selectedWorkflow = fileName;

  // Update UI
  selectedLabel.innerText = `Selected: ${fileName}`;
  btnPlay.classList.add("active");
}

// 3. Search Filter Logic
if (searchInput) {
  searchInput.addEventListener("keyup", (e) => {
    const query = e.target.value.toLowerCase();
    document.querySelectorAll(".workflow-item").forEach((item) => {
      if (item.innerText.toLowerCase().includes(query)) {
        item.style.display = "block";
      } else {
        item.style.display = "none";
      }
    });
  });
}

// 4. Execution Logic
if (btnPlay) {
  btnPlay.addEventListener("click", () => {
    if (!selectedWorkflow) return;

    btnPlay.innerText = "⏳ Running...";
    btnPlay.style.background = "#d97706";

    // Request the background script to load the file from OS and execute it
    chrome.runtime.sendMessage({
      type: "RUN_WORKFLOW_BY_NAME",
      payload: { filename: selectedWorkflow },
    });

    // Reset UI after a delay (or listen for completion event)
    setTimeout(() => {
      btnPlay.innerText = "▶ Run Selected";
      btnPlay.style.background = "#10b981";
    }, 2000);
  });
}

// 5. Macro Recorder Toggle
let isRecording = false;
const btnRecord = document.getElementById("btn-toggle-record");
if (btnRecord) {
  btnRecord.addEventListener("click", () => {
    isRecording = !isRecording;
    btnRecord.innerText = isRecording
      ? "⏹️ Stop Recording"
      : "🔴 Toggle Recording";
    btnRecord.style.background = isRecording ? "#334155" : "#ef4444";

    chrome.runtime.sendMessage({
      type: "TOGGLE_RECORDING",
      payload: { isRecording: isRecording },
    });
  });
}

// 6. Open Studio IDE
const btnOpenStudio = document.getElementById("btn-open-studio");
if (btnOpenStudio) {
  btnOpenStudio.addEventListener("click", () => {
    // Creates a new tab pointing to the Studio UI
    chrome.tabs.create({ url: chrome.runtime.getURL("studio/index.html") });
  });
}

// Listen for Auto-Save completion from the Background worker
chrome.runtime.onMessage.addListener((request) => {
  if (request.type === "REFRESH_WORKFLOW_LISTS") {
    loadWorkflows();
  }
});

// ============================================================================
// WORKSPACE SYNC: Auto-Collapse/Expand Layout based on Active Tab Context
// ============================================================================

async function syncSidebarLayoutWithTab(tabId) {
  const mainView = document.getElementById("main-sidebar-view");
  const studioView = document.getElementById("studio-active-view");
  if (!mainView || !studioView) return;

  try {
    const tab = await chrome.tabs.get(tabId);
    const studioUrl = chrome.runtime.getURL("studio/index.html");

    // If the current focused tab is strictly the Studio IDE, switch to placeholder
    if (tab && tab.url && tab.url.startsWith(studioUrl)) {
      mainView.style.display = "none";
      studioView.style.display = "flex";
    } else {
      // Return to your working workflow controls for all other tabs
      studioView.style.display = "none";
      mainView.style.display = "flex";

      // Safely re-trigger your file list rendering
      if (typeof loadWorkflows === "function") {
        loadWorkflows();
      }
    }
  } catch (err) {
    // Safe fallback if tab details are briefly uninitialized during rapid switches
    studioView.style.display = "none";
    mainView.style.display = "flex";
  }
}

// Native Listener 1: Triggers instantly when user clicks/switches browser tabs
chrome.tabs.onActivated.addListener((activeInfo) => {
  syncSidebarLayoutWithTab(activeInfo.tabId);
});

// Native Listener 2: Triggers instantly when any webpage alters or finishes its loading status
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    syncSidebarLayoutWithTab(tabId);
  }
});

// Native Listener 3: Run JIT check upon opening/initializing the sidebar window frame
async function initSidebarLayoutContext() {
  try {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (activeTab) {
      syncSidebarLayoutWithTab(activeTab.id);
    }
  } catch (err) {
    console.error("[BRunner Sidebar] Initialization layout sync skipped:", err);
  }
}

// Init
loadWorkflows();
// Force baseline calculation immediately on script mount
initSidebarLayoutContext();
