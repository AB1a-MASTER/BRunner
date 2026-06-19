import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { GraphNode } from "./GraphNode.jsx";
import { RemovableEdge } from "./RemovableEdge.jsx";
import {
  canvasToGraphWorkflow,
  ensureWorkflowFilename,
  layoutCanvasNodes,
  workflowToCanvas,
} from "./graphStudioModel.js";
import { projectRuntimeState, summarizeExecution } from "./runtimeProjection.js";

const NODE_TYPES = { brunner: GraphNode };
const EDGE_TYPES = { removable: RemovableEdge };
const Messages = Object.freeze({
  GetNodeDefinitions: "GET_NODE_DEFINITIONS",
  ListWorkflows: "OS_LIST_WORKFLOWS",
  LoadWorkflow: "OS_LOAD_WORKFLOW",
  SaveWorkflow: "OS_SAVE_WORKFLOW",
  RenameWorkflow: "OS_RENAME_WORKFLOW",
  UpgradeWorkflow: "OS_UPGRADE_WORKFLOW",
  StartWorkflow: "START_WORKFLOW",
  StopWorkflow: "STOP_WORKFLOW",
  GetRuntimeState: "GET_RUNTIME_STATE",
  RuntimeStateChanged: "RUNTIME_STATE_CHANGED",
});

export function GraphStudio() {
  return <ReactFlowProvider><GraphStudioCanvas /></ReactFlowProvider>;
}

