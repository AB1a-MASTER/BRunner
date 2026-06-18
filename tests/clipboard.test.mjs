import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ClipboardOperationError,
  executeClipboardAction,
} from "../BRunner/core/clipboard.js";
import { Actions } from "../BRunner/core/constants.js";

test("clipboard read requires explicit node approval", async () => {
  await assert.rejects(
    executeClipboardAction(
      Actions.ClipboardRead,
      { allowClipboardRead: "deny" },
      { readText: async () => "secret" },
    ),
    (error) => {
      assert.ok(error instanceof ClipboardOperationError);
      assert.equal(
        error.diagnostics.finalReason,
        "clipboard_read_not_approved",
      );
      return true;
    },
  );
});

test("approved clipboard read returns text", async () => {
  const value = await executeClipboardAction(
    Actions.ClipboardRead,
    { allowClipboardRead: "allow" },
    { readText: async () => "copied value" },
  );

  assert.equal(value, "copied value");
});

test("clipboard write passes expression-resolved text", async () => {
  let written;
  const result = await executeClipboardAction(
    Actions.ClipboardWrite,
    { value: "hello" },
    { writeText: async (value) => { written = value; } },
  );

  assert.equal(written, "hello");
  assert.deepEqual(result, { written: true, length: 5 });
});

test("clipboard write supports clearing clipboard", async () => {
  let written = "unchanged";
  await executeClipboardAction(
    Actions.ClipboardWrite,
    { value: "" },
    { writeText: async (value) => { written = value; } },
  );

  assert.equal(written, "");
});

test("clipboard adapter failures expose safe diagnostics", async () => {
  await assert.rejects(
    executeClipboardAction(
      Actions.ClipboardRead,
      { allowClipboardRead: "allow" },
      { readText: async () => { throw new Error("sensitive platform detail"); } },
    ),
    (error) => {
      assert.equal(error.message, "Clipboard read failed.");
      assert.equal(error.diagnostics.finalReason, "clipboard_read_failed");
      return true;
    },
  );
});
