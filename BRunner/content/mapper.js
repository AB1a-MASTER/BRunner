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
    CancelExecution: "CANCEL_EXECUTION",
  });

  const Actions = Object.freeze({
    ElementClick: "element.click",
    ElementType: "element.type",
    ElementExtract: "element.extract",
    ElementFocus: "element.focus",
    ElementSelect: "element.select",
    ElementToggle: "element.toggle",
    ElementDoubleClick: "element.double_click",
    ElementHover: "element.hover",
    ElementClear: "element.clear",
    ElementScrollIntoView: "element.scroll_into_view",
    BrowserScroll: "browser.scroll",
    DataExtractText: "data.extract.text",
    DataExtractAttribute: "data.extract.attribute",
    DataExtractList: "data.extract.list",
    DataExtractTable: "data.extract.table",
    DataExtractPage: "data.extract.page",
    LogicWait: "logic.wait",
    WaitElementVisible: "wait.element.visible",
    WaitElementHidden: "wait.element.hidden",
    WaitElementEnabled: "wait.element.enabled",
    WaitElementText: "wait.element.text",
    WaitUrl: "wait.url",
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
      this.cancelledRunIds = new Set();

      this.scanDom();
      this.installDomObserver();
      this.installMessageListener();
      this.installRecorderListeners();
      this.installRecorderHighlight();
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
              diagnostics: error.diagnostics || null,
            });
          });

        return true;
      });
    }

    async handleMessage(request) {
      switch (request?.type) {
        case Messages.ExecuteStep:
          return await this.executeStep(request.step, request.runId || "");

        case Messages.CancelExecution:
          if (request.runId) this.cancelledRunIds.add(request.runId);
          return {
            ok: true,
            cancelled: true,
            runId: request.runId || "",
          };

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

      if (!enabled) {
        this.hideRecorderHighlight();
      }

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

    installRecorderHighlight() {
      this.highlightBox = document.createElement("div");
      this.highlightBox.id = "brunner-recorder-highlight";

      Object.assign(this.highlightBox.style, {
        position: "fixed",
        zIndex: "2147483647",
        pointerEvents: "none",
        border: "2px solid #3b82f6",
        background: "rgba(59, 130, 246, 0.12)",
        borderRadius: "6px",
        boxShadow: "0 0 0 2px rgba(59, 130, 246, 0.25)",
        display: "none",
        transition: "all 80ms ease",
      });

      this.highlightLabel = document.createElement("div");
      this.highlightLabel.id = "brunner-recorder-highlight-label";

      Object.assign(this.highlightLabel.style, {
        position: "fixed",
        zIndex: "2147483647",
        pointerEvents: "none",
        background: "#1d4ed8",
        color: "#ffffff",
        fontFamily: "system-ui, sans-serif",
        fontSize: "11px",
        fontWeight: "600",
        padding: "3px 6px",
        borderRadius: "4px",
        display: "none",
        maxWidth: "300px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      });

      document.documentElement.appendChild(this.highlightBox);
      document.documentElement.appendChild(this.highlightLabel);

      document.addEventListener(
        "mouseover",
        (event) => {
          if (!this.isRecording) return;

          const element = this.findRecordableElement(event.target);
          if (!element) {
            this.hideRecorderHighlight();
            return;
          }

          this.showRecorderHighlight(element);
        },
        true,
      );

      document.addEventListener(
        "mouseout",
        (event) => {
          if (!this.isRecording) return;

          const nextTarget = event.relatedTarget;

          if (
            nextTarget &&
            nextTarget instanceof Element &&
            this.findRecordableElement(nextTarget)
          ) {
            return;
          }

          this.hideRecorderHighlight();
        },
        true,
      );

      window.addEventListener(
        "scroll",
        () => {
          if (this.highlightedElement && this.isRecording) {
            this.showRecorderHighlight(this.highlightedElement);
          }
        },
        true,
      );

      window.addEventListener("resize", () => {
        if (this.highlightedElement && this.isRecording) {
          this.showRecorderHighlight(this.highlightedElement);
        }
      });
    }

    showRecorderHighlight(element) {
      if (!element || !this.isVisibleElement(element)) {
        this.hideRecorderHighlight();
        return;
      }

      this.highlightedElement = element;

      const rect = element.getBoundingClientRect();
      const ctrlHash = this.getOrCreateControlHash(element);
      const targetInfo = resolver.buildElementTarget(element, ctrlHash);
      const friendlyName = this.getFriendlyName(element, targetInfo);

      Object.assign(this.highlightBox.style, {
        display: "block",
        left: `${Math.round(rect.left)}px`,
        top: `${Math.round(rect.top)}px`,
        width: `${Math.round(rect.width)}px`,
        height: `${Math.round(rect.height)}px`,
      });

      const labelTop = Math.max(0, rect.top - 24);

      this.highlightLabel.textContent = `BRunner: ${friendlyName}`;

      Object.assign(this.highlightLabel.style, {
        display: "block",
        left: `${Math.round(rect.left)}px`,
        top: `${Math.round(labelTop)}px`,
      });
    }

    hideRecorderHighlight() {
      this.highlightedElement = null;

      if (this.highlightBox) {
        this.highlightBox.style.display = "none";
      }

      if (this.highlightLabel) {
        this.highlightLabel.style.display = "none";
      }
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
        target: {
          primary: targetInfo.primary,
          candidates:
            targetInfo.candidates ||
            [targetInfo.primary, ...(targetInfo.fallbacks || [])].filter(
              Boolean,
            ),
          fallbacks: targetInfo.fallbacks || [],
          snapshot: targetInfo.snapshot,
        },
        targetType: targetInfo.primary?.strategy || "",
        targetFallbacks: targetInfo.fallbacks || [],
        targetSnapshot: targetInfo.snapshot,
        friendlyName,
        page: this.getCurrentPageContext(),
        recordedAt: new Date().toISOString(),
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

    async executeStep(step = {}, runId = "") {
      this.throwIfExecutionCancelled(runId);

      const action = step.action || step.type;

      if (action === Actions.LogicWait) {
        await this.delay(Number(step.ms || step.duration || 1000));
        return {
          ok: true,
        };
      }

      if (action === Actions.DataExtractPage) {
        return {
          ok: true,
          value: this.extractPageValue(step.config?.field || "all"),
          usedStrategy: "page_context",
          usedValue: step.config?.field || "all",
        };
      }

      if (action === Actions.BrowserScroll) {
        window.scrollBy({
          left: Number(step.config?.x || 0),
          top: Number(step.config?.y || 0),
          behavior: "instant",
        });

        return {
          ok: true,
          usedStrategy: "window.scrollBy",
        };
      }

      if (this.isConditionalWaitAction(action)) {
        return await this.executeConditionalWait(step, runId);
      }

      const resolved = resolver.resolveRecordedTarget(step, this.controls);

      if (!resolved.element) {
        return {
          ok: false,
          error: `Could not resolve target for step: ${action || "unknown"}`,
          diagnostics: this.createExecutionDiagnostics(
            step,
            resolved,
            "target_resolution_failed",
          ),
        };
      }

      const element = resolved.element;

      if (action === Actions.ElementScrollIntoView) {
        element.scrollIntoView({
          block: step.config?.block || "center",
          inline: "nearest",
          behavior: "instant",
        });

        return {
          ok: true,
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        };
      }

      if (action === Actions.ElementHover) {
        await this.executeHover(element);

        return {
          ok: true,
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        };
      }

      if (!this.passesJitOcclusionCheck(element)) {
        return {
          ok: false,
          error: "Target element is occluded or not interactable.",
          diagnostics: this.createExecutionDiagnostics(
            step,
            resolved,
            "target_occluded_or_not_interactable",
          ),
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

      if (action === Actions.ElementDoubleClick) {
        await this.executeDoubleClick(element);

        return {
          ok: true,
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        };
      }

      if (action === Actions.ElementClear) {
        await this.executeType(element, "");

        return {
          ok: true,
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        };
      }

      if (action === Actions.DataExtractText) {
        return {
          ok: true,
          value: this.extractTextValue(element),
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        };
      }

      if (action === Actions.DataExtractAttribute) {
        const attributeName = String(
          step.config?.attributeName || "",
        ).trim();

        if (!attributeName) {
          throw new Error("Extract Attribute requires an attribute name.");
        }

        return {
          ok: true,
          value: element.getAttribute(attributeName) ?? "",
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        };
      }

      if (action === Actions.DataExtractList) {
        return {
          ok: true,
          value: this.extractListValue(element, step.config || {}),
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        };
      }

      if (action === Actions.DataExtractTable) {
        return {
          ok: true,
          value: this.extractTableValue(element, step.config || {}),
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
        diagnostics: this.createExecutionDiagnostics(
          step,
          resolved,
          "unsupported_content_action",
        ),
      };
    }

    createExecutionDiagnostics(step, resolved, finalReason) {
      return {
        action: step?.action || step?.type || "unknown",
        expectedPage: step?.page || null,
        actualPage: this.getCurrentPageContext(),
        targetResolution: {
          mode: resolved?.mode || "failed",
          strategy: resolved?.strategy || null,
          value: resolved?.value || null,
          confidence: resolved?.confidence || 0,
          attempts: Array.isArray(resolved?.attempts)
            ? resolved.attempts
            : [],
          controlsTreeAttempted: Boolean(resolved?.controlsTreeAttempted),
          fuzzyAttempted: Boolean(resolved?.fuzzyAttempted),
        },
        finalReason,
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

    async executeDoubleClick(element) {
      await this.executeClick(element);
      await this.delay(50);
      await this.executeClick(element);

      const rect = element.getBoundingClientRect();
      element.dispatchEvent(
        new MouseEvent("dblclick", {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          detail: 2,
        }),
      );
    }

    async executeHover(element) {
      element.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });
      await this.delay(50);

      if (!this.passesJitOcclusionCheck(element)) {
        throw new Error("Hover target is occluded or not interactable.");
      }

      const rect = element.getBoundingClientRect();
      const eventInit = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      };

      element.dispatchEvent(new MouseEvent("pointerover", eventInit));
      element.dispatchEvent(new MouseEvent("mouseover", eventInit));
      element.dispatchEvent(new MouseEvent("mouseenter", eventInit));
      element.dispatchEvent(new MouseEvent("mousemove", eventInit));
    }

    isConditionalWaitAction(action) {
      return [
        Actions.WaitElementVisible,
        Actions.WaitElementHidden,
        Actions.WaitElementEnabled,
        Actions.WaitElementText,
        Actions.WaitUrl,
      ].includes(action);
    }

    async executeConditionalWait(step, runId = "") {
      const action = step.action || step.type;
      const timeoutMs = Number(step.config?.timeoutMs ?? 10000);
      const pollingMs = Number(step.config?.pollingMs ?? 250);

      if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
        throw new Error("Wait timeout must be a non-negative number.");
      }

      if (!Number.isFinite(pollingMs) || pollingMs <= 0) {
        throw new Error("Wait polling interval must be greater than zero.");
      }

      if (
        action === Actions.WaitUrl &&
        !String(step.config?.expected || "").trim()
      ) {
        throw new Error("Wait for URL requires an expected value.");
      }

      if (
        action === Actions.WaitElementText &&
        !String(step.config?.expectedText || "").trim()
      ) {
        throw new Error("Wait for Text requires expected text.");
      }

      const startedAt = Date.now();
      let attempts = 0;

      while (Date.now() - startedAt <= timeoutMs) {
        this.throwIfExecutionCancelled(runId);
        attempts++;

        if (this.isWaitConditionSatisfied(action, step)) {
          return {
            ok: true,
            attempts,
            elapsedMs: Date.now() - startedAt,
          };
        }

        await this.delayWithCancellation(
          Math.min(pollingMs, Math.max(timeoutMs, 1)),
          runId,
        );
      }

      const error = new Error(`Timed out waiting for ${action}.`);
      error.diagnostics = {
        action,
        expectedPage: step.page || null,
        actualPage: this.getCurrentPageContext(),
        attempts,
        timeoutMs,
        pollingMs,
        finalReason: "wait_condition_timeout",
      };
      throw error;
    }

    throwIfExecutionCancelled(runId) {
      if (!runId || !this.cancelledRunIds.has(runId)) return;

      const error = new Error("Workflow stopped by user.");
      error.name = "WorkflowCancelledError";
      error.diagnostics = {
        runId,
        finalReason: "workflow_cancelled",
      };
      throw error;
    }

    async delayWithCancellation(ms, runId) {
      let remaining = Math.max(Number(ms) || 0, 0);

      while (remaining > 0) {
        this.throwIfExecutionCancelled(runId);
        const chunk = Math.min(remaining, 100);
        await this.delay(chunk);
        remaining -= chunk;
      }

      this.throwIfExecutionCancelled(runId);
    }

    isWaitConditionSatisfied(action, step) {
      if (action === Actions.WaitUrl) {
        const expected = String(step.config?.expected || "");
        const mode = step.config?.matchMode || "contains";

        if (mode === "exact") return location.href === expected;
        if (mode === "regex") return new RegExp(expected).test(location.href);
        return location.href.includes(expected);
      }

      const resolved = resolver.resolveRecordedTarget(step, this.controls);
      const element = resolved.element;

      if (action === Actions.WaitElementHidden) {
        return !element || !this.isVisibleElement(element);
      }
      if (!element) return false;
      if (action === Actions.WaitElementVisible) return this.isVisibleElement(element);
      if (action === Actions.WaitElementEnabled) {
        return (
          this.isVisibleElement(element) &&
          !element.disabled &&
          element.getAttribute("aria-disabled") !== "true"
        );
      }

      if (action === Actions.WaitElementText) {
        const expected = String(step.config?.expectedText || "");
        const actual = String(element.innerText || element.textContent || "");
        return actual.includes(expected);
      }

      return false;
    }

    extractTextValue(element) {
      if (!element) return "";

      if (element.isContentEditable) {
        return String(element.innerText || element.textContent || "").trim();
      }

      if (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)) {
        return String(element.value || "").trim();
      }

      return String(element.innerText || element.textContent || "").trim();
    }

    extractListValue(element, config) {
      const selector = String(config.itemSelector || "li").trim();
      const valueMode = config.valueMode || "text";
      const attributeName = String(config.attributeName || "href").trim();
      const items = Array.from(element.querySelectorAll(selector));

      return items.map((item) => {
        if (valueMode === "attribute") {
          return item.getAttribute(attributeName) ?? "";
        }

        return this.extractTextValue(item);
      });
    }

    extractTableValue(element, config) {
      const rowSelector = String(config.rowSelector || "tr").trim();
      const cellSelector = String(config.cellSelector || "th, td").trim();
      const rows = Array.from(element.querySelectorAll(rowSelector)).map(
        (row) => {
          return Array.from(row.querySelectorAll(cellSelector)).map((cell) => {
            return this.extractTextValue(cell);
          });
        },
      ).filter((row) => row.length > 0);

      if (rows.length === 0) {
        return {
          headers: [],
          rows: [],
        };
      }

      const firstRowElement = element.querySelector(rowSelector);
      const hasHeaderCells = Boolean(firstRowElement?.querySelector("th"));
      const headers = hasHeaderCells ? rows[0] : [];
      const dataRows = hasHeaderCells ? rows.slice(1) : rows;

      return {
        headers,
        rows: headers.length > 0
          ? dataRows.map((row) => {
              return Object.fromEntries(
                headers.map((header, index) => [header || `column_${index + 1}`, row[index] ?? ""]),
              );
            })
          : dataRows,
      };
    }

    extractPageValue(field) {
      const metadata = {
        title: document.title,
        url: location.href,
        origin: location.origin,
        hostname: location.hostname,
        path: location.pathname,
        search: location.search,
      };

      return field === "all" ? metadata : metadata[field] ?? "";
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

      const aria = element.getAttribute("aria-label");
      if (aria) return aria;

      const placeholder = element.getAttribute("placeholder");
      if (placeholder) return placeholder;

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

    getCurrentPageContext() {
      return {
        url: location.href,
        origin: location.origin,
        host: location.host,
        hostname: location.hostname,
        domain: this.getRegistrableDomain(location.hostname),
        path: location.pathname,
        search: location.search,
        title: document.title,
      };
    }

    getRegistrableDomain(hostname) {
      const host = String(hostname || "").toLowerCase();

      if (!host) return "";
      if (host === "localhost") return "localhost";
      if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;

      const parts = host.split(".").filter(Boolean);

      if (parts.length <= 2) {
        return host;
      }

      // Basic heuristic. Good enough for now.
      // Later we can use a public suffix list if needed.
      return parts.slice(-2).join(".");
    }
  }

  if (!window.__BRUNNER_MAPPER__) {
    window.__BRUNNER_MAPPER__ = new BRunnerMapper();
  }
})();
