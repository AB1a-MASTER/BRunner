export const MapperAcceptanceExportVersion = "mapper.acceptance_export.v1";

export function verifyMapperAcceptanceSnapshot({
  pageMap = {},
  domManifest = {},
} = {}) {
  const components = (Array.isArray(pageMap.components) ? pageMap.components : [])
    .filter((component) => component?.status !== "removed");
  const manifestEntries = (Array.isArray(domManifest.entries) ? domManifest.entries : [])
    .filter((entry) => entry?.expectedMapped === true);
  const componentIndex = buildComponentIdentityIndex(components);
  const missing = [];
  const duplicateMatches = [];
  const tagMismatches = [];

  for (const entry of manifestEntries) {
    const matches = findIdentityMatches(entry, componentIndex);
    if (!matches.length) {
      missing.push(manifestEntrySummary(entry));
      continue;
    }
    if (matches.length > 1) {
      duplicateMatches.push({
        ...manifestEntrySummary(entry),
        componentIds: matches.map((component) => component.componentId || ""),
      });
      continue;
    }
    const component = matches[0];
    const expectedTag = normalizeIdentifier(entry.tag);
    const mappedTag = normalizeIdentifier(
      component.fingerprint?.technical?.tag,
    );
    if (expectedTag && mappedTag && expectedTag !== mappedTag) {
      tagMismatches.push({
        ...manifestEntrySummary(entry),
        componentId: component.componentId || "",
        expectedTag,
        mappedTag,
      });
    }
  }

  const outsideDocumentBody = components
    .filter((component) => !componentHasDocumentBodyPath(component))
    .map((component) => ({
      componentId: component.componentId || "",
      displayName: component.displayName || "",
      framePath:
        component.fingerprint?.structural?.frameScope?.path || "top",
      domPath: component.fingerprint?.technical?.domPath || "",
    }));
  const scanOverflow = pageMap.diagnostics?.scanOverflow === true;
  const unsupportedMap = pageMap.status === "protected_unsupported" ||
    pageMap.status === "unsupported" ||
    pageMap.classification === "dynamic_deferred";
  const truncatedManifest = domManifest.truncated === true;
  const ok = (
    !missing.length &&
    !duplicateMatches.length &&
    !tagMismatches.length &&
    !outsideDocumentBody.length &&
    !scanOverflow &&
    !unsupportedMap &&
    !truncatedManifest
  );

  return {
    schemaVersion: MapperAcceptanceExportVersion,
    ok,
    summary: {
      expectedDomElementCount: manifestEntries.length,
      mappedComponentCount: components.length,
      matchedDomElementCount:
        manifestEntries.length - missing.length - duplicateMatches.length,
      missingCount: missing.length,
      duplicateMatchCount: duplicateMatches.length,
      tagMismatchCount: tagMismatches.length,
      outsideDocumentBodyCount: outsideDocumentBody.length,
      scanOverflow,
      unsupportedMap,
      truncatedManifest,
    },
    missing,
    duplicateMatches,
    tagMismatches,
    outsideDocumentBody,
  };
}

function buildComponentIdentityIndex(components = []) {
  const byTestAttribute = new Map();
  const byId = new Map();
  const byTopFrameDomPath = new Map();
  for (const component of components) {
    const semantic = component.fingerprint?.semantic || {};
    const technical = component.fingerprint?.technical || {};
    const stableAttributes = semantic.stableAttributes || {};
    for (const name of ["data-testid", "data-test", "data-qa"]) {
      const value = normalizeIdentityValue(stableAttributes[name]);
      if (value) appendIndexValue(byTestAttribute, `${name}:${value}`, component);
    }
    const id = normalizeIdentifier(technical.id);
    if (id) appendIndexValue(byId, id, component);
    const framePath = String(
      component.fingerprint?.structural?.frameScope?.path || "top",
    );
    const domPath = String(technical.domPath || "").trim();
    if (framePath === "top" && domPath) {
      appendIndexValue(byTopFrameDomPath, domPath, component);
    }
  }
  return { byTestAttribute, byId, byTopFrameDomPath };
}

function findIdentityMatches(entry = {}, index = {}) {
  const attributeName = String(entry.identity?.attribute || "").trim();
  const attributeValue = normalizeIdentityValue(entry.identity?.value);
  if (attributeName && attributeValue) {
    return index.byTestAttribute?.get(`${attributeName}:${attributeValue}`) || [];
  }
  const id = normalizeIdentifier(entry.id);
  if (id) return index.byId?.get(id) || [];
  const domPath = String(entry.domPath || "").trim();
  return Number(entry.frameId) === 0 && domPath
    ? index.byTopFrameDomPath?.get(domPath) || []
    : [];
}

function appendIndexValue(index, key, component) {
  const current = index.get(key) || [];
  current.push(component);
  index.set(key, current);
}

function componentHasDocumentBodyPath(component = {}) {
  const domPath = String(
    component.fingerprint?.technical?.domPath || "",
  ).trim();
  if (!domPath) return false;
  const outerDocumentPath = domPath.split("::shadow::")[0] || "";
  return /(^|\/)body:\d+(?:\/|$)/.test(outerDocumentPath);
}

function manifestEntrySummary(entry = {}) {
  return {
    frameId: Number(entry.frameId) || 0,
    frameUrl: String(entry.frameUrl || ""),
    tag: normalizeIdentifier(entry.tag),
    id: String(entry.id || ""),
    identity: entry.identity || null,
    domPath: String(entry.domPath || ""),
  };
}

function normalizeIdentityValue(value) {
  return String(value || "").trim();
}

function normalizeIdentifier(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}
