import assert from "node:assert/strict";
import { test } from "node:test";

import {
  TEXT_MATCH_DEFAULTS,
  TextMatchConfigError,
  TextMatchError,
  compileTextMatcher,
  isTextMatch,
  matchTextCandidates,
  normalizeText,
  normalizeTextMatchConfig,
  normalizeWhitespace,
} from "../BRunner/nodes/shared/textMatching.js";

test("user-facing defaults are exact, case-insensitive, normalized whitespace", () => {
  assert.deepEqual(TEXT_MATCH_DEFAULTS, {
    matchMode: "exact",
    caseSensitive: false,
    whitespaceHandling: "normalize",
    occurrence: "first",
    occurrenceIndex: 0,
    multipleMatchBehavior: "fail",
    emptyValueBehavior: "fail",
  });
  assert.equal(isTextMatch("  Hello\n\tworld  ", "hello world"), true);
  assert.equal(isTextMatch("hello world!", "hello world"), false);
});

test("all six finalized match modes have deterministic semantics", () => {
  assert.equal(isTextMatch("Alpha Beta", "alpha beta", { matchMode: "exact" }), true);
  assert.equal(isTextMatch("a*b?", "a*b?", { matchMode: "exact" }), true);
  assert.equal(isTextMatch("axxbz", "a*b?", { matchMode: "exact" }), false);
  assert.equal(isTextMatch("Alpha Beta", "pha b", { matchMode: "contains" }), true);
  assert.equal(
    isTextMatch("Alpha Beta", "alpha", { matchMode: "starts_with" }),
    true,
  );
  assert.equal(
    isTextMatch("Alpha Beta", "BETA", { matchMode: "ends_with" }),
    true,
  );
  assert.equal(
    isTextMatch("invoice-2026-Q3.pdf", "invoice-????-Q?.*", {
      matchMode: "wildcard",
    }),
    true,
  );
  assert.equal(
    isTextMatch("Order AB-1234 ready", "AB-\\d{4}", { matchMode: "regex" }),
    true,
  );
});

test("case sensitivity is honored for literal, wildcard, and regex modes", () => {
  for (const matchMode of ["exact", "wildcard", "regex"]) {
    assert.equal(
      isTextMatch("AbC", matchMode === "wildcard" ? "a?c" : "abc", {
        matchMode,
        caseSensitive: false,
      }),
      true,
    );
    assert.equal(
      isTextMatch("AbC", matchMode === "wildcard" ? "a?c" : "abc", {
        matchMode,
        caseSensitive: true,
      }),
      false,
    );
  }
});

test("preserve, trim, and normalize whitespace remain distinct", () => {
  assert.equal(normalizeWhitespace("  A \n B  ", "preserve"), "  A \n B  ");
  assert.equal(normalizeWhitespace("  A \n B  ", "trim"), "A \n B");
  assert.equal(normalizeWhitespace("  A \n B  ", "normalize"), "A B");

  assert.equal(
    isTextMatch(" A  B ", "A B", { whitespaceHandling: "preserve" }),
    false,
  );
  assert.equal(
    isTextMatch(" A  B ", "A  B", { whitespaceHandling: "trim" }),
    true,
  );
  assert.equal(
    isTextMatch(" A  B ", "A B", { whitespaceHandling: "normalize" }),
    true,
  );
});

test("occurrence selects first, last, zero-based index, or all", () => {
  const candidates = ["no", "match", "MATCH", "also match"];
  const base = {
    matchMode: "contains",
    multipleMatchBehavior: "return_all",
  };

  assert.equal(
    matchTextCandidates(candidates, "match", {
      ...base,
      occurrence: "first",
    }).value,
    "match",
  );
  assert.equal(
    matchTextCandidates(candidates, "match", {
      ...base,
      occurrence: "last",
    }).value,
    "also match",
  );
  assert.equal(
    matchTextCandidates(candidates, "match", {
      ...base,
      occurrence: "index",
      occurrenceIndex: 1,
    }).value,
    "MATCH",
  );
  assert.deepEqual(
    matchTextCandidates(candidates, "match", {
      ...base,
      occurrence: "all",
    }).values,
    ["match", "MATCH", "also match"],
  );
});

