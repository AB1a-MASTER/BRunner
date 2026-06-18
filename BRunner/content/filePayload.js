// content/filePayload.js
// Validates and decodes workflow-provided virtual file payloads.

(function (global) {
  const MAX_FILE_BYTES = 10 * 1024 * 1024;

  function buildFilePayload(config = {}) {
    const sourceType = String(config.sourceType || "text").trim();
    const filename = normalizeFilename(config.filename);
    const mimeType = normalizeMimeType(config.mimeType);
    let bytes;

    if (sourceType === "text") {
      bytes = new TextEncoder().encode(String(config.content ?? ""));
    } else if (sourceType === "base64") {
      bytes = decodeBase64(config.content);
    } else {
      throw new Error(`Unsupported file source type: ${sourceType || "empty"}`);
    }

    if (bytes.byteLength > MAX_FILE_BYTES) {
      throw new Error("Virtual file exceeds the 10 MB safety limit.");
    }

    return {
      filename,
      mimeType,
      bytes,
    };
  }

  function normalizeFilename(value) {
    const filename = String(value || "").trim();
    if (!filename) throw new Error("File upload requires a filename.");
    if (filename.includes("\0") || /[\\/]/.test(filename)) {
      throw new Error("Filename must not contain a filesystem path.");
    }
    return filename;
  }

  function normalizeMimeType(value) {
    const mimeType = String(value || "application/octet-stream").trim();
    if (!/^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/.test(mimeType)) {
      throw new Error("File upload MIME type is invalid.");
    }
    return mimeType;
  }

  function decodeBase64(value) {
    const compact = String(value || "").replace(/\s+/g, "");
    const valid = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
    if (!valid.test(compact)) {
      throw new Error("File upload content is not valid base64.");
    }

    let decoded;
    try {
      decoded = atob(compact);
    } catch {
      throw new Error("File upload content is not valid base64.");
    }

    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  }

  global.BRunnerFilePayload = Object.freeze({
    MAX_FILE_BYTES,
    buildFilePayload,
  });
})(globalThis);
