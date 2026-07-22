import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { Messages, Defaults } from "../BRunner/core/constants.js";
import {
  MapStoreUnavailableError,
  createChromeMapStore,
  createNativeMapStore,
} from "../BRunner/core/mapStore.js";
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
  assert.equal(Messages.InspectCurrentPageMap, "INSPECT_CURRENT_PAGE_MAP");
  assert.equal(Messages.HighlightMapperComponent, "HIGHLIGHT_MAPPER_COMPONENT");
  assert.match(manifest, /mapper-inspector\/index\.html/);
  assert.match(manifest, /mapper-inspector\/app\.js/);
  assert.match(sidebarHtml, /btn-open-mapper-inspector/);
  assert.match(sidebarJs, /openMapperInspector/);
  assert.match(background, /case Messages\.ListWorkflowMapperStates/);
  assert.match(background, /case Messages\.MapCurrentPage/);
  assert.match(background, /case Messages\.InspectCurrentPageMap/);
  assert.match(background, /mapCurrentPageForInspector\(request, sender\)/);
  assert.match(background, /inspectCurrentPageMapForInspector\(request, sender\)/);
  assert.match(background, /getInspectorLiveMapperSnapshot/);
  assert.match(background, /shouldKeepPreviousInspectorMap/);
  assert.match(background, /isUsableInspectorPageMap/);
  assert.match(background, /deferred: true/);
  assert.match(background, /snapshotMode: "settled_current_dom"/);
  assert.match(background, /snapshotCapturedAt = normalizeInspectorSnapshotCapturedAt\(snapshot\.page\?\.capturedAt\)/);
  assert.match(background, /now: snapshotCapturedAt/);
  assert.match(background, /persisted: false/);
  assert.match(background, /reason: "stale_snapshot"/);
  assert.match(background, /url: snapshot\.page\.url \|\| snapshot\.tab\.url/);
  assert.match(background, /request\.snapshotMode \|\| ""/);
  const mapCurrentPageSource = background.match(
    /async function mapCurrentPageForInspector[\s\S]*?(?=async function inspectCurrentPageMapForInspector)/,
  )?.[0] || "";
  assert.match(mapCurrentPageSource, /tabId: snapshot\.tab\.id/);
  assert.doesNotMatch(mapCurrentPageSource, /tabId: tab\.id/);
  assert.match(background, /stale,/);
  assert.match(background, /getInspectorTargetTab\([\s\S]*?request\.tabId,[\s\S]*?request\.pageMap \|\| null,[\s\S]*?sender,[\s\S]*?policy/);
  assert.match(background, /pageMapMatchesUrl/);
  assert.match(background, /Math\.min\(3, Math\.max\(1, Number\(settings\.maxVersions\) \|\| 3\)\)/);
  assert.match(background, /materialMutationCount: Number\(snapshot\.page\.materialMutationCount\) \|\| 0/);
  assert.match(background, /platformProfile: snapshot\.page\.platformProfile \|\| null/);
  assert.match(background, /getInspectorMapperFrameSnapshots/);
  assert.match(background, /resolveMapperFrameId/);
  assert.match(background, /allFrames: true/);
  assert.match(background, /type: "GET_CONTROLS_TREE"/);
  assert.match(background, /chrome\.tabs\.sendMessage\(tab\.id/);
  assert.match(background, /\{ frameId: result\.frameId \}/);
  assert.match(background, /decorateAccessibleMapperFrameSnapshots/);
  assert.match(background, /decorateAccessibleMapperFrameScopes/);
  assert.match(background, /attachMapperFrameScope/);
  assert.match(background, /incomplete: discoveredMapperFrames\.length !== discovered\.length/);
  assert.match(background, /const accessible = frameSnapshots/);
  assert.match(background, /extensionAccessible/);
  assert.match(background, /accessibleFramePaths/);
  assert.match(background, /frameContexts: accessible\.map/);
  assert.match(background, /createUnreachableMapperFrameError/);
  assert.match(background, /identityAmbiguous/);
  assert.match(background, /createAmbiguousMapperFrameError/);
  assert.match(background, /cross_origin_frame_context_ambiguous/);
  assert.match(background, /sameOriginFrames/);
  assert.match(background, /case Messages\.HighlightMapperComponent/);
  assert.match(background, /highlightMapperComponentForInspector\(request, sender\)/);
  assert.match(background, /highlightRequestId: request\.highlightRequestId/);
  assert.match(background, /actionOverride: request\.actionOverride \|\| ""/);
  assert.match(background, /mapperState: "map_stale"/);
  assert.match(background, /mapperReason: "page_profile_mismatch"/);
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
  assert.match(content, /includeHidden: true/);
  assert.match(content, /resolved_element_hidden/);
  assert.match(content, /mapperState: hidden \? "hidden"/);
  assert.match(content, /highlighted,/);
  assert.match(content, /mapperMutationStats/);
  assert.match(content, /recordMapperMutations/);
  assert.match(content, /getMapperPageSnapshot/);
  assert.match(content, /capturedAt: new Date\(\)\.toISOString\(\)/);
  assert.match(content, /detectMapperPlatformProfile/);
  assert.match(content, /mapper\.platform_profile\.v1/);
  assert.match(content, /data-platform-profile='chat'/);
  assert.match(content, /data-platform-profile='social'/);
  assert.match(content, /getMapperInferredMajorRegion/);
  assert.match(content, /getMapperLargePaneBoundary/);
  assert.match(content, /getMapperRepeatedRecord/);
  assert.match(content, /getMapperPlatformTemplatePart/);
  assert.match(content, /majorRegionPath/);
  assert.match(content, /subregionPath/);
  assert.match(content, /loadedWindowHints/);
  assert.match(content, /lifetimeMaterialMutationCount/);
  assert.match(content, /settledCurrentDom/);
  assert.match(content, /snapshotMode === "settled_current_dom"/);
  assert.match(content, /compareElementsByVisualOrder/);
  assert.match(content, /enumerateMapperCandidates\(action = "", options = {}\)/);
  assert.match(content, /this\.resolveStoredMapperLocatorTarget\([\s\S]*?includeHidden,[\s\S]*?workBudget: runtimeWorkBudget,[\s\S]*?factWorkBudget: runtimeFactBudget/);
  assert.match(content, /mapperCandidateFromElement\(element, action = "", preferredLocator = null/);
  assert.match(content, /mergeMapperLocators\(fact\.locatorCandidates \|\| \[\], preferredLocator\)/);
  assert.match(content, /findElementsByMapperLocator\(locator = {}, options = {}\)/);
  assert.match(content, /stored_primary_locator_unique/);
  assert.match(content, /stored_fallback_locator_unique/);
  assert.match(content, /stored_primary_locator_ambiguous/);
  assert.match(content, /selector = `#\$\{this\.cssEscapeIdentifier\(value\)\}`/);
  assert.match(content, /findMapperElementsByLabelText/);
  assert.match(content, /findMapperElementsByDomPath/);
  assert.match(content, /options\.includeHidden \|\| this\.isUsableControl\(element, \{[\s\S]*?workBudget: candidateWorkBudget/);
  assert.match(content, /elements\.sort\(\(a, b\) => this\.compareElementsByVisualOrder\(a, b\)\)/);
  assert.match(content, /this\.hideRecorderHighlight\(\)/);
  assert.match(content, /zIndex: "2147483647"/);
  assert.match(content, /stale_highlight_request/);
  assert.match(content, /this\.mapperHighlightRequestId = requestId/);
  assert.match(content, /mapperPageMatchesCurrentLocation/);
  assert.match(content, /mapperPageIdentityDigest/);
  assert.match(content, /identity_v2_\$\{identity\}/);
  assert.match(content, /pageMap\.path && pageMap\.path !== profile\.path/);
  assert.match(content, /pageMap\.query === "string" && pageMap\.query !== profile\.query/);
  assert.match(content, /mapperReason: "page_profile_mismatch"/);
  assert.match(content, /Object\.values\(Actions\)\.includes\(actionOverride\)/);
  assert.match(content, /inspector_highlight_cleared/);
  assert.match(content, /highlightRequestId !== this\.mapperHighlightRequestId/);
  assert.match(content, /return true;/);
  assert.match(content, /isPassiveTextCandidate/);
  assert.match(content, /hasMappableText/);
  assert.match(content, /hasMappableMediaSignal/);
  assert.match(content, /capabilities\.add\("screenshot"\)/);
  assert.match(content, /element\.scrollIntoView/);
  assert.match(content, /afterNextPaint/);
  assert.match(content, /documentBounds: this\.getDocumentBounds/);
  assert.match(content, /viewportBounds/);
  assert.match(content, /scoreMapperCandidateWithEvidence/);
  assert.match(content, /source = "live_candidate"/);
  assert.match(content, /mapperFact/);
  assert.match(content, /expectedCapabilities/);
  assert.match(content, /withMapperResolverLog/);
  assert.match(content, /mapper\.resolver\.log\.v1/);
  assert.match(inspectorJs, /component-resolution-action/);
  assert.match(inspectorJs, /settings: entry\.settings \|\| \{\}/);
  assert.match(inspectorJs, /actionOverride: options\.actionOverride \|\| ""/);
  assert.match(inspectorJs, /identity_v2_\[0-9a-f\]\{32\}/);
  assert.match(content, /minimumScore: 75/);
  assert.match(content, /minimumMargin: 15/);
  assert.match(content, /resolverLog: resolved\?\.resolverLog/);
  assert.match(inspectorHtml, /view-tree/);
  assert.match(inspectorHtml, /view-graph/);
  assert.match(inspectorHtml, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(inspectorHtml, /Refresh Map/);
  assert.match(inspectorHtml, /highlight-hover-enabled/);
  assert.match(inspectorHtml, /component-search/);
  assert.match(inspectorHtml, /map-live-status/);
  assert.match(inspectorHtml, /btn-check-live-map/);
  assert.match(inspectorHtml, /component-status-filter/);
  assert.match(inspectorHtml, /map-version-tools/);
  assert.match(inspectorHtml, /data-collapse-panel="sites"/);
  assert.match(inspectorHtml, /data-collapse-panel="details"/);
  assert.match(inspectorHtml, /data-collapse-section="policy"/);
  assert.match(inspectorHtml, /data-resize-section="policy"/);
  assert.match(inspectorHtml, /data-resize-section="review"/);
  assert.doesNotMatch(inspectorHtml, /view-website/);
  assert.match(inspectorHtml, /policy-panel/);
  assert.match(inspectorJs, /ListWorkflowMapperStates/);
  assert.match(inspectorJs, /SaveWorkflowMapperState/);
  assert.match(inspectorJs, /MapCurrentPage/);
  assert.match(inspectorJs, /InspectCurrentPageMap/);
  assert.match(inspectorJs, /refreshSelectedPageMap/);
  assert.match(inspectorJs, /checkSelectedPageLiveStatus/);
  assert.match(inspectorJs, /liveStatusFromResponse/);
  assert.match(inspectorJs, /renderLiveStatus/);
  assert.match(inspectorJs, /Refreshing selected page map/);
  assert.match(inspectorJs, /pageMap: entry\.pageMap/);
  assert.match(inspectorJs, /HighlightMapperComponent/);
  assert.match(inspectorJs, /highlightHoverEnabled/);
  assert.match(inspectorJs, /previewComponentHighlight/);
  assert.match(inspectorJs, /hoverHighlightRequestId/);
  assert.match(inspectorJs, /hoverRestoreTimer/);
  assert.match(inspectorJs, /clearHoverRestoreTimer/);
  assert.match(inspectorJs, /window\.setTimeout\(\(\) =>/);
  assert.match(inspectorJs, /highlightRequestId/);
  assert.match(inspectorJs, /nextHighlightRequestId/);
  assert.match(inspectorJs, /Date\.now\(\) \* 1000/);
  assert.match(inspectorJs, /activeResolutionKey/);
  assert.match(inspectorJs, /lastResolutionByTarget/);
  assert.match(inspectorJs, /componentResolutionKey/);
  assert.match(inspectorJs, /selectedResolutionKey/);
  assert.match(inspectorJs, /resolutionForComponent/);
  assert.match(inspectorJs, /pruneInspectorResolutionState/);
  assert.match(inspectorJs, /clearWebsiteHighlight/);
  assert.match(inspectorJs, /restoreSelection: true/);
  assert.match(inspectorJs, /btn-check-live-resolution/);
  assert.match(inspectorJs, /checkLiveResolution/);
  assert.match(inspectorJs, /cancelHoverPreview/);
  assert.match(inspectorJs, /silentStale/);
  assert.match(inspectorJs, /componentQuery/);
  assert.match(inspectorJs, /treeCollapsed/);
  assert.match(inspectorJs, /wireTreeToggles/);
  assert.match(inspectorJs, /treeChildrenHtml/);
  assert.match(inspectorJs, /componentTypeColor/);
  assert.match(inspectorJs, /isUsablePageMap/);
  assert.match(inspectorJs, /kept last usable map/);
  assert.match(inspectorJs, /filterComponents/);
  assert.match(inspectorJs, /uniqueInspectorComponents/);
  assert.match(inspectorJs, /includeRemoved/);
  assert.match(inspectorJs, /status === "removed"/);
  assert.match(inspectorJs, /filterComponents\(entry, \{ includeRemoved: true \}\)/);
  assert.match(inspectorJs, /component\.reviewRequired !== false/);
  assert.match(inspectorJs, /acceptedReviewStatus/);
  assert.match(inspectorJs, /previousStatus: current\.status \|\| ""/);
  assert.match(inspectorJs, /sortComponentsByVisualOrder/);
  assert.match(inspectorJs, /compareComponentsByVisualOrder/);
  assert.match(inspectorJs, /visualOrderBounds/);
  assert.match(inspectorJs, /compareStructureNodesByVisualOrder/);
  assert.match(inspectorJs, /firstStructureComponent/);
  assert.match(inspectorJs, /componentSearchText/);
  assert.match(inspectorJs, /componentMatchesSearch/);
  assert.match(inspectorJs, /queryMatchesNormalizedText/);
  assert.match(inspectorJs, /collectSearchTokens/);
  assert.match(inspectorJs, /semantic\.title/);
  assert.match(inspectorJs, /stableAttributes/);
  assert.match(inspectorJs, /technical\.domPath/);
  assert.match(inspectorJs, /component\.reconciliationDecision/);
  assert.match(inspectorJs, /cancelHoverPreview\(\);\s*\n\s*clearHoverRestoreTimer\(\);\s*\n\s*state\.selectedComponentId = componentId/);
  assert.match(inspectorJs, /querySelectorAll\("\.panning"\)/);
  assert.match(inspectorJs, /resetTransientViewInteractions/);
  assert.match(inspectorJs, /componentFilterSummaryText/);
  assert.match(inspectorJs, /componentIsHidden/);
  assert.match(inspectorJs, /hidden-badge/);
  assert.match(inspectorJs, /hidden-component/);
  assert.match(inspectorJs, /mapSubtitle/);
  assert.match(inspectorJs, /material mutation\(s\)/);
  assert.match(inspectorJs, /siteGroups/);
  assert.match(inspectorJs, /groupSiteEntries/);
  assert.match(inspectorJs, /baseSiteName/);
  assert.match(inspectorJs, /retainRecentPageMaps/);
  assert.match(inspectorJs, /pruneWorkflowMapperState/);
  assert.match(inspectorJs, /renderVersionTools/);
  assert.match(inspectorJs, /map-page-select/);
  assert.match(inspectorJs, /btn-delete-page/);
  assert.match(inspectorJs, /deleteSelectedPageGroup/);
  assert.match(inspectorJs, /nextEntryIdAfterDeletePage/);
  assert.match(inspectorJs, /Delete saved mapper page/);
  assert.match(inspectorJs, /btn-delete-map-version/);
  assert.match(inspectorJs, /deleteSelectedMapVersion/);
  assert.match(inspectorJs, /data-delete-site-key/);
  assert.match(inspectorJs, /deleteSiteGroup/);
  assert.match(inspectorJs, /Delete saved mapper site/);
  assert.match(inspectorJs, /nextEntryIdAfterDelete/);
  assert.match(inspectorJs, /Delete saved mapper version/);
  assert.match(inspectorJs, /hasOwnProperty\.call\(selection, "nextComponentId"\)/);
  assert.match(inspectorJs, /pageGroupsForSite/);
  assert.match(inspectorJs, /pageEntryKey/);
  assert.match(inspectorJs, /pageLabel/);
  assert.match(inspectorJs, /renderPanelChrome/);
  assert.match(inspectorJs, /detailSectionSizes/);
  assert.match(inspectorJs, /startDetailResize/);
  assert.match(inspectorJs, /renderDetailSectionSizes/);
  assert.match(inspectorJs, /reviewRequired/);
  assert.match(inspectorJs, /componentShortName/);
  assert.doesNotMatch(inspectorJs, /renderWebsite/);
  assert.match(inspectorJs, /tree-explorer/);
  assert.match(inspectorJs, /treeMode: "structure"/);
  assert.match(inspectorJs, /data-tree-mode/);
  assert.match(inspectorJs, /renderStructureTree/);
  assert.match(inspectorJs, /componentStructurePath/);
  assert.match(inspectorJs, /mapperDomPathSegments/);
  assert.match(inspectorJs, /frameAwareDomPathSegments/);
  assert.match(inspectorJs, /mapperDocumentContextSegments/);
  assert.match(inspectorJs, /compareInspectorDocumentNodes/);
  assert.match(inspectorJs, /inspectorStructureContextLabel/);
  assert.match(inspectorJs, /documentContext/);
  assert.match(inspectorJs, /root\.children\.sort\(compareStructureNodesByVisualOrder\)/);
  assert.match(inspectorJs, /::shadow::/);
  assert.match(inspectorJs, /mapper\.container_target\.v2/);
  assert.match(inspectorJs, /createContainerTarget/);
  assert.match(inspectorJs, /anchorComponentId/);
  assert.match(inspectorJs, /ancestorDepth/);
  assert.match(inspectorJs, /capturedDepth !== null/);
  assert.match(inspectorJs, /data-container-target/);
  assert.match(inspectorJs, /selectContainerTarget/);
  assert.match(inspectorJs, /Highlight container; use the chevron/);
  assert.match(inspectorJs, /componentPlatformScopePath/);
  assert.match(inspectorJs, /componentRepeatScopePath/);
  assert.match(inspectorJs, /profile:\$\{scope\.family\}/);
  assert.match(inspectorJs, /technical\?\.domPath/);
  assert.match(inspectorJs, /componentTypeGroupName/);
  assert.match(inspectorJs, /componentTreeRowHtml/);
  assert.match(inspectorJs, /componentTreeIconType/);
  assert.match(inspectorJs, /treeIconSvg/);
  assert.match(inspectorJs, /buildInspectorGraph/);
  assert.match(inspectorJs, /graphEdgeHtml/);
  assert.match(inspectorJs, /leafCount/);
  assert.match(inspectorJs, /layoutNode\(graphTree/);
  assert.match(inspectorJs, /graph-port graph-port-in/);
  assert.match(inspectorJs, /V \$\{midY\} H \$\{endX\} V/);
  assert.match(inspectorJs, /wireGraphCanvas/);
  assert.match(inspectorJs, /renderMobileGraphList/);
  assert.match(inspectorJs, /Graph hierarchy list/);
  assert.match(inspectorJs, /data-graph-action="fit"/);
  assert.match(inspectorJs, /data-graph-action="toggle-orientation"/);
  assert.match(inspectorJs, /orientInspectorGraph/);
  assert.match(inspectorJs, /layout-horizontal/);
  assert.match(inspectorJs, /H \$\{midX\} V \$\{endY\} H/);
  assert.match(inspectorJs, /data-graph-viewport/);
  assert.match(inspectorJs, /graph-node-\$\{node\.kind\}/);
  assert.match(inspectorJs, /componentRegionName/);
  assert.match(inspectorJs, /platformScopeRegionLabel/);
  assert.match(inspectorJs, /buildInspectorStructureRoot/);
  assert.match(inspectorJs, /buildStructuralInspectorGraph/);
  assert.match(inspectorJs, /containerTarget/);
  assert.match(inspectorJs, /structureNodeToGraphTree/);
  assert.match(inspectorJs, /structureMobileGraphNodeHtml/);
  assert.match(inspectorJs, /graphKindForStructureNode/);
  assert.match(inspectorJs, /templateKind/);
  assert.match(inspectorJs, /repeatScopeRegionLabel/);
  assert.match(inspectorJs, /decorateStaticControls/);
  assert.match(inspectorJs, /iconButtonHtml/);
  assert.match(inspectorJs, /iconSvg/);
  assert.match(inspectorJs, /renderMapLegend/);
  assert.match(inspectorJs, /Map color legend/);
  assert.match(inspectorJs, /saveComponentAlias/);
  assert.match(inspectorJs, /acceptCurrentMapping/);
  assert.match(inspectorJs, /savePolicy/);
  assert.match(inspectorJs, /policy-global-mode/);
  assert.match(inspectorJs, /policy-site-mode/);
  assert.match(inspectorJs, /policy-page-mode/);
  assert.match(inspectorJs, /applyPolicyOverrideValues/);
  assert.match(inspectorJs, /displayAlias/);
  assert.match(inspectorJs, /reviewDecision/);
  assert.doesNotMatch(inspectorJs, /policy-(?:site|page)-sensitive/);
  assert.doesNotMatch(inspectorJs, /sensitive-badge|redactSensitive/);
  assert.match(inspectorJs, /renderLiveCandidateLinks/);
  assert.match(inspectorJs, /linkLiveCandidateAttempt/);
  assert.match(inspectorJs, /inspector_live_candidate/);
  assert.match(inspectorJs, /primaryLocatorFromMapperFact/);
  assert.match(inspectorJs, /createReviewMapVersion/);
  assert.match(inspectorJs, /map_review_/);
  assert.match(inspectorJs, /previousMapVersionId/);
  assert.match(inspectorJs, /reviewSource: "mapper_inspector"/);
  assert.match(inspectorJs, /Resolver Log/);
  assert.match(inspectorJs, /renderReliabilitySummary/);
  assert.match(inspectorJs, /renderMapLayerSummary/);
  assert.match(inspectorJs, /mapLayerSummary/);
  assert.match(inspectorJs, /Map Layers/);
  assert.match(inspectorJs, /Static and dynamic history are isolated/);
  assert.match(inspectorJs, /renderPlatformProfileSummary/);
  assert.match(inspectorJs, /renderFrameSummary/);
  assert.match(inspectorJs, /renderComponentFrameScope/);
  assert.match(inspectorJs, /renderComponentRepeatScope/);
  assert.match(inspectorJs, /Repeat Scope/);
  assert.match(inspectorJs, /Frame Scope/);
  assert.match(inspectorJs, /Platform Profile/);
  assert.match(inspectorJs, /profile\.product/);
  assert.match(inspectorJs, /profile\.detectionSource/);
  assert.match(inspectorJs, /profile \$\{profile\.family\}/);
  assert.match(inspectorJs, /renderComponentPlatformScope/);
  assert.match(inspectorJs, /renderComponentRegionDynamics/);
  assert.match(inspectorJs, /Region Dynamics/);
  assert.match(inspectorJs, /componentIsDynamicContext/);
  assert.match(inspectorJs, /Live bounded dynamic/);
  assert.match(inspectorJs, /Platform Scope/);
  assert.match(inspectorJs, /platformStructure/);
  assert.match(inspectorJs, /Major panes/);
  assert.match(inspectorJs, /Contextual scope is captured with the local mapper data\./);
  assert.match(inspectorJs, /scope\.loadedWindowIndex/);
  assert.match(inspectorJs, /scope\.dynamicKind/);
  assert.match(inspectorJs, /scope\.mappingDisposition/);
  assert.match(inspectorJs, /scope\.scopeSource/);
  assert.match(inspectorJs, /renderComponentReliability/);
  assert.match(inspectorJs, /runtimeAttemptsForComponent/);
  assert.match(inspectorJs, /reliabilityMetricsForEntry/);
  assert.match(inspectorJs, /mapper\.runtime_resolution\.v1|Runtime resolver attempts/);
  assert.doesNotMatch(inspectorJs, /rawLocatorStored|rawTextStored|redaction/);
  assert.match(inspectorJs, /fallbackRecoveryCount/);
  assert.match(inspectorJs, /incorrectActionCount/);
  assert.match(inspectorCss, /graph-shell/);
  assert.match(inspectorCss, /graph-node-subregion/);
  assert.match(inspectorCss, /graph-node-template/);
  assert.match(inspectorCss, /graph-layout-horizontal \.graph-port/);
  assert.match(inspectorCss, /container-highlightable/);
  assert.match(inspectorCss, /graph-mobile-list/);
  assert.match(inspectorCss, /\.graph-viewport \{\s*\n\s*display: none/);
  assert.match(inspectorCss, /component-filterbar/);
  assert.match(inspectorCss, /map-live-status/);
  assert.match(inspectorCss, /hidden-component/);
  assert.match(inspectorCss, /dynamic-badge/);
  assert.match(inspectorCss, /map-layer-panel/);
  assert.match(inspectorCss, /status-hidden/);
  assert.match(inspectorCss, /subtle-button/);
  assert.match(inspectorCss, /@media \(max-width: 1180px\)/);
  assert.match(inspectorCss, /@media \(max-width: 640px\)/);
  assert.match(inspectorCss, /\.map-toolbar > div \{\s*\n\s*min-width: 0;/);
  assert.match(inspectorCss, /\.map-picker \{[\s\S]*flex: 1 1 190px/);
  assert.match(inspectorCss, /\.filter-summary \{[\s\S]*text-overflow: ellipsis/);
  assert.match(inspectorCss, /\.map-toolbar h1,\s*\n\s*\.map-toolbar p \{[\s\S]*white-space: normal/);
  assert.match(inspectorCss, /site-panel\.collapsed \.panel-heading > span,\s*\n\s*\.detail-panel\.collapsed \.detail-rail-heading > span \{[\s\S]*writing-mode: horizontal-tb/);
  assert.match(inspectorCss, /header-actions input:not\(\[type="checkbox"\]\),[\s\S]*\.component-filterbar button \{[\s\S]*min-height: 36px/);
  assert.match(inspectorCss, /\.site-panel,\s*\n\.map-panel,\s*\n\.detail-panel \{[\s\S]*min-width: 0/);
  assert.match(inspectorCss, /\.graph-controls \{[\s\S]*grid-template-columns: repeat\(4, minmax\(34px, auto\)\) minmax\(0, 1fr\)/);
  assert.match(inspectorCss, /\.graph-summary,\s*\n\s*\.graph-controls \.map-legend \{[\s\S]*grid-column: 1 \/ -1/);
  assert.match(inspectorCss, /\.site-title,\s*\n\s*\.site-meta,\s*\n\s*\.row-title,\s*\n\s*\.row-meta \{[\s\S]*white-space: normal/);
  assert.match(inspectorCss, /--muted: #cbd5e1/);
  assert.match(inspectorCss, /height: 100vh/);
  assert.match(inspectorCss, /flex: 1 1 auto/);
  assert.match(inspectorCss, /site-panel-collapsed/);
  assert.match(inspectorCss, /detail-panel-collapsed/);
  assert.match(inspectorCss, /panel-collapse/);
  assert.match(inspectorCss, /section-resizer/);
  assert.match(inspectorCss, /page-picker/);
  assert.match(inspectorCss, /version-picker/);
  assert.match(inspectorCss, /danger-button/);
  assert.match(inspectorCss, /header-actions input:not\(\[type="checkbox"\]\)/);
  assert.match(inspectorCss, /tree-toggle/);
  assert.match(inspectorCss, /tree-children\.collapsed/);
  assert.match(inspectorCss, /--type-color/);
  assert.match(inspectorCss, /tree-status-changed/);
  assert.match(inspectorCss, /tree-explorer/);
  assert.match(inspectorCss, /tree-controls/);
  assert.match(inspectorCss, /tree-mode-button/);
  assert.match(inspectorCss, /tree-icon-button/);
  assert.match(inspectorCss, /icon-button/);
  assert.match(inspectorCss, /data-tooltip/);
  assert.match(inspectorCss, /map-legend/);
  assert.match(inspectorCss, /legend-chip/);
  assert.match(inspectorCss, /reliability-panel/);
  assert.match(inspectorCss, /metric-pill/);
  assert.match(inspectorCss, /attempt-row/);
  assert.match(inspectorCss, /site-delete-button/);
  assert.match(inspectorCss, /grid-template-columns: minmax\(0, 1fr\) 30px/);
  assert.match(inspectorCss, /detail-panel > section/);
  assert.match(inspectorCss, /grid-template-rows: auto minmax\(0, 1fr\)/);
  assert.match(inspectorCss, /policy-panel,\s*\n\.component-detail/);
  assert.match(inspectorCss, /graph-edge/);
  assert.match(inspectorCss, /graph-port-in/);
  assert.match(inspectorCss, /graph-world/);
  assert.match(inspectorCss, /graph-node-component/);
  assert.doesNotMatch(inspectorCss, /website-component/);
});

test("manual mapper harness contains same-origin and accessible cross-origin frames", async () => {
  const fixture = await readFile(
    new URL("../BRunner_Host/mapper_test.html", import.meta.url),
    "utf8",
  );

  assert.match(fixture, /id="same-origin-frame"[\s\S]*src="mapper_frame_child\.html"/);
  assert.match(fixture, /id="cross-origin-frame"[\s\S]*src="http:\/\/localhost:8765\/BRunner_Host\/mapper_frame_child\.html"/);
  assert.match(fixture, /id="protected-frame"[\s\S]*sandbox/);
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

test("native map store persists workflow mapper states through host bridge", async () => {
  const bridge = createMemoryNativeMapperBridge();
  const store = createNativeMapStore(bridge);

  await store.saveWorkflowMapperState("workflowA", createEmptyWorkflowMapperState("workflowA"));
  const allStates = await store.getAllWorkflowMapperStates();
  const state = await store.getWorkflowMapperState("workflowA");
  const deleted = await store.deleteWorkflowMapperState("workflowA");

  assert.deepEqual(Object.keys(allStates), ["workflowA"]);
  assert.equal(state.workflowId, "workflowA");
  assert.equal(state.storage.provider, "native");
  assert.equal(deleted, true);
});

test("native map store reports timeout status without hanging callers", async () => {
  const store = createNativeMapStore({
    async listMapperStates() {
      throw new Error("Timed out waiting for native host response (42).");
    },
  });

  await assert.rejects(
    () => store.getAllWorkflowMapperStates(),
    (error) => {
      assert.ok(error instanceof MapStoreUnavailableError);
      assert.equal(error.code, "map_store_timeout");
      return true;
    },
  );

  const status = store.getStatus();
  assert.equal(status.available, false);
  assert.equal(status.state, "timeout");
  assert.equal(status.operation, "list");
});

function createMemoryStorage(initial = {}) {
  const values = structuredClone(initial);
  return {
    async get(key) {
      if (key === null) return structuredClone(values);
      return {
        [key]: structuredClone(values[key]),
      };
    },
    async set(next) {
      Object.assign(values, structuredClone(next));
    },
  };
}

function createMemoryNativeMapperBridge() {
  const states = {};
  return {
    async listMapperStates() {
      return { states: structuredClone(states) };
    },
    async getMapperState(workflowId) {
      return { state: structuredClone(states[workflowId] || null) };
    },
    async saveMapperState(workflowId, state) {
      states[workflowId] = structuredClone(state);
      return { state: structuredClone(states[workflowId]) };
    },
    async deleteMapperState(workflowId) {
      const deleted = Object.prototype.hasOwnProperty.call(states, workflowId);
      delete states[workflowId];
      return { deleted };
    },
  };
}
