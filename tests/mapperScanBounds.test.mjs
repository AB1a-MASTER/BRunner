import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildStaticPageMap } from "../BRunner/mapper/core.js";

const root = new URL("../", import.meta.url);
const mapperSource = await readFile(
  new URL("BRunner/content/mapper.js", root),
  "utf8",
);
const backgroundSource = await readFile(
  new URL("BRunner/background.js", root),
  "utf8",
);
const targetResolverSource = await readFile(
  new URL("BRunner/content/targetResolver.js", root),
  "utf8",
);

function createBudget(maxWork = 10000) {
  return {
    maxWork,
    workCount: 0,
    overflow: false,
    overflowAt: "",
    consume(kind = "work", count = 1) {
      if (this.overflow) return false;
      if (this.workCount + count > this.maxWork) {
        this.overflow = true;
        this.overflowAt = kind;
        return false;
      }
      this.workCount += count;
      return true;
    },
    fail(kind = "work") {
      this.overflow = true;
      this.overflowAt ||= kind;
      return false;
    },
  };
}

function classMethodSource(name, nextName) {
  const start = mapperSource.indexOf(`    ${name}`);
  const end = mapperSource.indexOf(`\n    ${nextName}`, start);
  assert.notEqual(start, -1, `Missing ${name}`);
  assert.notEqual(end, -1, `Missing boundary ${nextName}`);
  return mapperSource.slice(start, end).trim();
}

function backgroundFunctionSource(name, nextName) {
  const start = backgroundSource.indexOf(name);
  const end = backgroundSource.indexOf(`\n${nextName}`, start);
  assert.notEqual(start, -1, `Missing ${name}`);
  assert.notEqual(end, -1, `Missing boundary ${nextName}`);
  return backgroundSource.slice(start, end).trim();
}

function plainFunctionSource(source, name, nextName) {
  const start = source.indexOf(`  function ${name}`);
  const end = source.indexOf(`\n  function ${nextName}`, start);
  assert.notEqual(start, -1, `Missing ${name}`);
  assert.notEqual(end, -1, `Missing boundary ${nextName}`);
  return source.slice(start, end).trim();
}

function fakeDocumentFor(elements) {
  const document = {
    elements,
    ownerDocument: null,
    createTreeWalker(root) {
      let index = 0;
      return {
        nextNode() {
          return root.elements?.[index++] || null;
        },
      };
    },
  };
  document.ownerDocument = document;
  return document;
}

test("bounded DOM enumeration stops at one overflow sentinel", () => {
  let visited = 0;
  const elements = Array.from({ length: 10 }, (_, index) => ({
    index,
    shadowRoot: null,
    matches() {
      visited += 1;
      return true;
    },
  }));
  const document = fakeDocumentFor(elements);
  const method = Function(
    "document",
    "NodeFilter",
    "MAPPER_SCAN_OVERFLOW_SENTINEL",
    "DEFAULT_MAPPER_MAX_DOM_ROOTS",
    "MAX_MAPPER_CANDIDATE_ASSESSMENT_WORK",
    `return ({${classMethodSource(
      "enumerateBoundedStaticCandidateElements(options = {}) {",
      "enumerateStaticCandidateElements(options = {}) {",
    )}}).enumerateBoundedStaticCandidateElements;`,
  )(document, { SHOW_ELEMENT: 1 }, 1, 256, 100000);
  const result = method.call({
    getMapperStaticCandidateSelector: () => "*",
    normalizeMapperMaxComponents: () => 2,
    normalizeMapperMaxVisitedNodes: () => 100,
    createMapperWorkBudget: () => createBudget(100),
    isUsableControl: () => true,
    compareElementsByVisualOrder: (left, right) => left.index - right.index,
  }, {
    maxComponents: 2,
  });

  assert.equal(visited, 3);
  assert.equal(result.elements.length, 3);
  assert.equal(result.candidateCount, 3);
  assert.equal(result.overflow, true);

  const boundedBranch = classMethodSource(
    "enumerateBoundedStaticCandidateElements(options = {}) {",
    "enumerateStaticCandidateElements(options = {}) {",
  );
  assert.match(boundedBranch, /createTreeWalker/);
  assert.doesNotMatch(boundedBranch, /querySelectorAll/);
});