function GraphStudioCanvas() {
  const [definitions, setDefinitions] = useState([]);
  const [definitionsError, setDefinitionsError] = useState("");
  const [nodes, setNodes, applyNodeChanges] = useNodesState([]);
  const [edges, setEdges, applyEdgeChanges] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [loadedFilename, setLoadedFilename] = useState("");
  const [workflowName, setWorkflowName] = useState("Untitled");
  const [metadata, setMetadata] = useState(() => createNewMetadata());
  const [sourceSchema, setSourceSchema] = useState(2);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ kind: "neutral", text: "New v2 workflow" });
  const [execution, setExecution] = useState({
    status: "idle",
    currentNodeId: "",
    completedNodeIds: [],
    skippedNodeIds: [],
    totalSteps: 0,
  });
  const { screenToFlowPosition, fitView } = useReactFlow();
  const readOnly = sourceSchema === 1;
  const executionActive = ["starting", "running", "cancelling"].includes(execution.status);
  const editingLocked = readOnly || executionActive;
  const layoutDirection = metadata.settings?.graphLayoutDirection || "vertical";

  const definitionsByType = useMemo(
    () => new Map(definitions.map((definition) => [definition.type, definition])),
    [definitions],
  );
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;

  const refreshWorkflows = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: Messages.ListWorkflows });
      if (!isSuccess(response)) throw new Error(response?.error || "Could not list workflows.");
      const nextFiles = response.files || response.workflows || [];
      setFiles(nextFiles);
      setSelectedFile((current) => current && nextFiles.includes(current) ? current : (nextFiles[0] || ""));
    } catch (error) {
      setNotice({ kind: "error", text: error.message || String(error) });
    }
  }, []);

  useEffect(() => {
    let active = true;
    chrome.runtime.sendMessage({ type: Messages.GetNodeDefinitions })
      .then((response) => {
        if (!active) return;
        if (!response?.ok || !Array.isArray(response.definitions)) {
          throw new Error(response?.error || "Node definitions are unavailable.");
        }
        setDefinitions(response.definitions);
      })
      .catch((error) => {
        if (active) setDefinitionsError(error.message || String(error));
      });
    refreshWorkflows();
    return () => { active = false; };
  }, [refreshWorkflows]);

  useEffect(() => {
    const applyRuntimeState = (state) => {
      if (state?.execution) setExecution(state.execution);
    };
    const listener = (request) => {
      if (request?.type === Messages.RuntimeStateChanged) {
        applyRuntimeState(request.state);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    chrome.runtime.sendMessage({ type: Messages.GetRuntimeState })
      .then((response) => {
        if (response?.ok) applyRuntimeState(response.state);
      })
      .catch(() => {});
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => {
    setNodes((current) => projectRuntimeState(current, execution, readOnly));
    setEdges((current) => current.map((edge) => ({
      ...edge,
      data: {
        ...edge.data,
        readOnly,
        executionLocked: executionActive,
      },
    })));
  }, [execution, executionActive, readOnly, setEdges, setNodes]);

  const markDirty = useCallback(() => {
    if (!readOnly) setDirty(true);
  }, [readOnly]);

  const onNodesChange = useCallback((changes) => {
    applyNodeChanges(changes);
    if (changes.some((change) => !["select", "dimensions"].includes(change.type))) markDirty();
  }, [applyNodeChanges, markDirty]);

  const onEdgesChange = useCallback((changes) => {
    applyEdgeChanges(changes);
    if (changes.some((change) => change.type !== "select")) markDirty();
  }, [applyEdgeChanges, markDirty]);

  const createNode = useCallback((definition, position) => {
    if (readOnly) return;
    const id = `${definition.type.replace(/[^a-z0-9]+/gi, "-")}-${crypto.randomUUID().slice(0, 8)}`;
    const config = Object.fromEntries(
      (definition.config || [])
        .filter((field) => field.default !== undefined)
        .map((field) => [field.key, structuredClone(field.default)]),
    );
    setNodes((current) => current.concat({
      id,
      type: "brunner",
      position,
      data: {
        type: definition.type,
        definition,
        config,
        target: "",
        targetSource: "",
        targetEdited: false,
        executionMode: "enabled",
        skipWhen: "",
        collapsed: false,
        layoutDirection,
        readOnly: false,
        onMutate: () => setDirty(true),
      },
    }));
    setSelectedNodeId(id);
    setDirty(true);
  }, [layoutDirection, readOnly, setNodes]);

  const addFromPalette = useCallback((definition) => {
    createNode(definition, { x: 120 + nodes.length * 28, y: 100 + nodes.length * 110 });
  }, [createNode, nodes.length]);

  const onConnect = useCallback((connection) => {
    if (readOnly) return;
    setEdges((current) => addEdge({
      ...connection,
      id: `edge-${connection.source}-${connection.target}`,
      type: "removable",
      animated: false,
      data: { readOnly: false, onMutate: () => setDirty(true) },
    }, current));
    setDirty(true);
  }, [readOnly, setEdges]);

  const onDrop = useCallback((event) => {
    event.preventDefault();
    if (readOnly) return;
    const type = event.dataTransfer.getData("application/brunner-node");
    const definition = definitionsByType.get(type);
    if (!definition) return;
    createNode(definition, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  }, [createNode, definitionsByType, readOnly, screenToFlowPosition]);

  const updateSelectedNode = useCallback((patch) => {
    if (readOnly) return;
    setNodes((current) => current.map((node) => node.id === selectedNodeId
      ? { ...node, data: { ...node.data, ...patch } }
      : node));
    setDirty(true);
  }, [readOnly, selectedNodeId, setNodes]);

  const confirmDiscard = useCallback(() => {
    return !dirty || window.confirm("Discard unsaved graph changes?");
  }, [dirty]);

  const newWorkflow = useCallback(() => {
    if (!confirmDiscard()) return;
    setNodes([]);
    setEdges([]);
    setSelectedNodeId("");
    setLoadedFilename("");
    setWorkflowName("Untitled");
    setMetadata(createNewMetadata());
    setSourceSchema(2);
    setDirty(false);
    setNotice({ kind: "neutral", text: "New v2 workflow" });
  }, [confirmDiscard, setEdges, setNodes]);

  const loadWorkflow = useCallback(async () => {
    if (!selectedFile || !definitions.length || !confirmDiscard()) return;
    setBusy(true);
    setNotice({ kind: "neutral", text: `Loading ${selectedFile}…` });
    try {
      const response = await chrome.runtime.sendMessage({
        type: Messages.LoadWorkflow,
        filename: selectedFile,
      });
      if (!isSuccess(response)) throw new Error(response?.error || "Could not load workflow.");
      const content = response.content || response.workflow || response.data || response;
      const model = workflowToCanvas(content, definitionsByType);
      setNodes(model.nodes.map((node) => ({
        ...node,
        data: { ...node.data, onMutate: () => setDirty(true) },
      })));
      setEdges(model.edges.map((edge) => ({
        ...edge,
        data: { ...edge.data, onMutate: () => setDirty(true) },
      })));
      setSelectedNodeId("");
      setLoadedFilename(selectedFile);
      setWorkflowName(model.sourceSchema === 1
        ? stripJson(selectedFile)
        : (model.metadata.name || stripJson(selectedFile)));
      setMetadata(model.metadata);
      setSourceSchema(model.sourceSchema);
      setDirty(false);
      setNotice(model.readOnly
        ? { kind: "warning", text: "Legacy v1 loaded read-only · upgrade required to edit" }
        : { kind: "success", text: "Graph loaded" });
      window.setTimeout(() => fitView({ padding: 0.18, duration: 250 }), 0);
    } catch (error) {
      setNotice({ kind: "error", text: error.message || String(error) });
    } finally {
      setBusy(false);
    }
  }, [confirmDiscard, definitions.length, definitionsByType, fitView, selectedFile, setEdges, setNodes]);

  const createGraphContent = useCallback(() => canvasToGraphWorkflow(nodes, edges, {
    ...metadata,
    name: workflowName,
  }), [edges, metadata, nodes, workflowName]);

  const arrangeGraph = useCallback((direction = layoutDirection) => {
    const nextDirection = direction === "horizontal" ? "horizontal" : "vertical";
    setNodes((current) => layoutCanvasNodes(current, edges, nextDirection));
    setMetadata((current) => ({
      ...current,
      settings: { ...current.settings, graphLayoutDirection: nextDirection },
    }));
    if (!readOnly) setDirty(true);
    window.setTimeout(() => fitView({ padding: 0.18, duration: 250 }), 0);
  }, [edges, fitView, layoutDirection, readOnly, setNodes]);

  const saveWorkflow = useCallback(async () => {
    if (readOnly || busy || executionActive) return;
    setBusy(true);
    try {
      const content = createGraphContent();
      const desiredFilename = ensureWorkflowFilename(workflowName);
      const rename = Boolean(loadedFilename && loadedFilename !== desiredFilename);
      const response = await chrome.runtime.sendMessage(rename
        ? {
            type: Messages.RenameWorkflow,
            filename: loadedFilename,
            newFilename: desiredFilename,
            content,
          }
        : {
            type: Messages.SaveWorkflow,
            filename: desiredFilename,
            content,
          });
      if (!isSuccess(response)) throw new Error(response?.error || "Could not save workflow.");
      const savedFilename = response.newFilename || response.filename || desiredFilename;
      setLoadedFilename(savedFilename);
      setSelectedFile(savedFilename);
      setWorkflowName(stripJson(savedFilename));
      setMetadata((current) => ({ ...current, name: stripJson(savedFilename) }));
      setDirty(false);
      setNotice({ kind: "success", text: `Saved ${savedFilename}` });
      await refreshWorkflows();
    } catch (error) {
      setNotice({ kind: "error", text: error.message || String(error) });
    } finally {
      setBusy(false);
    }
  }, [busy, createGraphContent, executionActive, loadedFilename, readOnly, refreshWorkflows, workflowName]);

  const runOrStopWorkflow = useCallback(async () => {
    if (executionActive) {
      if (execution.status !== "running") return;
      try {
        const response = await chrome.runtime.sendMessage({ type: Messages.StopWorkflow });
        if (!response?.ok) throw new Error(response?.error || "Could not stop workflow.");
      } catch (error) {
        setNotice({ kind: "error", text: error.message || String(error) });
      }
      return;
    }

    try {
      const content = createGraphContent();
      setExecution({
        status: "starting",
        workflowName,
        currentNodeId: "",
        completedNodeIds: [],
        skippedNodeIds: [],
        totalSteps: nodes.length,
      });
      setNotice({ kind: "neutral", text: "Starting graph workflow…" });
      const response = await chrome.runtime.sendMessage({
        type: Messages.StartWorkflow,
        workflow: content,
      });
      if (!response?.ok) throw new Error(response?.error || "Workflow failed.");
      if (response.cancelled) {
        setNotice({ kind: "warning", text: "Workflow stopped" });
      } else {
        setNotice({
          kind: "success",
          text: `Completed ${response.executed || 0} · bypassed ${response.skipped || 0}`,
        });
      }
    } catch (error) {
      setExecution((current) => current.status === "starting"
        ? { ...current, status: "idle" }
        : current);
      setNotice({ kind: "error", text: error.message || String(error) });
    }
  }, [createGraphContent, execution.status, executionActive, nodes.length, workflowName]);

  const upgradeWorkflow = useCallback(async () => {
    if (!readOnly || !loadedFilename || busy) return;
    const confirmed = window.confirm(
      `Upgrade ${loadedFilename} to graph schema v2?\n\nThe original will be retained as ${loadedFilename}.v1.bak.`,
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      const content = createGraphContent();
      const response = await chrome.runtime.sendMessage({
        type: Messages.UpgradeWorkflow,
        filename: loadedFilename,
        content,
      });
      if (!isSuccess(response)) throw new Error(response?.error || "Could not upgrade workflow.");
      setSourceSchema(2);
      setNodes((current) => current.map((node) => ({
        ...node,
        data: { ...node.data, readOnly: false },
      })));
      setEdges((current) => current.map((edge) => ({
        ...edge,
        data: { ...edge.data, readOnly: false },
      })));
      setDirty(false);
      setNotice({
        kind: "success",
        text: `Upgraded · backup ${response.backupFilename || `${loadedFilename}.v1.bak`}`,
      });
    } catch (error) {
      setNotice({ kind: "error", text: error.message || String(error) });
    } finally {
      setBusy(false);
    }
  }, [busy, createGraphContent, loadedFilename, readOnly, setNodes]);

  return (
    <div className="graph-shell">
      <GraphHeader
        nodeCount={nodes.length}
        edgeCount={edges.length}
        busy={busy}
        readOnly={readOnly}
        onSave={saveWorkflow}
        execution={execution}
        executionActive={executionActive}
        onRun={runOrStopWorkflow}
      />
      <WorkflowBar
        files={files}
        selectedFile={selectedFile}
        onSelectedFile={setSelectedFile}
        workflowName={workflowName}
        onWorkflowName={(name) => { if (!readOnly) { setWorkflowName(name); setDirty(true); } }}
        domain={metadata.boundDomain}
        onDomain={(boundDomain) => { if (!readOnly) { setMetadata((current) => ({ ...current, boundDomain })); setDirty(true); } }}
        dirty={dirty}
        busy={busy || executionActive}
        readOnly={readOnly}
        loadedFilename={loadedFilename}
        notice={notice}
        onNew={newWorkflow}
        onLoad={loadWorkflow}
        onRefresh={refreshWorkflows}
        onUpgrade={upgradeWorkflow}
        layoutDirection={layoutDirection}
        onLayoutDirection={arrangeGraph}
        onArrange={() => arrangeGraph(layoutDirection)}
      />
      <main className="graph-layout">
        <NodePalette definitions={definitions} error={definitionsError} onAdd={addFromPalette} readOnly={editingLocked} />
        <section className="graph-canvas" aria-label="Workflow graph canvas">
          {readOnly && <div className="legacy-lock">Legacy v1 preview · upgrade to edit</div>}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = readOnly ? "none" : "move"; }}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId("")}
            onNodesDelete={(deleted) => {
              if (deleted.some((node) => node.id === selectedNodeId)) setSelectedNodeId("");
            }}
            nodesDraggable={!editingLocked}
            nodesConnectable={!editingLocked}
            edgesReconnectable={!editingLocked}
            deleteKeyCode={editingLocked ? null : ["Backspace", "Delete"]}
            fitView
            minZoom={0.25}
            maxZoom={1.8}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor="#3b82f6" maskColor="rgba(2, 6, 23, 0.72)" />
            {nodes.length === 0 && (
              <div className="canvas-empty"><NodeGlyphLarge /><strong>Build the first graph</strong><span>Drag a node here or select one from the palette.</span></div>
            )}
          </ReactFlow>
        </section>
        <PropertiesPanel node={selectedNode} onChange={updateSelectedNode} readOnly={editingLocked} />
      </main>
    </div>
  );
}

