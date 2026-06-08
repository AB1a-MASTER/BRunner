// content/mapper.js
// BRunner Execution Agent.
// Runs inside target webpages.
// Depends on content/targetResolver.js being loaded first.

(function () {
  const Messages = Object.freeze({
    ExecuteStep: "EXECUTE_STEP",
    ToggleRecording: "TOGGLE_RECORDING",
    GetRecordingState: "GET_RECORDING_STATE",
    SetRecordingState: "SET_RECORDING_STATE",
    RecordedStep: "RECORDED_STEP",
  });

  const Actions = Object.freeze({
    ElementClick: "element.click",
    ElementType: "element.type",
    ElementExtract: "element.extract",
    ElementFocus: "element.focus",
    ElementSelect: "element.select",
    ElementToggle: "element.toggle",
    LogicWait: "logic.wait",
  });

  const resolver = window.BRunnerTargetResolver;

  if (!resolver) {
    console.error(
      "[BRunner] targetResolver.js was not loaded before mapper.js.",
    );
    return;
  }

  class BRunnerMapper {
    constructor() {
      this.controls = new Map();
      this.isRecording = false;
      this.lastInputValueByElement = new WeakMap();

      this.scanDom();
      this.installDomObserver();
      this.installMessageListener();
      this.installRecorderListeners();
      this.requestRecordingState();

      console.log("[BRunner] Mapper initialized.");
    }

    scanDom() {
      this.controls.clear();

      const elements = document.querySelectorAll(
        [
          "button",
          "a",
          "input",
          "textarea",
          "select",
          "[role='button']",
          "[role='link']",
          "[role='textbox']",
          "[contenteditable='true']",
        ].join(","),
      );

      elements.forEach((element) => {
        if (!this.isUsableControl(element)) return;

        const ctrlHash = this.getOrCreateControlHash(element);
        const targetInfo = resolver.buildElementTarget(element, ctrlHash);

        this.controls.set(ctrlHash, {
          id: ctrlHash,
          element,
          target: targetInfo.primary,
          targetFallbacks: targetInfo.fallbacks,
          snapshot: targetInfo.snapshot,
          friendlyName: this.getFriendlyName(element, targetInfo),
        });
      });

      return Array.from(this.controls.values()).map((control) => ({
        id: control.id,
        target: control.target,
        targetFallbacks: control.targetFallbacks,
        snapshot: control.snapshot,
        friendlyName: control.friendlyName,
      }));
    }

    installDomObserver() {
      const observer = new MutationObserver(() => {
        window.clearTimeout(this.scanTimer);
        this.scanTimer = window.setTimeout(() => this.scanDom(), 250);
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "id",
          "name",
          "aria-label",
          "data-testid",
          "data-test",
          "data-qa",
          "style",
          "class",
          "hidden",
          "disabled",
        ],
      });
    }

    installMessageListener() {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        this.handleMessage(request)
          .then((response) => sendResponse(response))
          .catch((error) => {
            console.error("[BRunner] Mapper message error:", error);

            sendResponse({
              ok: false,
              error: error.message || String(error),
            });
          });

        return true;
      });
    }

    async handleMessage(request) {
      switch (request?.type) {
        case Messages.ExecuteStep:
          return await this.executeStep(request.step);

        case Messages.SetRecordingState:
          this.setRecordingState(Boolean(request.isRecording));
          return {
            ok: true,
            isRecording: this.isRecording,
          };

        case Messages.ToggleRecording:
          this.setRecordingState(Boolean(request.enabled));
          return {
            ok: true,
            isRecording: this.isRecording,
          };

        case Messages.GetRecordingState:
          return {
            ok: true,
            isRecording: this.isRecording,
          };

        case "GET_CONTROLS_TREE":
          return {
            ok: true,
            controls: this.scanDom(),
          };

        default:
          return {
            ok: false,
            error: `Unknown mapper message: ${request?.type || "undefined"}`,
          };
      }
    }

    async requestRecordingState() {
      try {
        const response = await chrome.runtime.sendMessage({
          type: Messages.GetRecordingState,
        });

        const recording = response?.recording;
        this.setRecordingState(Boolean(recording?.isRecording));
      } catch {
        // Background may not be ready yet. Safe to ignore.
      }
    }

    setRecordingState(enabled) {
      this.isRecording = enabled;
      document.documentElement.dataset.brunnerRecording = enabled
        ? "true"
        : "false";

      console.log(`[BRunner] Recording ${enabled ? "enabled" : "disabled"}.`);
    }

    installRecorderListeners() {
      document.addEventListener(
        "click",
        (event) => this.recordClick(event),
        true,
      );

      document.addEventListener(
        "change",
        (event) => this.recordInputLikeEvent(event),
        true,
      );

      document.addEventListener(
        "blur",
        (event) => this.recordInputLikeEvent(event),
        true,
      );

      document.addEventListener(
        "keydown",
        (event) => {
          if (!this.isRecording) return;

          const element = event.target;
          if (!this.isTextEntryElement(element)) return;

          this.lastInputValueByElement.set(element, element.value || "");
        },
        true,
      );
    }

    recordClick(event) {
      if (!this.isRecording) return;

      const element = this.findRecordableElement(event.target);
      if (!element) return;

      // Avoid recording clicks generated by BRunner itself.
      if (element.dataset?.brunnerSuppressRecord === "true") return;

      const step = this.createRecordedStep(Actions.ElementClick, element);

      this.emitRecordedStep(step);
    }

    recordInputLikeEvent(event) {
      if (!this.isRecording) return;

      const element = event.target;
      if (!this.isTextEntryElement(element)) return;

      const value = this.getElementValue(element);
      const previous = this.lastInputValueByElement.get(element);

      if (previous === value) return;

      this.lastInputValueByElement.set(element, value);

      const step = this.createRecordedStep(Actions.ElementType, element, {
        value,
      });

      this.emitRecordedStep(step);
    }

    createRecordedStep(action, element, extra = {}) {
      const ctrlHash = this.getOrCreateControlHash(element);
      const targetInfo = resolver.buildElementTarget(element, ctrlHash);
      const friendlyName = this.getFriendlyName(element, targetInfo);

      return {
        action,
        target: targetInfo.primary,
        targetType: targetInfo.primary?.strategy || "",
        targetFallbacks: targetInfo.fallbacks,
        targetSnapshot: targetInfo.snapshot,
        friendlyName,
        ...extra,
      };
    }

    emitRecordedStep(step) {
      chrome.runtime
        .sendMessage({
          type: Messages.RecordedStep,
          step,
        })
        .catch((error) => {
          console.warn("[BRunner] Failed to emit recorded step:", error);
        });
    }

    async executeStep(step = {}) {
      const action = step.action || step.type;

      if (action === Actions.LogicWait) {
        await this.delay(Number(step.ms || step.duration || 1000));
        return {
          ok: true,
        };
      }

      const resolved = resolver.resolveRecordedTarget(step);

      if (!resolved.element) {
        return {
          ok: false,
          error: `Could not resolve target for step: ${action || "unknown"}`,
        };
      }

      const element = resolved.element;

      if (!this.passesJitOcclusionCheck(element)) {
        return {
          ok: false,
          error: "Target element is occluded or not interactable.",
        };
      }

      if (action === Actions.ElementClick) {
        await this.executeClick(element);

        return {
          ok: true,
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        };
      }

      if (action === Actions.ElementType) {
        await this.executeType(element, step.value || step.text || "");

        return {
          ok: true,
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        };
      }

      if (action === Actions.ElementExtract) {
        const value = this.extractValue(element);

        return {
          ok: true,
          value,
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        };
      }

      if (action === Actions.ElementFocus) {
        await this.executeFocus(element);

        return {
          ok: true,
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        };
      }

      if (action === Actions.ElementSelect) {
        await this.executeSelect(
          element,
          step.value || step.option || step.text || "",
        );

        return {
          ok: true,
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        };
      }

      if (action === Actions.ElementToggle) {
        await this.executeToggle(element, step.value);

        return {
          ok: true,
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        };
      }

      return {
        ok: false,
        error: `Unsupported content action: ${action || "undefined"}`,
      };
    }

    async executeClick(element) {
      element.dataset.brunnerSuppressRecord = "true";

      element.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });

      await this.delay(50);

      element.focus?.();

      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      for (const type of [
        "pointerdown",
        "mousedown",
        "pointerup",
        "mouseup",
        "click",
      ]) {
        element.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
          }),
        );
      }

      element.click?.();

      window.setTimeout(() => {
        delete element.dataset.brunnerSuppressRecord;
      }, 250);
    }

    async executeType(element, value) {
      element.dataset.brunnerSuppressRecord = "true";

      element.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });

      await this.delay(50);

      element.focus?.();

      if (element.isContentEditable) {
        element.textContent = value;
      } else if ("value" in element) {
        element.value = value;
      } else {
        element.textContent = value;
      }

      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: value,
        }),
      );

      element.dispatchEvent(
        new Event("change", {
          bubbles: true,
          cancelable: true,
        }),
      );

      window.setTimeout(() => {
        delete element.dataset.brunnerSuppressRecord;
      }, 250);
    }

    async executeFocus(element) {
      element.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });

      await this.delay(50);

      element.focus?.();

      element.dispatchEvent(
        new FocusEvent("focus", {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
    }

    async executeSelect(element, value) {
      element.dataset.brunnerSuppressRecord = "true";

      element.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });

      await this.delay(50);

      element.focus?.();

      const desiredValue = String(value || "").trim();

      if (element.tagName.toLowerCase() === "select") {
        const options = Array.from(element.options);

        const match = options.find((option) => {
          return (
            option.value === desiredValue ||
            option.text.trim() === desiredValue ||
            option.label.trim() === desiredValue
          );
        });

        if (!match) {
          throw new Error(`Select option not found: ${desiredValue}`);
        }

        element.value = match.value;

        element.dispatchEvent(
          new Event("input", {
            bubbles: true,
            cancelable: true,
          }),
        );

        element.dispatchEvent(
          new Event("change", {
            bubbles: true,
            cancelable: true,
          }),
        );

        window.setTimeout(() => {
          delete element.dataset.brunnerSuppressRecord;
        }, 250);

        return;
      }

      // Basic ARIA/custom dropdown fallback.
      await this.executeClick(element);
      await this.delay(150);

      const option = this.findVisibleOptionByText(desiredValue);

      if (!option) {
        throw new Error(`Visible option not found: ${desiredValue}`);
      }

      await this.executeClick(option);

      window.setTimeout(() => {
        delete element.dataset.brunnerSuppressRecord;
      }, 250);
    }

    async executeToggle(element, desiredState) {
      element.dataset.brunnerSuppressRecord = "true";

      element.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });

      await this.delay(50);

      const tag = element.tagName.toLowerCase();
      const type = (element.getAttribute("type") || "").toLowerCase();

      const isCheckable =
        tag === "input" && ["checkbox", "radio"].includes(type);

      if (isCheckable) {
        const shouldToggle =
          desiredState === undefined ||
          desiredState === "" ||
          desiredState === null
            ? true
            : Boolean(
                desiredState === true ||
                desiredState === "true" ||
                desiredState === "checked",
              );

        if (shouldToggle || !element.checked) {
          element.click();
        }

        element.dispatchEvent(
          new Event("change", {
            bubbles: true,
            cancelable: true,
          }),
        );

        window.setTimeout(() => {
          delete element.dataset.brunnerSuppressRecord;
        }, 250);

        return;
      }

      const ariaChecked = element.getAttribute("aria-checked");
      const ariaPressed = element.getAttribute("aria-pressed");

      if (ariaChecked !== null || ariaPressed !== null) {
        await this.executeClick(element);

        window.setTimeout(() => {
          delete element.dataset.brunnerSuppressRecord;
        }, 250);

        return;
      }

      await this.executeClick(element);

      window.setTimeout(() => {
        delete element.dataset.brunnerSuppressRecord;
      }, 250);
    }

    findVisibleOptionByText(text) {
      const expected = String(text || "")
        .trim()
        .toLowerCase();

      if (!expected) return null;

      const candidates = Array.from(
        document.querySelectorAll(
          [
            "option",
            "[role='option']",
            "[role='menuitem']",
            "li",
            "div",
            "span",
            "button",
          ].join(","),
        ),
      );

      return (
        candidates.find((element) => {
          if (!this.isVisibleElement(element)) return false;

          const value = String(
            element.innerText ||
              element.textContent ||
              element.getAttribute("aria-label") ||
              "",
          )
            .trim()
            .toLowerCase();

          return value === expected;
        }) || null
      );
    }

    extractValue(element) {
      if (!element) return "";

      if (element.isContentEditable) {
        return element.innerText || element.textContent || "";
      }

      if ("value" in element) {
        return element.value || "";
      }

      return element.innerText || element.textContent || "";
    }

    passesJitOcclusionCheck(element) {
      if (!this.isVisibleElement(element)) return false;

      const rect = element.getBoundingClientRect();

      const x = Math.min(
        Math.max(rect.left + rect.width / 2, 0),
        window.innerWidth - 1,
      );

      const y = Math.min(
        Math.max(rect.top + rect.height / 2, 0),
        window.innerHeight - 1,
      );

      const topElement = document.elementFromPoint(x, y);

      return (
        topElement === element ||
        element.contains(topElement) ||
        topElement?.contains(element)
      );
    }

    getOrCreateControlHash(element) {
      if (!element.dataset.brunnerId) {
        element.dataset.brunnerId = this.createControlHash(element);
      }

      return element.dataset.brunnerId;
    }

    createControlHash(element) {
      const basis = [
        element.tagName,
        element.id,
        element.getAttribute("name"),
        element.getAttribute("aria-label"),
        element.getAttribute("type"),
        resolver.getStableElementText(element),
        this.getDomIndexPath(element),
      ].join("|");

      return `ctrl_${this.hashString(basis)}`;
    }

    getDomIndexPath(element) {
      const parts = [];
      let current = element;

      while (
        current &&
        current.nodeType === Node.ELEMENT_NODE &&
        current !== document.documentElement &&
        parts.length < 8
      ) {
        const parent = current.parentElement;
        if (!parent) break;

        const index = Array.from(parent.children).indexOf(current);
        parts.unshift(`${current.tagName.toLowerCase()}:${index}`);
        current = parent;
      }

      return parts.join("/");
    }

    hashString(value) {
      let hash = 0;
      const text = String(value);

      for (let i = 0; i < text.length; i++) {
        hash = (hash << 5) - hash + text.charCodeAt(i);
        hash |= 0;
      }

      return Math.abs(hash).toString(16);
    }

    getFriendlyName(element, targetInfo) {
      const primary = targetInfo?.primary;

      if (primary?.value) {
        return `${primary.strategy}: ${primary.value}`;
      }

      const text = resolver.getStableElementText(element);
      if (text) return text;

      const tag = element.tagName?.toLowerCase?.() || "element";
      return tag;
    }

    findRecordableElement(startElement) {
      if (!startElement || !(startElement instanceof Element)) return null;

      return startElement.closest(
        [
          "button",
          "a",
          "input",
          "textarea",
          "select",
          "[role='button']",
          "[role='link']",
          "[role='textbox']",
          "[contenteditable='true']",
        ].join(","),
      );
    }

    isUsableControl(element) {
      if (!this.isVisibleElement(element)) return false;
      if (element.disabled) return false;
      if (element.getAttribute("aria-hidden") === "true") return false;
      return true;
    }

    isVisibleElement(element) {
      if (!element || !(element instanceof Element)) return false;

      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    }

    isTextEntryElement(element) {
      if (!element || !(element instanceof Element)) return false;

      const tag = element.tagName.toLowerCase();

      if (tag === "textarea") return true;
      if (tag === "select") return true;
      if (element.isContentEditable) return true;

      if (tag === "input") {
        const type = (element.getAttribute("type") || "text").toLowerCase();

        return ![
          "button",
          "submit",
          "reset",
          "checkbox",
          "radio",
          "file",
          "image",
          "hidden",
        ].includes(type);
      }

      return false;
    }

    getElementValue(element) {
      if (!element) return "";

      if (element.isContentEditable) {
        return element.innerText || element.textContent || "";
      }

      if ("value" in element) {
        return element.value || "";
      }

      return "";
    }

    delay(ms) {
      return new Promise((resolve) => window.setTimeout(resolve, ms));
    }
  }

  if (!window.__BRUNNER_MAPPER__) {
    window.__BRUNNER_MAPPER__ = new BRunnerMapper();
  }
})();
