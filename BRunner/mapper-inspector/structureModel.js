export const InspectorStructureRoles = Object.freeze({
  TopDocument: "top_document",
  FrameGroup: "frame_group",
  FrameDocument: "frame_document",
});

const StructureRoleOrder = Object.freeze({
  [InspectorStructureRoles.TopDocument]: 0,
  [InspectorStructureRoles.FrameGroup]: 1,
  [InspectorStructureRoles.FrameDocument]: 2,
});

export function mapperDocumentContextSegments(frameScope = {}) {
  const path = String(frameScope?.path || "top").trim() || "top";
  if (path === "top") {
    return [{
      part: "document:top",
      path: "",
      documentContext: true,
      structureRole: InspectorStructureRoles.TopDocument,
    }];
  }

  const access = frameScope?.access === "cross_origin"
    ? "cross_origin"
    : "same_origin";
  return [
    {
      part: "document:frames",
      path: "",
      documentContext: true,
      structureRole: InspectorStructureRoles.FrameGroup,
    },
    {
      part: `frame:${access}:${path}`,
      path: "",
      documentContext: true,
      structureRole: InspectorStructureRoles.FrameDocument,
    },
  ];
}

export function inspectorStructureRoleForPart(part = "") {
  const value = String(part || "");
  if (value === "document:top") return InspectorStructureRoles.TopDocument;
  if (value === "document:frames") return InspectorStructureRoles.FrameGroup;
  if (value.startsWith("frame:")) return InspectorStructureRoles.FrameDocument;
  return "";
}

export function inspectorStructureContextLabel(part = "") {
  const value = String(part || "");
  if (value === "document:top") return "Top document";
  if (value === "document:frames") return "Embedded frame documents";
  if (!value.startsWith("frame:")) return "";

  const payload = value.slice("frame:".length);
  const separator = payload.indexOf(":");
  const access = separator >= 0 ? payload.slice(0, separator) : "same_origin";
  const path = separator >= 0 ? payload.slice(separator + 1) : payload;
  const prefix = access === "cross_origin"
    ? "Cross-origin frame document"
    : "Same-origin frame document";
  return `${prefix} - ${path || "unknown frame"}`;
}

export function compareInspectorDocumentNodes(left = {}, right = {}) {
  const leftRole = left.structureRole || inspectorStructureRoleForPart(left.key);
  const rightRole = right.structureRole || inspectorStructureRoleForPart(right.key);
  const leftOrder = Object.prototype.hasOwnProperty.call(StructureRoleOrder, leftRole)
    ? StructureRoleOrder[leftRole]
    : null;
  const rightOrder = Object.prototype.hasOwnProperty.call(StructureRoleOrder, rightRole)
    ? StructureRoleOrder[rightRole]
    : null;

  if (leftOrder === null && rightOrder === null) return null;
  if (leftOrder === null) return 1;
  if (rightOrder === null) return -1;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return String(left.key || "").localeCompare(String(right.key || ""));
}
