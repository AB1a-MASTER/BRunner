import assert from "node:assert/strict";
import test from "node:test";

import {
  InspectorStructureRoles,
  compareInspectorDocumentNodes,
  inspectorStructureContextLabel,
  mapperDocumentContextSegments,
} from "../BRunner/mapper-inspector/structureModel.js";

test("Inspector gives top and embedded frame documents explicit context branches", () => {
  const top = mapperDocumentContextSegments({
    access: "top",
    path: "top",
  });
  const frame = mapperDocumentContextSegments({
    access: "same_origin",
    path: "top/frame_74348181",
  });

  assert.deepEqual(top.map((segment) => segment.part), ["document:top"]);
  assert.deepEqual(frame.map((segment) => segment.part), [
    "document:frames",
    "frame:same_origin:top/frame_74348181",
  ]);
  assert.equal(top[0].documentContext, true);
  assert.equal(frame[1].documentContext, true);
  assert.equal(inspectorStructureContextLabel(top[0].part), "Top document");
  assert.equal(
    inspectorStructureContextLabel(frame[0].part),
    "Embedded frame documents",
  );
  assert.equal(
    inspectorStructureContextLabel(frame[1].part),
    "Same-origin frame document - top/frame_74348181",
  );
});

test("Inspector document contexts ignore incomparable frame-local visual positions", () => {
  const frameGroup = {
    key: "document:frames",
    structureRole: InspectorStructureRoles.FrameGroup,
    visualY: 0,
  };
  const topDocument = {
    key: "document:top",
    structureRole: InspectorStructureRoles.TopDocument,
    visualY: 900,
  };
  const crossOrigin = {
    key: "document:frames/frame:cross_origin:isolated/frame_b",
    structureRole: InspectorStructureRoles.FrameDocument,
    visualY: 0,
  };
  const sameOrigin = {
    key: "document:frames/frame:same_origin:top/frame_a",
    structureRole: InspectorStructureRoles.FrameDocument,
    visualY: 1000,
  };

  assert.deepEqual(
    [frameGroup, topDocument].sort(compareInspectorDocumentNodes),
    [topDocument, frameGroup],
  );
  assert.deepEqual(
    [sameOrigin, crossOrigin].sort(compareInspectorDocumentNodes),
    [crossOrigin, sameOrigin],
  );
});
