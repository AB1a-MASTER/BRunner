import { useEffect } from "react";
import { Handle, Position, useReactFlow, useUpdateNodeInternals } from "@xyflow/react";
import { getExecutionPresentation, getNodeSummaryRows } from "./nodePresentation.js";

export function GraphNode({ id, data, selected }) {
  const { deleteElements, updateNodeData } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const definition = data.definition || {};
  const category = definition.category || "Node";
  const summaryRows = getNodeSummaryRows(data);
  const execution = getExecutionPresentation(data);
  const bypassed = execution.mode === "disabled";
  const readOnly = data.readOnly === true
    || data.executionLocked === true
    || data.navigationLocked === true;
  const collapsed = data.collapsed === true;
  const horizontal = data.layoutDirection === "horizontal";
  const targetPosition = horizontal ? Position.Left : Position.Top;
  const sourcePosition = horizontal ? Position.Right : Position.Bottom;

  useEffect(() => {
    updateNodeInternals(id);
  }, [collapsed, horizontal, id, updateNodeInternals]);

  const toggleBypass = (event) => {
    event.stopPropagation();
    if (readOnly) return;
    updateNodeData(id, {
      executionMode: bypassed ? "enabled" : "disabled",
    });
    data.onMutate?.();
  };

  const removeNode = (event) => {
    event.stopPropagation();
    if (readOnly) return;
    data.onMutate?.();
    deleteElements({ nodes: [{ id }] });
  };

  const toggleCollapsed = (event) => {
    event.stopPropagation();
    if (data.executionLocked === true || data.navigationLocked === true) return;
    updateNodeData(id, { collapsed: !collapsed });
    if (data.readOnly !== true) data.onMutate?.();
    window.requestAnimationFrame(() => updateNodeInternals(id));
  };

  const runtimeStatus = data.runtimeStatus || "idle";

  return (
    <article className={`graph-node${selected ? " is-selected" : ""}${bypassed ? " is-bypassed" : ""}${collapsed ? " is-collapsed" : ""} runtime-${runtimeStatus}`}>
      <Handle type="target" position={targetPosition} id="input" />
      <header className="graph-node-header">
        <div className="graph-node-kicker">
          <NodeGlyph />
          <span>{category}</span>
        </div>
        <div className="graph-node-actions">
          <button
            type="button"
            className="node-action nodrag nopan"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={toggleCollapsed}
            disabled={data.executionLocked === true || data.navigationLocked === true}
            aria-label={collapsed ? `Expand ${definition.label}` : `Collapse ${definition.label}`}
            title={collapsed ? "Expand node" : "Collapse node"}
          >
            <CollapseIcon collapsed={collapsed} />
          </button>
          <button
            type="button"
            className="node-action nodrag nopan"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={toggleBypass}
            disabled={readOnly}
            aria-label={bypassed ? `Enable ${definition.label}` : `Bypass ${definition.label}`}
            title={bypassed ? "Enable node" : "Bypass node"}
          >
            <BypassIcon bypassed={bypassed} />
          </button>
          <button
            type="button"
            className="node-action node-remove nodrag nopan"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={removeNode}
            disabled={readOnly}
            aria-label={`Remove ${definition.label || "node"}`}
            title="Remove node"
          >
            <CloseIcon />
          </button>
        </div>
      </header>

      <strong className="graph-node-title">{definition.label || data.type || "Workflow node"}</strong>

      {runtimeStatus !== "idle" && (
        <div className={`node-runtime node-runtime-${runtimeStatus}`} role="status">
          <span>{runtimeLabel(runtimeStatus)}</span>
        </div>
      )}

      <div className={`node-execution node-execution-${execution.mode}`}>
        <span>{execution.label}</span>
        {!collapsed && <code>{execution.detail}</code>}
      </div>

      {!collapsed && (summaryRows.length ? (
        <dl className="graph-node-summary">
          {summaryRows.map((row) => (
            <div key={row.key}>
              <dt>{row.label}</dt>
              <dd title={row.value}>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="graph-node-unconfigured">Select to configure this node</p>
      ))}

      {!collapsed && <footer className="graph-node-footer">
        <code>{data.type}</code>
        <span>v{definition.version || 1}</span>
      </footer>}
      <Handle type="source" position={sourcePosition} id="success" />
    </article>
  );
}

function NodeGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16">
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
      <path d="M10 7h4a3 3 0 0 1 3 3v4" />
    </svg>
  );
}

function BypassIcon({ bypassed }) {
  return bypassed
    ? <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14M14 7l5 5-5 5" /></svg>
    : <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" /><path d="M7 17 17 7" /></svg>;
}

function CloseIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" /></svg>;
}

function CollapseIcon({ collapsed }) {
  return collapsed
    ? <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m8 14 4-4 4 4" /></svg>
    : <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m8 10 4 4 4-4" /></svg>;
}

function runtimeLabel(status) {
  return {
    running: "Running",
    completed: "Completed",
    skipped: "Bypassed",
    failed: "Failed",
    cancelled: "Cancelled",
  }[status] || status;
}
