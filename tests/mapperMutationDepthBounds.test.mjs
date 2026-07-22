import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const mapperSource = await readFile(
  new URL("BRunner/content/mapper.js", root),
  "utf8",
);

function classMethodSource(name, nextName) {
  const start = mapperSource.indexOf(`    ${name}`);
  const end = mapperSource.indexOf(`\n    ${nextName}`, start);
  assert.notEqual(start, -1, `Missing ${name}`);
  assert.notEqual(end, -1, `Missing boundary ${nextName}`);
  return mapperSource.slice(start, end).trim();
}

function createBudget(maxWork = 1000) {
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
  };
}

function createMutationStats() {
  return {
    materialMutationCount: 0,
    lastMutationAt: "",
    regionMutationCounts: {},
    observerOverflowCount: 0,
    lastObserverOverflowAt: "",
    lastObserverSummary: null,
  };
}

test("observer captures bounded characterData changes and text clearing is material", () => {
  const document = { documentElement: { id: "document-root" } };
  const observeMapperRoots = Function(
    "document",
    `return ({${classMethodSource(
      "observeMapperRoots(roots = this.lastMapperScanRoots) {",
      "recordMapperMutations(records = []) {",
    )}}).observeMapperRoots;`,
  )(document);
  let observed = null;
  observeMapperRoots.call({
    mapperObserver: {
      observe(target, options) {
        observed = { target, options };
      },
    },
    observedMapperRoots: {
      has: () => false,
      add: () => {},
    },
    lastMapperScanRoots: [document],
  }, [document]);

  assert.equal(observed.target, document.documentElement);
  assert.equal(observed.options.characterData, true);
  assert.equal(Object.hasOwn(observed.options, "characterDataOldValue"), false);
  assert.equal(observed.options.subtree, true);

  const Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
  const methods = Function(
    "MAX_MAPPER_MUTATION_RECORDS",
    "MAX_MAPPER_MUTATION_NODES",
    "MAX_MAPPER_MUTATION_TEXT_NODES",
    "Node",
    `return ({
      ${classMethodSource(
        "recordMapperMutations(records = []) {",
        "recordMapperRegionMutation(node, count = 1) {",
      )},
      ${classMethodSource(
        "isBRunnerInternalNode(node) {",
        "getMapperPageSnapshot(options = {}) {",
      )}
    });`,
  )(100, 500, 1000, Node);
  const context = {
    ...methods,
    mapperMutationStats: createMutationStats(),
    recordMapperRegionMutation: () => {},
    isMaterialMutationNode: () => false,
  };
  const parentElement = {
    nodeType: Node.ELEMENT_NODE,
    id: "content",
    closest: () => null,
  };

  const updated = context.recordMapperMutations([{
    type: "characterData",
    target: {
      nodeType: Node.TEXT_NODE,
      nodeValue: "Updated text",
      parentElement,
    },
    oldValue: "Previous text",
  }]);
  assert.equal(updated.materialMutationCount, 1);
  assert.equal(updated.nodesVisited, 1);
  assert.equal(updated.textNodesVisited, 1);
  assert.equal(updated.overflow, false);

  context.mapperMutationStats = createMutationStats();
  const cleared = context.recordMapperMutations([{
    type: "characterData",
    target: {
      nodeType: Node.TEXT_NODE,
      nodeValue: "",
      parentElement,
    },
    oldValue: "Visible before",
  }]);
  assert.equal(cleared.materialMutationCount, 1);
  assert.equal(cleared.textNodesVisited, 1);

  context.mapperMutationStats = createMutationStats();
  const internal = context.recordMapperMutations([{
    type: "characterData",
    target: {
      nodeType: Node.TEXT_NODE,
      nodeValue: "BRunner overlay label",
      parentElement: {
        nodeType: Node.ELEMENT_NODE,
        id: "brunner-recorder-highlight",
        closest: () => null,
      },
    },
  }]);
  assert.equal(internal.materialMutationCount, 0);
  assert.equal(internal.nodesVisited, 0);
});

test("characterData processing reports text-budget overflow", () => {
  const Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
  const recordMapperMutations = Function(
    "MAX_MAPPER_MUTATION_RECORDS",
    "MAX_MAPPER_MUTATION_NODES",
    "MAX_MAPPER_MUTATION_TEXT_NODES",
    "Node",
    `return ({${classMethodSource(
      "recordMapperMutations(records = []) {",
      "recordMapperRegionMutation(node, count = 1) {",
    )}}).recordMapperMutations;`,
  )(100, 500, 1, Node);
  const context = {
    mapperMutationStats: createMutationStats(),
    isBRunnerInternalNode: () => false,
    recordMapperRegionMutation: () => {},
    isMaterialMutationNode: () => false,
  };
  const records = Array.from({ length: 2 }, () => ({
    type: "characterData",
    target: { nodeType: Node.TEXT_NODE, nodeValue: "changed" },
  }));

  const result = recordMapperMutations.call(context, records);
  assert.equal(result.materialMutationCount, 1);
  assert.equal(result.nodesVisited, 2);
  assert.equal(result.textNodesVisited, 1);
  assert.equal(result.textWorkOverflow, true);
  assert.equal(result.overflow, true);
  assert.equal(result.reason, "mutation_observer_text_work_overflow");
});