function GraphHeader({ nodeCount, edgeCount, busy, readOnly, onSave, execution, executionActive, onRun }) {
  return (
    <header className="graph-header">
      <div className="brand-lockup"><span className="brand-mark">BR</span><div><strong>BRunner</strong><span>Graph Studio</span></div></div>
      <div className="graph-stats" aria-label="Graph status"><span><b>{nodeCount}</b> nodes</span><span><b>{edgeCount}</b> edges</span><span className={`run-state run-state-${execution.status || "idle"}`} aria-live="polite">{summarizeExecution(execution)}</span></div>
      <nav className="graph-actions" aria-label="Studio actions">
        <a href="../studio/index.html" className="button secondary">Sequential Studio</a>
        <button type="button" className="button secondary" onClick={onSave} disabled={busy || readOnly || executionActive}>Save</button>
        <button type="button" className={`button ${executionActive ? "stop" : "primary"}`} onClick={onRun} disabled={busy || !nodeCount || (executionActive && execution.status !== "running")}>{execution.status === "starting" ? "Starting" : execution.status === "cancelling" ? "Stopping" : executionActive ? "Stop" : "Run"}</button>
      </nav>
    </header>
  );
}

function WorkflowBar(props) {
  return (
    <section className="workflow-bar" aria-label="Workflow persistence">
      <div className="workflow-picker">
        <label htmlFor="saved-workflow">Saved workflow</label>
        <select id="saved-workflow" value={props.selectedFile} onChange={(event) => props.onSelectedFile(event.target.value)} disabled={props.busy}>
          {!props.files.length && <option value="">No saved workflows</option>}
          {props.files.map((file) => <option key={file} value={file}>{file}</option>)}
        </select>
        <button type="button" className="compact-button" onClick={props.onLoad} disabled={!props.selectedFile || props.busy}>Load</button>
        <button type="button" className="compact-button icon-only" onClick={props.onRefresh} disabled={props.busy} aria-label="Refresh workflow list" title="Refresh workflow list"><RefreshIcon /></button>
      </div>
      <div className="workflow-fields">
        <label htmlFor="graph-workflow-name">Name</label>
        <input id="graph-workflow-name" value={props.workflowName} onChange={(event) => props.onWorkflowName(event.target.value)} disabled={props.readOnly || props.busy} />
        <label htmlFor="graph-workflow-domain">Domain</label>
        <input id="graph-workflow-domain" value={props.domain} onChange={(event) => props.onDomain(event.target.value)} disabled={props.readOnly || props.busy} placeholder="optional" />
      </div>
      <div className={`workflow-notice notice-${props.notice.kind}`} role="status"><span>{props.dirty ? "Unsaved" : props.readOnly ? "v1 read-only" : "Saved"}</span><p>{props.notice.text}</p></div>
      <div className="workflow-bar-actions">
        <label htmlFor="graph-layout-direction">Layout</label>
        <select id="graph-layout-direction" value={props.layoutDirection} onChange={(event) => props.onLayoutDirection(event.target.value)} disabled={props.busy}>
          <option value="vertical">Vertical</option>
          <option value="horizontal">Horizontal</option>
        </select>
        <button type="button" className="compact-button" onClick={props.onArrange} disabled={props.busy}>Arrange</button>
        {props.readOnly && <button type="button" className="compact-button upgrade" onClick={props.onUpgrade} disabled={props.busy || !props.loadedFilename}>Upgrade to v2</button>}
        <button type="button" className="compact-button" onClick={props.onNew} disabled={props.busy}>New</button>
      </div>
    </section>
  );
}

