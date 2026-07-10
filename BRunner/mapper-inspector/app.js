const Messages = Object.freeze({
  ListWorkflowMapperStates: "LIST_WORKFLOW_MAPPER_STATES",
  SaveWorkflowMapperState: "SAVE_WORKFLOW_MAPPER_STATE",
  MapCurrentPage: "MAP_CURRENT_PAGE",
  InspectCurrentPageMap: "INSPECT_CURRENT_PAGE_MAP",
  HighlightMapperComponent: "HIGHLIGHT_MAPPER_COMPONENT",
});

const state = {
  states: {},
  entries: [],
  siteGroups: [],
  selectedEntryId: "",
  selectedComponentId: "",
  activeView: "tree",
  treeMode: "structure",
  treeCollapsed: {},
  componentQuery: "",
  componentStatusFilter: "",
  collapsedPanels: {
    sites: false,
    details: false,
    policy: false,
    review: false,
    component: false,
  },
  detailSectionSizes: {
    policy: 230,
    review: 128,
  },
  lastResolutionByTarget: {},
  liveStatusByEntry: {},
  hoverHighlightRequestId: 0,
  highlightRequestId: 0,
  activeResolutionKey: "",
  graphView: {
    scale: 0.86,
    panX: 18,
    panY: 18,
    dragging: false,
    dragX: 0,
    dragY: 0,
  },
};

const els = {
  workflowId: document.getElementById("map-workflow-id"),
  mapActive: document.getElementById("btn-map-active"),
  refresh: document.getElementById("btn-refresh"),
  highlightEnabled: document.getElementById("highlight-enabled"),
  highlightHoverEnabled: document.getElementById("highlight-hover-enabled"),
  sitePanel: document.querySelector(".site-panel"),
  detailPanel: document.querySelector(".detail-panel"),
  siteSearch: document.getElementById("site-search"),
  siteList: document.getElementById("site-list"),
  title: document.getElementById("map-title"),
  subtitle: document.getElementById("map-subtitle"),
  liveStatus: document.getElementById("map-live-status"),
  checkLiveMap: document.getElementById("btn-check-live-map"),
  versionTools: document.getElementById("map-version-tools"),
  componentSearch: document.getElementById("component-search"),
  componentStatusFilter: document.getElementById("component-status-filter"),
  clearComponentFilter: document.getElementById("btn-clear-component-filter"),
  componentFilterSummary: document.getElementById("component-filter-summary"),
  tabs: Array.from(document.querySelectorAll(".view-tab")),
  views: {
    tree: document.getElementById("view-tree"),
    graph: document.getElementById("view-graph"),
  },
  reviewList: document.getElementById("review-list"),
  policy: document.getElementById("policy-panel"),
  detail: document.getElementById("component-detail"),
  status: document.getElementById("status-line"),
  collapseButtons: Array.from(document.querySelectorAll("[data-collapse-panel], [data-collapse-section]")),
  detailSections: Array.from(document.querySelectorAll("[data-detail-section]")),
  sectionResizers: Array.from(document.querySelectorAll("[data-resize-section]")),
};

init();

function init() {
  decorateStaticControls();
  els.refresh.addEventListener("click", refreshSelectedPageMap);
  els.mapActive.addEventListener("click", mapActivePage);
  els.checkLiveMap.addEventListener("click", () => checkSelectedPageLiveStatus({ manual: true }));
  els.siteSearch.addEventListener("input", renderSites);
  els.componentSearch.addEventListener("input", () => {
    state.componentQuery = els.componentSearch.value;
    renderFilteredComponentViews();
  });
  els.componentStatusFilter.addEventListener("change", () => {
    state.componentStatusFilter = els.componentStatusFilter.value;
    renderFilteredComponentViews();
  });
  els.clearComponentFilter.addEventListener("click", clearComponentFilter);
  els.highlightEnabled.addEventListener("change", () => {
    cancelHoverPreview();
    if (els.highlightEnabled.checked) {
      void highlightSelectedComponent();
    } else {
      void clearWebsiteHighlight();
    }
  });
  els.highlightHoverEnabled.addEventListener("change", () => {
    if (!els.highlightHoverEnabled.checked) cancelHoverPreview({ restoreSelection: true });
  });
  els.collapseButtons.forEach((button) => {
    button.addEventListener("click", () => togglePanelCollapse(button));
  });
  els.sectionResizers.forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => startDetailResize(event, handle.dataset.resizeSection));
  });
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => setView(tab.dataset.view));
  });
  renderPanelChrome();
  loadStates();
}

function decorateStaticControls() {
  decorateActionButton(els.mapActive, "map", "Map active page", "Map");
  decorateActionButton(els.refresh, "refresh", "Refresh selected page map", "Refresh");
  decorateActionButton(els.checkLiveMap, "pulse", "Check live page state", "");
  decorateActionButton(els.clearComponentFilter, "x", "Clear component filters", "");
  els.tabs.forEach((tab) => {
    const view = tab.dataset.view || "";
    decorateActionButton(tab, view === "graph" ? "graph" : "tree", `${view === "graph" ? "Graph" : "Tree"} view`, tab.textContent.trim());
  });
}

function decorateActionButton(button, icon, label, visibleLabel = "") {
  if (!button) return;
  button.setAttribute("title", label);
  button.setAttribute("aria-label", label);
  button.dataset.tooltip = label;
  button.classList.add("has-icon");
  if (!visibleLabel) button.classList.add("icon-only");
  button.innerHTML = `${iconSvg(icon)}${visibleLabel ? `<span class="button-label">${escapeHtml(visibleLabel)}</span>` : ""}`;
}

async function loadStates() {
  setStatus("Loading saved maps...");
  try {
    const response = await chrome.runtime.sendMessage({
      type: Messages.ListWorkflowMapperStates,
    });
    if (response?.ok === false) throw new Error(response.error || "Load failed.");

    state.states = response?.states || {};
    state.entries = flattenMapEntries(state.states);
    state.siteGroups = groupSiteEntries(state.entries);
    pruneInspectorResolutionState();
    if (!state.entries.some((entry) => entry.id === state.selectedEntryId)) {
      state.selectedEntryId = state.siteGroups[0]?.latest?.id || state.entries[0]?.id || "";
      state.selectedComponentId = "";
      resetGraphView();
    }
    renderAll();
    void checkSelectedPageLiveStatus();
    setStatus(`${state.siteGroups.length} saved site(s), ${state.entries.length} retained map version(s) loaded.`);
  } catch (error) {
    setStatus(`Mapper Inspector load failed: ${error.message || error}`, true);
  }
}

async function mapActivePage() {
  const workflowId = els.workflowId.value.trim();
  cancelHoverPreview();
  void clearWebsiteHighlight();
  setStatus("Mapping active page...");
  try {
    const response = await chrome.runtime.sendMessage({
      type: Messages.MapCurrentPage,
      workflowId,
    });
    if (response?.ok === false) throw new Error(response.error || "Map failed.");

    if (response.workflowId) els.workflowId.value = response.workflowId;
    state.selectedEntryId = entryId(response.workflowId, response.pageMap);
    state.selectedComponentId = "";
    resetGraphView();
    await loadStates();
    setStatus(response.deferred
      ? `Live page is dynamic-deferred; kept last usable map with ${response.pageMap?.componentCount || 0} component(s).`
      : `Mapped ${response.pageMap?.componentCount || 0} component(s).`);
  } catch (error) {
    setStatus(`Map active page failed: ${error.message || error}`, true);
  }
}

async function refreshSelectedPageMap() {
  const entry = selectedEntry();
  if (!entry) {
    await loadStates();
    return;
  }

  const previousComponentId = state.selectedComponentId;
  cancelHoverPreview();
  void clearWebsiteHighlight(entry);
  setStatus("Refreshing selected page map...");
  try {
    const response = await chrome.runtime.sendMessage({
      type: Messages.MapCurrentPage,
      workflowId: entry.workflowId,
      pageMap: entry.pageMap,
    });
    if (response?.ok === false) throw new Error(response.error || "Refresh failed.");

    state.selectedEntryId = entryId(response.workflowId, response.pageMap);
    state.selectedComponentId = previousComponentId;
    resetGraphView();
    await loadStates();
    if (!selectedComponent()) {
      state.selectedComponentId = "";
      renderAll();
    }
    void checkSelectedPageLiveStatus();
    setStatus(response.deferred
      ? `Live page is dynamic-deferred; kept last usable map with ${response.pageMap?.componentCount || 0} component(s).`
      : `Refreshed ${response.pageMap?.componentCount || 0} component(s).`);
  } catch (error) {
    setStatus(`Refresh selected page failed: ${error.message || error}`, true);
  }
}

async function checkSelectedPageLiveStatus(options = {}) {
  const entry = selectedEntry();
  if (!entry) {
    renderLiveStatus(null);
    return;
  }

  const entryKey = entry.id;
  state.liveStatusByEntry[entryKey] = {
    state: "checking",
    label: "Checking live page...",
  };
  renderLiveStatus(entry);

  try {
    const response = await chrome.runtime.sendMessage({
      type: Messages.InspectCurrentPageMap,
      workflowId: entry.workflowId,
      settings: entry.settings || {},
      pageMap: entry.pageMap,
    });
    if (response?.ok === false) throw new Error(response.error || "Live status failed.");
    if (entryKey !== state.selectedEntryId) return;

    state.liveStatusByEntry[entryKey] = liveStatusFromResponse(response);
    renderLiveStatus(entry);
    if (options.manual) {
      setStatus(`Live map status: ${state.liveStatusByEntry[entryKey].label}`);
    }
  } catch (error) {
    if (entryKey !== state.selectedEntryId) return;
    state.liveStatusByEntry[entryKey] = {
      state: "error",
      label: "Live check failed",
      detail: error.message || String(error),
    };
    renderLiveStatus(entry);
    if (options.manual) {
      setStatus(`Live map check failed: ${error.message || error}`, true);
    }
  }
}

function liveStatusFromResponse(response = {}) {
  const live = response.live || {};
  const saved = response.saved || {};
  const mutationCount = Number(live.materialMutationCount) || 0;
  if (live.classification === "dynamic_deferred") {
    return {
      state: "dynamic",
      label: `Dynamic deferred${mutationCount ? ` | ${mutationCount} mutations` : ""}`,
      detail: response.reason || "dynamic_deferred",
    };
  }
  if (!response.stale) {
    return {
      state: "current",
      label: `Live current | ${live.componentCount || 0} components`,
      detail: response.reason || "current",
    };
  }
  const countChanged = live.componentCount !== saved.componentCount
    ? `${saved.componentCount || 0} -> ${live.componentCount || 0} components`
    : `${live.componentCount || 0} components`;
  return {
    state: "stale",
    label: `Refresh recommended | ${countChanged}`,
    detail: response.reason || "changed",
  };
}