test("scan fact construction and returned controls stay within maxComponents", () => {
  const document = fakeDocumentFor([]);
  const candidates = Array.from({ length: 3 }, (_, index) => ({ index }));
  let factBuildCount = 0;
  const method = Function(
    "resolver",
    "document",
    "MAX_MAPPER_PLATFORM_PROFILE_WORK",
    "DEFAULT_MAPPER_MAX_DOM_ROOTS",
    `return ({${classMethodSource(
      "scanDom(options = {}) {",
      "installDomObserver() {",
    )}}).scanDom;`,
  )({
    buildElementTarget(element, ctrlHash) {
      return {
        primary: { strategy: "test", value: ctrlHash },
        fallbacks: [],
        snapshot: { index: element.index },
      };
    },
  }, document, 128000, 256);
  const context = {
    controls: new Map(),
    mapperMaxComponents: 500,
    detectMapperPlatformProfile: () => ({ family: "generic" }),
    normalizeMapperMaxComponents: () => 2,
    normalizeMapperMaxVisitedNodes: () => 100,
    createMapperWorkBudget: () => createBudget(100),
    createMapperFactWorkBudget: () => createBudget(100),
    enumerateBoundedStaticCandidateElements: () => ({
      elements: candidates,
      roots: [document],
      overflow: true,
      candidateCount: 3,
    }),
    getOrCreateControlHash: (element) => `control-${element.index}`,
    buildMapperComponentFact(element) {
      factBuildCount += 1;
      return { componentUid: `fact-${element.index}` };
    },
    getFriendlyName: (element) => `Control ${element.index}`,
    observeMapperRoots: () => {},
  };

  const controls = method.call(context, {
    maxComponents: 2,
    reason: "test",
  });

  assert.equal(factBuildCount, 2);
  assert.equal(controls.length, 2);
  assert.equal(context.controls.size, 2);
  assert.equal(context.lastMapperScanDiagnostics.sampledComponentCount, 2);
  assert.equal(context.lastMapperScanDiagnostics.candidateCount, 3);
  assert.equal(context.lastMapperScanDiagnostics.overflow, true);
});

test("runtime candidate enumeration refuses overflow before building mapper facts", () => {
  let factBuildCount = 0;
  const method = Function(
    "DEFAULT_MAPPER_RUNTIME_WORK",
    "MAX_MAPPER_RUNTIME_WORK",
    `return ({${classMethodSource(
      'enumerateMapperCandidates(action = "", options = {}) {',
      'mapperComponentScanOverflowResolution(component = {}, action = "", diagnostics = {}) {',
    )}}).enumerateMapperCandidates;`,
  )(50000, 100000);
  const result = method.call({
    normalizeMapperMaxComponents: () => 2,
    createMapperWorkBudget: () => createBudget(100),
    createMapperFactWorkBudget: () => createBudget(100),
    getMapperStaticCandidateSelector: () => "*",
    enumerateBoundedMapperElements: () => ({
      elements: [{}, {}, {}],
      overflow: true,
      candidateCount: 3,
      maxComponents: 2,
    }),
    mapperCandidateFromElement() {
      factBuildCount += 1;
      return {};
    },
  }, "element.click", {
    maxComponents: 2,
  });

  assert.equal(factBuildCount, 0);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.overflow, true);
  assert.equal(result.candidateCount, 3);
});