function NodePalette({ definitions, error, onAdd, readOnly }) {
  const [query, setQuery] = useState("");
  const visible = definitions.filter((definition) => `${definition.label} ${definition.type} ${definition.category}`.toLowerCase().includes(query.trim().toLowerCase()));
  const groups = visible.reduce((result, definition) => {
    const category = definition.category || "Other";
    result[category] = result[category] || [];
    result[category].push(definition);
    return result;
  }, {});
  return (
    <aside className="graph-sidebar palette-panel" aria-label="Node palette">
      <div className="panel-heading"><div><span>Library</span><h2>Nodes</h2></div><b>{visible.length}</b></div>
      <label className="search-field"><span className="sr-only">Search nodes</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search nodes" /></label>
      <div className="palette-scroll">
        {error && <p className="panel-error">{error}</p>}
        {readOnly && <p className="readonly-help">Upgrade this legacy workflow before adding nodes.</p>}
        {Object.entries(groups).map(([category, items]) => (
          <section className="palette-group" key={category}><h3>{category}</h3>{items.map((definition) => (
            <button type="button" className="palette-node" key={definition.type} draggable={!readOnly} disabled={readOnly}
              onDragStart={(event) => { event.dataTransfer.setData("application/brunner-node", definition.type); event.dataTransfer.effectAllowed = "move"; }}
              onClick={() => onAdd(definition)}>
              <span className="palette-glyph"><NodeGlyphSmall /></span><span><strong>{definition.label}</strong><code>{definition.type}</code></span>
            </button>
          ))}</section>
        ))}
      </div>
    </aside>
  );
}

