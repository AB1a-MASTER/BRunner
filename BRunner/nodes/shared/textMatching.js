import "../../shared/textMatching.js";

const textMatching = globalThis.BRunnerTextMatching;

if (!textMatching) {
  throw new Error("BRunner shared text-matching implementation did not load.");
}

export const {
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
  matchText,
  selectTextMatches,
} = textMatching;

export default textMatching;