function flattenMapEntries(states = {}) {
  const entries = [];
  Object.values(states).forEach((workflowState) => {
    const maps = retainRecentPageMaps(workflowState?.maps || [], workflowState?.settings || {});
    maps.forEach((pageMap) => {
      entries.push({
        id: entryId(workflowState.workflowId, pageMap),
        workflowId: workflowState.workflowId,
        settings: workflowState.settings || {},
        pageMap,
      });
    });
  });

  return entries.sort((a, b) => {
    return String(b.pageMap.createdAt || "").localeCompare(String(a.pageMap.createdAt || ""));
  });
}

function retainRecentPageMaps(maps = [], settings = {}) {
  const maxVersions = clampNumber(settings.maxVersions, 1, 3, 3);
  const groups = groupBy(maps, (map) => map.pageProfileKey || map.siteKey || map.mapVersionId || "unknown");
  return Object.values(groups).flatMap((group) => {
    const usable = group.filter(isUsablePageMap);
    const candidates = usable.length ? usable : group;
    return candidates
      .slice()
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))
      .slice(-maxVersions);
  });
}

function isUsablePageMap(map = {}) {
  return map.status !== "unsupported" &&
    map.classification !== "dynamic_deferred" &&
    (map.components || []).length > 0;
}

function groupSiteEntries(entries = []) {
  const groups = groupBy(entries, siteGroupKey);
  return Object.entries(groups)
    .map(([key, groupEntries]) => {
      const sorted = groupEntries.slice().sort((a, b) => {
        return String(b.pageMap.createdAt || "").localeCompare(String(a.pageMap.createdAt || ""));
      });
      const latest = sorted[0] || null;
      const siteKeys = new Set(sorted.map((entry) => entry.pageMap.siteKey).filter(Boolean));
      const pageKeys = new Set(sorted.map((entry) => entry.pageMap.pageProfileKey).filter(Boolean));
      const workflowIds = new Set(sorted.map((entry) => entry.workflowId).filter(Boolean));
      return {
        key,
        latest,
        entries: sorted,
        siteCount: siteKeys.size,
        pageCount: pageKeys.size,
        workflowCount: workflowIds.size,
        componentCount: latest?.pageMap?.componentCount || latest?.pageMap?.components?.length || 0,
      };
    })
    .sort((a, b) => {
      return String(b.latest?.pageMap?.createdAt || "").localeCompare(String(a.latest?.pageMap?.createdAt || ""));
    });
}

function siteGroupKey(entry = {}) {
  const map = entry.pageMap || {};
  return normalizeIdentifier(baseSiteName(map) || entry.workflowId || "unknown-site");
}

function baseSiteName(map = {}) {
  const raw = map.hostname || map.origin || map.siteKey || "";
  if (!raw) return "";
  let value = String(raw).trim().toLowerCase();
  try {
    value = new URL(value.includes("://") ? value : `https://${value}`).hostname;
  } catch {
    value = value.replace(/^https?:\/\//, "").split(/[/?#]/)[0];
  }
  value = value.replace(/^www\./, "").replace(/^www_/, "");
  return value || map.siteKey || "";
}

function selectedSiteGroup() {
  return state.siteGroups.find((group) => {
    return group.entries.some((entry) => entry.id === state.selectedEntryId);
  }) || null;
}

function entryId(workflowId = "", pageMap = {}) {
  return `${workflowId}::${pageMap.mapVersionId || ""}`;
}

function selectedEntry() {
  return state.entries.find((entry) => entry.id === state.selectedEntryId) || null;
}

function selectedComponent() {
  const entry = selectedEntry();
  return (entry?.pageMap?.components || []).find((component) => {
    return component.componentId === state.selectedComponentId;
  }) || null;
}

function selectedFilteredComponents() {
  return filterComponents(selectedEntry());
}

function filterComponents(entry = null, options = {}) {
  const components = sortComponentsByVisualOrder(entry?.pageMap?.components || []);
  const query = normalizeText(state.componentQuery);
  const statusFilter = normalizeText(state.componentStatusFilter);
  const includeRemoved = options.includeRemoved === true;
  return components.filter((component) => {
    const status = normalizeText(component.status || "unknown");
    if (
      status === "removed" &&
      !includeRemoved &&
      statusFilter !== "removed" &&
      statusFilter !== "review"
    ) {
      return false;
    }
    const statusMatches = !statusFilter ||
      statusFilter === status ||
      (statusFilter === "review" && (
        component.reviewRequired ||
        ["ambiguous", "changed", "removed"].includes(status)
      ));
    if (!statusMatches) return false;
    if (!query) return true;
    return componentSearchText(component).includes(query);
  });
}

function sortComponentsByVisualOrder(components = []) {
  return components.slice().sort(compareComponentsByVisualOrder);
}

function compareComponentsByVisualOrder(a = {}, b = {}) {
  const aBounds = visualOrderBounds(a);
  const bBounds = visualOrderBounds(b);
  if (aBounds.hasPosition && bBounds.hasPosition) {
    const yDelta = aBounds.y - bBounds.y;
    if (Math.abs(yDelta) > 4) return yDelta;
    const xDelta = aBounds.x - bBounds.x;
    if (Math.abs(xDelta) > 4) return xDelta;
  } else if (aBounds.hasPosition !== bBounds.hasPosition) {
    return aBounds.hasPosition ? -1 : 1;
  }

  const captureOrderDelta = visualOrderIndex(a) - visualOrderIndex(b);
  if (captureOrderDelta) return captureOrderDelta;

  const aPath = visualOrderPath(a);
  const bPath = visualOrderPath(b);
  if (aPath !== bPath) return aPath.localeCompare(bPath);

  return String(a.componentId || "").localeCompare(String(b.componentId || ""));
}

function visualOrderBounds(component = {}) {
  const visual = component.fingerprint?.visual || {};
  const bounds = visual.documentBounds || visual.bounds || visual.viewportBounds || {};
  return {
    x: Number.isFinite(Number(bounds.x ?? bounds.left)) ? Number(bounds.x ?? bounds.left) : Number.MAX_SAFE_INTEGER,
    y: Number.isFinite(Number(bounds.y ?? bounds.top)) ? Number(bounds.y ?? bounds.top) : Number.MAX_SAFE_INTEGER,
    hasPosition: Number.isFinite(Number(bounds.x ?? bounds.left)) && Number.isFinite(Number(bounds.y ?? bounds.top)),
  };
}

function visualOrderIndex(component = {}) {
  const index = Number(component.captureOrder);
  return Number.isFinite(index) ? index : Number.MAX_SAFE_INTEGER;
}

function visualOrderPath(component = {}) {
  return String(component.fingerprint?.technical?.domPath || component.componentId || component.componentUid || "");
}

function componentSearchText(component = {}) {
  const semantic = component.fingerprint?.semantic || {};
  const behavioral = component.fingerprint?.behavioral || {};
  const technical = component.fingerprint?.technical || {};
  return normalizeText([
    component.componentId,
    component.componentUid,
    component.displayAlias,
    component.displayName,
    componentShortName(component),
    componentIsHidden(component) ? "hidden invisible not visible" : "",
    component.status,
    component.reviewRequired ? "review required" : "",
    semantic.role,
    semantic.accessibleName,
    semantic.altText,
    semantic.labelText,
    semantic.stableText,
    semantic.placeholder,
    semantic.title,
    semantic.name,
    ...Object.values(semantic.stableAttributes || {}),
    behavioral.href,
    technical.tag,
    technical.id,
    ...(technical.classes || []),
    component.primaryLocator?.value,
    ...(component.fallbackLocators || []).map((locator) => locator.value),
    componentRegionName(component),
    componentTypeGroupName(component),
    ...(component.expectedCapabilities || []),
  ].join(" "));
}

function componentFilterSummaryText(components = [], filteredComponents = []) {
  if (!components.length) return "0 components";
  if (filteredComponents.length === components.length) {
    return `${components.length} components`;
  }
  return `${filteredComponents.length} of ${components.length} components`;
}

function clearComponentFilter() {
  state.componentQuery = "";
  state.componentStatusFilter = "";
  els.componentSearch.value = "";
  els.componentStatusFilter.value = "";
  renderFilteredComponentViews();
}

function togglePanelCollapse(button) {
  const key = button.dataset.collapsePanel || button.dataset.collapseSection || "";
  if (!key || !Object.prototype.hasOwnProperty.call(state.collapsedPanels, key)) return;
  state.collapsedPanels[key] = !state.collapsedPanels[key];
  renderPanelChrome();
}

function renderPanelChrome() {
  document.body.classList.toggle("site-panel-collapsed", state.collapsedPanels.sites);
  document.body.classList.toggle("detail-panel-collapsed", state.collapsedPanels.details);
  els.sitePanel?.classList.toggle("collapsed", state.collapsedPanels.sites);
  els.detailPanel?.classList.toggle("collapsed", state.collapsedPanels.details);
  els.detailSections.forEach((section) => {
    const key = section.dataset.detailSection || "";
    section.classList.toggle("collapsed", Boolean(state.collapsedPanels[key]));
  });
  els.sectionResizers.forEach((handle) => {
    const key = handle.dataset.resizeSection || "";
    handle.hidden = Boolean(state.collapsedPanels.details || state.collapsedPanels[key]);
  });
  els.collapseButtons.forEach((button) => {
    const key = button.dataset.collapsePanel || button.dataset.collapseSection || "";
    const collapsed = Boolean(state.collapsedPanels[key]);
    button.innerHTML = iconSvg("chevron");
    button.classList.toggle("collapsed", collapsed);
    button.setAttribute("aria-expanded", String(!collapsed));
    const label = `${collapsed ? "Expand" : "Collapse"} ${panelLabel(key)}`;
    button.setAttribute("title", label);
    button.setAttribute("aria-label", label);
    button.dataset.tooltip = label;
  });
  renderDetailSectionSizes();
}

function panelLabel(key = "") {
  if (key === "sites") return "websites";
  if (key === "details") return "details";
  if (key === "review") return "review queue";
  if (key === "component") return "component details";
  return key || "panel";
}

function renderDetailSectionSizes() {
  els.detailSections.forEach((section) => {
    const key = section.dataset.detailSection || "";
    if (key === "policy" || key === "review") {
      section.style.flexBasis = state.collapsedPanels[key]
        ? ""
        : `${state.detailSectionSizes[key]}px`;
    }
  });
}

function startDetailResize(event, sectionKey = "") {
  if (!["policy", "review"].includes(sectionKey) || state.collapsedPanels.details) return;
  const section = els.detailSections.find((item) => item.dataset.detailSection === sectionKey);
  if (!section || state.collapsedPanels[sectionKey]) return;

  const startY = event.clientY;
  const startHeight = section.getBoundingClientRect().height;
  const pointerId = event.pointerId;
  event.preventDefault();
  event.currentTarget.setPointerCapture?.(pointerId);
  document.body.classList.add("resizing-detail-section");

  const onMove = (moveEvent) => {
    const nextHeight = clampNumber(startHeight + moveEvent.clientY - startY, 72, 460, startHeight);
    state.detailSectionSizes[sectionKey] = nextHeight;
    renderDetailSectionSizes();
  };
  const onEnd = () => {
    document.body.classList.remove("resizing-detail-section");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onEnd);
    window.removeEventListener("pointercancel", onEnd);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onEnd, { once: true });
  window.addEventListener("pointercancel", onEnd, { once: true });
}

