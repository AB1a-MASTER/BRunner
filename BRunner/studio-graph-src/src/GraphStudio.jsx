import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { GraphNode } from "./GraphNode.jsx";
import { RemovableEdge } from "./RemovableEdge.jsx";
import studioIcon from "../../icons/icon2.png";
import {
  canvasToGraphWorkflow,
  ensureWorkflowFilename,
  layoutCanvasNodes,
  workflowToCanvas,
} from "./graphStudioModel.js";
import {
  filterExecutionLogs,
  projectRuntimeState,
  summarizeExecution,
  summarizeExecutionLogs,
} from "./runtimeProjection.js";
import {
  CanvasTool,
  getCanvasInteraction,
  getMiniMapNodeColor,
  isCanvasShortcutTarget,
} from "./canvasInteraction.js";
import {
  DEFAULT_STUDIO_PREFERENCES,
  InspectorMode,
  LogHandlingPolicy,
  StudioDensity,
  loadStudioPreferences,
  normalizeStudioPreferences,
  saveStudioPreferences,
} from "../../core/studioPreferences.js";

const NODE_TYPES = { brunner: GraphNode };
const EDGE_TYPES = { removable: RemovableEdge };
const Messages = Object.freeze({
  GetNodeDefinitions: "GET_NODE_DEFINITIONS",
  ListWorkflows: "OS_LIST_WORKFLOWS",
  LoadWorkflow: "OS_LOAD_WORKFLOW",
  SaveWorkflow: "OS_SAVE_WORKFLOW",
  RenameWorkflow: "OS_RENAME_WORKFLOW",
  UpgradeWorkflow: "OS_UPGRADE_WORKFLOW",
  DeleteWorkflow: "OS_DELETE_WORKFLOW",
  DuplicateWorkflow: "OS_DUPLICATE_WORKFLOW",
  StartWorkflow: "START_WORKFLOW",
  StopWorkflow: "STOP_WORKFLOW",
  GetRuntimeState: "GET_RUNTIME_STATE",
  RuntimeStateChanged: "RUNTIME_STATE_CHANGED",
  ClearExecutionLogs: "CLEAR_EXECUTION_LOGS",
  SaveExecutionLog: "OS_SAVE_EXECUTION_LOG",
  StudioReceiveStep: "STUDIO_RECEIVE_STEP",
  CheckBridgeStatus: "CHECK_BRIDGE_STATUS",
  ToggleRecording: "TOGGLE_RECORDING",
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
  const [uiPreferences, setUiPreferences] = useState(DEFAULT_STUDIO_PREFERENCES);
  const [logFilterNodeId, setLogFilterNodeId] = useState("");
  const [canvasTool, setCanvasTool] = useState(CanvasTool.Select);
  const [temporaryPan, setTemporaryPan] = useState(false);
  const [canvasHasFocus, setCanvasHasFocus] = useState(false);
  const [hostStatus, setHostStatus] = useState("checking");
  const [recording, setRecording] = useState({
    isRecording: false,
    tabPolicy: "openerDescendants",
  });
  const [execution, setExecution] = useState({
    status: "idle",
    currentNodeId: "",
    completedNodeIds: [],
    skippedNodeIds: [],
    totalSteps: 0,
    logs: [],
  });
  const handledLogRunRef = useRef("");
  const { screenToFlowPosition, fitView, getNodes, getEdges } = useReactFlow();
  const readOnly = sourceSchema === 1;
  const executionActive = ["starting", "running", "cancelling"].includes(execution.status);
  const recordingActive = recording.isRecording === true;
  const editingLocked = readOnly || executionActive;
  const canvasInteraction = getCanvasInteraction({
    tool: canvasTool,
    temporaryPan,
    editingLocked,
    canvasHasFocus,
  });
  const layoutDirection = metadata.settings?.graphLayoutDirection || "vertical";
  const logsOpen = uiPreferences.panels.executionLogsExpanded;
  const libraryExpanded = uiPreferences.panels.nodeLibraryExpanded;
  const inspectorPinned = uiPreferences.inspectorMode === InspectorMode.Pinned;
  const inspectorVisible = inspectorPinned || Boolean(selectedNodeId);

  const definitionsByType = useMemo(
    () => new Map(definitions.map((definition) => [definition.type, definition])),
    [definitions],
  );
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;
  const selectedNodeCount = nodes.filter((node) => node.selected).length;

  useEffect(() => {
    let active = true;
    loadStudioPreferences()
      .then((preferences) => { if (active) setUiPreferences(preferences); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const updateUiPreferences = useCallback((patch) => {
    setUiPreferences((current) => {
      const next = normalizeStudioPreferences({
        ...current,
        ...patch,
        panels: { ...current.panels, ...(patch?.panels || {}) },
      });
      saveStudioPreferences(next).catch(() => {});
      return next;
    });
  }, []);

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

  const checkHostStatus = useCallback(async () => {
    setHostStatus("checking");
    try {
      const response = await chrome.runtime.sendMessage({ type: Messages.CheckBridgeStatus });
      const connected = Boolean(response?.connected);
      setHostStatus(connected ? "connected" : "disconnected");
      if (connected) await refreshWorkflows();
      return connected;
    } catch {
      setHostStatus("disconnected");
      return false;
    }
  }, [refreshWorkflows]);

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
    return () => { active = false; };
  }, [refreshWorkflows]);

  useEffect(() => {
    checkHostStatus();
  }, [checkHostStatus]);

  useEffect(() => {
    const applyRuntimeState = (state) => {
      if (state?.execution) setExecution(state.execution);
      if (state?.recording) setRecording(state.recording);
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
    const onKeyDown = (event) => {
      if (isCanvasShortcutTarget(event.target)) return;
      if (event.key === "Escape") {
        setTemporaryPan(false);
        setSelectedNodeId("");
        setNodes((current) => current.map((node) => node.selected ? { ...node, selected: false } : node));
        setEdges((current) => current.map((edge) => edge.selected ? { ...edge, selected: false } : edge));
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        setTemporaryPan(true);
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key?.toLowerCase() === "h") setCanvasTool(CanvasTool.Hand);
      if (event.key?.toLowerCase() === "v") setCanvasTool(CanvasTool.Select);
    };
    const onKeyUp = (event) => {
      if (event.code === "Space") setTemporaryPan(false);
    };
    const onBlur = () => setTemporaryPan(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [setEdges, setNodes]);

  useEffect(() => {
    setNodes((current) => projectRuntimeState(
      current,
      execution,
      readOnly,
      canvasInteraction.effectiveTool === CanvasTool.Hand,
    ));
    setEdges((current) => current.map((edge) => ({
      ...edge,
      data: {
        ...edge.data,
        readOnly,
        executionLocked: executionActive,
        navigationLocked: canvasInteraction.effectiveTool === CanvasTool.Hand,
      },
    })));
  }, [canvasInteraction.effectiveTool, execution, executionActive, readOnly, setEdges, setNodes]);

  useEffect(() => {
    if (logFilterNodeId && !nodes.some((node) => node.id === logFilterNodeId)) {
      setLogFilterNodeId("");
    }
  }, [logFilterNodeId, nodes]);

  const markDirty = useCallback(() => {
    if (!readOnly) setDirty(true);
  }, [readOnly]);

  const selectCanvasNode = useCallback((nodeId) => {
    setNodes((current) => current.every((node) => node.selected === (node.id === nodeId))
      ? current
      : current.map((node) => ({
          ...node,
          selected: node.id === nodeId,
        })));
    setEdges((current) => current.map((edge) => edge.selected
      ? { ...edge, selected: false }
      : edge));
    setSelectedNodeId(nodeId);
  }, [setEdges, setNodes]);

  const setInspectorMode = useCallback((mode) => {
    updateUiPreferences({ inspectorMode: mode });
    if (mode !== InspectorMode.Auto) return;
    setSelectedNodeId("");
    setNodes((current) => current.map((node) => node.selected
      ? { ...node, selected: false }
      : node));
    setEdges((current) => current.map((edge) => edge.selected
      ? { ...edge, selected: false }
      : edge));
  }, [setEdges, setNodes, updateUiPreferences]);

  const onNodesChange = useCallback((changes) => {
    applyNodeChanges(changes);
    if (changes.some((change) => !["select", "dimensions"].includes(change.type))) markDirty();
  }, [applyNodeChanges, markDirty]);

  const onEdgesChange = useCallback((changes) => {
    applyEdgeChanges(changes);
    if (changes.some((change) => change.type !== "select")) markDirty();
  }, [applyEdgeChanges, markDirty]);

  const createNode = useCallback((definition, position) => {
    if (!canvasInteraction.canEdit) return;
    const id = `${definition.type.replace(/[^a-z0-9]+/gi, "-")}-${crypto.randomUUID().slice(0, 8)}`;
    const config = Object.fromEntries(
      (definition.config || [])
        .filter((field) => field.default !== undefined)
        .map((field) => [field.key, structuredClone(field.default)]),
    );
    setNodes((current) => current.map((node) => ({ ...node, selected: false })).concat({
      id,
      type: "brunner",
      position,
      selected: true,
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
    window.setTimeout(() => selectCanvasNode(id), 0);
    setDirty(true);
  }, [canvasInteraction.canEdit, layoutDirection, selectCanvasNode, setNodes]);

  const addFromPalette = useCallback((definition) => {
    createNode(definition, { x: 120 + nodes.length * 28, y: 100 + nodes.length * 110 });
  }, [createNode, nodes.length]);

  const appendRecordedStep = useCallback((step) => {
    if (!step || !definitionsByType.size) return;
    try {
      const currentNodes = getNodes();
      const currentEdges = getEdges();
      const model = workflowToCanvas({ steps: [step] }, definitionsByType);
      const sourceNode = model.nodes[0];
      if (!sourceNode) return;
      const usedIds = new Set(currentNodes.map((node) => node.id));
      const baseId = sourceNode.id || "recorded-node";
      let id = baseId;
      let suffix = 2;
      while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
      const index = currentNodes.length;
      const node = {
        ...sourceNode,
        id,
        selected: true,
        position: layoutDirection === "horizontal"
          ? { x: 90 + index * 340, y: 120 }
          : { x: 120, y: 70 + index * 300 },
        data: {
          ...sourceNode.data,
          readOnly: false,
          layoutDirection,
          onMutate: () => setDirty(true),
        },
      };
      const sourceIds = new Set(currentEdges.map((edge) => edge.source));
      const terminal = [...currentNodes].reverse().find((candidate) => !sourceIds.has(candidate.id));
      setNodes(currentNodes.map((candidate) => ({ ...candidate, selected: false })).concat(node));
      if (terminal) {
        setEdges(currentEdges.concat({
          id: `edge-${terminal.id}-${id}`,
          source: terminal.id,
          sourceHandle: "success",
          target: id,
          targetHandle: "input",
          type: "removable",
          animated: false,
          data: { readOnly: false, onMutate: () => setDirty(true) },
        }));
      }
      setSelectedNodeId(id);
      setDirty(true);
      window.setTimeout(() => fitView({ padding: 0.18, duration: 220 }), 0);
    } catch (error) {
      setNotice({ kind: "error", text: `Could not add recorded node: ${error.message || error}` });
    }
  }, [definitionsByType, fitView, getEdges, getNodes, layoutDirection, setEdges, setNodes]);

  useEffect(() => {
    const listener = (request) => {
      if (request?.type === Messages.StudioReceiveStep) appendRecordedStep(request.step);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [appendRecordedStep]);

  const onConnect = useCallback((connection) => {
    if (!canvasInteraction.canEdit) return;
    setEdges((current) => addEdge({
      ...connection,
      id: `edge-${connection.source}-${connection.target}`,
      type: "removable",
      animated: false,
      data: { readOnly: false, onMutate: () => setDirty(true) },
    }, current));
    setDirty(true);
  }, [canvasInteraction.canEdit, setEdges]);

  const onDrop = useCallback((event) => {
    event.preventDefault();
    if (!canvasInteraction.canEdit) return;
    const type = event.dataTransfer.getData("application/brunner-node");
    const definition = definitionsByType.get(type);
    if (!definition) return;
    createNode(definition, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  }, [canvasInteraction.canEdit, createNode, definitionsByType, screenToFlowPosition]);

  const updateSelectedNode = useCallback((patch) => {
    if (!canvasInteraction.canEdit) return;
    setNodes((current) => current.map((node) => node.id === selectedNodeId
      ? { ...node, data: { ...node.data, ...patch } }
      : node));
    setDirty(true);
  }, [canvasInteraction.canEdit, selectedNodeId, setNodes]);

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

  const duplicateWorkflow = useCallback(async () => {
    if (!selectedFile || busy || hostStatus !== "connected") return;
    const base = stripJson(selectedFile);
    const requestedName = window.prompt("Name the duplicated workflow", `${base}_copy`);
    if (!requestedName?.trim()) return;
    const newFilename = ensureWorkflowFilename(requestedName.trim());
    setBusy(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: Messages.DuplicateWorkflow,
        filename: selectedFile,
        newFilename,
      });
      if (!isSuccess(response)) throw new Error(response?.error || "Could not duplicate workflow.");
      await refreshWorkflows();
      setSelectedFile(response.newFilename || response.filename || newFilename);
      setNotice({ kind: "success", text: `Duplicated as ${response.newFilename || response.filename || newFilename}` });
    } catch (error) {
      setNotice({ kind: "error", text: error.message || String(error) });
    } finally {
      setBusy(false);
    }
  }, [busy, hostStatus, refreshWorkflows, selectedFile]);

  const deleteWorkflow = useCallback(async () => {
    if (!selectedFile || busy || hostStatus !== "connected") return;
    if (!window.confirm(`Delete ${selectedFile}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: Messages.DeleteWorkflow,
        filename: selectedFile,
      });
      if (!isSuccess(response)) throw new Error(response?.error || "Could not delete workflow.");
      if (loadedFilename === selectedFile) {
        setLoadedFilename("");
        setDirty(true);
      }
      setNotice({ kind: "success", text: `Deleted ${selectedFile}` });
      await refreshWorkflows();
    } catch (error) {
      setNotice({ kind: "error", text: error.message || String(error) });
    } finally {
      setBusy(false);
    }
  }, [busy, hostStatus, loadedFilename, refreshWorkflows, selectedFile]);

  const createGraphContent = useCallback(() => canvasToGraphWorkflow(nodes, edges, {
    ...metadata,
    name: workflowName,
  }), [edges, metadata, nodes, workflowName]);

  const graphSaveError = useMemo(() => {
    try {
      createGraphContent();
      return "";
    } catch (error) {
      return error.message || String(error);
    }
  }, [createGraphContent]);
  const canSave = dirty
    && !readOnly
    && !busy
    && !executionActive
    && !recordingActive
    && hostStatus === "connected"
    && !graphSaveError;

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

  const toggleRecording = useCallback(async () => {
    if (executionActive) return;
    try {
      const response = await chrome.runtime.sendMessage({
        type: Messages.ToggleRecording,
        enabled: !recordingActive,
        tabPolicy: recording.tabPolicy || "openerDescendants",
      });
      if (!response?.ok) throw new Error(response?.error || "Could not change recording state.");
      if (response.recording) setRecording(response.recording);
      setNotice({
        kind: response.recording?.isRecording ? "warning" : "success",
        text: response.recording?.isRecording ? "Recording browser actions" : "Recording stopped",
      });
    } catch (error) {
      setNotice({ kind: "error", text: error.message || String(error) });
    }
  }, [executionActive, recording.tabPolicy, recordingActive]);

  const clearExecutionLogs = useCallback(async ({ announce = true } = {}) => {
    try {
      const response = await chrome.runtime.sendMessage({ type: Messages.ClearExecutionLogs });
      if (!response?.ok) throw new Error(response?.error || "Could not clear execution logs.");
      if (response.state?.execution) setExecution(response.state.execution);
      if (announce) setNotice({ kind: "success", text: "Execution logs cleared" });
      return true;
    } catch (error) {
      setNotice({ kind: "error", text: error.message || String(error) });
      return false;
    }
  }, []);

  const saveExecutionLogs = useCallback(async (snapshot = execution, { announce = true } = {}) => {
    if (hostStatus !== "connected" || !snapshot.logs?.length) return false;
    try {
      const response = await chrome.runtime.sendMessage({
        type: Messages.SaveExecutionLog,
        workflowName: snapshot.workflowName || workflowName,
        runId: snapshot.runId || "run",
        logs: snapshot.logs,
      });
      if (!isSuccess(response)) throw new Error(response?.error || "Could not save execution logs.");
      if (announce) setNotice({ kind: "success", text: `Saved execution log ${response.filename || ""}`.trim() });
      return true;
    } catch (error) {
      setNotice({ kind: "error", text: error.message || String(error) });
      return false;
    }
  }, [execution, hostStatus, workflowName]);

  useEffect(() => {
    const terminal = ["completed", "failed", "cancelled"].includes(execution.status);
    const runKey = `${execution.runId || "run"}:${execution.status}`;
    if (!terminal || !execution.logs?.length || handledLogRunRef.current === runKey) return;
    const policy = uiPreferences.logPolicy;
    if ([LogHandlingPolicy.SaveAfterRun, LogHandlingPolicy.ClearAndSaveAfterRun].includes(policy)
      && hostStatus !== "connected") return;
    handledLogRunRef.current = runKey;
    void (async () => {
      if (policy === LogHandlingPolicy.ClearAfterRun) {
        await clearExecutionLogs({ announce: false });
      } else if (policy === LogHandlingPolicy.SaveAfterRun) {
        await saveExecutionLogs(execution, { announce: false });
      } else if (policy === LogHandlingPolicy.ClearAndSaveAfterRun) {
        const saved = await saveExecutionLogs(execution, { announce: false });
        if (saved) await clearExecutionLogs({ announce: false });
      }
    })();
  }, [clearExecutionLogs, execution, hostStatus, saveExecutionLogs, uiPreferences.logPolicy]);

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
        logs: [],
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
    <div className={`graph-shell${logsOpen ? " logs-open" : ""}`}>
      <a className="skip-link" href="#workflow-graph-canvas">Skip to graph canvas</a>
      <StudioCommandBar
        busy={busy}
        nodeCount={nodes.length}
        hostStatus={hostStatus}
        onRetryHost={checkHostStatus}
        onNew={newWorkflow}
        files={files}
        selectedFile={selectedFile}
        onSelectedFile={setSelectedFile}
        onLoad={loadWorkflow}
        onRefresh={refreshWorkflows}
        onDuplicate={duplicateWorkflow}
        onDelete={deleteWorkflow}
        density={uiPreferences.density}
        onDensity={(density) => updateUiPreferences({ density })}
        recording={recording}
        recordingActive={recordingActive}
        onRecordingPolicy={(tabPolicy) => setRecording((current) => ({ ...current, tabPolicy }))}
        onToggleRecording={toggleRecording}
        execution={execution}
        executionActive={executionActive}
        onRun={runOrStopWorkflow}
      />
      <main className={`graph-layout${libraryExpanded ? "" : " library-collapsed"}${inspectorVisible ? "" : " inspector-collapsed"}`}>
        {libraryExpanded ? <NodePalette definitions={definitions} error={definitionsError} onAdd={addFromPalette} onCollapse={() => updateUiPreferences({ panels: { nodeLibraryExpanded: false } })} readOnly={!canvasInteraction.canEdit} navigationMode={canvasInteraction.effectiveTool === CanvasTool.Hand} /> : <PanelRestoreRail side="left" label="Show Node Library" onRestore={() => updateUiPreferences({ panels: { nodeLibraryExpanded: true } })} />}
        <section
          id="workflow-graph-canvas"
          className={`graph-canvas tool-${canvasInteraction.effectiveTool}`}
          aria-label="Workflow graph canvas"
          tabIndex="0"
          onFocusCapture={() => setCanvasHasFocus(true)}
          onPointerDown={(event) => {
            if (canvasInteraction.canSelect && event.target.classList?.contains("react-flow__pane")) {
              setSelectedNodeId("");
            }
          }}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setCanvasHasFocus(false);
          }}
        >
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
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = canvasInteraction.canEdit ? "move" : "none"; }}
            onNodeClick={canvasInteraction.canSelect ? (_, node) => setSelectedNodeId(node.id) : undefined}
            onNodesDelete={(deleted) => {
              if (deleted.some((node) => node.id === selectedNodeId)) setSelectedNodeId("");
            }}
            panOnDrag={canvasInteraction.panOnDrag}
            selectionOnDrag={canvasInteraction.selectionOnDrag}
            selectionMode={SelectionMode.Partial}
            multiSelectionKeyCode={["Meta", "Control", "Shift"]}
            panActivationKeyCode={null}
            elementsSelectable={canvasInteraction.elementsSelectable}
            nodesFocusable={canvasInteraction.canSelect}
            edgesFocusable={canvasInteraction.canSelect}
            nodesDraggable={canvasInteraction.nodesDraggable}
            nodesConnectable={canvasInteraction.nodesConnectable}
            edgesReconnectable={canvasInteraction.edgesReconnectable}
            deleteKeyCode={canvasInteraction.deleteKeyCode}
            fitView
            minZoom={0.25}
            maxZoom={1.8}
            proOptions={{ hideAttribution: true }}
          >
            <CanvasToolBar tool={canvasTool} effectiveTool={canvasInteraction.effectiveTool} selectedNodeCount={selectedNodeCount} overviewVisible={uiPreferences.overviewVisible} onOverview={() => updateUiPreferences({ overviewVisible: !uiPreferences.overviewVisible })} onTool={setCanvasTool} />
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
            <Controls showInteractive={false} />
            {uiPreferences.overviewVisible && <MiniMap pannable zoomable nodeColor={getMiniMapNodeColor} maskColor="rgba(2, 6, 23, 0.72)" ariaLabel="Workflow overview with live execution states" />}
            {nodes.length === 0 && (
              <div className="canvas-empty"><NodeGlyphLarge /><strong>Build the first graph</strong><span>Drag a node here or select one from the palette.</span></div>
            )}
          </ReactFlow>
        </section>
        {inspectorVisible ? <InspectorPanel
          node={selectedNode}
          onNodeChange={updateSelectedNode}
          readOnly={!canvasInteraction.canEdit}
          navigationMode={canvasInteraction.effectiveTool === CanvasTool.Hand}
          workflowName={workflowName}
          onWorkflowName={(name) => { if (!readOnly) { setWorkflowName(name); setDirty(true); } }}
          metadata={metadata}
          variables={execution.variables || []}
          onMetadata={(patch) => { if (!readOnly) { setMetadata((current) => ({ ...current, ...patch })); setDirty(true); } }}
          nodeCount={nodes.length}
          edgeCount={edges.length}
          dirty={dirty}
          notice={notice}
          graphSaveError={graphSaveError}
          canSave={canSave}
          onSave={saveWorkflow}
          sourceSchema={sourceSchema}
          loadedFilename={loadedFilename}
          busy={busy || executionActive || recordingActive}
          hostConnected={hostStatus === "connected"}
          onUpgrade={upgradeWorkflow}
          layoutDirection={layoutDirection}
          onLayoutDirection={arrangeGraph}
          onArrange={() => arrangeGraph(layoutDirection)}
          inspectorMode={uiPreferences.inspectorMode}
          onInspectorMode={setInspectorMode}
        /> : <PanelRestoreRail side="right" label="Pin Inspector" onRestore={() => setInspectorMode(InspectorMode.Pinned)} />}
      </main>
      {logsOpen && (
        <ExecutionLogPanel
          logs={execution.logs || []}
          nodes={nodes}
          filterNodeId={logFilterNodeId}
          onFilterNodeId={setLogFilterNodeId}
          onSelectNode={selectCanvasNode}
          onCollapse={() => updateUiPreferences({ panels: { executionLogsExpanded: false } })}
          logPolicy={uiPreferences.logPolicy}
          onLogPolicy={(logPolicy) => updateUiPreferences({ logPolicy })}
          hostConnected={hostStatus === "connected"}
          onClear={() => clearExecutionLogs()}
          onSave={() => saveExecutionLogs()}
        />
      )}
      {!logsOpen && <button type="button" className="logs-restore" onClick={() => updateUiPreferences({ panels: { executionLogsExpanded: true } })} aria-label="Show Execution Logs" title="Show Execution Logs"><LogsIcon /></button>}
    </div>
  );
}

function CanvasToolBar({ tool, effectiveTool, selectedNodeCount, overviewVisible, onOverview, onTool }) {
  const temporary = tool !== effectiveTool;
  return (
    <div className="canvas-tool-bar nodrag nopan" role="toolbar" aria-label="Canvas tools">
      <button type="button" className={effectiveTool === CanvasTool.Select ? "is-active" : ""} onClick={() => onTool(CanvasTool.Select)} aria-label="Selector tool" aria-pressed={tool === CanvasTool.Select} aria-keyshortcuts="V" title="Selector (V)"><SelectorIcon /></button>
      <button type="button" className={effectiveTool === CanvasTool.Hand ? "is-active" : ""} onClick={() => onTool(CanvasTool.Hand)} aria-label="Hand tool" aria-pressed={tool === CanvasTool.Hand} aria-keyshortcuts="H" title="Hand (H or hold Space)"><HandIcon /></button>
      <button type="button" className={overviewVisible ? "is-active" : ""} onClick={onOverview} aria-label={overviewVisible ? "Hide overview map" : "Show overview map"} aria-pressed={overviewVisible} title={overviewVisible ? "Hide overview map" : "Show overview map"}><OverviewIcon /></button>
      <span className="canvas-tool-status" aria-live="polite">{temporary ? "Temporary Hand mode" : `${effectiveTool === CanvasTool.Hand ? "Hand" : "Selector"} mode`}. {selectedNodeCount} nodes selected.</span>
    </div>
  );
}

function PanelRestoreRail({ side, label, onRestore }) {
  return <aside className={`panel-restore-rail rail-${side}`}><button type="button" onClick={onRestore} aria-label={label} aria-expanded="false" title={label}><PanelIcon side={side} /></button></aside>;
}

function StudioCommandBar(props) {
  const hostLabel = props.hostStatus === "connected"
    ? "Connected to Host"
    : props.hostStatus === "checking" ? "Connecting to Host" : "Host Disconnected";
  return (
    <header className="studio-command-bar">
      <nav className="command-group identity-group" aria-label="Identity and navigation">
        <div className="brand-lockup"><img className="brand-mark" src={studioIcon} alt="" /><div><strong>BRunner</strong><span>Graph Studio</span></div></div>
        <button type="button" className="command-button" onClick={props.onNew} disabled={props.busy || props.executionActive || props.recordingActive} title="Create a new workflow"><PlusIcon /><span>New</span></button>
        <a href="../studio/index.html" className="command-button" title="Open Sequential Studio"><SequenceIcon /><span>Sequential</span></a>
      </nav>

      <div className={`host-connection host-${props.hostStatus}`} role="status" aria-live="polite">
        <span className="host-dot" aria-hidden="true" />
        <span>{hostLabel}</span>
        {props.hostStatus === "disconnected" && <button type="button" onClick={props.onRetryHost} title="Retry native host connection">Retry</button>}
      </div>

      <div className="command-sections">
        <section className="command-group" aria-label="Display controls">
          <span className="command-group-label">View</span>
          <select aria-label="Studio display size" title="Change the display size in both Studios" value={props.density} onChange={(event) => props.onDensity(event.target.value)}>
            <option value={StudioDensity.Compact}>Compact</option>
            <option value={StudioDensity.Comfortable}>Comfortable</option>
            <option value={StudioDensity.Large}>Large</option>
          </select>
        </section>
        <section className="command-group" aria-label="Recording controls">
          <span className="command-group-label">Record</span>
          <select aria-label="Recording tab policy" title="Choose which tabs recording follows" value={props.recording.tabPolicy || "openerDescendants"} onChange={(event) => props.onRecordingPolicy(event.target.value)} disabled={props.recordingActive || props.executionActive}>
            <option value="openerDescendants">Opened tabs</option>
            <option value="activeTab">Active tab</option>
          </select>
          <button type="button" className={`command-button${props.recordingActive ? " is-recording" : ""}`} onClick={props.onToggleRecording} disabled={props.executionActive} title={props.recordingActive ? "Stop recording browser actions" : "Record browser actions"}><RecordIcon active={props.recordingActive} /><span>{props.recordingActive ? "Stop" : "Record"}</span></button>
        </section>

        <section className="command-group saved-workflow-group" aria-label="Saved workflow controls">
          <span className="command-group-label">Workflow</span>
          <select aria-label="Saved workflow" title="Choose a saved workflow" value={props.selectedFile} onChange={(event) => props.onSelectedFile(event.target.value)} disabled={props.busy || props.executionActive || props.recordingActive}>
            {!props.files.length && <option value="">No saved workflows</option>}
            {props.files.map((file) => <option key={file} value={file}>{file}</option>)}
          </select>
          <button type="button" className="command-button icon-command" onClick={props.onLoad} disabled={props.hostStatus !== "connected" || !props.selectedFile || props.busy || props.executionActive || props.recordingActive} aria-label="Load selected workflow" title="Load selected workflow"><LoadIcon /></button>
          <button type="button" className="command-button icon-command" onClick={props.onDuplicate} disabled={props.hostStatus !== "connected" || !props.selectedFile || props.busy || props.executionActive || props.recordingActive} aria-label="Duplicate selected workflow" title="Duplicate selected workflow"><DuplicateIcon /></button>
          <button type="button" className="command-button icon-command danger-command" onClick={props.onDelete} disabled={props.hostStatus !== "connected" || !props.selectedFile || props.busy || props.executionActive || props.recordingActive} aria-label="Delete selected workflow" title="Delete selected workflow"><DeleteIcon /></button>
          <button type="button" className="command-button icon-command" onClick={props.onRefresh} disabled={props.hostStatus !== "connected" || props.busy || props.executionActive} aria-label="Refresh saved workflows" title="Refresh saved workflows"><RefreshIcon /></button>
        </section>

        <section className="command-group execution-group" aria-label="Execution controls">
          <span className={`run-state run-state-${props.execution.status || "idle"}`} aria-live="polite">{summarizeExecution(props.execution)}</span>
          <button type="button" className={`button ${props.executionActive ? "stop" : "primary"}`} onClick={props.onRun} disabled={props.busy || props.recordingActive || !props.nodeCount || (props.executionActive && props.execution.status !== "running")} title={props.executionActive ? "Stop workflow execution" : "Run current workflow"}>{props.execution.status === "starting" ? "Starting" : props.execution.status === "cancelling" ? "Stopping" : props.executionActive ? "Stop" : "Run"}</button>
        </section>
      </div>
    </header>
  );
}

function ExecutionLogPanel({ logs, nodes, filterNodeId, onFilterNodeId, onSelectNode, onCollapse, logPolicy, onLogPolicy, hostConnected, onClear, onSave }) {
  const visibleLogs = filterExecutionLogs(logs, filterNodeId);
  const summary = summarizeExecutionLogs(logs);
  const labels = new Map(nodes.map((node) => [node.id, node.data.definition?.label || node.data.type || node.id]));
  return (
    <section id="execution-log-panel" className="execution-log-panel" aria-labelledby="execution-log-heading">
      <div className="execution-log-toolbar">
        <div><h2 id="execution-log-heading">Execution Logs</h2></div>
        <div className="execution-log-summary" aria-label="Execution log summary">
          <span>{summary.events} events</span><span>{summary.completed} completed</span><span>{summary.skipped} bypassed</span>{summary.failed > 0 && <span className="has-failures">{summary.failed} failed</span>}
        </div>
        <label htmlFor="execution-log-filter">Node</label>
        <select id="execution-log-filter" value={filterNodeId} onChange={(event) => onFilterNodeId(event.target.value)}>
          <option value="">All nodes</option>
          {nodes.map((node) => <option key={node.id} value={node.id}>{labels.get(node.id)}</option>)}
        </select>
        <label htmlFor="execution-log-policy">After run</label>
        <select id="execution-log-policy" value={logPolicy} onChange={(event) => onLogPolicy(event.target.value)} title="Choose how execution logs are handled after each run">
          <option value={LogHandlingPolicy.DoNothing}>Do nothing</option>
          <option value={LogHandlingPolicy.ClearAfterRun}>Clear after run</option>
          <option value={LogHandlingPolicy.ClearAndSaveAfterRun} disabled={!hostConnected}>Clear &amp; save after run</option>
          <option value={LogHandlingPolicy.SaveAfterRun} disabled={!hostConnected}>Save after run</option>
        </select>
        <button type="button" className="icon-log-button" onClick={onSave} disabled={!hostConnected || !logs.length} aria-label="Save execution logs" title={hostConnected ? "Save execution logs as a .log file" : "Connect to the host to save logs"}><SaveLogIcon /></button>
        <button type="button" className="icon-log-button" onClick={onClear} disabled={!logs.length} aria-label="Clear execution logs" title="Clear execution logs"><DeleteIcon /></button>
        <button type="button" className="panel-collapse-button" onClick={onCollapse} aria-label="Hide Execution Logs" aria-expanded="true" title="Hide Execution Logs"><CollapsePanelIcon direction="down" /></button>
      </div>
      <div className="execution-log-list" role="log" aria-live="polite" aria-relevant="additions">
        {!visibleLogs.length && <p className="execution-log-empty">{logs.length ? "No events match this node." : "Run the graph to see bounded, secret-safe execution history."}</p>}
        {visibleLogs.map((entry) => (
          <article className={`execution-log-entry log-${entry.status}`} key={entry.id}>
            <time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
            <span className="execution-log-status">{entry.status}</span>
            <div><strong>{entry.nodeId ? (labels.get(entry.nodeId) || entry.action || "Node") : "Workflow"}</strong><p>{entry.message}</p></div>
            {entry.nodeId && <button type="button" onClick={() => onSelectNode(entry.nodeId)} aria-label={`Select ${labels.get(entry.nodeId) || "node"} on canvas`}>Select node</button>}
          </article>
        ))}
      </div>
    </section>
  );
}

function NodePalette({ definitions, error, onAdd, onCollapse, readOnly, navigationMode }) {
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
      <div className="panel-heading"><div><h2>Node Library</h2></div><div className="panel-heading-actions"><b>{visible.length}</b><button type="button" className="panel-collapse-button" onClick={onCollapse} aria-label="Hide Node Library" aria-expanded="true" title="Hide Node Library"><CollapsePanelIcon direction="left" /></button></div></div>
      <label className="search-field"><span className="sr-only">Search nodes</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search nodes" /></label>
      <div className="palette-scroll">
        {error && <p className="panel-error">{error}</p>}
        {readOnly && <p className="readonly-help">{navigationMode ? "Switch to Selector to add or edit nodes." : "Upgrade this legacy workflow before adding nodes."}</p>}
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

function InspectorPanel(props) {
  const [workflowTab, setWorkflowTab] = useState("workflow");
  const node = props.node;
  const readOnly = props.readOnly;
  const navigationMode = props.navigationMode;

  if (!node) {
    const saveReason = props.canSave
      ? "Save workflow changes"
      : props.graphSaveError || (!props.hostConnected ? "Connect to the native host to save" : props.dirty ? "Workflow cannot be saved right now" : "No unsaved changes");
    return (
      <aside className="graph-sidebar properties-panel inspector-panel" aria-label="Inspector">
        <div className="panel-heading"><div><h2>Inspector</h2></div><button type="button" className="panel-collapse-button" onClick={() => props.onInspectorMode(props.inspectorMode === InspectorMode.Pinned ? InspectorMode.Auto : InspectorMode.Pinned)} aria-label={props.inspectorMode === InspectorMode.Pinned ? "Use automatic Inspector" : "Pin Inspector"} aria-pressed={props.inspectorMode === InspectorMode.Pinned} title={props.inspectorMode === InspectorMode.Pinned ? "Collapse Inspector until a node is selected" : "Keep Inspector pinned"}><PinIcon pinned={props.inspectorMode === InspectorMode.Pinned} /></button></div>
        <div className="inspector-tabs" role="tablist" aria-label="Workflow Inspector views">
          <button type="button" role="tab" aria-selected={workflowTab === "workflow"} onClick={() => setWorkflowTab("workflow")}>Workflow</button>
          <button type="button" role="tab" aria-selected={workflowTab === "data"} onClick={() => setWorkflowTab("data")}>Data</button>
        </div>
        <div className="properties-scroll">
          {workflowTab === "workflow" ? (
            <>
              <div className={`workflow-inspector-status notice-${props.notice.kind}`} role="status">
                <strong>{props.sourceSchema === 1 ? "v1 read-only" : props.dirty ? "Unsaved changes" : "Saved"}</strong>
                <span>{props.notice.text}</span>
              </div>
              <div className="workflow-stats" aria-label="Workflow graph status"><span><b>{props.nodeCount}</b> nodes</span><span><b>{props.edgeCount}</b> edges</span></div>
              <section className="property-section" aria-labelledby="workflow-details-heading">
                <h3 id="workflow-details-heading">Workflow details</h3>
                <Field label="Name" htmlFor="inspector-workflow-name"><input id="inspector-workflow-name" value={props.workflowName} disabled={readOnly || props.busy} onChange={(event) => props.onWorkflowName(event.target.value)} /></Field>
                <Field label="Bound domain" htmlFor="inspector-workflow-domain"><input id="inspector-workflow-domain" value={props.metadata.boundDomain || ""} disabled={readOnly || props.busy} onChange={(event) => props.onMetadata({ boundDomain: event.target.value })} placeholder="optional" /></Field>
                <Field label="Description" htmlFor="inspector-workflow-description"><textarea id="inspector-workflow-description" rows="4" value={props.metadata.description || ""} disabled={readOnly || props.busy} onChange={(event) => props.onMetadata({ description: event.target.value })} placeholder="Describe what this workflow does" /></Field>
              </section>
              <section className="property-section" aria-labelledby="workflow-behavior-heading">
                <h3 id="workflow-behavior-heading">Behavior</h3>
                <Field label="Layout" htmlFor="inspector-layout-direction"><select id="inspector-layout-direction" value={props.layoutDirection} disabled={props.busy} onChange={(event) => props.onLayoutDirection(event.target.value)}><option value="vertical">Vertical</option><option value="horizontal">Horizontal</option></select></Field>
                <button type="button" className="inspector-secondary-action" onClick={props.onArrange} disabled={props.busy}>Arrange workflow</button>
                <label className="inspector-checkbox"><input type="checkbox" checked={props.metadata.settings?.reuseExistingTabs === true} disabled={readOnly || props.busy} onChange={(event) => props.onMetadata({ settings: { ...props.metadata.settings, reuseExistingTabs: event.target.checked } })} />Reuse an already-open matching tab</label>
              </section>
              <div className="inspector-save-actions">
                <button type="button" className="button primary" onClick={props.onSave} disabled={!props.canSave} title={saveReason}>Save Changes</button>
                {props.sourceSchema === 1 && <button type="button" className="button upgrade" onClick={props.onUpgrade} disabled={!props.hostConnected || props.busy || !props.loadedFilename} title="Upgrade this v1 workflow with an immutable backup">Upgrade to v2</button>}
              </div>
              {props.graphSaveError && <p className="panel-error">{props.graphSaveError}</p>}
            </>
          ) : (
            <WorkflowDataView seeds={props.metadata.variables} variables={props.variables} />
          )}
        </div>
      </aside>
    );
  }

  const definition = node.data.definition;
  const setConfig = (key, value) => props.onNodeChange({ config: { ...node.data.config, [key]: value } });
  return (
    <aside className="graph-sidebar properties-panel inspector-panel" aria-label="Inspector">
      <div className="panel-heading"><div><h2>Inspector</h2></div><button type="button" className="panel-collapse-button" onClick={() => props.onInspectorMode(props.inspectorMode === InspectorMode.Pinned ? InspectorMode.Auto : InspectorMode.Pinned)} aria-label={props.inspectorMode === InspectorMode.Pinned ? "Use automatic Inspector" : "Pin Inspector"} aria-pressed={props.inspectorMode === InspectorMode.Pinned} title={props.inspectorMode === InspectorMode.Pinned ? "Collapse Inspector until a node is selected" : "Keep Inspector pinned"}><PinIcon pinned={props.inspectorMode === InspectorMode.Pinned} /></button></div>
      <div className="properties-scroll">
        <div className="inspector-context"><span>Node</span><strong>{definition.label}</strong></div>
        <div className="node-identity"><code>{node.data.type}</code><span>{navigationMode ? "Navigation mode" : node.data.readOnly ? "Legacy preview" : node.data.executionLocked ? "Execution locked" : `Node ${node.id.slice(-8)}`}</span></div>
        <section className="property-section" aria-labelledby="execution-heading"><h3 id="execution-heading">Execution</h3>
          <Field label="Node mode" htmlFor="property-execution-mode"><select id="property-execution-mode" value={node.data.executionMode || "enabled"} disabled={readOnly} onChange={(event) => props.onNodeChange({ executionMode: event.target.value })}><option value="enabled">Enabled</option><option value="disabled">Bypassed (always skip)</option><option value="conditional">Conditional bypass</option></select></Field>
          {node.data.executionMode === "conditional" && <Field label="Bypass when" required htmlFor="property-skip-when" help="Skip when this expression resolves to true."><input id="property-skip-when" value={node.data.skipWhen || ""} disabled={readOnly} onChange={(event) => props.onNodeChange({ skipWhen: event.target.value })} placeholder="{{skip_this_step}}" /></Field>}
          {node.data.executionMode === "disabled" && <p className="bypass-note">Connections remain intact; runtime passes over this node.</p>}
        </section>
        <section className="property-section" aria-labelledby="configuration-heading"><h3 id="configuration-heading">Configuration</h3>
          {definition.targetRequired && <Field label="Target Element" required htmlFor="property-target"><input id="property-target" value={node.data.target || ""} disabled={readOnly} onChange={(event) => props.onNodeChange({ target: event.target.value, targetEdited: true })} placeholder="CSS selector or recorded target" /></Field>}
          {(definition.config || []).map((field) => <ConfigField key={field.key} field={field} value={node.data.config[field.key] ?? field.default ?? ""} config={node.data.config} onChange={setConfig} disabled={readOnly} />)}
        </section>
      </div>
    </aside>
  );
}

function WorkflowDataView({ seeds = {}, variables = [] }) {
  const runtimeNames = new Set((variables || []).map((entry) => entry.name));
  const entries = [
    ...Object.keys(seeds || {}).filter((name) => !runtimeNames.has(name)).map((name) => ({ name, type: typeof seeds[name], summary: "Workflow seed" })),
    ...(variables || []),
  ];
  return (
    <section className="workflow-data-view" aria-labelledby="workflow-data-heading">
      <div className="data-view-heading"><div><h3 id="workflow-data-heading">Variables</h3><p>{entries.length ? `${entries.length} available` : "No variables available"}</p></div><b>{entries.length}</b></div>
      {!entries.length && <p className="properties-empty">Run the workflow or add seed variables to inspect data.</p>}
      {entries.map((entry) => <article key={entry.name} className="data-variable-row"><strong>{entry.name}</strong><span>{entry.type || "unknown"}</span><p>{entry.summary || entry.origin?.action || "Current run"}</p></article>)}
    </section>
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
function createNewMetadata() { return { id: crypto.randomUUID(), name: "Untitled", description: "", boundDomain: "", settings: { reuseExistingTabs: false, graphLayoutDirection: "vertical" }, variables: {} }; }
function NodeGlyphSmall() { return <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/><path d="M10 7h4a3 3 0 0 1 3 3v4"/></svg>; }
function NodeGlyphLarge() { return <svg aria-hidden="true" viewBox="0 0 48 48"><rect x="7" y="7" width="13" height="13" rx="3"/><rect x="28" y="28" width="13" height="13" rx="3"/><path d="M20 13.5h8a7 7 0 0 1 7 7V28"/></svg>; }
function RefreshIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2 5M20 5v6h-6"/></svg>; }
function PlusIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>; }
function SequenceIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="4" width="5" height="5" rx="1"/><rect x="15" y="15" width="5" height="5" rx="1"/><path d="M9 6.5h4a4 4 0 0 1 4 4V15"/></svg>; }
function LoadIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h6l2 2h8v10H4Z"/><path d="m12 11 0 5m-2-2 2 2 2-2"/></svg>; }
function DuplicateIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5H5v11h3"/></svg>; }
function DeleteIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7M10 11v5m4-5v5"/></svg>; }
function SaveLogIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 4h12l2 2v14H5Z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/></svg>; }
function RecordIcon({ active }) { return active ? <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1"/></svg> : <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/></svg>; }
function OverviewIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="m7 15 3-4 3 2 4-5"/></svg>; }
function LogsIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 5h12M6 10h12M6 15h8M6 20h5"/></svg>; }
function PanelIcon({ side }) { return <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d={side === "left" ? "M9 4v16m4-11 3 3-3 3" : "M15 4v16m-4-11-3 3 3 3"}/></svg>; }
function CollapsePanelIcon({ direction }) { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d={direction === "down" ? "m7 9 5 5 5-5" : "m14 7-5 5 5 5"}/></svg>; }
function PinIcon({ pinned }) { return pinned ? <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m8 4 8 0-1 6 3 3H6l3-3Z"/><path d="M12 13v7"/></svg> : <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 5 12 12M9 4h7l-1 6 3 3-3 1M6 13h5l1 7"/></svg>; }
function SelectorIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 4 11 8-6 1-3 6Z"/></svg>; }
function HandIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 11V7a2 2 0 0 1 4 0v3-5a2 2 0 0 1 4 0v5-3a2 2 0 0 1 4 0v7c0 4-3 7-7 7h-1c-3 0-5-2-6-4l-2-4a2 2 0 0 1 4-2Z"/></svg>; }
