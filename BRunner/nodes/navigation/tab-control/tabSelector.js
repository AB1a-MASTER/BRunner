import {
  NodeErrorCodes,
  NodeExecutionError,
} from "../../shared/nodeContracts.js";
import {
  MultipleMatchBehaviors,
  TabMatchModes,
  TabControlErrorCodes,
  TabSelectorKinds,
} from "./definition.js";

export function selectTabFromCandidates({
  kind,
  value,
  matchMode = TabMatchModes.Exact,
  multipleMatchBehavior = MultipleMatchBehaviors.Fail,
  currentTab = null,
  referencedTab = null,
  tabs = [],
  creationSequence = null,
} = {}) {
  const ordered = orderTabs(tabs);
  let matches = [];
  let matchedBy = kind;

  if (kind === TabSelectorKinds.Current) {
    matches = currentTab ? [currentTab] : [];
  } else if (kind === TabSelectorKinds.SavedReference) {
    matches = referencedTab ? [referencedTab] : [];
  } else if (kind === TabSelectorKinds.Id) {
    matches = ordered.filter((tab) => Number(tab.id) === Number(value));
  } else if (kind === TabSelectorKinds.Index) {
    matches = ordered.filter((tab) => Number(tab.index) === Number(value));
  } else if (kind === TabSelectorKinds.Title) {
    matches = ordered.filter((tab) => (
      matchesText(tab.title, value, matchMode)
    ));
  } else if (kind === TabSelectorKinds.Url) {
    matches = ordered.filter((tab) => (
      matchesText(tab.url, value, matchMode)
    ));
  } else if (kind === TabSelectorKinds.MostRecentlyOpened) {
    const recent = selectMostRecent(ordered, creationSequence);
    matches = recent ? [recent] : [];
  } else if (kind === TabSelectorKinds.First) {
    matches = ordered.slice(0, 1);
  } else if (kind === TabSelectorKinds.Last) {
    matches = ordered.slice(-1);
  }

  if (
    matches.length > 1 &&
    multipleMatchBehavior === MultipleMatchBehaviors.FirstMatching
  ) {
    return {
      tab: matches[0],
      matchedBy: `${matchedBy}:first_matching`,
      matchCount: matches.length,
    };
  }
  if (
    matches.length > 1 &&
    multipleMatchBehavior === MultipleMatchBehaviors.MostRecentlyOpened
  ) {
    const recent = selectMostRecent(matches, creationSequence);
    if (!recent) {
      return {
        tab: null,
        matchedBy: `${matchedBy}:most_recently_opened_unavailable`,
        matchCount: matches.length,
      };
    }
    return {
      tab: recent,
      matchedBy: `${matchedBy}:most_recently_opened`,
      matchCount: matches.length,
    };
  }
  if (matches.length > 1) {
    throw new NodeExecutionError(
      TabControlErrorCodes.AmbiguousSelector,
      "Tab selector matched more than one browser tab.",
      {
        selectorKind: kind,
        matchCount: matches.length,
        tabIds: matches.map((tab) => Number(tab.id)),
        retryable: false,
      },
    );
  }
  return {
    tab: matches[0] || null,
    matchedBy,
    matchCount: matches.length,
  };
}

export function selectRelativeTab({
  currentTab,
  tabs = [],
  direction,
  offset = 1,
  wrapAround = false,
} = {}) {
  if (!currentTab || !Number.isInteger(Number(currentTab.id))) {
    return { tab: null, matchedBy: `relative_${direction}`, matchCount: 0 };
  }
  const ordered = orderTabs(tabs).filter((tab) => (
    Number(tab.windowId) === Number(currentTab.windowId)
  ));
  const start = ordered.findIndex((tab) => Number(tab.id) === Number(currentTab.id));
  if (start < 0 || !ordered.length) {
    return { tab: null, matchedBy: `relative_${direction}`, matchCount: 0 };
  }
  const delta = ["left", "previous"].includes(direction) ? -offset : offset;
  let target = start + delta;
  if (wrapAround) {
    target = ((target % ordered.length) + ordered.length) % ordered.length;
  }
  const tab = target >= 0 && target < ordered.length ? ordered[target] : null;
  return {
    tab,
    matchedBy: `relative_${direction}`,
    matchCount: tab ? 1 : 0,
  };
}

export function orderTabs(tabs = []) {
  return [...tabs]
    .filter((tab) => tab && Number.isInteger(Number(tab.id)))
    .toSorted((left, right) => (
      Number(left.windowId ?? 0) - Number(right.windowId ?? 0) ||
      Number(left.index ?? 0) - Number(right.index ?? 0) ||
      Number(left.id) - Number(right.id)
    ));
}

function selectMostRecent(tabs, creationSequence) {
  if (!(creationSequence instanceof Map)) return null;
  let selected = null;
  let selectedSequence = -Infinity;
  for (const tab of tabs) {
    const sequence = Number(creationSequence.get(Number(tab.id)));
    if (Number.isFinite(sequence) && sequence > selectedSequence) {
      selected = tab;
      selectedSequence = sequence;
    }
  }
  return selected;
}

function matchesText(actual, expected, mode) {
  const candidate = String(actual || "");
  const query = String(expected || "");
  if (mode === TabMatchModes.Contains) return candidate.includes(query);
  if (mode === TabMatchModes.Wildcard) return compileWildcard(query).test(candidate);
  return candidate === query;
}

function compileWildcard(value) {
  const source = String(value ?? "");
  try {
    return new RegExp(
      `^${source
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replaceAll("*", ".*")
        .replaceAll("?", ".")}$`,
    );
  } catch (error) {
    throw new NodeExecutionError(
      NodeErrorCodes.ConfigInvalid,
      "Tab URL pattern is invalid.",
      { value: source, cause: error.message, retryable: false },
    );
  }
}