test("DOM paths retain ancestry deeper than ten levels until the work budget ends", () => {
  const Node = { ELEMENT_NODE: 1 };
  class FakeElement {
    constructor(tagName, rootNode) {
      this.nodeType = Node.ELEMENT_NODE;
      this.tagName = tagName.toUpperCase();
      this.parentElement = null;
      this.firstElementChild = null;
      this.nextElementSibling = null;
      this.rootNode = rootNode;
    }

    getRootNode() {
      return this.rootNode;
    }
  }
  class FakeShadowRoot {}
  const document = { documentElement: null };
  const html = new FakeElement("html", document);
  document.documentElement = html;
  const body = new FakeElement("body", document);
  appendElement(html, body);
  let parent = body;
  for (let index = 0; index < 12; index += 1) {
    const ancestor = new FakeElement("div", document);
    appendElement(parent, ancestor);
    parent = ancestor;
  }
  const target = new FakeElement("button", document);
  appendElement(parent, target);

  const methods = createPathMethods(FakeElement, FakeShadowRoot, Node);
  const completeBudget = createBudget(1000);
  const completeContext = createPathContext(methods, completeBudget);
  const path = completeContext.getMapperDomPath(target);
  assert.ok(path.split("/").length > 10);
  assert.match(path, /^html:0\/body:0\//);
  assert.equal(completeBudget.overflow, false);

  const exhaustedBudget = createBudget(5);
  const exhaustedContext = createPathContext(methods, exhaustedBudget);
  assert.equal(exhaustedContext.getMapperDomPath(target), "");
  assert.equal(exhaustedBudget.overflow, true);
  assert.equal(exhaustedBudget.overflowAt, "fact_dom_path_ancestor");
});

test("composed paths retain more than five nested shadow roots", () => {
  const Node = { ELEMENT_NODE: 1 };
  class FakeElement {
    constructor(tagName, rootNode) {
      this.nodeType = Node.ELEMENT_NODE;
      this.tagName = tagName.toUpperCase();
      this.parentElement = null;
      this.firstElementChild = null;
      this.nextElementSibling = null;
      this.rootNode = rootNode;
    }

    getRootNode() {
      return this.rootNode;
    }
  }
  class FakeShadowRoot {
    constructor(host) {
      this.host = host;
    }
  }
  const document = { documentElement: null };
  const html = new FakeElement("html", document);
  document.documentElement = html;
  const body = new FakeElement("body", document);
  appendElement(html, body);

  let parent = body;
  let currentRoot = document;
  for (let index = 0; index < 6; index += 1) {
    const host = new FakeElement(`host-${index}`, currentRoot);
    appendElement(parent, host);
    const shadowRoot = new FakeShadowRoot(host);
    const shell = new FakeElement("section", shadowRoot);
    parent = shell;
    currentRoot = shadowRoot;
  }
  const target = new FakeElement("button", currentRoot);
  appendElement(parent, target);

  const methods = createPathMethods(FakeElement, FakeShadowRoot, Node);
  const budget = createBudget(1000);
  const context = createPathContext(methods, budget);
  const shadowPath = context.getMapperShadowPath(target);
  const domPath = context.getMapperDomPath(target);

  assert.equal(shadowPath.length, 6);
  assert.equal(domPath.split("::shadow::").length, 7);
  assert.equal(budget.overflow, false);
  assert.ok(shadowPath.every((boundary) => boundary.hostPath && boundary.innerPath));

  const exhaustedBudget = createBudget(3);
  const exhaustedContext = createPathContext(methods, exhaustedBudget);
  assert.deepEqual(exhaustedContext.getMapperShadowPath(target), []);
  assert.equal(exhaustedBudget.overflow, true);
  assert.match(exhaustedBudget.overflowAt, /^fact_(?:dom_path|shadow_path)_/);
});

function appendElement(parent, child) {
  child.parentElement = parent;
  if (!parent.firstElementChild) {
    parent.firstElementChild = child;
    return;
  }
  let sibling = parent.firstElementChild;
  while (sibling.nextElementSibling) sibling = sibling.nextElementSibling;
  sibling.nextElementSibling = child;
}

function createPathMethods(Element, ShadowRoot, Node) {
  return Function(
    "Element",
    "ShadowRoot",
    "Node",
    `return ({
      ${classMethodSource(
        "getMapperDomPath(element) {",
        "getMapperShadowPath(element) {",
      )},
      ${classMethodSource(
        "getMapperShadowPath(element) {",
        "getMapperPathWithinRoot(element, root) {",
      )},
      ${classMethodSource(
        "getMapperPathWithinRoot(element, root) {",
        "cssEscapeIdentifier(value) {",
      )}
    });`,
  )(Element, ShadowRoot, Node);
}

function createPathContext(methods, budget) {
  return {
    ...methods,
    consumeMapperFactWork: (kind, count = 1) => budget.consume(kind, count),
    getBoundedMapperSiblingIndex(element, kind) {
      const parent = element.parentElement;
      if (!parent) return 0;
      let index = 0;
      let sibling = parent.firstElementChild;
      while (sibling) {
        if (!budget.consume(kind)) return -1;
        if (sibling === element) return index;
        index += 1;
        sibling = sibling.nextElementSibling;
      }
      return -1;
    },
  };
}