function PropertiesPanel({ node, onChange, readOnly }) {
  if (!node) return <aside className="graph-sidebar properties-panel"><div className="panel-heading"><div><span>Inspector</span><h2>Properties</h2></div></div><div className="properties-empty"><NodeGlyphLarge /><p>Select a node to inspect its configuration.</p></div></aside>;
  const definition = node.data.definition;
  const setConfig = (key, value) => onChange({ config: { ...node.data.config, [key]: value } });
  return (
    <aside className="graph-sidebar properties-panel">
      <div className="panel-heading"><div><span>Inspector</span><h2>{definition.label}</h2></div></div>
      <div className="properties-scroll">
        <div className="node-identity"><code>{node.data.type}</code><span>{readOnly ? "Legacy preview" : `Node ${node.id.slice(-8)}`}</span></div>
        <section className="property-section" aria-labelledby="execution-heading"><h3 id="execution-heading">Execution</h3>
          <Field label="Node mode" htmlFor="property-execution-mode"><select id="property-execution-mode" value={node.data.executionMode || "enabled"} disabled={readOnly} onChange={(event) => onChange({ executionMode: event.target.value })}><option value="enabled">Enabled</option><option value="disabled">Bypassed (always skip)</option><option value="conditional">Conditional bypass</option></select></Field>
          {node.data.executionMode === "conditional" && <Field label="Bypass when" required htmlFor="property-skip-when" help="Skip when this expression resolves to true."><input id="property-skip-when" value={node.data.skipWhen || ""} disabled={readOnly} onChange={(event) => onChange({ skipWhen: event.target.value })} placeholder="{{skip_this_step}}" /></Field>}
          {node.data.executionMode === "disabled" && <p className="bypass-note">Connections remain intact; runtime passes over this node.</p>}
        </section>
        <section className="property-section" aria-labelledby="configuration-heading"><h3 id="configuration-heading">Configuration</h3>
          {definition.targetRequired && <Field label="Target Element" required htmlFor="property-target"><input id="property-target" value={node.data.target || ""} disabled={readOnly} onChange={(event) => onChange({ target: event.target.value, targetEdited: true })} placeholder="CSS selector or recorded target" /></Field>}
          {(definition.config || []).map((field) => <ConfigField key={field.key} field={field} value={node.data.config[field.key] ?? field.default ?? ""} config={node.data.config} onChange={setConfig} disabled={readOnly} />)}
        </section>
      </div>
    </aside>
  );
}