test("runtime locator overflow returns structured unsupported without selecting a candidate", () => {
  let factBuildCount = 0;
  const overflowMethod = Function(
    "MAPPER_SCAN_OVERFLOW_SENTINEL",
    `return ({${classMethodSource(
      'mapperComponentScanOverflowResolution(component = {}, action = "", diagnostics = {}) {',
      'mapperCandidateFromElement(element, action = "", preferredLocator = null, source = "live_candidate", options = {}) {',
    )}}).mapperComponentScanOverflowResolution;`,
  )(1);
  const overflowContext = {
    normalizeMapperMaxComponents: () => 2,
    withMapperResolverLog: (result) => result,
  };
  const method = Function(
    "MAX_MAPPER_RUNTIME_LOCATORS",
    `return ({${classMethodSource(
      'resolveStoredMapperLocatorTarget(component = {}, action = "", options = {}) {',
      'findElementsByMapperLocator(locator = {}, options = {}) {',
    )}}).resolveStoredMapperLocatorTarget;`,
  )(32);
  overflowContext.findElementsByMapperLocator = () => ({
    elements: [{}, {}, {}],
    overflow: true,
    candidateCount: 3,
    maxComponents: 2,
  });
  overflowContext.mapperComponentScanOverflowResolution = overflowMethod.bind(overflowContext);
  overflowContext.mapperCandidateFromElement = () => {
    factBuildCount += 1;
    return {};
  };

  const result = method.call(overflowContext, {
    primaryLocator: { strategy: "text", value: "Save" },
  }, "element.click", {
    maxComponents: 2,
  });

  assert.equal(factBuildCount, 0);
  assert.equal(result.element, null);
  assert.equal(result.mapperState, "protected_unsupported");
  assert.equal(result.mapperReason, "component_scan_overflow");
  assert.deepEqual(result.attempts, []);
  assert.deepEqual({
    version: result.scanDiagnostics.version,
    maxComponents: result.scanDiagnostics.maxComponents,
    sampledComponentCount: result.scanDiagnostics.sampledComponentCount,
    candidateCount: result.scanDiagnostics.candidateCount,
    candidateCountIsLowerBound: result.scanDiagnostics.candidateCountIsLowerBound,
    overflow: result.scanDiagnostics.overflow,
    reason: result.scanDiagnostics.reason,
  }, {
    version: "mapper.scan.v1",
    maxComponents: 2,
    sampledComponentCount: 0,
    candidateCount: 3,
    candidateCountIsLowerBound: true,
    overflow: true,
    reason: "component_scan_overflow",
  });
});

test("generic runtime DOM matching stops at max plus one", () => {
  let visited = 0;
  const elements = Array.from({ length: 20 }, (_, index) => ({
    index,
    shadowRoot: null,
  }));
  const document = fakeDocumentFor(elements);
  const method = Function(
    "document",
    "NodeFilter",
    "MAPPER_SCAN_OVERFLOW_SENTINEL",
    "DEFAULT_MAPPER_MAX_DOM_ROOTS",
    "MAX_MAPPER_CANDIDATE_ASSESSMENT_WORK",
    `return ({${classMethodSource(
      "enumerateBoundedMapperElements(options = {}) {",
      "getMapperStaticCandidateSelector() {",
    )}}).enumerateBoundedMapperElements;`,
  )(document, { SHOW_ELEMENT: 1 }, 1, 256, 100000);
  const result = method.call({
    normalizeMapperMaxComponents: () => 2,
    normalizeMapperMaxVisitedNodes: () => 100,
    createMapperWorkBudget: () => createBudget(100),
    isUsableControl: () => true,
    compareElementsByVisualOrder: (left, right) => left.index - right.index,
  }, {
    maxComponents: 2,
    includeHidden: true,
    matches: () => {
      visited += 1;
      return true;
    },
  });

  assert.equal(visited, 3);
  assert.equal(result.elements.length, 3);
  assert.equal(result.overflow, true);
  assert.equal(result.candidateCount, 3);
});

test("sparse DOM traversal reports visited-node overflow without finding candidates", () => {
  let visited = 0;
  const elements = Array.from({ length: 20 }, () => ({
    shadowRoot: null,
    matches() {
      visited += 1;
      return false;
    },
  }));
  const document = fakeDocumentFor(elements);
  const method = Function(
    "document",
    "NodeFilter",
    "MAPPER_SCAN_OVERFLOW_SENTINEL",
    "DEFAULT_MAPPER_MAX_DOM_ROOTS",
    "MAX_MAPPER_CANDIDATE_ASSESSMENT_WORK",
    `return ({${classMethodSource(
      "enumerateBoundedStaticCandidateElements(options = {}) {",
      "enumerateStaticCandidateElements(options = {}) {",
    )}}).enumerateBoundedStaticCandidateElements;`,
  )(document, { SHOW_ELEMENT: 1 }, 1, 256, 100000);
  const result = method.call({
    getMapperStaticCandidateSelector: () => "button",
    normalizeMapperMaxComponents: () => 2,
    normalizeMapperMaxVisitedNodes: () => 3,
    createMapperWorkBudget: () => createBudget(100),
    isUsableControl: () => true,
    compareElementsByVisualOrder: () => 0,
  }, { maxComponents: 2, maxVisitedNodes: 3 });

  assert.equal(visited, 4);
  assert.equal(result.elements.length, 0);
  assert.equal(result.visitedNodeCount, 4);
  assert.equal(result.overflow, true);
  assert.equal(result.overflowKind, "visited_node_budget");
});

