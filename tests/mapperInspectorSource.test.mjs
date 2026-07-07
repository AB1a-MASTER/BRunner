import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { Messages, Defaults } from "../BRunner/core/constants.js";
import { createChromeMapStore } from "../BRunner/core/mapStore.js";
import { createEmptyWorkflowMapperState } from "../BRunner/mapper/core.js";

const root = new URL("../", import.meta.url);

test("mapper inspector extension surface is wired", async () => {
  const [manifest, sidebarHtml, sidebarJs, background, content, inspectorHtml, inspectorJs, inspectorCss] =
    await Promise.all([
      readFile(new URL("BRunner/manifest.json", root), "utf8"),
      readFile(new URL("BRunner/sidebar/sidebar.html", root), "utf8"),
      readFile(new URL("BRunner/sidebar/sidebar.js", root), "utf8"),
      readFile(new URL("BRunner/background.js", root), "utf8"),
      readFile(new URL("BRunner/content/mapper.js", root), "utf8"),
      readFile(new URL("BRunner/mapper-inspector/index.html", root), "utf8"),
      readFile(new URL("BRunner/mapper-inspector/app.js", root), "utf8"),
      readFile(new URL("BRunner/mapper-inspector/style.css", root), "utf8"),
    ]);

  assert.equal(Messages.ListWorkflowMapperStates, "LIST_WORKFLOW_MAPPER_STATES");
  assert.equal(Messages.MapCurrentPage, "MAP_CURRENT_PAGE");
  assert.equal(Messages.HighlightMapperComponent, "HIGHLIGHT_MAPPER_COMPONENT");
  assert.match(manifest, /mapper-inspector\/index\.html/);
  assert.match(manifest, /mapper-inspector\/app\.js/);
  assert.match(sidebarHtml, /btn-open-mapper-inspector/);
  assert.match(sidebarJs, /openMapperInspector/);
  assert.match(background, /case Messages\.ListWorkflowMapperStates/);
  assert.match(background, /case Messages\.MapCurrentPage/);
  assert.match(background, /mapCurrentPageForInspector\(request, sender\)/);
  assert.match(background, /case Messages\.HighlightMapperComponent/);
  assert.match(background, /highlightMapperComponentForInspector\(request, sender\)/);
  assert.match(background, /selectBestInspectorTargetTab/);
  assert.match(background, /tab\.id !== senderTabId/);
  assert.match(background, /sendInspectorMapperMessage/);
  assert.match(background, /injectMapperContentScripts/);
  assert.match(background, /chrome\.scripting\.executeScript/);
  assert.match(background, /content\/targetResolver\.js/);
  assert.match(background, /content\/filePayload\.js/);
  assert.match(background, /content\/mapper\.js/);
  assert.match(background, /Receiving end does not exist/);
  assert.match(background, /No website tab found/);
  assert.match(content, /HighlightMapperComponent/);
  assert.match(content, /highlightMapperComponent/);
  assert.match(content, /element\.scrollIntoView/);
  assert.match(content, /afterNextPaint/);
  assert.match(content, /documentBounds: this\.getDocumentBounds/);
  assert.match(content, /viewportBounds/);
  assert.match(content, /scoreMapperCandidateWithEvidence/);
  assert.match(content, /source: "live_candidate"/);
  assert.match(content, /mapperFact/);
  assert.match(content, /expectedCapabilities/);
  assert.match(content, /withMapperResolverLog/);
  assert.match(content, /mapper\.resolver\.log\.v1/);
  assert.match(content, /minimumScore: 75/);
  assert.match(content, /minimumMargin: 15/);
  assert.match(content, /resolverLog: resolved\?\.resolverLog/);
  assert.match(inspectorHtml, /view-tree/);
  assert.match(inspectorHtml, /view-graph/);
  assert.doesNotMatch(inspectorHtml, /view-website/);
  assert.match(inspectorHtml, /policy-panel/);
  assert.match(inspectorJs, /ListWorkflowMapperStates/);
  assert.match(inspectorJs, /SaveWorkflowMapperState/);
  assert.match(inspectorJs, /MapCurrentPage/);
  assert.match(inspectorJs, /HighlightMapperComponent/);
  assert.match(inspectorJs, /reviewRequired/);
  assert.match(inspectorJs, /componentShortName/);
  assert.doesNotMatch(inspectorJs, /renderWebsite/);
  assert.match(inspectorJs, /tree-explorer/);
  assert.match(inspectorJs, /treeMode: "structure"/);
  assert.match(inspectorJs, /data-tree-mode/);
  assert.match(inspectorJs, /renderStructureTree/);
  assert.match(inspectorJs, /componentStructurePath/);
  assert.match(inspectorJs, /technical\?\.domPath/);
  assert.match(inspectorJs, /componentTypeGroupName/);
  assert.match(inspectorJs, /componentTreeRowHtml/);
  assert.match(inspectorJs, /componentTreeIconType/);
  assert.match(inspectorJs, /treeIconSvg/);
  assert.match(inspectorJs, /buildInspectorGraph/);
  assert.match(inspectorJs, /graphEdgeHtml/);
  assert.match(inspectorJs, /componentY/);
  assert.match(inspectorJs, /graph-port graph-port-in/);
  assert.match(inspectorJs, /V \$\{midY\} H \$\{endX\} V/);
  assert.match(inspectorJs, /wireGraphCanvas/);
  assert.match(inspectorJs, /data-graph-action="fit"/);
  assert.match(inspectorJs, /data-graph-viewport/);
  assert.match(inspectorJs, /graph-node-\$\{node\.kind\}/);
  assert.match(inspectorJs, /componentRegionName/);
  assert.match(inspectorJs, /saveComponentAlias/);
  assert.match(inspectorJs, /acceptCurrentMapping/);
  assert.match(inspectorJs, /savePolicy/);
  assert.match(inspectorJs, /displayAlias/);
  assert.match(inspectorJs, /reviewDecision/);
  assert.match(inspectorJs, /sensitive-badge/);
  assert.match(inspectorJs, /redactSensitive/);
  assert.match(inspectorJs, /renderLiveCandidateLinks/);
  assert.match(inspectorJs, /linkLiveCandidateAttempt/);
  assert.match(inspectorJs, /inspector_live_candidate/);
  assert.match(inspectorJs, /primaryLocatorFromMapperFact/);
  assert.match(inspectorJs, /createReviewMapVersion/);
  assert.match(inspectorJs, /map_review_/);
  assert.match(inspectorJs, /previousMapVersionId/);
  assert.match(inspectorJs, /reviewSource: "mapper_inspector"/);
  assert.match(inspectorJs, /Resolver Log/);
  assert.match(inspectorCss, /graph-shell/);
  assert.match(inspectorCss, /tree-explorer/);
  assert.match(inspectorCss, /tree-controls/);
  assert.match(inspectorCss, /tree-mode-button/);
  assert.match(inspectorCss, /tree-icon-button/);
  assert.match(inspectorCss, /detail-panel > section/);
  assert.match(inspectorCss, /grid-template-rows: auto minmax\(0, 1fr\)/);
  assert.match(inspectorCss, /policy-panel,\s*\n\.component-detail/);
  assert.match(inspectorCss, /graph-edge/);
  assert.match(inspectorCss, /graph-port-in/);
  assert.match(inspectorCss, /graph-world/);
  assert.match(inspectorCss, /graph-node-component/);
  assert.doesNotMatch(inspectorCss, /website-component/);
});

test("map store lists deserialized workflow mapper states", async () => {
  const storage = createMemoryStorage({
    [Defaults.MapperStorageKey]: {
      workflowA: createEmptyWorkflowMapperState("workflowA"),
      invalid: { mapperSchemaVersion: 999 },
    },
  });
  const store = createChromeMapStore(storage);

  const states = await store.getAllWorkflowMapperStates();

  assert.deepEqual(Object.keys(states), ["workflowA"]);
  assert.equal(states.workflowA.workflowId, "workflowA");
});

function createMemoryStorage(initial = {}) {
  const values = structuredClone(initial);
  return {
    async get(key) {
      return {
        [key]: structuredClone(values[key]),
      };
    },
    async set(next) {
      Object.assign(values, structuredClone(next));
    },
  };
}