function ConfigField({ field, value, config, onChange, disabled }) {
  if (field.visibleWhen && String(config[field.visibleWhen.field] ?? "") !== String(field.visibleWhen.equals)) return null;
  const id = `property-${field.key}`;
  let control;
  if (field.kind === "select") control = <select id={id} value={String(value)} disabled={disabled} onChange={(event) => onChange(field.key, event.target.value)}>{(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}</select>;
  else if (["textarea", "value"].includes(field.kind)) control = <textarea id={id} rows="5" disabled={disabled} value={typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)} onChange={(event) => onChange(field.key, event.target.value)} />;
  else control = <input id={id} value={String(value)} disabled={disabled} inputMode={field.kind === "number" ? "numeric" : undefined} onChange={(event) => onChange(field.key, event.target.value)} />;
  return <Field label={field.label || field.key} required={field.required} help={field.help} htmlFor={id}>{control}</Field>;
}

function Field({ label, required, help, htmlFor, children }) { return <div className="property-field"><label htmlFor={htmlFor}>{label}{required ? " *" : ""}</label>{children}{help && <small>{help}</small>}</div>; }
function isSuccess(response) { return Boolean(response && (response.ok === true || response.status === "success")); }
function stripJson(filename) { return String(filename || "Untitled").replace(/\.json$/i, ""); }
function createNewMetadata() { return { id: crypto.randomUUID(), name: "Untitled", boundDomain: "", settings: { reuseExistingTabs: false, graphLayoutDirection: "vertical" }, variables: {} }; }
function NodeGlyphSmall() { return <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/><path d="M10 7h4a3 3 0 0 1 3 3v4"/></svg>; }
function NodeGlyphLarge() { return <svg aria-hidden="true" viewBox="0 0 48 48"><rect x="7" y="7" width="13" height="13" rx="3"/><rect x="28" y="28" width="13" height="13" rx="3"/><path d="M20 13.5h8a7 7 0 0 1 7 7V28"/></svg>; }
function RefreshIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2 5M20 5v6h-6"/></svg>; }