test("shadow-root discovery has an independent deterministic cap", () => {
  const document = fakeDocumentFor([]);
  const shadowA = { elements: [], ownerDocument: document };
  const shadowB = { elements: [], ownerDocument: document };
  document.elements = [
    { shadowRoot: shadowA, matches: () => false },
    { shadowRoot: shadowB, matches: () => false },
  ];
  const method = Function(
    "document",
    "NodeFilter",
    "MAPPER_SCAN_OVERFLOW_SENTINEL",
    "DEFAULT_MAPPER_MAX_DOM_ROOTS",
    "MAX_MAPPER_CANDIDATE_ASSESSMENT_WORK",
    `return ({${classMethodSource(
      "enumerateBoundedStaticCandidateElements(options = {}) {",
      "enumerateStaticCandidateElements(options = {}) {",
    )}}).enumerateBoundedStaticCandidateElements;`,
  )(document, { SHOW_ELEMENT: 1 }, 1, 2, 100000);
  const result = method.call({
    getMapperStaticCandidateSelector: () => "button",
    normalizeMapperMaxComponents: () => 10,
    normalizeMapperMaxVisitedNodes: () => 100,
    createMapperWorkBudget: () => createBudget(100),
    isUsableControl: () => true,
    compareElementsByVisualOrder: () => 0,
  }, {});

  assert.equal(result.overflow, true);
  assert.equal(result.overflowKind, "dom_root_budget");
  assert.equal(result.rootBudgetExceeded, true);
  assert.equal(result.discoveredRootCount, 3);
  assert.equal(result.roots.length, 1);
});

test("deep ancestor traversal uses work budget instead of the old locator depth cap", () => {
  const method = Function(
    `return ({${classMethodSource(
      'getBoundedMapperClosest(element, selector, kind = "fact_ancestor") {',
      'getBoundedMapperSiblingIndex(element, kind = "fact_sibling") {',
    )}}).getBoundedMapperClosest;`,
  )();
  const chain = Array.from({ length: 76 }, (_, index) => ({
    index,
    matches: (selector) => selector === "main" && index === 75,
    parentElement: null,
  }));
  for (let index = 0; index < chain.length - 1; index += 1) {
    chain[index].parentElement = chain[index + 1];
  }
  const budget = createBudget(100);
  const result = method.call({
    consumeMapperFactWork: (kind) => budget.consume(kind),
    getMapperComposedParentElement: (element) => element.parentElement,
  }, chain[0], "main");

  assert.equal(result, chain[75]);
  assert.equal(budget.overflow, false);
  assert.equal(budget.workCount, 76);
});

test("mutation observer records, nodes, and direct text each have caps", () => {
  const method = Function(
    "MAX_MAPPER_MUTATION_RECORDS",
    "MAX_MAPPER_MUTATION_NODES",
    "MAX_MAPPER_MUTATION_TEXT_NODES",
    `return ({${classMethodSource(
      "recordMapperMutations(records = []) {",
      "recordMapperRegionMutation(node, count = 1) {",
    )}}).recordMapperMutations;`,
  )(100, 500, 1000);
  const context = {
    mapperMutationStats: {
      materialMutationCount: 0,
      lastMutationAt: "",
      regionMutationCounts: {},
      observerOverflowCount: 0,
      lastObserverOverflowAt: "",
      lastObserverSummary: null,
    },
    isBRunnerInternalNode: () => false,
    recordMapperRegionMutation: () => {},
    isMaterialMutationNode(_node, budget) {
      budget.consume();
      budget.consume();
      budget.consume();
      return false;
    },
  };
  const records = [{
    type: "childList",
    target: {},
    addedNodes: Array.from({ length: 500 }, () => ({})),
    removedNodes: [],
  }];
  const result = method.call(context, records);
  assert.equal(result.nodesVisited, 334);
  assert.equal(result.textNodesVisited, 1000);
  assert.equal(result.textWorkOverflow, true);
  assert.equal(result.overflow, true);
  assert.equal(result.reason, "mutation_observer_text_work_overflow");

  const recordOverflow = method.call(context, Array.from({ length: 101 }, () => ({
    type: "attributes",
    target: {},
  })));
  assert.equal(recordOverflow.recordsVisited, 100);
  assert.equal(recordOverflow.overflow, true);
});

