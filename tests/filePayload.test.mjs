import assert from "node:assert/strict";
import { test } from "node:test";

await import("../BRunner/content/filePayload.js");

const { buildFilePayload, MAX_FILE_BYTES } = globalThis.BRunnerFilePayload;

test("text payload becomes UTF-8 bytes", () => {
  const payload = buildFilePayload({
    sourceType: "text",
    filename: "hello.txt",
    mimeType: "text/plain",
    content: "hello",
  });

  assert.equal(payload.filename, "hello.txt");
  assert.equal(payload.mimeType, "text/plain");
  assert.equal(new TextDecoder().decode(payload.bytes), "hello");
});

test("base64 payload decodes bytes", () => {
  const payload = buildFilePayload({
    sourceType: "base64",
    filename: "data.txt",
    content: "QlJ1bm5lcg==",
  });

  assert.equal(new TextDecoder().decode(payload.bytes), "BRunner");
});

test("filename rejects filesystem paths", () => {
  assert.throws(
    () => buildFilePayload({ filename: "C:\\secret.txt", content: "x" }),
    /must not contain a filesystem path/,
  );
});

test("invalid base64 is rejected", () => {
  assert.throws(
    () => buildFilePayload({
      sourceType: "base64",
      filename: "bad.bin",
      content: "not base64!",
    }),
    /not valid base64/,
  );
});

test("payload size limit is enforced", () => {
  assert.throws(
    () => buildFilePayload({
      sourceType: "text",
      filename: "large.txt",
      content: "x".repeat(MAX_FILE_BYTES + 1),
    }),
    /exceeds the 10 MB safety limit/,
  );
});