function renderAll() {
  renderSites();
  renderSelectedMap();
  renderPolicyPanel();
  renderReviewQueue();
  renderDetail();
}

function renderFilteredComponentViews() {
  const entry = selectedEntry();
  if (entry && state.selectedComponentId) {
    const visible = filterComponents(entry).some((component) => {
      return component.componentId === state.selectedComponentId;
    });
    if (!visible) state.selectedComponentId = "";
  }
  renderSelectedMap();
  renderReviewQueue();
  renderDetail();
}

function renderSites() {
  const query = normalizeText(els.siteSearch.value);
  const groups = state.siteGroups.filter((group) => {
    const latest = group.latest || {};
    const entriesText = group.entries.map((entry) => [
      entry.workflowId,
      entry.pageMap.hostname,
      entry.pageMap.path,
      entry.pageMap.title,
      entry.pageMap.status,
    ].join(" ")).join(" ");
    const haystack = normalizeText([
      group.key,
      latest.workflowId,
      latest.pageMap?.hostname,
      latest.pageMap?.siteKey,
      entriesText,
    ].join(" "));
    return !query || haystack.includes(query);
  });

  if (!groups.length) {
    els.siteList.innerHTML = `<div class="empty-state">No saved sites.</div>`;
    return;
  }

  els.siteList.innerHTML = groups.map((group) => {
    const entry = group.latest;
    const map = entry?.pageMap || {};
    const active = group.entries.some((item) => item.id === state.selectedEntryId);
    const siteLabel = map.hostname || map.siteKey || "Unknown site";
    return `
      <div class="site-card ${active ? "active" : ""}">
        <button class="site-card-main" data-site-key="${escapeAttr(group.key)}" type="button">
          <span class="site-title">${escapeHtml(siteLabel)}</span>
          <span class="site-meta">${group.entries.length} retained version(s) | ${group.pageCount || 1} page profile(s)</span>
          <span class="site-meta">${escapeHtml(map.path || "/")} | ${group.componentCount || 0} components | ${escapeHtml(map.status || "")}</span>
        </button>
        ${iconButtonHtml({
          icon: "trash",
          label: `Delete saved site ${siteLabel}`,
          className: "icon-button danger-icon site-delete-button",
          attrs: `data-delete-site-key="${escapeAttr(group.key)}"`,
        })}
      </div>
    `;
  }).join("");

  els.siteList.querySelectorAll("[data-site-key]").forEach((button) => {
    button.addEventListener("click", () => {
      const previousEntry = selectedEntry();
      const group = state.siteGroups.find((item) => item.key === button.dataset.siteKey);
      cancelHoverPreview();
      void clearWebsiteHighlight(previousEntry);
      state.selectedEntryId = group?.latest?.id || "";
      state.selectedComponentId = "";
      resetGraphView();
      renderAll();
      void checkSelectedPageLiveStatus();
    });
  });
  els.siteList.querySelectorAll("[data-delete-site-key]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      void deleteSiteGroup(button.dataset.deleteSiteKey || "");
    });
  });
}

function renderSelectedMap() {
  const entry = selectedEntry();
  if (!entry) {
    els.title.textContent = "No map selected";
    els.subtitle.textContent = "Record or map a page to inspect components.";
    renderLiveStatus(null);
    els.versionTools.innerHTML = "";
    els.componentFilterSummary.textContent = "0 components";
    Object.values(els.views).forEach((view) => {
      view.innerHTML = `<div class="empty-state">No map selected.</div>`;
    });
    return;
  }

  const map = entry.pageMap;
  const components = sortComponentsByVisualOrder(map.components || []);
  const filteredComponents = selectedFilteredComponents();
  renderVersionTools(entry);
  els.title.textContent = map.title || map.hostname || "Saved map";
  els.subtitle.textContent = mapSubtitle(map);
  renderLiveStatus(entry);
  els.componentFilterSummary.textContent = componentFilterSummaryText(components, filteredComponents);

  renderTree(entry, filteredComponents);
  renderGraph(entry, filteredComponents);
}

function renderLiveStatus(entry = selectedEntry()) {
  if (!els.liveStatus || !els.checkLiveMap) return;
  if (!entry) {
    els.liveStatus.textContent = "Live status not checked";
    els.liveStatus.className = "map-live-status idle";
    els.liveStatus.title = "";
    els.checkLiveMap.disabled = true;
    return;
  }

  const status = state.liveStatusByEntry[entry.id] || {
    state: "idle",
    label: "Live status not checked",
    detail: "",
  };
  els.liveStatus.textContent = status.label;
  els.liveStatus.title = status.detail || "";
  els.liveStatus.className = `map-live-status ${normalizeIdentifier(status.state || "idle") || "idle"}`;
  els.checkLiveMap.disabled = status.state === "checking";
}

function mapSubtitle(map = {}) {
  const mutationCount = Number(map.diagnostics?.materialMutationCount) || 0;
  return [
    `${map.hostname || ""}${map.path || ""}`,
    map.status || "unknown",
    mutationCount ? `${mutationCount} material mutation(s)` : "",
    map.diagnostics?.reason || "",
    map.mapVersionId || "",
  ].filter(Boolean).join(" | ");
}

function renderVersionTools(entry) {
  const group = selectedSiteGroup();
  if (!group?.entries?.length) {
    els.versionTools.innerHTML = "";
    return;
  }
  const pageGroups = pageGroupsForSite(group);
  const currentPageKey = pageEntryKey(entry);
  const currentPageGroup = pageGroups.find((pageGroup) => pageGroup.key === currentPageKey) || pageGroups[0];
  const versionEntries = currentPageGroup?.entries || group.entries;

  els.versionTools.innerHTML = `
    <label class="map-picker page-picker">
      <span>Page</span>
      <select id="map-page-select" aria-label="Saved page">
        ${pageGroups.map((pageGroup) => {
          return `
            <option value="${escapeAttr(pageGroup.key)}" ${pageGroup.key === currentPageGroup?.key ? "selected" : ""}>
              ${escapeHtml(pageLabel(pageGroup.latest))}
            </option>
          `;
        }).join("")}
      </select>
    </label>
    <label class="map-picker version-picker">
      <span>Version</span>
      <select id="map-version-select" aria-label="Map version">
        ${versionEntries.map((item) => {
          return `
            <option value="${escapeAttr(item.id)}" ${item.id === state.selectedEntryId ? "selected" : ""}>
              ${escapeHtml(versionLabel(item))}
            </option>
          `;
        }).join("")}
      </select>
    </label>
    ${iconButtonHtml({
      id: "btn-delete-map-version",
      icon: "trash",
      label: "Delete selected map version",
      className: "icon-button danger-icon",
    })}
    ${iconButtonHtml({
      id: "btn-delete-site",
      icon: "trash-site",
      label: "Delete all saved pages and versions for this site",
      className: "icon-button danger-icon",
    })}
  `;

  document.getElementById("map-page-select")?.addEventListener("change", (event) => {
    const previousEntry = selectedEntry();
    const pageGroup = pageGroups.find((item) => item.key === event.target.value);
    cancelHoverPreview();
    void clearWebsiteHighlight(previousEntry);
    state.selectedEntryId = pageGroup?.latest?.id || "";
    state.selectedComponentId = "";
    resetGraphView();
    renderAll();
    void checkSelectedPageLiveStatus();
  });
  document.getElementById("map-version-select")?.addEventListener("change", (event) => {
    const previousEntry = selectedEntry();
    cancelHoverPreview();
    void clearWebsiteHighlight(previousEntry);
    state.selectedEntryId = event.target.value;
    state.selectedComponentId = "";
    resetGraphView();
    renderAll();
    void checkSelectedPageLiveStatus();
  });
  document.getElementById("btn-delete-map-version")?.addEventListener("click", deleteSelectedMapVersion);
  document.getElementById("btn-delete-site")?.addEventListener("click", () => {
    void deleteSiteGroup(group.key);
  });
}

async function deleteSelectedMapVersion() {
  const entry = selectedEntry();
  if (!entry) return;

  const label = versionLabel(entry);
  const confirmed = window.confirm(`Delete saved mapper version?\n\n${label}`);
  if (!confirmed) return;

  const nextEntryId = nextEntryIdAfterDelete(entry);
  cancelHoverPreview();
  void clearWebsiteHighlight(entry);

  try {
    await updateSelectedWorkflowState((workflowState) => ({
      ...workflowState,
      maps: (workflowState.maps || []).filter((pageMap) => {
        return pageMap.mapVersionId !== entry.pageMap.mapVersionId;
      }),
    }), {
      nextEntryId,
      nextComponentId: "",
    });
    setStatus(nextEntryId ? "Saved mapper version deleted." : "Saved mapper version deleted. No saved maps remain.");
    void checkSelectedPageLiveStatus();
  } catch (error) {
    setStatus(`Delete saved mapper version failed: ${error.message || error}`, true);
  }
}

async function deleteSiteGroup(siteKey = "") {
  const group = state.siteGroups.find((item) => item.key === siteKey) || selectedSiteGroup();
  if (!group?.entries?.length) return;

  const latestMap = group.latest?.pageMap || {};
  const siteLabel = latestMap.hostname || latestMap.siteKey || group.key || "saved site";
  const confirmed = window.confirm(
    `Delete saved mapper site?\n\n${siteLabel}\n${group.pageCount || 1} page profile(s), ${group.entries.length} retained version(s)`,
  );
  if (!confirmed) return;

  const previousEntry = selectedEntry();
  cancelHoverPreview();
  void clearWebsiteHighlight(previousEntry);

  try {
    const workflowIds = Array.from(new Set(group.entries.map((entry) => entry.workflowId).filter(Boolean)));
    for (const workflowId of workflowIds) {
      const current = state.states[workflowId];
      if (!current) continue;
      const nextState = pruneWorkflowMapperState({
        ...structuredClone(current),
        maps: (current.maps || []).filter((pageMap) => {
          return siteGroupKey({ workflowId, pageMap }) !== group.key;
        }),
      });
      const response = await chrome.runtime.sendMessage({
        type: Messages.SaveWorkflowMapperState,
        workflowId,
        state: nextState,
      });
      if (response?.ok === false) throw new Error(response.error || "Save failed.");
      state.states[workflowId] = response.state || nextState;
    }

    state.entries = flattenMapEntries(state.states);
    state.siteGroups = groupSiteEntries(state.entries);
    pruneInspectorResolutionState();
    state.selectedEntryId = state.siteGroups[0]?.latest?.id || state.entries[0]?.id || "";
    state.selectedComponentId = "";
    resetGraphView();
    renderAll();
    setStatus(state.selectedEntryId ? "Saved mapper site deleted." : "Saved mapper site deleted. No saved maps remain.");
    void checkSelectedPageLiveStatus();
  } catch (error) {
    setStatus(`Delete saved mapper site failed: ${error.message || error}`, true);
  }
}