test("target text and sibling traversal stop through the shared budget", () => {
  const textSource = plainFunctionSource(
    targetResolverSource,
    "getBoundedElementText(element, options = {}) {",
    "enumerateBoundedElements(selector, options = {}) {",
  );
  const getText = Function(
    "isElement",
    "createTargetWorkBudget",
    "consumeWork",
    "cleanValue",
    `${textSource}; return getBoundedElementText;`,
  )(
    () => true,
    () => createBudget(100),
    (budget, kind, count) => budget.consume(kind, count),
    (value) => String(value || "").trim(),
  );
  const root = { firstChild: null };
  let previous = null;
  for (let index = 0; index < 20; index += 1) {
    const node = {
      nodeType: 1,
      firstChild: null,
      nextSibling: null,
      parentNode: root,
      matches: () => false,
    };
    if (!root.firstChild) root.firstChild = node;
    if (previous) previous.nextSibling = node;
    previous = node;
  }
  const textBudget = createBudget(5);
  assert.equal(getText(root, { workBudget: textBudget, maxChars: 80 }), "");
  assert.equal(textBudget.overflow, true);
  assert.equal(textBudget.workCount, 5);

  const siblingSource = plainFunctionSource(
    targetResolverSource,
    'getElementSiblingIndex(element, workBudget, kind = "target_sibling") {',
    "getSameTagSiblingPosition(element, workBudget) {",
  );
  const getSiblingIndex = Function(
    "consumeWork",
    `${siblingSource}; return getElementSiblingIndex;`,
  )((budget, kind, count) => budget.consume(kind, count));
  const parent = { firstElementChild: null };
  const siblings = Array.from({ length: 20 }, () => ({
    parentElement: parent,
    nextElementSibling: null,
  }));
  parent.firstElementChild = siblings[0];
  siblings.forEach((sibling, index) => {
    sibling.nextElementSibling = siblings[index + 1] || null;
  });
  const siblingBudget = createBudget(5);
  assert.equal(getSiblingIndex(siblings[10], siblingBudget), -1);
  assert.equal(siblingBudget.overflow, true);
});

test("many-frame discovery retains only the deterministic budget plus overflow sentinel", () => {
  const source = backgroundFunctionSource(
    "function selectBoundedInspectorMapperFrames(",
    "async function getInspectorMapperFrameSnapshots(",
  );
  const selectFrames = Function(
    "MAPPER_FRAME_CONTEXT_BUDGET",
    `${source}; return selectBoundedInspectorMapperFrames;`,
  )(100);
  const discovered = Array.from({ length: 250 }, (_, index) => {
    const frameId = 249 - index;
    return {
      frameId,
      result: {
        frameScope: { path: frameId ? `top > iframe:nth(${frameId})` : "top" },
      },
    };
  });

  const selection = selectFrames(discovered, 3);

  assert.deepEqual(selection.frames.map((entry) => entry.frameId), [0, 1, 2]);
  assert.equal(selection.frames.length, 3);
  assert.equal(selection.discoveredFrameContextCount, 250);
  assert.equal(selection.frameContextOverflow, true);
  assert.equal(selection.firstOmittedFramePath, "top > iframe:nth(3)");
});

