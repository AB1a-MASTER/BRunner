// core/clipboard.js
// Permission-gated clipboard behavior independent from Chrome transport.

import { Actions } from "./constants.js";

export class ClipboardOperationError extends Error {
  constructor(message, action, finalReason) {
    super(message);
    this.name = "ClipboardOperationError";
    this.diagnostics = {
      action,
      finalReason,
    };
  }
}

export async function executeClipboardAction(
  action,
  config = {},
  adapter = {},
) {
  if (action === Actions.ClipboardRead) {
    if (![true, "true", "allow"].includes(config.allowClipboardRead)) {
      throw new ClipboardOperationError(
        "Clipboard read requires explicit approval in node configuration.",
        action,
        "clipboard_read_not_approved",
      );
    }

    if (typeof adapter.readText !== "function") {
      throw new ClipboardOperationError(
        "Clipboard read is unavailable in this runtime.",
        action,
        "clipboard_unavailable",
      );
    }

    try {
      return await adapter.readText();
    } catch {
      throw new ClipboardOperationError(
        "Clipboard read failed.",
        action,
        "clipboard_read_failed",
      );
    }
  }

  if (action === Actions.ClipboardWrite) {
    if (typeof adapter.writeText !== "function") {
      throw new ClipboardOperationError(
        "Clipboard write is unavailable in this runtime.",
        action,
        "clipboard_unavailable",
      );
    }

    const text = String(config.value ?? "");

    try {
      await adapter.writeText(text);
      return {
        written: true,
        length: text.length,
      };
    } catch {
      throw new ClipboardOperationError(
        "Clipboard write failed.",
        action,
        "clipboard_write_failed",
      );
    }
  }

  throw new ClipboardOperationError(
    `Unsupported clipboard action: ${action || "undefined"}`,
    action || "unknown",
    "clipboard_action_unsupported",
  );
}