function nextEntryIdAfterDelete(entry = {}) {
  const remaining = state.entries.filter((item) => item.id !== entry.id);
  const samePage = remaining.filter((item) => {
    return item.workflowId === entry.workflowId &&
      item.pageMap?.pageProfileKey === entry.pageMap?.pageProfileKey;
  });
  if (samePage[0]?.id) return samePage[0].id;

  const currentSiteKey = siteGroupKey(entry);
  const sameSite = remaining.filter((item) => siteGroupKey(item) === currentSiteKey);
  return sameSite[0]?.id || remaining[0]?.id || "";
}

function pageGroupsForSite(group = {}) {
  return Object.entries(groupBy(group.entries || [], pageEntryKey))
    .map(([key, entries]) => {
      const sorted = entries.slice().sort((a, b) => {
        return String(b.pageMap.createdAt || "").localeCompare(String(a.pageMap.createdAt || ""));
      });
      return {
        key,
        entries: sorted,
        latest: sorted[0] || null,
      };
    })
    .sort((a, b) => {
      return String(b.latest?.pageMap?.createdAt || "").localeCompare(String(a.latest?.pageMap?.createdAt || ""));
    });
}

function pageEntryKey(entry = {}) {
  return entry.pageMap?.pageProfileKey || entry.id || "unknown-page";
}

function pageLabel(entry = {}) {
  const map = entry.pageMap || {};
  const path = map.path || pagePathFromProfileKey(map.pageProfileKey) || "/";
  const title = map.title && map.title !== path ? ` | ${map.title}` : "";
  return `${path}${title}`;
}

function pagePathFromProfileKey(pageProfileKey = "") {
  const [, page = "", query = ""] = String(pageProfileKey || "").split("::");
  if (!page || page === "home") return "/";
  const path = `/${page.replace(/_+/g, "/")}`;
  return query ? `${path}?${query.replace(/_+/g, "=")}` : path;
}

function versionLabel(entry = {}) {
  const map = entry.pageMap || {};
  const created = String(map.createdAt || "").replace("T", " ").slice(0, 16);
  const status = map.status || "unknown";
  const count = map.componentCount || map.components?.length || 0;
  return `${status} | ${count} component(s) | ${created || map.mapVersionId || ""}`;
}

function renderPolicyPanel() {
  const entry = selectedEntry();
  if (!entry) {
    els.policy.innerHTML = `<div class="empty-state">No map selected.</div>`;
    return;
  }

  const settings = entry.settings || {};
  const map = entry.pageMap || {};
  const siteOverride = settings.siteOverrides?.[map.siteKey] || {};
  const pageOverride = settings.pageOverrides?.[map.pageProfileKey] || {};
  const effective = effectivePolicy(entry);
  const sensitive = isSensitiveEntry(entry);

  els.policy.innerHTML = `
    <div class="policy-grid">
      <div>
        <span class="badge ${sensitive ? "sensitive-badge" : ""}">${sensitive ? "sensitive" : "normal"}</span>
        <span class="badge">${escapeHtml(effective.mode || "automatic")}</span>
      </div>
      <label>
        Query allowlist
        <input id="policy-query-allowlist" type="text" value="${escapeAttr((settings.queryAllowlist || []).join(", "))}">
      </label>
      <label>
        Max components
        <input id="policy-max-components" type="number" min="1" max="2000" value="${Number(settings.maxComponents) || 500}">
      </label>
      <label>
        Mutation limit
        <input id="policy-mutation-limit" type="number" min="1" max="500" value="${Number(settings.materialMutationLimit) || 50}">
      </label>
      <label>
        Site sensitivity
        <select id="policy-site-sensitive">
          <option value="false" ${siteOverride.sensitive === true ? "" : "selected"}>Normal</option>
          <option value="true" ${siteOverride.sensitive === true ? "selected" : ""}>Sensitive</option>
        </select>
      </label>
      <button id="btn-save-policy" type="button">Save policy</button>
    </div>
  `;

  document.getElementById("btn-save-policy")?.addEventListener("click", savePolicy);
}

function renderTree(entry, filteredComponents = filterComponents(entry)) {
  const map = entry.pageMap;
  const components = sortComponentsByVisualOrder(map.components || []);
  const siteNodeKey = treeNodeKey("site", entry.id);
  const pageNodeKey = treeNodeKey("page", entry.id, map.pageProfileKey || map.path || "/");
  const treeContent = filteredComponents.length
    ? renderTreeModeContent(filteredComponents, pageNodeKey)
    : `<div class="empty-state">No components match the current filter.</div>`;

  els.views.tree.innerHTML = `
    <div class="tree-controls">
      <div class="tree-mode-group" role="group" aria-label="Tree grouping">
        ${treeModeButtonHtml("structure", "Structure")}
        ${treeModeButtonHtml("regions", "Regions")}
        ${treeModeButtonHtml("types", "Types")}
      </div>
      ${renderMapLegend()}
    </div>
    <div class="tree-explorer" role="tree">
      ${treeNodeHtml({
        key: siteNodeKey,
        level: 0,
        title: map.hostname || map.siteKey || "Unknown site",
        meta: map.origin || "",
        icon: "site",
        collapsible: true,
      })}
      ${treeChildrenHtml(siteNodeKey, `
        ${treeNodeHtml({
          key: pageNodeKey,
          level: 1,
          title: map.path || "/",
          meta: `${map.classification || "page"} | ${filteredComponents.length}/${components.length} records`,
          icon: "page",
          collapsible: true,
        })}
        ${treeChildrenHtml(pageNodeKey, treeContent)}
      `)}
    </div>
  `;

  wireTreeModeButtons(els.views.tree);
  wireTreeToggles(els.views.tree);
  wireComponentRows(els.views.tree);
}

function treeModeButtonHtml(mode, label) {
  return `
    <button class="tree-mode-button ${state.treeMode === mode ? "active" : ""}"
      data-tree-mode="${escapeAttr(mode)}" type="button">
      ${escapeHtml(label)}
    </button>
  `;
}

function wireTreeModeButtons(root) {
  root.querySelectorAll("[data-tree-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.treeMode = button.dataset.treeMode || "structure";
      renderSelectedMap();
    });
  });
}

function renderTreeModeContent(components = [], parentKey = "") {
  if (state.treeMode === "types") {
    return renderGroupedComponentTree(components, componentTypeGroupName, "element", parentKey);
  }
  if (state.treeMode === "regions") {
    return renderGroupedComponentTree(components, componentRegionName, "region", parentKey);
  }
  return renderStructureTree(components, parentKey);
}

function renderGroupedComponentTree(components = [], groupNameFn, groupIcon = "region", parentKey = "") {
  const groups = groupBy(sortComponentsByVisualOrder(components), groupNameFn);
  return Object.entries(groups).map(([groupName, group]) => {
    const groupKey = treeNodeKey(parentKey, state.treeMode, groupName);
    return `
      ${treeNodeHtml({
        key: groupKey,
        level: 2,
        title: groupName,
        meta: `${group.length} element(s)`,
        icon: groupIcon,
        collapsible: true,
      })}
      ${treeChildrenHtml(groupKey, group.map((component) => componentTreeRowHtml(component, 3)).join(""))}
    `;
  }).join("");
}

function renderStructureTree(components = [], parentKey = "") {
  const root = createStructureNode("document", "document", 1);
  sortComponentsByVisualOrder(components).forEach((component) => insertComponentIntoStructure(root, component));
  return root.children.map((node) => structureNodeHtml(node, 2, parentKey)).join("");
}

function renderGraph(entry, filteredComponents = filterComponents(entry)) {
  const graph = buildInspectorGraph(entry, filteredComponents);

  els.views.graph.innerHTML = `
    <div class="graph-shell">
      <div class="graph-controls">
        ${iconButtonHtml({ icon: "fit", label: "Fit graph", className: "icon-button", attrs: `data-graph-action="fit"` })}
        ${iconButtonHtml({ icon: "reset", label: "Reset graph pan and zoom", className: "icon-button", attrs: `data-graph-action="reset"` })}
        ${iconButtonHtml({ icon: "minus", label: "Zoom out", className: "icon-button", attrs: `data-graph-action="zoom-out"` })}
        <span data-graph-zoom>${Math.round(state.graphView.scale * 100)}%</span>
        ${iconButtonHtml({ icon: "plus", label: "Zoom in", className: "icon-button", attrs: `data-graph-action="zoom-in"` })}
        <span class="graph-summary">${graph.componentCount}/${graph.totalComponentCount} elements | ${graph.reviewCount} review</span>
        ${renderMapLegend()}
      </div>
      <div class="graph-viewport" data-graph-viewport>
        <div class="graph-world" data-graph-world style="width: ${graph.width}px; height: ${graph.height}px;">
          <svg class="graph-edges" width="${graph.width}" height="${graph.height}" aria-hidden="true">
            ${graph.edges.map(graphEdgeHtml).join("")}
          </svg>
          ${graph.nodes.map(graphNodeHtml).join("")}
        </div>
      </div>
    </div>
  `;

  wireComponentRows(els.views.graph);
  wireGraphCanvas(els.views.graph, graph);
}

