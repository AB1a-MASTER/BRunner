const Messages = Object.freeze({
  ListWorkflowMapperStates: "LIST_WORKFLOW_MAPPER_STATES",
  SaveWorkflowMapperState: "SAVE_WORKFLOW_MAPPER_STATE",
  MapCurrentPage: "MAP_CURRENT_PAGE",
  HighlightMapperComponent: "HIGHLIGHT_MAPPER_COMPONENT",
});

const state = {
  states: {},
  entries: [],
  selectedEntryId: "",
  selectedComponentId: "",
  activeView: "tree",
  treeMode: "structure",
  lastResolutionByComponent: {},
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
  siteSearch: document.getElementById("site-search"),
  siteList: document.getElementById("site-list"),
  title: document.getElementById("map-title"),
  subtitle: document.getElementById("map-subtitle"),
  tabs: Array.from(document.querySelectorAll(".view-tab")),
  views: {
    tree: document.getElementById("view-tree"),
    graph: document.getElementById("view-graph"),
  },
  reviewList: document.getElementById("review-list"),
  policy: document.getElementById("policy-panel"),
  detail: document.getElementById("component-detail"),
  status: document.getElementById("status-line"),
};

init();

function init() {
  els.refresh.addEventListener("click", loadStates);
  els.mapActive.addEventListener("click", mapActivePage);
  els.siteSearch.addEventListener("input", renderSites);
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => setView(tab.dataset.view));
  });
  loadStates();
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
    if (!state.entries.some((entry) => entry.id === state.selectedEntryId)) {
      state.selectedEntryId = state.entries[0]?.id || "";
      state.selectedComponentId = "";
      resetGraphView();
    }
    renderAll();
    setStatus(`${state.entries.length} saved map version(s) loaded.`);
  } catch (error) {
    setStatus(`Mapper Inspector load failed: ${error.message || error}`, true);
  }
}

async function mapActivePage() {
  const workflowId = els.workflowId.value.trim();
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
    setStatus(`Mapped ${response.pageMap?.componentCount || 0} component(s).`);
  } catch (error) {
    setStatus(`Map active page failed: ${error.message || error}`, true);
  }
}

