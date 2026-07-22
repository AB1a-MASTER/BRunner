import "../../shared/textMatching.js";
import {
  NodeErrorCodes,
  NodeExecutionError,
} from "./nodeContracts.js";

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

export function translateTextMatchError(error, details = {}) {
  if (error instanceof NodeExecutionError) return error;
  if (!(error instanceof textMatching.TextMatchError)) return error;
  const code = error.code === "MULTIPLE_MATCHES"
    ? NodeErrorCodes.AmbiguousTarget
    : error.code === "CONFIG_INVALID"
      ? NodeErrorCodes.ConfigInvalid
      : NodeErrorCodes.ValidationFailed;
  return new NodeExecutionError(
    code,
    error.message,
    {
      ...error.details,
      ...details,
      adapterCode: error.code,
    },
    { cause: error },
  );
}

export default textMatching;