function buildInspectorGraph(entry, filteredComponents = null) {
  const map = entry.pageMap || {};
  const allComponents = sortComponentsByVisualOrder(map.components || []);
  const components = sortComponentsByVisualOrder(filteredComponents || allComponents);
  const regionGroups = Object.entries(groupBy(components, componentRegionName));
  const nodes = [];
  const edges = [];
  const nodeById = new Map();
  const size = {
    site: { width: 240, height: 64 },
    page: { width: 240, height: 64 },
    region: { width: 210, height: 58 },
    component: { width: 250, height: 70 },
  };
  const gapX = 52;
  const gapY = 28;
  const top = 48;
  const pageY = top + size.site.height + 48;
  const regionY = pageY + size.page.height + 58;
  const componentY = regionY + size.region.height + gapY;

  const addNode = (node) => {
    nodes.push(node);
    nodeById.set(node.id, node);
    return node;
  };
  const addEdge = (fromId, toId) => {
    const from = nodeById.get(fromId);
    const to = nodeById.get(toId);
    if (from && to) edges.push({ from, to });
  };

  const componentNodesByRegion = regionGroups.map(([region, group], index) => {
    const groupWidth = Math.max(size.region.width, size.component.width);
    const groupX = 48 + index * (groupWidth + gapX);
    const componentX = groupX + Math.round((groupWidth - size.component.width) / 2);
    const regionX = groupX + Math.round((groupWidth - size.region.width) / 2);
    const regionNode = addNode({
      id: `region:${index}`,
      kind: "region",
      x: regionX,
      y: regionY,
      ...size.region,
      title: region,
      meta: `${group.length} element(s)`,
    });
    const componentNodes = group.map((component, componentIndex) => {
      const node = addNode({
        id: `component:${component.componentId}`,
        kind: "component",
        x: componentX,
        y: componentY + componentIndex * (size.component.height + gapY),
        ...size.component,
        title: componentShortName(component),
        meta: `${component.status || "unknown"} | ${component.componentId || ""}`,
        status: component.status || "unknown",
        reviewRequired: component.reviewRequired === true,
        hidden: componentIsHidden(component),
        componentId: component.componentId,
      });
      return node;
    });
    return { regionNode, componentNodes };
  });

  const longestRegion = Math.max(0, ...regionGroups.map(([, group]) => group.length));
  const regionCount = Math.max(regionGroups.length, 1);
  const totalWidth = Math.max(
    720,
    96 + regionCount * Math.max(size.region.width, size.component.width) + Math.max(0, regionCount - 1) * gapX,
  );
  const totalHeight = Math.max(
    420,
    componentY + longestRegion * (size.component.height + gapY) + 48,
  );
  const centerX = Math.round(totalWidth / 2);
  const siteNode = addNode({
    id: "site",
    kind: "site",
    x: centerX - Math.round(size.site.width / 2),
    y: top,
    ...size.site,
    title: map.hostname || map.siteKey || "Website",
    meta: entry.workflowId || "",
  });
  const pageNode = addNode({
    id: "page",
    kind: "page",
    x: centerX - Math.round(size.page.width / 2),
    y: pageY,
    ...size.page,
    title: map.path || "/",
    meta: `${map.status || "unknown"} | ${map.classification || "page"}`,
  });

  addEdge(siteNode.id, pageNode.id);
  componentNodesByRegion.forEach(({ regionNode, componentNodes }) => {
    addEdge(pageNode.id, regionNode.id);
    componentNodes.forEach((componentNode) => addEdge(regionNode.id, componentNode.id));
  });

  return {
    nodes,
    edges,
    width: totalWidth,
    height: totalHeight,
    componentCount: components.length,
    totalComponentCount: allComponents.length,
    reviewCount: components.filter((component) => component.reviewRequired).length,
  };
}

function graphNodeHtml(node) {
  const active = node.componentId === state.selectedComponentId;
  const classes = [
    "graph-node",
    `graph-node-${node.kind}`,
    node.componentId ? "selectable" : "",
    active ? "active" : "",
    node.reviewRequired ? "review-required" : "",
    node.hidden ? "hidden-component" : "",
  ].filter(Boolean).join(" ");
  const style = `left: ${node.x}px; top: ${node.y}px; width: ${node.width}px; min-height: ${node.height}px;`;
  const body = `
    <span class="graph-port graph-port-in" aria-hidden="true"></span>
    <span class="graph-port graph-port-out" aria-hidden="true"></span>
    <span class="row-title">${escapeHtml(node.title)}</span>
    <span class="row-meta">${node.componentId ? `${componentStatusLineHtml({ status: node.status, componentId: node.componentId }, node.hidden)}` : escapeHtml(node.meta)}</span>
  `;

  if (node.componentId) {
    return `
      <button class="${classes}" style="${style}" data-component-id="${escapeAttr(node.componentId)}" type="button">
        ${body}
      </button>
    `;
  }

  return `<div class="${classes}" style="${style}">${body}</div>`;
}

function graphEdgeHtml(edge) {
  const startX = edge.from.x + edge.from.width / 2;
  const startY = edge.from.y + edge.from.height;
  const endX = edge.to.x + edge.to.width / 2;
  const endY = edge.to.y;
  const midY = Math.round(startY + Math.max(26, (endY - startY) / 2));
  const path = `M ${startX} ${startY} V ${midY} H ${endX} V ${endY}`;
  return `<path class="graph-edge" d="${path}"></path>`;
}

function wireGraphCanvas(root, graph) {
  applyGraphTransform(root);
  root.querySelectorAll("[data-graph-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.graphAction;
      if (action === "fit") fitGraphToViewport(root, graph);
      if (action === "reset") {
        resetGraphView();
        applyGraphTransform(root);
      }
      if (action === "zoom-in") zoomGraph(root, 1.15);
      if (action === "zoom-out") zoomGraph(root, 1 / 1.15);
    });
  });

  const viewport = root.querySelector("[data-graph-viewport]");
  if (!viewport) return;

  viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomGraph(root, event.deltaY < 0 ? 1.08 : 1 / 1.08);
  }, { passive: false });

  viewport.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    state.graphView.dragging = true;
    state.graphView.dragX = event.clientX;
    state.graphView.dragY = event.clientY;
    viewport.setPointerCapture?.(event.pointerId);
    viewport.classList.add("panning");
  });

  viewport.addEventListener("pointermove", (event) => {
    if (!state.graphView.dragging) return;
    state.graphView.panX += event.clientX - state.graphView.dragX;
    state.graphView.panY += event.clientY - state.graphView.dragY;
    state.graphView.dragX = event.clientX;
    state.graphView.dragY = event.clientY;
    applyGraphTransform(root);
  });

  const stopPan = (event) => {
    state.graphView.dragging = false;
    viewport.releasePointerCapture?.(event.pointerId);
    viewport.classList.remove("panning");
  };
  viewport.addEventListener("pointerup", stopPan);
  viewport.addEventListener("pointercancel", stopPan);
  viewport.addEventListener("pointerleave", stopPan);
}

function fitGraphToViewport(root, graph) {
  const viewport = root.querySelector("[data-graph-viewport]");
  if (!viewport || !viewport.clientWidth || !viewport.clientHeight) return;
  const scale = clampFloat(
    Math.min((viewport.clientWidth - 36) / graph.width, (viewport.clientHeight - 36) / graph.height),
    0.3,
    1.15,
  );
  state.graphView.scale = scale;
  state.graphView.panX = Math.round((viewport.clientWidth - graph.width * scale) / 2);
  state.graphView.panY = Math.max(12, Math.round((viewport.clientHeight - graph.height * scale) / 2));
  applyGraphTransform(root);
}

function zoomGraph(root, factor) {
  state.graphView.scale = clampFloat(state.graphView.scale * factor, 0.3, 1.6);
  applyGraphTransform(root);
}

function applyGraphTransform(root) {
  const world = root.querySelector("[data-graph-world]");
  const label = root.querySelector("[data-graph-zoom]");
  if (!world) return;
  world.style.transform = `translate(${state.graphView.panX}px, ${state.graphView.panY}px) scale(${state.graphView.scale})`;
  if (label) label.textContent = `${Math.round(state.graphView.scale * 100)}%`;
}

function resetGraphView() {
  state.graphView.scale = 0.86;
  state.graphView.panX = 18;
  state.graphView.panY = 18;
  state.graphView.dragging = false;
}

function componentRowHtml(component) {
  return `
    <button class="component-row selectable ${component.componentId === state.selectedComponentId ? "active" : ""}"
      data-component-id="${escapeAttr(component.componentId)}" type="button">
      <span class="row-title">${escapeHtml(componentShortName(component))}</span>
      <span class="row-meta">${statusHtml(component.status)} | ${escapeHtml(component.componentId)}</span>
    </button>
  `;
}

function componentTreeRowHtml(component, level = 0) {
  return treeNodeHtml({
    key: treeNodeKey("component", component.componentId),
    level,
    title: componentShortName(component),
    meta: `${component.status || "unknown"} | ${component.componentId || ""}`,
    icon: componentTreeIconType(component),
    componentId: component.componentId,
    active: component.componentId === state.selectedComponentId,
    status: component.status,
    reviewRequired: component.reviewRequired,
    hidden: componentIsHidden(component),
  });
}

function createStructureNode(key, title, depth = 0) {
  return {
    key,
    title,
    depth,
    children: [],
    childByKey: new Map(),
    components: [],
  };
}

function insertComponentIntoStructure(root, component = {}) {
  const parts = componentStructurePath(component);
  let current = root;
  parts.forEach((part, index) => {
    const key = parts.slice(0, index + 1).join("/");
    if (!current.childByKey.has(key)) {
      const node = createStructureNode(key, structurePartLabel(part), index + 1);
      current.childByKey.set(key, node);
      current.children.push(node);
    }
    current = current.childByKey.get(key);
  });
  current.components.push(component);
}