test("multiple-match behavior supports fail, first, confidence, and return all", () => {
  const candidates = ["prefix target suffix", "target", "target suffix"];
  const base = { matchMode: "contains", occurrence: "all" };

  assert.throws(
    () =>
      matchTextCandidates(candidates, "target", {
        ...base,
        multipleMatchBehavior: "fail",
      }),
    (error) =>
      error instanceof TextMatchError &&
      error.code === "MULTIPLE_MATCHES" &&
      error.details.matchCount === 3,
  );
  assert.equal(
    matchTextCandidates(candidates, "target", {
      ...base,
      multipleMatchBehavior: "first",
    }).value,
    "prefix target suffix",
  );
  assert.equal(
    matchTextCandidates(candidates, "target", {
      ...base,
      multipleMatchBehavior: "highest_confidence",
    }).value,
    "target",
  );
  assert.deepEqual(
    matchTextCandidates(candidates, "target", {
      ...base,
      multipleMatchBehavior: "return_all",
    }).values,
    candidates,
  );
});

test("empty matching values implement fail, skip, no filter, and no match", () => {
  assert.throws(
    () => compileTextMatcher(" \n ", { emptyValueBehavior: "fail" }),
    (error) =>
      error instanceof TextMatchConfigError &&
      error.code === "CONFIG_INVALID" &&
      error.details.reason === "empty_value",
  );

  const skipped = matchTextCandidates(["one", "two"], "", {
    emptyValueBehavior: "skip",
  });
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.skipped, true);

  const unfiltered = matchTextCandidates(["one", "two"], "", {
    emptyValueBehavior: "no_filter",
  });
  assert.equal(unfiltered.status, "no_filter");
  assert.deepEqual(unfiltered.values, ["one", "two"]);
  assert.equal(
    isTextMatch(undefined, "", { emptyValueBehavior: "no_filter" }),
    true,
  );

  const noMatch = matchTextCandidates(["one", "two"], "", {
    emptyValueBehavior: "return_no_match",
  });
  assert.equal(noMatch.status, "no_match");
  assert.equal(noMatch.matched, false);
  assert.deepEqual(noMatch.values, []);
});

test("invalid regex and invalid adapter configuration surface CONFIG_INVALID", () => {
  assert.throws(
    () => compileTextMatcher("[unterminated", { matchMode: "regex" }),
    (error) =>
      error instanceof TextMatchConfigError &&
      error.code === "CONFIG_INVALID" &&
      error.details.matchMode === "regex",
  );
  assert.throws(
    () => normalizeTextMatchConfig({ matchMode: "fuzzy" }),
    (error) =>
      error instanceof TextMatchConfigError &&
      error.code === "CONFIG_INVALID" &&
      error.details.field === "matchMode",
  );
});

test("candidate output preserves arbitrary original text and values", () => {
  const text = "\0 <b>Mixed</b>\n🙂  text ";
  const value = { id: 7, text };
  const result = matchTextCandidates([value], "\0 <B>MIXED</B> 🙂 TEXT", {}, {
    getText: (candidate) => candidate.text,
  });

  assert.equal(result.match.value, value);
  assert.equal(result.match.text, text);
  assert.equal(result.match.normalizedText, "\0 <b>Mixed</b> 🙂 text");
  assert.equal(
    normalizeText(text),
    "\0 <b>mixed</b> 🙂 text",
  );
});

test("classic global and ESM wrapper expose the same frozen API", () => {
  assert.equal(globalThis.BRunnerTextMatching.isTextMatch, isTextMatch);
  assert.equal(Object.isFrozen(globalThis.BRunnerTextMatching), true);
});