test("many-frame aggregation caps messages and stops without per-frame overflow placeholders", async () => {
  const selectSource = backgroundFunctionSource(
    "function selectBoundedInspectorMapperFrames(",
    "async function getInspectorMapperFrameSnapshots(",
  );
  const selectFrames = Function(
    "MAPPER_FRAME_CONTEXT_BUDGET",
    `${selectSource}; return selectBoundedInspectorMapperFrames;`,
  )(100);
  const snapshotSource = backgroundFunctionSource(
    "async function getInspectorMapperFrameSnapshots(",
    "function summarizeInspectorScanDiagnostics(",
  );
  const discovered = Array.from({ length: 250 }, (_, frameId) => ({
    frameId,
    result: {
      frameScope: { path: frameId ? `top > iframe:nth(${frameId})` : "top" },
    },
  })).reverse();

  async function runCollection(responseForFrame) {
    const sentFrameIds = [];
    let injectionCount = 0;
    const chrome = {
      scripting: {
        executeScript: async () => discovered,
      },
      tabs: {
        sendMessage: async (_tabId, _message, target) => {
          sentFrameIds.push(target.frameId);
          return responseForFrame(target.frameId);
        },
      },
    };
    const getSnapshots = Function(
      "chrome",
      "createDefaultMapperSettings",
      "normalizeMapperSettings",
      "MAPPER_FRAME_CONTEXT_BUDGET",
      "selectBoundedInspectorMapperFrames",
      "decorateAccessibleMapperFrameSnapshots",
      "injectMapperContentScripts",
      `${snapshotSource}; return getInspectorMapperFrameSnapshots;`,
    )(
      chrome,
      () => ({ maxComponents: 500 }),
      ({ maxComponents }) => ({ maxComponents }),
      100,
      selectFrames,
      (snapshots) => snapshots,
      async () => {
        injectionCount += 1;
      },
    );
    const snapshots = await getSnapshots({ id: 7 }, "", 500);
    return { snapshots, sentFrameIds, injectionCount };
  }

  const budgeted = await runCollection((frameId) => ({
    ok: true,
    controls: [],
    page: {},
    frameScope: discovered.find((entry) => entry.frameId === frameId).result.frameScope,
    scanDiagnostics: { candidateCount: 0, overflow: false },
  }));
  assert.equal(budgeted.sentFrameIds.length, 100);
  assert.equal(budgeted.snapshots.length, 100);
  assert.equal(budgeted.injectionCount, 0);
  assert.equal(budgeted.snapshots[0].scanDiagnostics.frameContextOverflow, true);
  assert.equal(budgeted.snapshots[0].scanDiagnostics.frameScanIncomplete, true);
  assert.equal(
    budgeted.snapshots[0].scanDiagnostics.firstOmittedFramePath,
    "top > iframe:nth(100)",
  );

  const componentOverflow = await runCollection((frameId) => ({
    ok: true,
    controls: [{ mapperFact: { componentUid: `component-${frameId}` } }],
    page: {},
    frameScope: discovered.find((entry) => entry.frameId === frameId).result.frameScope,
    scanDiagnostics: { candidateCount: 501, overflow: true },
  }));
  assert.deepEqual(componentOverflow.sentFrameIds, [0]);
  assert.equal(componentOverflow.snapshots.length, 1);
  assert.equal(componentOverflow.injectionCount, 0);
  assert.equal(componentOverflow.snapshots[0].scanDiagnostics.stoppedDueToComponentLimit, true);
  assert.equal(
    componentOverflow.snapshots[0].scanDiagnostics.firstOmittedFramePath,
    "top > iframe:nth(1)",
  );
});

test("frame overflow diagnostics survive page-map normalization without changing defer semantics", () => {
  const pageMap = buildStaticPageMap({
    page: {
      url: "https://example.test/frame-overflow",
      title: "Frame overflow",
      frameSummary: {
        sameOriginFrames: 99,
        crossOriginFrames: 1,
        accessibleFramePaths: ["top", "top > iframe:nth(1)"],
        incompleteFramePaths: ["top > iframe:nth(100)"],
        maxFrameContexts: 100,
        discoveredFrameContextCount: 250,
        processedFrameContextCount: 100,
        reachableFrameContextCount: 100,
        frameContextOverflow: true,
        frameScanIncomplete: true,
        accessibleFramePathsComplete: false,
      },
      scanDiagnostics: {
        maxComponents: 500,
        sampledComponentCount: 0,
        candidateCount: 501,
        candidateCountIsLowerBound: true,
        overflow: true,
        reason: "frame_context_overflow",
        maxFrameContexts: 100,
        discoveredFrameContextCount: 250,
        processedFrameContextCount: 100,
        reachableFrameContextCount: 100,
        frameContextOverflow: true,
        frameScanIncomplete: true,
        accessibleFramePathsComplete: false,
        firstOmittedFramePath: "top > iframe:nth(100)",
      },
    },
    componentFacts: [],
    settings: { maxComponents: 500 },
  });

  assert.equal(pageMap.classification, "dynamic_deferred");
  assert.equal(pageMap.diagnostics.scanOverflow, true);
  assert.equal(pageMap.diagnostics.scanReason, "frame_context_overflow");
  assert.equal(pageMap.diagnostics.frameContextOverflow, true);
  assert.equal(pageMap.diagnostics.frameScanIncomplete, true);
  assert.equal(pageMap.diagnostics.accessibleFramePathsComplete, false);
  assert.equal(pageMap.diagnostics.firstOmittedFramePath, "top > iframe:nth(100)");
  assert.deepEqual(
    pageMap.diagnostics.frameSummary.incompleteFramePaths,
    ["top > iframe:nth(100)"],
  );
});