function componentStructurePath(component = {}) {
  const domPath = component.fingerprint?.technical?.domPath || "";
  const parts = String(domPath || "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length) return parts;

  const structural = component.fingerprint?.structural || {};
  const ancestors = Array.isArray(structural.ancestorTokens)
    ? structural.ancestorTokens
    : [];
  return [
    ...ancestors.slice().reverse().map((item) => `section:${normalizeIdentifier(item) || "ancestor"}`),
    `${component.fingerprint?.technical?.tag || "element"}:${structural.relativeIndex ?? 0}`,
  ];
}

function structurePartLabel(part = "") {
  const [tag, index] = String(part).split(":");
  const cleanTag = normalizeIdentifier(tag || "element") || "element";
  return index === undefined || index === ""
    ? cleanTag
    : `${cleanTag}[${index}]`;
}

function structureNodeHtml(node, level = 0, parentKey = "") {
  const componentCount = countStructureComponents(node);
  const components = sortComponentsByVisualOrder(node.components);
  const children = node.children.slice().sort(compareStructureNodesByVisualOrder);
  const nodeKey = treeNodeKey(parentKey, "structure", node.key);
  return `
    ${treeNodeHtml({
      key: nodeKey,
      level,
      title: node.title,
      meta: `${componentCount} mapped element(s)`,
      icon: structureIconType(node.title),
      collapsible: true,
    })}
    ${treeChildrenHtml(nodeKey, `
      ${components.map((component) => componentTreeRowHtml(component, level + 1)).join("")}
      ${children.map((child) => structureNodeHtml(child, level + 1, nodeKey)).join("")}
    `)}
  `;
}

function compareStructureNodesByVisualOrder(a = {}, b = {}) {
  const aComponent = firstStructureComponent(a);
  const bComponent = firstStructureComponent(b);
  if (aComponent && bComponent) return compareComponentsByVisualOrder(aComponent, bComponent);
  if (aComponent) return -1;
  if (bComponent) return 1;
  return String(a.key || "").localeCompare(String(b.key || ""));
}

function firstStructureComponent(node = {}) {
  if (node.components?.length) {
    return sortComponentsByVisualOrder(node.components)[0];
  }
  const childComponents = (node.children || [])
    .map(firstStructureComponent)
    .filter(Boolean);
  return sortComponentsByVisualOrder(childComponents)[0] || null;
}

function countStructureComponents(node) {
  return node.components.length +
    node.children.reduce((total, child) => total + countStructureComponents(child), 0);
}

function treeNodeHtml(node = {}) {
  const collapsed = node.collapsible && isTreeNodeCollapsed(node.key);
  const icon = node.icon || "element";
  const classes = [
    "tree-row",
    node.componentId ? "tree-row-button selectable" : "",
    node.collapsible ? "tree-toggle" : "",
    collapsed ? "collapsed" : "",
    node.active ? "active" : "",
    node.reviewRequired ? "review-required" : "",
    node.hidden ? "hidden-component" : "",
    node.status ? `tree-status-${normalizeIdentifier(node.status)}` : "",
  ].filter(Boolean).join(" ");
  const style = `--level: ${Number(node.level) || 0}; --type-color: ${componentTypeColor(icon)};`;
  const body = `
    <span class="tree-chevron">${node.collapsible ? treeIconSvg("chevron") : ""}</span>
    <span class="tree-icon tree-icon-${escapeAttr(icon)}">${treeIconSvg(icon)}</span>
    <span class="tree-copy">
      <span class="row-title">${escapeHtml(node.title || "Element")}</span>
      <span class="row-meta">${node.componentId ? componentStatusLineHtml({ status: node.status, componentId: node.componentId }, node.hidden) : escapeHtml(node.meta || "")}</span>
    </span>
    <span class="tree-lock">${treeIconSvg("lock")}</span>
  `;

  if (node.componentId) {
    return `
      <button class="${classes}" style="${style}" data-component-id="${escapeAttr(node.componentId)}" type="button" role="treeitem">
        ${body}
      </button>
    `;
  }

  return `
    <button class="${classes}" style="${style}" data-tree-node="${escapeAttr(node.key || "")}"
      type="button" role="treeitem" aria-expanded="${collapsed ? "false" : "true"}">
      ${body}
    </button>
  `;
}

function treeChildrenHtml(parentKey = "", content = "") {
  const collapsed = isTreeNodeCollapsed(parentKey);
  return `<div class="tree-children ${collapsed ? "collapsed" : ""}" data-tree-children="${escapeAttr(parentKey)}">${content}</div>`;
}

function wireTreeToggles(root) {
  root.querySelectorAll("[data-tree-node]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.treeNode || "";
      if (!key) return;
      state.treeCollapsed[key] = !isTreeNodeCollapsed(key);
      renderSelectedMap();
    });
  });
}

function isTreeNodeCollapsed(key = "") {
  return Boolean(key && state.treeCollapsed[key]);
}

function treeNodeKey(...parts) {
  return parts
    .flat()
    .map((part) => normalizeIdentifier(part || "node"))
    .filter(Boolean)
    .join("::");
}

function componentTypeColor(type = "") {
  const key = normalizeIdentifier(type);
  if (key === "button") return "#c084fc";
  if (key === "input") return "#67e8f9";
  if (key === "link") return "#86efac";
  if (key === "image") return "#93c5fd";
  if (key === "text") return "#f8fafc";
  if (key === "region") return "#facc15";
  if (key === "page" || key === "site") return "#cbd5e1";
  return "#a78bfa";
}

function renderMapLegend() {
  const entries = [
    ["Selected", "#38bdf8", "Selected component"],
    ["Review", "#c084fc", "Review required or ambiguous"],
    ["Hidden", "#fb923c", "Resolved but hidden"],
    ["Removed", "#ef4444", "Historical removed record"],
    ["Button", componentTypeColor("button"), "Button/action"],
    ["Input", componentTypeColor("input"), "Input/control"],
    ["Link", componentTypeColor("link"), "Link/navigation"],
    ["Text", componentTypeColor("text"), "Visible text"],
    ["Region", componentTypeColor("region"), "Page region"],
  ];
  return `
    <div class="map-legend" aria-label="Map color legend">
      ${entries.map(([label, color, title]) => `
        <span class="legend-chip" title="${escapeAttr(title)}" data-tooltip="${escapeAttr(title)}">
          <span class="legend-swatch" style="--legend-color: ${escapeAttr(color)}"></span>
          ${escapeHtml(label)}
        </span>
      `).join("")}
    </div>
  `;
}

function iconButtonHtml({ id = "", icon = "element", label = "", className = "icon-button", attrs = "" } = {}) {
  return `
    <button ${id ? `id="${escapeAttr(id)}"` : ""} class="${escapeAttr(className)}" type="button"
      title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}" data-tooltip="${escapeAttr(label)}" ${attrs}>
      ${iconSvg(icon)}
    </button>
  `;
}

function renderReviewQueue() {
  const entry = selectedEntry();
  const review = filterComponents(entry, { includeRemoved: true }).filter((component) => {
    return component.reviewRequired ||
      (
        component.reviewRequired !== false &&
        ["ambiguous", "changed", "removed"].includes(component.status)
      );
  });

  if (!review.length) {
    els.reviewList.innerHTML = `<div class="empty-state">No matching review-required components.</div>`;
    return;
  }

  els.reviewList.innerHTML = review.map((component) => `
    <button class="review-item selectable ${component.componentId === state.selectedComponentId ? "active" : ""} ${componentIsHidden(component) ? "hidden-component" : ""}"
      data-component-id="${escapeAttr(component.componentId)}" type="button">
      <span class="row-title">${escapeHtml(componentShortName(component))}</span>
      <span class="row-meta">${componentStatusLineHtml(component)}</span>
    </button>
  `).join("");

  wireComponentRows(els.reviewList);
}

function renderDetail(lastResolution = null) {
  const entry = selectedEntry();
  const component = selectedComponent();
  if (!component) {
    els.detail.className = "component-detail empty";
    els.detail.textContent = "Select a component.";
    return;
  }

  const sensitive = isSensitiveEntry(entry);
  const resolution = lastResolution || resolutionForComponent(component, entry);
  const activeResolution = state.activeResolutionKey === componentResolutionKey(entry, component);
  els.detail.className = "component-detail";
  els.detail.innerHTML = `
    <div class="detail-block">
      <h3>Identity</h3>
      <div><strong>${escapeHtml(component.displayAlias || componentShortName(component))}</strong></div>
      <div><code>${escapeHtml(component.componentId)}</code></div>
      <div>${statusHtml(component.status)} ${component.reviewRequired ? `<span class="badge">review</span>` : ""} ${componentIsHidden(component) ? `<span class="badge hidden-badge">hidden</span>` : ""} ${sensitive ? `<span class="badge sensitive-badge">redacted</span>` : ""}</div>
    </div>
    <div class="detail-block detail-actions">
      <label>
        Display alias
        <input id="component-alias" type="text" value="${escapeAttr(component.displayAlias || "")}" placeholder="${escapeAttr(componentShortName(component))}">
      </label>
      <button id="btn-save-alias" type="button">Save alias</button>
      <button id="btn-check-live-resolution" type="button" ${activeResolution ? "disabled" : ""}>
        ${activeResolution ? "Checking live resolution..." : "Check live resolution"}
      </button>
      ${component.reviewRequired ? `<button id="btn-accept-review" type="button">Accept current mapping</button>` : ""}
    </div>
    <div class="detail-block">
      <h3>Locator</h3>
      <pre>${escapeHtml(jsonForDisplay(component.primaryLocator || {}, sensitive))}</pre>
    </div>
    <div class="detail-block">
      <h3>Fallback Locators</h3>
      <pre>${escapeHtml(jsonForDisplay(component.fallbackLocators || [], sensitive))}</pre>
    </div>
    <div class="detail-block">
      <h3>Capabilities</h3>
      <pre>${escapeHtml(jsonForDisplay(component.expectedCapabilities || [], false))}</pre>
    </div>
    <div class="detail-block">
      <h3>History</h3>
      <pre>${escapeHtml(jsonForDisplay(component.historicalLinks || [], false))}</pre>
    </div>
    ${resolution ? `
      <div class="detail-block">
        <h3>Live Resolution</h3>
        <pre>${escapeHtml(jsonForDisplay(resolution, sensitive))}</pre>
      </div>
      ${resolution.resolverLog ? `
        <div class="detail-block">
          <h3>Resolver Log</h3>
          <pre>${escapeHtml(jsonForDisplay(resolution.resolverLog, sensitive))}</pre>
        </div>
      ` : ""}
      ${renderLiveCandidateLinks(resolution, component)}
    ` : ""}
  `;

  document.getElementById("btn-save-alias")?.addEventListener("click", saveComponentAlias);
  document.getElementById("btn-check-live-resolution")?.addEventListener("click", checkLiveResolution);
  document.getElementById("btn-accept-review")?.addEventListener("click", acceptCurrentMapping);
  els.detail.querySelectorAll("[data-link-attempt-index]").forEach((button) => {
    button.addEventListener("click", () => {
      linkLiveCandidateAttempt(Number(button.dataset.linkAttemptIndex));
    });
  });
}

function renderLiveCandidateLinks(resolution = {}, component = {}) {
  const sensitive = isSensitiveEntry(selectedEntry());
  const attempts = Array.isArray(resolution.attempts) ? resolution.attempts : [];
  const linkable = attempts
    .map((attempt, index) => ({ attempt, index }))
    .filter(({ attempt }) => attempt.mapperFact?.componentUid);

  if (!component.reviewRequired || !linkable.length) return "";

  return `
    <div class="detail-block detail-actions">
      <h3>Candidate Link</h3>
      ${linkable.map(({ attempt, index }) => `
        <button type="button" data-link-attempt-index="${index}">
          Link ${escapeHtml(sensitive ? `candidate ${index + 1}` : attempt.displayName || attempt.componentId || `candidate ${index + 1}`)}
          ${attempt.score !== undefined ? `(${Number(attempt.score)})` : ""}
        </button>
      `).join("")}
    </div>
  `;
}