function flattenMapEntries(states = {}) {
  const entries = [];
  Object.values(states).forEach((workflowState) => {
    (workflowState?.maps || []).forEach((pageMap) => {
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

function renderAll() {
  renderSites();
  renderSelectedMap();
  renderPolicyPanel();
  renderReviewQueue();
  renderDetail();
}

function renderSites() {
  const query = normalizeText(els.siteSearch.value);
  const entries = state.entries.filter((entry) => {
    const haystack = normalizeText([
      entry.workflowId,
      entry.pageMap.hostname,
      entry.pageMap.path,
      entry.pageMap.title,
      entry.pageMap.status,
    ].join(" "));
    return !query || haystack.includes(query);
  });

  if (!entries.length) {
    els.siteList.innerHTML = `<div class="empty-state">No saved maps.</div>`;
    return;
  }

  els.siteList.innerHTML = entries.map((entry) => {
    const map = entry.pageMap;
    return `
      <button class="site-card ${entry.id === state.selectedEntryId ? "active" : ""}"
        data-entry-id="${escapeAttr(entry.id)}" type="button">
        <span class="site-title">${escapeHtml(map.hostname || map.siteKey || "Unknown site")}</span>
        <span class="site-meta">${escapeHtml(map.path || "/")} | ${map.componentCount || 0} components</span>
        <span class="site-meta">${escapeHtml(entry.workflowId)} | ${escapeHtml(map.status || "")}</span>
      </button>
    `;
  }).join("");

  els.siteList.querySelectorAll("[data-entry-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedEntryId = button.dataset.entryId;
      state.selectedComponentId = "";
      resetGraphView();
      renderAll();
    });
  });
}

function renderSelectedMap() {
  const entry = selectedEntry();
  if (!entry) {
    els.title.textContent = "No map selected";
    els.subtitle.textContent = "Record or map a page to inspect components.";
    Object.values(els.views).forEach((view) => {
      view.innerHTML = `<div class="empty-state">No map selected.</div>`;
    });
    return;
  }

  const map = entry.pageMap;
  els.title.textContent = map.title || map.hostname || "Saved map";
  els.subtitle.textContent = `${map.hostname || ""}${map.path || ""} | ${map.status || "unknown"} | ${map.mapVersionId || ""}`;

  renderTree(entry);
  renderGraph(entry);
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

function renderTree(entry) {
  const map = entry.pageMap;
  const components = map.components || [];

  els.views.tree.innerHTML = `
    <div class="tree-controls" role="group" aria-label="Tree grouping">
      ${treeModeButtonHtml("structure", "Structure")}
      ${treeModeButtonHtml("regions", "Regions")}
      ${treeModeButtonHtml("types", "Types")}
    </div>
    <div class="tree-explorer" role="tree">
      ${treeNodeHtml({
        level: 0,
        title: map.hostname || map.siteKey || "Unknown site",
        meta: map.origin || "",
        icon: "site",
      })}
      ${treeNodeHtml({
        level: 1,
        title: map.path || "/",
        meta: `${map.classification || "page"} | ${components.length} records`,
        icon: "page",
      })}
      ${renderTreeModeContent(components)}
    </div>
  `;

  wireTreeModeButtons(els.views.tree);
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

function renderTreeModeContent(components = []) {
  if (state.treeMode === "types") {
    return renderGroupedComponentTree(components, componentTypeGroupName, "element");
  }
  if (state.treeMode === "regions") {
    return renderGroupedComponentTree(components, componentRegionName, "region");
  }
  return renderStructureTree(components);
}

function renderGroupedComponentTree(components = [], groupNameFn, groupIcon = "region") {
  const groups = groupBy(components, groupNameFn);
  return Object.entries(groups).map(([groupName, group]) => `
    ${treeNodeHtml({
      level: 2,
      title: groupName,
      meta: `${group.length} element(s)`,
      icon: groupIcon,
    })}
    ${group.map((component) => componentTreeRowHtml(component, 3)).join("")}
  `).join("");
}

function renderStructureTree(components = []) {
  const root = createStructureNode("document", "document", 1);
  components.forEach((component) => insertComponentIntoStructure(root, component));
  return root.children.map((node) => structureNodeHtml(node, 2)).join("");
}

function renderGraph(entry) {
  const graph = buildInspectorGraph(entry);

  els.views.graph.innerHTML = `
    <div class="graph-shell">
      <div class="graph-controls">
        <button data-graph-action="fit" type="button">Fit</button>
        <button data-graph-action="reset" type="button">Reset</button>
        <button data-graph-action="zoom-out" type="button">-</button>
        <span data-graph-zoom>${Math.round(state.graphView.scale * 100)}%</span>
        <button data-graph-action="zoom-in" type="button">+</button>
        <span>${graph.componentCount} elements | ${graph.reviewCount} review</span>
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

function buildInspectorGraph(entry) {
  const map = entry.pageMap || {};
  const components = map.components || [];
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
  ].filter(Boolean).join(" ");
  const style = `left: ${node.x}px; top: ${node.y}px; width: ${node.width}px; min-height: ${node.height}px;`;
  const body = `
    <span class="graph-port graph-port-in" aria-hidden="true"></span>
    <span class="graph-port graph-port-out" aria-hidden="true"></span>
    <span class="row-title">${escapeHtml(node.title)}</span>
    <span class="row-meta">${node.componentId ? `${statusHtml(node.status)} | ${escapeHtml(node.componentId)}` : escapeHtml(node.meta)}</span>
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
    level,
    title: componentShortName(component),
    meta: `${component.status || "unknown"} | ${component.componentId || ""}`,
    icon: componentTreeIconType(component),
    componentId: component.componentId,
    active: component.componentId === state.selectedComponentId,
    status: component.status,
    reviewRequired: component.reviewRequired,
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

function structureNodeHtml(node, level = 0) {
  const componentCount = countStructureComponents(node);
  return `
    ${treeNodeHtml({
      level,
      title: node.title,
      meta: `${componentCount} mapped element(s)`,
      icon: structureIconType(node.title),
    })}
    ${node.components.map((component) => componentTreeRowHtml(component, level + 1)).join("")}
    ${node.children.map((child) => structureNodeHtml(child, level + 1)).join("")}
  `;
}

function countStructureComponents(node) {
  return node.components.length +
    node.children.reduce((total, child) => total + countStructureComponents(child), 0);
}

function treeNodeHtml(node = {}) {
  const classes = [
    "tree-row",
    node.componentId ? "tree-row-button selectable" : "",
    node.active ? "active" : "",
    node.reviewRequired ? "review-required" : "",
  ].filter(Boolean).join(" ");
  const style = `--level: ${Number(node.level) || 0};`;
  const body = `
    <span class="tree-chevron">${node.componentId ? "" : treeIconSvg("chevron")}</span>
    <span class="tree-icon tree-icon-${escapeAttr(node.icon || "element")}">${treeIconSvg(node.icon || "element")}</span>
    <span class="tree-copy">
      <span class="row-title">${escapeHtml(node.title || "Element")}</span>
      <span class="row-meta">${node.componentId ? `${statusHtml(node.status)} | ${escapeHtml(node.componentId)}` : escapeHtml(node.meta || "")}</span>
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

  return `<div class="${classes}" style="${style}" role="treeitem" aria-expanded="true">${body}</div>`;
}

function renderReviewQueue() {
  const entry = selectedEntry();
  const review = (entry?.pageMap?.components || []).filter((component) => {
    return component.reviewRequired || ["ambiguous", "changed", "removed"].includes(component.status);
  });

  if (!review.length) {
    els.reviewList.innerHTML = `<div class="empty-state">No review-required components.</div>`;
    return;
  }

  els.reviewList.innerHTML = review.map((component) => `
    <button class="review-item selectable ${component.componentId === state.selectedComponentId ? "active" : ""}"
      data-component-id="${escapeAttr(component.componentId)}" type="button">
      <span class="row-title">${escapeHtml(componentShortName(component))}</span>
      <span class="row-meta">${statusHtml(component.status)} | ${escapeHtml(component.componentId)}</span>
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
  const resolution = lastResolution ||
    state.lastResolutionByComponent[component.componentId] ||
    null;
  els.detail.className = "component-detail";
  els.detail.innerHTML = `
    <div class="detail-block">
      <h3>Identity</h3>
      <div><strong>${escapeHtml(component.displayAlias || componentShortName(component))}</strong></div>
      <div><code>${escapeHtml(component.componentId)}</code></div>
      <div>${statusHtml(component.status)} ${component.reviewRequired ? `<span class="badge">review</span>` : ""} ${sensitive ? `<span class="badge sensitive-badge">redacted</span>` : ""}</div>
    </div>
    <div class="detail-block detail-actions">
      <label>
        Display alias
        <input id="component-alias" type="text" value="${escapeAttr(component.displayAlias || "")}" placeholder="${escapeAttr(componentShortName(component))}">
      </label>
      <button id="btn-save-alias" type="button">Save alias</button>
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

function normalizeIdentifier(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

async function selectComponent(componentId) {
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

  try {
    const response = await chrome.runtime.sendMessage({
      type: Messages.HighlightMapperComponent,
      pageMap: entry.pageMap,
      component,
    });
    if (response?.ok === false) throw new Error(response.error || "Highlight failed.");
    state.lastResolutionByComponent[component.componentId] = response;
    renderDetail(response);
    setStatus(`Highlight: ${response.mapperState || "unknown"} (${response.mapperReason || "no reason"})`);
  } catch (error) {
    setStatus(`Highlight failed: ${error.message || error}`, true);
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
      reviewRequired: false,
      reviewDecision: {
        type: "accept_current_mapping",
        decidedAt: new Date().toISOString(),
        componentUid: current.componentUid || "",
        mapVersionId: current.capturedMapVersionId || "",
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

async function linkLiveCandidateAttempt(index) {
  const component = selectedComponent();
  const resolution = component
    ? state.lastResolutionByComponent[component.componentId]
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
      components: (entry.pageMap.components || []).map((item) => {
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

  const nextState = updater(structuredClone(current));
  const response = await chrome.runtime.sendMessage({
    type: Messages.SaveWorkflowMapperState,
    workflowId: entry.workflowId,
    state: nextState,
  });
  if (response?.ok === false) throw new Error(response.error || "Save failed.");

  const selectedEntryId = selection.nextEntryId || state.selectedEntryId;
  const selectedComponentId = selection.nextComponentId || state.selectedComponentId;
  state.states[entry.workflowId] = response.state || nextState;
  state.entries = flattenMapEntries(state.states);
  state.selectedEntryId = selectedEntryId;
  state.selectedComponentId = selectedComponentId;
  renderAll();
}

function setView(view) {
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

function statusColor(status = "") {
  if (status === "same") return "#22c55e";
  if (status === "changed") return "#38bdf8";
  if (status === "new") return "#a3e635";
  if (status === "ambiguous") return "#f59e0b";
  if (status === "removed") return "#ef4444";
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
  return String(value || "").trim().toLowerCase();
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
