// Shared text-matching contract.
// Kept as a classic script so content scripts and ESM node executors use the
// exact same implementation.

(function (global) {
  const MATCH_MODES = Object.freeze([
    "exact",
    "contains",
    "starts_with",
    "ends_with",
    "wildcard",
    "regex",
  ]);
  const WHITESPACE_HANDLING = Object.freeze([
    "preserve",
    "trim",
    "normalize",
  ]);
  const OCCURRENCES = Object.freeze(["first", "last", "index", "all"]);
  const MULTIPLE_MATCH_BEHAVIORS = Object.freeze([
    "fail",
    "first",
    "highest_confidence",
    "return_all",
  ]);
  const EMPTY_VALUE_BEHAVIORS = Object.freeze([
    "fail",
    "skip",
    "no_filter",
    "return_no_match",
  ]);

  const TEXT_MATCH_DEFAULTS = Object.freeze({
    matchMode: "exact",
    caseSensitive: false,
    whitespaceHandling: "normalize",
    occurrence: "first",
    occurrenceIndex: 0,
    multipleMatchBehavior: "fail",
    emptyValueBehavior: "fail",
  });

  class TextMatchError extends Error {
    constructor(message, code, details = {}) {
      super(message);
      this.name = "TextMatchError";
      this.code = code;
      this.details = { ...details };
    }
  }

  class TextMatchConfigError extends TextMatchError {
    constructor(message, details = {}) {
      super(message, "CONFIG_INVALID", details);
      this.name = "TextMatchConfigError";
    }
  }

  function normalizeTextMatchConfig(config = {}) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new TextMatchConfigError(
        "Text matching configuration must be an object.",
        { field: "config", value: config },
      );
    }

    const matchMode = normalizeOption(
      config.matchMode,
      TEXT_MATCH_DEFAULTS.matchMode,
      MATCH_MODES,
      "matchMode",
    );
    const whitespaceHandling = normalizeOption(
      config.whitespaceHandling,
      TEXT_MATCH_DEFAULTS.whitespaceHandling,
      WHITESPACE_HANDLING,
      "whitespaceHandling",
    );
    const occurrence = normalizeOption(
      config.occurrence,
      TEXT_MATCH_DEFAULTS.occurrence,
      OCCURRENCES,
      "occurrence",
    );
    const multipleMatchBehavior = normalizeOption(
      config.multipleMatchBehavior,
      TEXT_MATCH_DEFAULTS.multipleMatchBehavior,
      MULTIPLE_MATCH_BEHAVIORS,
      "multipleMatchBehavior",
    );
    const emptyValueBehavior = normalizeOption(
      config.emptyValueBehavior,
      TEXT_MATCH_DEFAULTS.emptyValueBehavior,
      EMPTY_VALUE_BEHAVIORS,
      "emptyValueBehavior",
    );
    const caseSensitive = normalizeBoolean(
      config.caseSensitive,
      TEXT_MATCH_DEFAULTS.caseSensitive,
      "caseSensitive",
    );
    const occurrenceIndex = normalizeOccurrenceIndex(config, occurrence);

    return Object.freeze({
      matchMode,
      caseSensitive,
      whitespaceHandling,
      occurrence,
      occurrenceIndex,
      multipleMatchBehavior,
      emptyValueBehavior,
    });
  }

  function normalizeOption(value, fallback, allowed, field) {
    if (value === undefined) return fallback;
    if (typeof value !== "string") {
      throw new TextMatchConfigError(
        `Text matching ${field} must be one of: ${allowed.join(", ")}.`,
        { field, value, allowed: [...allowed] },
      );
    }

    const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (!allowed.includes(normalized)) {
      throw new TextMatchConfigError(
        `Text matching ${field} must be one of: ${allowed.join(", ")}.`,
        { field, value, allowed: [...allowed] },
      );
    }
    return normalized;
  }

  function normalizeBoolean(value, fallback, field) {
    if (value === undefined) return fallback;
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    throw new TextMatchConfigError(
      `Text matching ${field} must be true or false.`,
      { field, value },
    );
  }

  function normalizeOccurrenceIndex(config, occurrence) {
    const supplied =
      config.occurrenceIndex ?? config.matchIndex ?? config.index;
    if (supplied === undefined && occurrence !== "index") {
      return TEXT_MATCH_DEFAULTS.occurrenceIndex;
    }

    const index = supplied === undefined ? 0 : Number(supplied);
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new TextMatchConfigError(
        "Text matching occurrenceIndex must be a zero-based non-negative integer.",
        { field: "occurrenceIndex", value: supplied },
      );
    }
    return index;
  }

  function normalizeWhitespace(value, handling = "normalize") {
    const text = toText(value);
    if (handling === "preserve") return text;
    if (handling === "trim") return text.trim();
    if (handling === "normalize") return text.trim().replace(/\s+/gu, " ");
    throw new TextMatchConfigError(
      `Text matching whitespaceHandling must be one of: ${WHITESPACE_HANDLING.join(", ")}.`,
      {
        field: "whitespaceHandling",
        value: handling,
        allowed: [...WHITESPACE_HANDLING],
      },
    );
  }

  function normalizeText(value, config = {}) {
    const normalizedConfig = isNormalizedConfig(config)
      ? config
      : normalizeTextMatchConfig(config);
    const whitespaceNormalized = normalizeWhitespace(
      value,
      normalizedConfig.whitespaceHandling,
    );
    return normalizedConfig.caseSensitive
      ? whitespaceNormalized
      : whitespaceNormalized.toLowerCase();
  }

  function compileTextMatcher(expectedValue, config = {}) {
    const normalizedConfig = isNormalizedConfig(config)
      ? config
      : normalizeTextMatchConfig(config);
    const expectedText = toText(expectedValue);
    const normalizedExpected = normalizeWhitespace(
      expectedText,
      normalizedConfig.whitespaceHandling,
    );
    const emptyAction = getEmptyAction(
      normalizedExpected,
      normalizedConfig.emptyValueBehavior,
    );

    if (emptyAction) {
      return Object.freeze({
        config: normalizedConfig,
        expectedText,
        normalizedExpected,
        emptyAction,
        inspect(candidateValue) {
          const text = toText(candidateValue);
          return Object.freeze({
            matched: emptyAction === "no_filter",
            confidence: emptyAction === "no_filter" ? 1 : 0,
            text,
            normalizedText: normalizeWhitespace(
              text,
              normalizedConfig.whitespaceHandling,
            ),
          });
        },
        test() {
          return emptyAction === "no_filter";
        },
      });
    }

    const evaluator = buildEvaluator(normalizedExpected, normalizedConfig);
    return Object.freeze({
      config: normalizedConfig,
      expectedText,
      normalizedExpected,
      emptyAction: null,
      inspect(candidateValue) {
        const text = toText(candidateValue);
        const normalizedText = normalizeWhitespace(
          text,
          normalizedConfig.whitespaceHandling,
        );
        const evaluation = evaluator(normalizedText);
        return Object.freeze({
          matched: evaluation.matched,
          confidence: evaluation.confidence,
          text,
          normalizedText,
        });
      },
      test(candidateValue) {
        const text = normalizeWhitespace(
          candidateValue,
          normalizedConfig.whitespaceHandling,
        );
        return evaluator(text).matched;
      },
    });
  }

  function getEmptyAction(normalizedExpected, behavior) {
    if (normalizedExpected.length > 0) return null;
    if (behavior === "fail") {
      throw new TextMatchConfigError(
        "Text matching value is empty after whitespace handling.",
        { field: "value", reason: "empty_value" },
      );
    }
    return behavior;
  }

  function buildEvaluator(expected, config) {
    const expectedForComparison = foldCase(expected, config.caseSensitive);

    if (config.matchMode === "exact") {
      return (candidate) => {
        const comparable = foldCase(candidate, config.caseSensitive);
        const matched = comparable === expectedForComparison;
        return { matched, confidence: matched ? 1 : 0 };
      };
    }

    if (config.matchMode === "contains") {
      return (candidate) => {
        const comparable = foldCase(candidate, config.caseSensitive);
        const matched = comparable.includes(expectedForComparison);
        return {
          matched,
          confidence: matched
            ? substringConfidence(comparable, expectedForComparison)
            : 0,
        };
      };
    }

    if (config.matchMode === "starts_with") {
      return (candidate) => {
        const comparable = foldCase(candidate, config.caseSensitive);
        const matched = comparable.startsWith(expectedForComparison);
        return {
          matched,
          confidence: matched
            ? substringConfidence(comparable, expectedForComparison)
            : 0,
        };
      };
    }

    if (config.matchMode === "ends_with") {
      return (candidate) => {
        const comparable = foldCase(candidate, config.caseSensitive);
        const matched = comparable.endsWith(expectedForComparison);
        return {
          matched,
          confidence: matched
            ? substringConfidence(comparable, expectedForComparison)
            : 0,
        };
      };
    }

    if (config.matchMode === "wildcard") {
      const source = wildcardToRegExpSource(expected);
      const expression = compileRegExp(
        `^(?:${source})$`,
        config.caseSensitive ? "u" : "iu",
        expected,
      );
      const literalLength = expected.replace(/[*?]/gu, "").length;
      return (candidate) => {
        const matched = expression.test(candidate);
        return {
          matched,
          confidence: matched
            ? patternConfidence(candidate.length, literalLength)
            : 0,
        };
      };
    }

    const expression = compileRegExp(
      expected,
      config.caseSensitive ? "u" : "iu",
      expected,
    );
    return (candidate) => {
      const match = expression.exec(candidate);
      const matched = match !== null;
      return {
        matched,
        confidence: matched
          ? patternConfidence(candidate.length, match[0].length)
          : 0,
      };
    };
  }

  function compileRegExp(source, flags, originalValue) {
    try {
      return new RegExp(source, flags);
    } catch (error) {
      throw new TextMatchConfigError(
        `Text matching regex is invalid: ${error.message}`,
        {
          field: "value",
          matchMode: "regex",
          value: originalValue,
          cause: error.message,
        },
      );
    }
  }

  function wildcardToRegExpSource(pattern) {
    let source = "";
    for (const character of pattern) {
      if (character === "*") {
        source += "[\\s\\S]*";
      } else if (character === "?") {
        source += "[\\s\\S]";
      } else {
        source += escapeRegExp(character);
      }
    }
    return source;
  }

  function escapeRegExp(value) {
    return value.replace(/[\\^$.*+?()[\]{}|/]/gu, "\\$&");
  }

  function substringConfidence(candidate, expected) {
    if (candidate === expected) return 1;
    return clampConfidence(expected.length / Math.max(candidate.length, 1));
  }

  function patternConfidence(candidateLength, matchedLength) {
    if (candidateLength === matchedLength) return 1;
    return clampConfidence(matchedLength / Math.max(candidateLength, 1));
  }

  function clampConfidence(value) {
    return Math.max(0.000001, Math.min(0.999999, value));
  }

  function isTextMatch(candidateValue, expectedValue, config = {}) {
    return compileTextMatcher(expectedValue, config).test(candidateValue);
  }

  function matchTextCandidates(
    candidateValues,
    expectedValue,
    config = {},
    options = {},
  ) {
    const matcher = compileTextMatcher(expectedValue, config);
    const values = Array.from(candidateValues || []);

    if (matcher.emptyAction === "skip") {
      return buildMatchResult("skipped", matcher, [], [], values.length);
    }
    if (matcher.emptyAction === "return_no_match") {
      return buildMatchResult("no_match", matcher, [], [], values.length);
    }

    const getText =
      typeof options.getText === "function" ? options.getText : (value) => value;
    const matches = [];
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      const inspected = matcher.inspect(getText(value, index));
      if (!inspected.matched) continue;
      matches.push(
        Object.freeze({
          index,
          value,
          text: inspected.text,
          normalizedText: inspected.normalizedText,
          confidence: inspected.confidence,
        }),
      );
    }

    if (matcher.emptyAction === "no_filter") {
      return buildMatchResult(
        "no_filter",
        matcher,
        matches,
        matches,
        values.length,
      );
    }

    const occurrenceMatches = selectOccurrence(matches, matcher.config);
    const selected = resolveMultipleMatches(
      occurrenceMatches,
      matcher.config.multipleMatchBehavior,
    );
    return buildMatchResult(
      selected.length ? "matched" : "no_match",
      matcher,
      matches,
      selected,
      values.length,
    );
  }

  function selectOccurrence(matches, config) {
    if (!matches.length) return [];
    if (config.occurrence === "first") return [matches[0]];
    if (config.occurrence === "last") return [matches[matches.length - 1]];
    if (config.occurrence === "index") {
      return matches[config.occurrenceIndex]
        ? [matches[config.occurrenceIndex]]
        : [];
    }
    return [...matches];
  }

  function resolveMultipleMatches(matches, behavior) {
    if (matches.length < 2) return matches;
    if (behavior === "fail") {
      throw new TextMatchError(
        `Text matching found ${matches.length} matches where one was required.`,
        "MULTIPLE_MATCHES",
        { matchCount: matches.length },
      );
    }
    if (behavior === "first") return [matches[0]];
    if (behavior === "return_all") return matches;

    let best = matches[0];
    for (let index = 1; index < matches.length; index += 1) {
      if (matches[index].confidence > best.confidence) best = matches[index];
    }
    return [best];
  }

  function buildMatchResult(
    status,
    matcher,
    matches,
    selected,
    candidateCount,
  ) {
    const selectedMatches = Object.freeze([...selected]);
    return Object.freeze({
      status,
      matched: selectedMatches.length > 0,
      skipped: status === "skipped",
      noFilter: status === "no_filter",
      expectedText: matcher.expectedText,
      normalizedExpected: matcher.normalizedExpected,
      config: matcher.config,
      candidateCount,
      matchCount: matches.length,
      matches: Object.freeze([...matches]),
      selected: selectedMatches,
      match: selectedMatches[0] || null,
      value: selectedMatches[0]?.value ?? null,
      values: Object.freeze(selectedMatches.map((entry) => entry.value)),
    });
  }

  function foldCase(value, caseSensitive) {
    return caseSensitive ? value : value.toLowerCase();
  }

  function toText(value) {
    return String(value ?? "");
  }

  function isNormalizedConfig(config) {
    return (
      config &&
      typeof config === "object" &&
      Object.isFrozen(config) &&
      MATCH_MODES.includes(config.matchMode) &&
      WHITESPACE_HANDLING.includes(config.whitespaceHandling) &&
      OCCURRENCES.includes(config.occurrence) &&
      MULTIPLE_MATCH_BEHAVIORS.includes(config.multipleMatchBehavior) &&
      EMPTY_VALUE_BEHAVIORS.includes(config.emptyValueBehavior)
    );
  }

  global.BRunnerTextMatching = Object.freeze({
    MATCH_MODES,
    WHITESPACE_HANDLING,
    OCCURRENCES,
    MULTIPLE_MATCH_BEHAVIORS,
    EMPTY_VALUE_BEHAVIORS,
    TEXT_MATCH_DEFAULTS,
    TextMatchError,
    TextMatchConfigError,
    normalizeTextMatchConfig,
    normalizeWhitespace,
    normalizeText,
    compileTextMatcher,
    isTextMatch,
    matchTextCandidates,
    matchText: isTextMatch,
    selectTextMatches: matchTextCandidates,
  });
})(globalThis);