function wireComponentRows(root) {
  root.querySelectorAll("[data-component-id]").forEach((button) => {
    button.addEventListener("click", () => selectComponent(button.dataset.componentId));
    button.addEventListener("mouseenter", () => previewComponentHighlight(button.dataset.componentId));
    button.addEventListener("focusin", () => previewComponentHighlight(button.dataset.componentId));
    button.addEventListener("mouseleave", () => cancelHoverPreview({ restoreSelection: true }));
    button.addEventListener("focusout", () => cancelHoverPreview({ restoreSelection: true }));
  });
}

function componentShortName(component = {}) {
  const fingerprint = component.fingerprint || {};
  const semantic = fingerprint.semantic || {};
  const technical = fingerprint.technical || {};
  const type = normalizeIdentifier(
    semantic.role ||
      technical.tag ||
      "element",
  );
  const name = normalizeIdentifier(
    semantic.stableAttributes?.["data-testid"] ||
      semantic.stableAttributes?.["data-test"] ||
      semantic.stableAttributes?.["data-qa"] ||
      semantic.accessibleName ||
      semantic.labelText ||
      semantic.stableText ||
      semantic.placeholder ||
      semantic.name ||
      component.displayName ||
      component.componentId,
  );
  return [type, name].filter(Boolean).join("_") || component.componentId || "element";
}

function componentRegionName(component = {}) {
  return component.fingerprint?.structural?.formName ||
    component.fingerprint?.structural?.nearbyLabel ||
    component.fingerprint?.semantic?.role ||
    "Page";
}

function componentTypeGroupName(component = {}) {
  const semantic = component.fingerprint?.semantic || {};
  const technical = component.fingerprint?.technical || {};
  return normalizeIdentifier(
    semantic.role ||
      technical.tag ||
      "element",
  ) || "element";
}

function componentTreeIconType(component = {}) {
  const semantic = component.fingerprint?.semantic || {};
  const technical = component.fingerprint?.technical || {};
  const role = normalizeIdentifier(semantic.role || "");
  const tag = normalizeIdentifier(technical.tag || "");
  const type = role || tag;
  if (["button", "submit", "menuitem"].includes(type)) return "button";
  if (["textbox", "input", "textarea", "combobox", "select"].includes(type)) return "input";
  if (["link", "a"].includes(type)) return "link";
  if (["img", "image"].includes(type)) return "image";
  if (["heading", "paragraph", "text", "label", "span"].includes(type)) return "text";
  if (["form", "group", "section", "region", "main", "nav", "header", "footer"].includes(type)) return "region";
  return "element";
}

function structureIconType(title = "") {
  const value = normalizeIdentifier(String(title).replace(/\[\d+\]$/, ""));
  if (["form", "section", "main", "nav", "header", "footer", "article", "aside"].includes(value)) return "region";
  if (["button"].includes(value)) return "button";
  if (["input", "textarea", "select"].includes(value)) return "input";
  if (["a"].includes(value)) return "link";
  if (["img", "picture", "svg"].includes(value)) return "image";
  if (["p", "span", "label", "h1", "h2", "h3", "h4", "h5", "h6"].includes(value)) return "text";
  return "element";
}

function treeIconSvg(type = "element") {
  const icons = {
    chevron: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 6l3 3 3-3"/></svg>`,
    lock: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 7V5a3 3 0 016 0v2"/><rect x="4" y="7" width="8" height="7" rx="1.5"/></svg>`,
    site: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M2.5 6h11M6 3v10"/></svg>`,
    page: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h5l3 3V13a1 1 0 01-1 1H4a1 1 0 01-1-1V3.5a1 1 0 011-1z"/><path d="M9 2.5V6h3"/></svg>`,
    region: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M6 3v10M10 3v10"/></svg>`,
    text: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4h10M8 4v9M5.5 13h5"/></svg>`,
    button: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 2.5v11M11 2.5v11M2.5 5h11M2.5 11h11"/></svg>`,
    input: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="4.5" width="11" height="7" rx="1.5"/><path d="M5 8h6"/></svg>`,
    link: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 5.5l3-3a2.1 2.1 0 113 3l-2 2M9.5 10.5l-3 3a2.1 2.1 0 11-3-3l2-2M6 10l4-4"/></svg>`,
    image: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="9" rx="1.5"/><path d="M4.5 10l2-2 2 2 1.5-1.5 2 2"/><circle cx="10.5" cy="6.2" r="1"/></svg>`,
    element: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5l5.5 5.5L8 13.5 2.5 8z"/></svg>`,
  };
  return icons[type] || icons.element;
}

function iconSvg(type = "element") {
  const icons = {
    map: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2V6z"/><path d="M9 4v14M15 6v14"/></svg>`,
    refresh: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M18 10a6 6 0 00-10-3L4 11"/><path d="M6 14a6 6 0 0010 3l4-4"/></svg>`,
    pulse: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2-6 4 12 2-6h6"/></svg>`,
    x: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
    trash: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 14h10l1-14"/><path d="M9 7V4h6v3"/></svg>`,
    "trash-site": `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 14h10l1-14"/><path d="M9.5 12h5M9.5 16h5"/></svg>`,
    tree: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v18"/><path d="M6 7h7v4H6M6 15h10v4H6"/></svg>`,
    graph: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 7l3 8M16 7l-3 8"/></svg>`,
    fit: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`,
    reset: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0113-6"/><path d="M17 3v5h-5"/><path d="M20 12a8 8 0 01-13 6"/><path d="M7 21v-5h5"/></svg>`,
    plus: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
    minus: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>`,
    chevron: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10l4 4 4-4"/></svg>`,
    element: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 9-9 9-9-9z"/></svg>`,
  };
  return icons[type] || icons.element;
}

