import { normalizeTargetResolutionOutput } from "../../shared/targetAdapter.js";
import { ResolveResultCardinalities } from "./definition.js";
import { buildTargetOverrides } from "./validators.js";

const RESOLVED_STATES = Object.freeze(["resolved", "resolved_with_fallback"]);

/**
 * Normalizes one mapper-owned resolution outcome reported by the content
 * mapper transport into the shared target-resolution shape plus the bounded
 * component set this node publishes. The mapper remains the only resolver;
 * this adapter never re-resolves or guesses a candidate.
 */
export function normalizeMapperResolution(source = {}, config = {}, target = null) {
  const targetInput = buildTargetOverrides(config, target);
  const state = String(source.mapperState || source.state || "not_found").trim();
  const candidates = collectCandidates(source);
  const targetResolution = normalizeTargetResolutionOutput(
    {
      state,
      confidence: source.confidence,
      component: source.component,
      componentRef: source.componentRef ?? targetInput.componentRef,
      matchCount: source.matchCount ?? candidates.length,
      visible: source.visible,
      interactable: source.interactable,
      reason: source.reason || source.mapperReason,
      matchedBy: source.matchedBy,
    },
    targetInput,
    { defaultMinimumConfidence: config.minimumConfidence },
  );

  return {
    ok: targetResolution.resolved,
    // The effective state after the confidence and visibility gates, not the
    // raw mapper state, so a gated rejection reports why it was rejected.
    state: targetResolution.state,
    reportedState: state,
    targetResolution,
    componentRef: targetResolution.componentRef || targetInput.componentRef || null,
    component: source.component ?? candidates[0] ?? null,
    candidates,
    matchCount: normalizeMatchCount(source, candidates),
  };
}

export function selectPublishedComponents(config = {}, resolution = {}) {
  const primary = resolution.component ? [resolution.component] : [];
  if (config.resultCardinality === ResolveResultCardinalities.One) {
    return primary;
  }
  if (!resolution.candidates.length) return primary;
  return config.resultCardinality === ResolveResultCardinalities.First
    ? resolution.candidates.slice(0, 1)
    : resolution.candidates;
}

export function collectCandidates(source) {
  if (!source || typeof source !== "object") return [];
  const list = Array.isArray(source.components)
    ? source.components
    : Array.isArray(source.matches)
      ? source.matches
      : Array.isArray(source.candidates)
        ? source.candidates
        : [];
  return list
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry.candidate && typeof entry.candidate === "object"
        ? entry.candidate
        : entry;
      const score = entry.score ?? candidate.score;
      return score === undefined ? candidate : { ...candidate, score };
    })
    .filter(Boolean);
}

function normalizeMatchCount(source, candidates) {
  const reported = Number(source.matchCount);
  if (Number.isInteger(reported) && reported >= 0) {
    return Math.max(reported, candidates.length);
  }
  return candidates.length || (source.component ? 1 : 0);
}

export function isResolvedState(state) {
  return RESOLVED_STATES.includes(String(state || "").trim());
}
