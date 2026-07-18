import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const resolverSource = await readFile(
  new URL("BRunner/content/targetResolver.js", root),
  "utf8",
);

function functionSource(name, nextName) {
  const start = resolverSource.indexOf(`  function ${name}`);
  const end = resolverSource.indexOf(`\n  function ${nextName}`, start);
  assert.notEqual(start, -1, `Missing ${name}`);
  assert.notEqual(end, -1, `Missing boundary ${nextName}`);
  return resolverSource.slice(start, end).trim();
}

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

function makeElement(parentElement, tagName = "DIV", attributes = {}) {
  const element = {
    nodeType: 1,
    tagName,
    parentElement,
    id: attributes.id || "",
    children: [],
    getAttribute(name) {
      return attributes[name] || null;
    },
  };
  if (parentElement) parentElement.children.push(element);
  return element;
}

test("generated target candidate overlap counts each locator once", () => {
  const source = functionSource(
    "collectBoundedTargetCandidates(target = {}, workBudget = null) {",
    "candidateConfidence(candidate = {}) {",
  );
  const collectCandidates = Function(
    "MAX_TARGET_RESOLUTION_CANDIDATES",
    "failWorkBudget",
    "consumeWork",
    "dedupeCandidates",
    `${source}; return collectBoundedTargetCandidates;`,
  )(
    32,
    (budget, kind) => budget.fail(kind),
    (budget, kind) => budget.consume(kind),
    (candidates) => [...candidates].sort(
      (a, b) => Number(b.score || 0) - Number(a.score || 0),
    ),
  );

  const uniqueCandidates = Array.from({ length: 17 }, (_, index) => ({
    strategy: `strategy-${index}`,
    value: `value-${index}`,
    score: 100 - index,
  }));
  // This is the same overlapping shape produced by buildElementTarget:
  // primary is also in candidates, and fallbacks repeat candidates after it.
  const generatedTarget = {
    primary: uniqueCandidates[0],
    candidates: uniqueCandidates,
    fallbacks: uniqueCandidates.slice(1),
  };
  const budget = createBudget(100);

  const collected = collectCandidates(generatedTarget, budget);

  assert.deepEqual(collected, uniqueCandidates);
  assert.equal(budget.workCount, 17);
  assert.equal(budget.overflow, false);
});

test("candidate cap still rejects more than 32 unique locators", () => {
  const source = functionSource(
    "collectBoundedTargetCandidates(target = {}, workBudget = null) {",
    "candidateConfidence(candidate = {}) {",
  );
  const collectCandidates = Function(
    "MAX_TARGET_RESOLUTION_CANDIDATES",
    "failWorkBudget",
    "consumeWork",
    "dedupeCandidates",
    `${source}; return collectBoundedTargetCandidates;`,
  )(
    32,
    (budget, kind) => budget.fail(kind),
    (budget, kind) => budget.consume(kind),
    (candidates) => candidates,
  );
  const candidates = Array.from({ length: 33 }, (_, index) => ({
    strategy: "id",
    value: `id-${index}`,
  }));
  const budget = createBudget(100);

  assert.deepEqual(collectCandidates({ candidates }, budget), []);
  assert.equal(budget.workCount, 32);
  assert.equal(budget.overflow, true);
  assert.equal(budget.overflowAt, "target_locator_candidate_budget");
});

test("DOM paths are complete through ten levels and omitted beyond ten", () => {
  const source = functionSource(
    "buildDomPath(element, options = {}) {",
    "buildFormContextSelector(element, options = {}) {",
  );
  const documentElement = makeElement(null, "HTML");
  const document = { documentElement };
  const buildDomPath = Function(
    "isElement",
    "Node",
    "document",
    "getElementSiblingIndex",
    `${source}; return buildDomPath;`,
  )(
    (element) => element?.nodeType === 1,
    { ELEMENT_NODE: 1 },
    document,
    (_element, budget, kind) => (budget.consume(kind) ? 0 : -1),
  );

  let target = documentElement;
  for (let depth = 0; depth < 10; depth += 1) {
    target = makeElement(target, depth === 9 ? "BUTTON" : "DIV");
  }
  const tenLevelBudget = createBudget(20);
  const completePath = buildDomPath(target, { workBudget: tenLevelBudget });
  assert.equal(completePath.split("/").length, 10);
  assert.match(completePath, /button:0$/);
  assert.equal(tenLevelBudget.overflow, false);

  const deeperTarget = makeElement(target, "SPAN");
  const deepBudget = createBudget(20);
  assert.equal(buildDomPath(deeperTarget, { workBudget: deepBudget }), "");
  assert.equal(deepBudget.workCount, 10);
  assert.equal(deepBudget.overflow, false);
});

test("unanchored CSS selectors are omitted instead of truncated", () => {
  const source = functionSource(
    "buildStableCssSelector(element, options = {}) {",
    'boundedClosest(element, selector, workBudget, kind = "target_ancestor") {',
  );
  const buildStableCssSelector = Function(
    "isElement",
    "Node",
    "cssEscape",
    "escapeCssString",
    "getSameTagSiblingPosition",
    `${source}; return buildStableCssSelector;`,
  )(
    (element) => element?.nodeType === 1,
    { ELEMENT_NODE: 1 },
    (value) => String(value),
    (value) => String(value),
    () => ({ count: 1, index: 1 }),
  );

  const documentElement = makeElement(null, "HTML");
  let target = documentElement;
  for (let depth = 0; depth < 6; depth += 1) {
    target = makeElement(target, depth === 5 ? "BUTTON" : "DIV");
  }

  assert.equal(buildStableCssSelector(target), "");

  const anchoredParent = target.parentElement;
  anchoredParent.getAttribute = (name) => name === "data-testid"
    ? "stable-parent"
    : null;
  assert.equal(
    buildStableCssSelector(target),
    'div[data-testid="stable-parent"] > button',
  );
});