function normalizeIdentifier(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

async function selectComponent(componentId) {
  cancelHoverPreview();
  state.selectedComponentId = componentId;
  renderSelectedMap();
  renderReviewQueue();
  renderDetail();

  if (els.highlightEnabled.checked) {
    await highlightSelectedComponent();
  }
}

async function highlightSelectedComponent() {
  const entry = selectedEntry();
  const component = selectedComponent();
  if (!entry || !component) return;

  await highlightComponent(entry, component);
}

async function checkLiveResolution() {
  const entry = selectedEntry();
  const component = selectedComponent();
  if (!entry || !component) return;

  const targetKey = componentResolutionKey(entry, component);
  state.activeResolutionKey = targetKey;
  renderDetail();
  try {
    await highlightComponent(entry, component, null, {
      statusPrefix: "Live resolution",
    });
  } finally {
    if (state.activeResolutionKey === targetKey) {
      state.activeResolutionKey = "";
      if (selectedResolutionKey() === targetKey) renderDetail();
    }
  }
}

async function previewComponentHighlight(componentId) {
  if (!els.highlightEnabled.checked || !els.highlightHoverEnabled.checked) return;
  const entry = selectedEntry();
  const component = (entry?.pageMap?.components || []).find((item) => {
    return item.componentId === componentId;
  });
  if (!entry || !component) return;

  const requestId = ++state.hoverHighlightRequestId;
  await highlightComponent(entry, component, requestId, {
    statusPrefix: "Preview",
    silentStale: true,
  });
}

function cancelHoverPreview(options = {}) {
  state.hoverHighlightRequestId += 1;
  if (options.restoreSelection && els.highlightEnabled.checked && selectedComponent()) {
    void highlightSelectedComponent();
  }
}

async function highlightComponent(entry, component, requestId = null, options = {}) {
  const highlightRequestId = ++state.highlightRequestId;
  const targetKey = componentResolutionKey(entry, component);
  try {
    const response = await chrome.runtime.sendMessage({
      type: Messages.HighlightMapperComponent,
      pageMap: entry.pageMap,
      component,
      highlightRequestId,
    });
    if (requestId !== null && requestId !== state.hoverHighlightRequestId) return;
    if (response?.ok === false) throw new Error(response.error || "Highlight failed.");
    if (response?.mapperState === "stale") return;

    state.lastResolutionByTarget[targetKey] = response;
    if (selectedResolutionKey() !== targetKey) return;

    renderSelectedMap();
    renderReviewQueue();
    renderDetail(response);
    setStatus(`${options.statusPrefix || "Highlight"}: ${response.mapperState || "unknown"} (${response.mapperReason || "no reason"})`);
  } catch (error) {
    if (requestId !== null && requestId !== state.hoverHighlightRequestId && options.silentStale) return;
    if (selectedResolutionKey() !== targetKey) return;
    setStatus(`${options.statusPrefix || "Highlight"} failed: ${error.message || error}`, true);
  }
}

async function clearWebsiteHighlight(entry = selectedEntry()) {
  if (!entry) return;
  const highlightRequestId = ++state.highlightRequestId;
  try {
    await chrome.runtime.sendMessage({
      type: Messages.HighlightMapperComponent,
      pageMap: entry.pageMap,
      component: null,
      highlightRequestId,
    });
  } catch {
    // Clearing an inspection-only overlay should never interrupt navigation.
  }
}

async function saveComponentAlias() {
  const component = selectedComponent();
  if (!component) return;
  const alias = document.getElementById("component-alias")?.value?.trim() || "";
  try {
    await updateSelectedComponent((current) => ({
      ...current,
      displayAlias: alias,
      updatedAt: new Date().toISOString(),
    }));
    setStatus(alias ? `Alias saved for ${component.componentId}.` : `Alias cleared for ${component.componentId}.`);
  } catch (error) {
    setStatus(`Alias save failed: ${error.message || error}`, true);
  }
}

async function acceptCurrentMapping() {
  const component = selectedComponent();
  if (!component) return;
  try {
    await createReviewMapVersion((current) => ({
      ...current,
      status: acceptedReviewStatus(current.status),
      reviewRequired: false,
      reviewDecision: {
        type: "accept_current_mapping",
        decidedAt: new Date().toISOString(),
        componentUid: current.componentUid || "",
        mapVersionId: current.capturedMapVersionId || "",
        previousStatus: current.status || "",
      },
      historicalLinks: [
        ...(Array.isArray(current.historicalLinks) ? current.historicalLinks : []),
        {
          componentUid: current.componentUid || "",
          mapVersionId: current.capturedMapVersionId || "",
          status: "accepted",
          source: "inspector_review",
        },
      ],
      updatedAt: new Date().toISOString(),
    }));
    setStatus(`Accepted current mapping for ${component.componentId} in a new map version.`);
  } catch (error) {
    setStatus(`Review save failed: ${error.message || error}`, true);
  }
}

function acceptedReviewStatus(status = "") {
  return status === "removed" ? status : "same";
}

async function linkLiveCandidateAttempt(index) {
  const component = selectedComponent();
  const resolution = component
    ? resolutionForComponent(component)
    : null;
  const attempt = Array.isArray(resolution?.attempts)
    ? resolution.attempts[index]
    : null;
  const mapperFact = attempt?.mapperFact;
  if (!component || !mapperFact?.componentUid) return;

  const primaryLocator = primaryLocatorFromMapperFact(mapperFact);
  const fallbackLocators = (mapperFact.locatorCandidates || [])
    .filter((locator) => locator !== primaryLocator);

  try {
    await createReviewMapVersion((current) => ({
      ...current,
      componentUid: mapperFact.componentUid,
      displayName: mapperFact.displayName || current.displayName,
      primaryLocator: primaryLocator || current.primaryLocator,
      fallbackLocators,
      fingerprint: mapperFact.fingerprint || current.fingerprint,
      expectedCapabilities: mapperFact.expectedCapabilities || current.expectedCapabilities,
      action: mapperFact.action || current.action,
      status: "same",
      reviewRequired: false,
      reviewDecision: {
        type: "link_live_candidate",
        decidedAt: new Date().toISOString(),
        previousComponentUid: current.componentUid || "",
        linkedComponentUid: mapperFact.componentUid,
        score: attempt.score ?? null,
        evidence: attempt.evidence || [],
      },
      historicalLinks: [
        ...(Array.isArray(current.historicalLinks) ? current.historicalLinks : []),
        {
          componentUid: current.componentUid || "",
          mapVersionId: current.capturedMapVersionId || "",
          status: current.status || "",
          source: "inspector_previous_component",
        },
        {
          componentUid: mapperFact.componentUid,
          mapVersionId: mapperFact.capturedMapVersionId || "",
          score: attempt.score ?? 0,
          status: "linked",
          source: "inspector_live_candidate",
        },
      ],
      updatedAt: new Date().toISOString(),
    }));
    setStatus(`Linked live candidate to ${component.componentId} in a new map version.`);
  } catch (error) {
    setStatus(`Candidate link failed: ${error.message || error}`, true);
  }
}

async function savePolicy() {
  const entry = selectedEntry();
  if (!entry) return;

  try {
    const nextSettings = {
      ...(entry.settings || {}),
      queryAllowlist: splitCsv(document.getElementById("policy-query-allowlist")?.value || ""),
      maxComponents: clampNumber(document.getElementById("policy-max-components")?.value, 1, 2000, 500),
      materialMutationLimit: clampNumber(document.getElementById("policy-mutation-limit")?.value, 1, 500, 50),
      siteOverrides: {
        ...(entry.settings?.siteOverrides || {}),
        [entry.pageMap.siteKey]: {
          ...(entry.settings?.siteOverrides?.[entry.pageMap.siteKey] || {}),
          sensitive: document.getElementById("policy-site-sensitive")?.value === "true",
        },
      },
    };

    await updateSelectedWorkflowState((workflowState) => ({
      ...workflowState,
      settings: nextSettings,
    }));
    setStatus("Mapper policy saved.");
  } catch (error) {
    setStatus(`Policy save failed: ${error.message || error}`, true);
  }
}

async function updateSelectedComponent(updater) {
  const entry = selectedEntry();
  const component = selectedComponent();
  if (!entry || !component) return;

  await updateSelectedWorkflowState((workflowState) => ({
    ...workflowState,
    maps: (workflowState.maps || []).map((pageMap) => {
      if (pageMap.mapVersionId !== entry.pageMap.mapVersionId) return pageMap;
      return {
        ...pageMap,
        components: (pageMap.components || []).map((item) => {
          return item.componentId === component.componentId ? updater(item) : item;
        }),
      };
    }),
  }));
}

async function createReviewMapVersion(componentUpdater) {
  const entry = selectedEntry();
  const component = selectedComponent();
  if (!entry || !component) return;

  const newMapVersionId = createInspectorMapVersionId(entry.pageMap, component.componentId);
  await updateSelectedWorkflowState((workflowState) => ({
    ...workflowState,
    maps: (workflowState.maps || []).concat({
      ...structuredClone(entry.pageMap),
      mapVersionId: newMapVersionId,
      status: "refreshed",
      createdAt: new Date().toISOString(),
      previousMapVersionId: entry.pageMap.mapVersionId || "",
      reviewSource: "mapper_inspector",
          components: sortComponentsByVisualOrder(entry.pageMap.components || []).map((item) => {
            const cloned = structuredClone(item);
            const next = item.componentId === component.componentId
              ? componentUpdater(cloned)
          : cloned;
        return {
          ...next,
          capturedMapVersionId: newMapVersionId,
        };
      }),
    }),
  }), {
    nextEntryId: entryId(entry.workflowId, { mapVersionId: newMapVersionId }),
    nextComponentId: component.componentId,
  });
}

async function updateSelectedWorkflowState(updater, selection = {}) {
  const entry = selectedEntry();
  if (!entry) return;
  const current = state.states[entry.workflowId];
  if (!current) return;

  const nextState = pruneWorkflowMapperState(updater(structuredClone(current)));
  const response = await chrome.runtime.sendMessage({
    type: Messages.SaveWorkflowMapperState,
    workflowId: entry.workflowId,
    state: nextState,
  });
  if (response?.ok === false) throw new Error(response.error || "Save failed.");

  const selectedEntryId = Object.prototype.hasOwnProperty.call(selection, "nextEntryId")
    ? selection.nextEntryId
    : state.selectedEntryId;
  const selectedComponentId = Object.prototype.hasOwnProperty.call(selection, "nextComponentId")
    ? selection.nextComponentId
    : state.selectedComponentId;
  state.states[entry.workflowId] = response.state || nextState;
  state.entries = flattenMapEntries(state.states);
  state.siteGroups = groupSiteEntries(state.entries);
  pruneInspectorResolutionState();
  state.selectedEntryId = state.entries.some((item) => item.id === selectedEntryId)
    ? selectedEntryId
    : state.siteGroups[0]?.latest?.id || state.entries[0]?.id || "";
  state.selectedComponentId = state.selectedEntryId ? selectedComponentId : "";
  renderAll();
}

function pruneWorkflowMapperState(workflowState = {}) {
  const settings = {
    ...(workflowState.settings || {}),
    maxVersions: clampNumber(workflowState.settings?.maxVersions, 1, 3, 3),
  };
  return {
    ...workflowState,
    settings,
    maps: retainRecentPageMaps(workflowState.maps || [], settings),
  };
}

function setView(view) {
  cancelHoverPreview();
  state.graphView.dragging = false;
  els.views.graph.querySelectorAll(".panning").forEach((element) => {
    element.classList.remove("panning");
  });
  state.activeView = view;
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  Object.entries(els.views).forEach(([key, element]) => {
    element.classList.toggle("active", key === view);
  });
}

function statusHtml(status = "") {
  const value = escapeHtml(status || "unknown");
  return `<span class="status-${value}">${value}</span>`;
}

function componentStatusLineHtml(component = {}, hidden = componentIsHidden(component)) {
  return [
    statusHtml(component.status),
    hidden ? `<span class="status-hidden">hidden</span>` : "",
    escapeHtml(component.componentId || ""),
  ].filter(Boolean).join(" | ");
}

function componentIsHidden(component = {}) {
  const resolution = resolutionForComponent(component);
  const visual = component.fingerprint?.visual || {};
  return Boolean(
    resolution?.hidden === true ||
      resolution?.mapperState === "hidden" ||
      visual.hidden === true ||
      visual.visible === false ||
      component.status === "hidden",
  );
}

function componentResolutionKey(entry = null, component = null) {
  if (!entry?.id || !component?.componentId) return "";
  return `${entry.id}::${component.componentId}`;
}

function selectedResolutionKey() {
  return componentResolutionKey(selectedEntry(), selectedComponent());
}

function resolutionForComponent(component = null, entry = selectedEntry()) {
  const key = componentResolutionKey(entry, component);
  return key ? state.lastResolutionByTarget[key] || null : null;
}

function pruneInspectorResolutionState() {
  const retainedKeys = new Set();
  state.entries.forEach((entry) => {
    (entry.pageMap?.components || []).forEach((component) => {
      const key = componentResolutionKey(entry, component);
      if (key) retainedKeys.add(key);
    });
  });
  Object.keys(state.lastResolutionByTarget).forEach((key) => {
    if (!retainedKeys.has(key)) delete state.lastResolutionByTarget[key];
  });
}

function statusColor(status = "") {
  if (status === "same") return "#22c55e";
  if (status === "changed") return "#38bdf8";
  if (status === "new") return "#a3e635";
  if (status === "ambiguous") return "#f59e0b";
  if (status === "removed") return "#ef4444";
  if (status === "hidden") return "#f97316";
  return "#8b5cf6";
}

function primaryLocatorFromMapperFact(mapperFact = {}) {
  const locators = Array.isArray(mapperFact.locatorCandidates)
    ? mapperFact.locatorCandidates
    : [];
  return locators.find((locator) => locator.selectedAtCapture) ||
    locators[0] ||
    null;
}

function createInspectorMapVersionId(pageMap = {}, componentId = "") {
  return `map_review_${stableHash({
    previousMapVersionId: pageMap.mapVersionId || "",
    componentId,
    at: new Date().toISOString(),
  })}`;
}

function stableHash(value) {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => {
      return `${JSON.stringify(key)}:${stableStringify(value[key])}`;
    }).join(",")}}`;
  }
  return JSON.stringify(value);
}

function effectivePolicy(entry = null) {
  const settings = entry?.settings || {};
  const map = entry?.pageMap || {};
  return {
    ...settings,
    ...(settings.siteOverrides?.[map.siteKey] || {}),
    ...(settings.pageOverrides?.[map.pageProfileKey] || {}),
  };
}

function isSensitiveEntry(entry = null) {
  return effectivePolicy(entry).sensitive === true;
}

function jsonForDisplay(value, sensitive = false) {
  const prepared = sensitive ? redactSensitive(value) : value;
  return JSON.stringify(prepared, null, 2);
}

function redactSensitive(value, key = "") {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, key));
  }
  if (!value || typeof value !== "object") {
    return shouldRedactKey(key) && typeof value === "string" && value
      ? "[redacted]"
      : value;
  }

  return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
    entryKey,
    redactSensitive(entryValue, entryKey),
  ]));
}

function shouldRedactKey(key = "") {
  return [
    "value",
    "accessibleName",
    "stableText",
    "labelText",
    "placeholder",
    "title",
    "href",
    "nearbyLabel",
    "displayName",
  ].includes(key);
}

function splitCsv(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function clampFloat(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function groupBy(items, keyFn) {
  return items.reduce((groups, item) => {
    const key = String(keyFn(item) || "Page");
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
    return groups;
  }, {});
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.style.borderColor = isError ? "#ef4444" : "#334155";
  els.status.classList.toggle("visible", Boolean(message));
}

function normalizeText(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value = "") {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
