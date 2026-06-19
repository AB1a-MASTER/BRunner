export function projectRuntimeState(nodes, execution = {}, readOnly = false) {
  const completed = new Set(execution.completedNodeIds || []);
  const skipped = new Set(execution.skippedNodeIds || []);
  const active = ["starting", "running", "cancelling"].includes(execution.status);

  return nodes.map((node) => {
    let runtimeStatus = "idle";
    if (skipped.has(node.id)) runtimeStatus = "skipped";
    else if (completed.has(node.id)) runtimeStatus = "completed";
    else if (node.id === execution.currentNodeId) {
      if (execution.status === "failed") runtimeStatus = "failed";
      else if (execution.status === "cancelled") runtimeStatus = "cancelled";
      else if (active) runtimeStatus = "running";
    }

    return {
      ...node,
      data: {
        ...node.data,
        runtimeStatus,
        executionLocked: active,
        readOnly,
      },
    };
  });
}

export function summarizeExecution(execution = {}) {
  const completed = execution.completedNodeIds?.length || 0;
  const skipped = execution.skippedNodeIds?.length || 0;
  switch (execution.status) {
    case "starting": return "Starting workflow…";
    case "running": return `Running ${completed + skipped + 1} of ${execution.totalSteps || 0}`;
    case "cancelling": return "Stopping workflow…";
    case "completed": return `Completed ${completed} · bypassed ${skipped}`;
    case "failed": return execution.error || "Workflow failed";
    case "cancelled": return "Workflow stopped";
    default: return "Ready to run";
  }
}
