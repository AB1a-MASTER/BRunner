const LEGACY_NAVIGATE_TYPE = "browser.navigate";
const LEGACY_NAVIGATE_VERSION = 1;

/**
 * Only the provisional v1 contract uses Sequential Studio's compact URL /
 * Open In aliases. Finalized versions must use the shared registry fields.
 */
export function usesLegacyNavigateEditor(step = {}) {
  return (
    String(step.action || step.type || "") === LEGACY_NAVIGATE_TYPE &&
    Number(step.version) === LEGACY_NAVIGATE_VERSION
  );
}