test("controls-tree messages and multi-frame aggregation preserve bounded overflow diagnostics", async () => {
  const background = backgroundSource;
  const frameAggregation = background.match(
    /async function getInspectorMapperFrameSnapshots[\s\S]*?(?=\nfunction summarizeInspectorScanDiagnostics)/,
  )?.[0] || "";
  const controlsTreeCase = mapperSource.match(
    /case "GET_CONTROLS_TREE":[\s\S]*?(?=\n\s*default:)/,
  )?.[0] || "";

  assert.match(controlsTreeCase, /maxComponents: request\.maxComponents/);
  assert.match(controlsTreeCase, /scanDiagnostics: \{ \.\.\.this\.lastMapperScanDiagnostics \}/);
  assert.match(
    mapperSource,
    /!mutationDiagnostics\.materialMutationCount[\s\S]*?!mutationDiagnostics\.overflow/,
  );
  assert.match(mapperSource, /MAPPER_RESCAN_DEBOUNCE_MS/);
  assert.match(background, /maxComponents: frameMaxComponents/);
  assert.match(background, /responseControls\.slice\(0, remaining\)/);
  assert.match(background, /allMapperFacts\.slice\(0, policy\.maxComponents\)/);
  assert.match(background, /component_scan_overflow/);
  assert.match(background, /frame_context_overflow/);
  assert.match(background, /frame_scan_incomplete/);
  assert.match(background, /MAPPER_FRAME_CONTEXT_BUDGET = 100/);
  assert.doesNotMatch(frameAggregation, /skippedDueToGlobalLimit/);
  assert.match(background, /scanDiagnostics: snapshot\.page\.scanDiagnostics \|\| null/);
  assert.match(mapperSource, /mapperState: "protected_unsupported"[\s\S]*?mapperReason: "component_scan_overflow"/);
  assert.match(mapperSource, /findMapperElementsByText[\s\S]*?enumerateBoundedMapperElements/);
  assert.doesNotMatch(mapperSource, /enumerateStaticCandidateElements\(\)\.filter/);

  assert.ok(
    frameAggregation.indexOf("responseControls.slice(0, remaining)") <
      frameAggregation.indexOf("acceptedControlCount += acceptedControls.length"),
    "frame controls must be sliced before the aggregate count advances",
  );
});

test("live mapper snapshots never substitute a non-top frame for frame zero", () => {
  const liveSnapshot = backgroundFunctionSource(
    "async function getInspectorLiveMapperSnapshot(",
    "function selectBoundedInspectorMapperFrames(",
  );
  assert.match(liveSnapshot, /snapshot\.frameId === 0/);
  assert.doesNotMatch(liveSnapshot, /\|\|\s*frameSnapshots\[0\]/);
});

test("target resolver bounds text, labels, siblings, and runtime fallback work", () => {
  assert.match(targetResolverSource, /target_text_descendant/);
  assert.match(targetResolverSource, /target_dom_path_sibling/);
  assert.match(targetResolverSource, /target_css_sibling/);
  assert.match(targetResolverSource, /target_label_ancestor/);
  assert.match(targetResolverSource, /target_locator_candidate_budget/);
  assert.match(targetResolverSource, /mode: "work_budget_exceeded"/);
  assert.doesNotMatch(targetResolverSource, /querySelectorAll/);
  assert.doesNotMatch(targetResolverSource, /failWorkBudget\([^\n]*target_dom_path_depth/);
  assert.doesNotMatch(targetResolverSource, /failWorkBudget\([^\n]*target_css_ancestor_depth/);
});
