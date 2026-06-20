import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
} from "@xyflow/react";

export function RemovableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  selected,
  data,
}) {
  const { deleteElements } = useReactFlow();
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const readOnly = data?.readOnly === true
    || data?.executionLocked === true
    || data?.navigationLocked === true;

  const remove = (event) => {
    event.stopPropagation();
    if (readOnly) return;
    data?.onMutate?.();
    deleteElements({ edges: [{ id }] });
  };

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <button
          type="button"
          className={`edge-remove nodrag nopan${selected ? " is-selected" : ""}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          onClick={remove}
          disabled={readOnly}
          aria-label="Remove connection"
          title={readOnly ? "Upgrade workflow to edit connections" : "Remove connection"}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m8 8 8 8M16 8l-8 8" /></svg>
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
