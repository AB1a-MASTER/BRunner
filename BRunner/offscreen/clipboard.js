// Offscreen DOM bridge for Clipboard API access from the service worker.

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.target !== "offscreen.clipboard") return false;

  handleClipboardOperation(request)
    .then((response) => sendResponse(response))
    .catch(() => {
      sendResponse({
        ok: false,
        error: "Clipboard operation failed.",
      });
    });

  return true;
});

async function handleClipboardOperation(request) {
  if (request.operation === "readText") {
    return {
      ok: true,
      value: await readClipboardText(),
    };
  }

  if (request.operation === "writeText") {
    await writeClipboardText(String(request.value ?? ""));
    return { ok: true };
  }

  return {
    ok: false,
    error: "Unsupported clipboard operation.",
  };
}

async function readClipboardText() {
  try {
    if (navigator.clipboard?.readText) {
      return await navigator.clipboard.readText();
    }
  } catch {
    // Offscreen documents may lack focus; use extension clipboard permission.
  }

  const textarea = createClipboardTextarea();

  try {
    textarea.focus();
    const pasted = document.execCommand("paste");
    if (!pasted) throw new Error("Clipboard paste command failed.");
    return textarea.value;
  } finally {
    textarea.remove();
  }
}

async function writeClipboardText(value) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Offscreen documents may lack focus; use extension clipboard permission.
  }

  const textarea = createClipboardTextarea();

  try {
    textarea.value = value;
    textarea.focus();
    textarea.select();
    const copied = document.execCommand("copy");
    if (!copied) throw new Error("Clipboard copy command failed.");
  } finally {
    textarea.remove();
  }
}

function createClipboardTextarea() {
  const textarea = document.createElement("textarea");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  return textarea;
}
