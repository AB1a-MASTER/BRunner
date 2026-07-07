// content/mapper.js
// BRunner Execution Agent.
// Runs inside target webpages.
// Depends on content/targetResolver.js being loaded first.

(function () {
  const Messages = Object.freeze({
    ExecuteStep: "EXECUTE_STEP",
    PrepareHostFallback: "PREPARE_HOST_FALLBACK",
    VerifyHostFallback: "VERIFY_HOST_FALLBACK",
    ToggleRecording: "TOGGLE_RECORDING",
    GetRecordingState: "GET_RECORDING_STATE",
    SetRecordingState: "SET_RECORDING_STATE",
    RecordedStep: "RECORDED_STEP",
    CancelExecution: "CANCEL_EXECUTION",
    HighlightMapperComponent: "HIGHLIGHT_MAPPER_COMPONENT",
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
    FileInputUpload: "file.input.upload",
    LogicWait: "logic.wait",
    WaitElementVisible: "wait.element.visible",
    WaitElementHidden: "wait.element.hidden",
    WaitElementEnabled: "wait.element.enabled",
    WaitElementText: "wait.element.text",
    WaitUrl: "wait.url",
  });

  const resolver = window.BRunnerTargetResolver;
  const filePayload = window.BRunnerFilePayload;

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

      const elements = this.enumerateStaticCandidateElements();

      elements.forEach((element) => {
        if (!this.isUsableControl(element)) return;

        const ctrlHash = this.getOrCreateControlHash(element);
        const targetInfo = resolver.buildElementTarget(element, ctrlHash);
        const mapperFact = this.buildMapperComponentFact(
          element,
          "",
          targetInfo,
        );

        this.controls.set(ctrlHash, {
          id: ctrlHash,
          element,
          target: targetInfo.primary,
          targetFallbacks: targetInfo.fallbacks,
          snapshot: targetInfo.snapshot,
          mapperFact,
          friendlyName: this.getFriendlyName(element, targetInfo),
        });
      });

      return Array.from(this.controls.values()).map((control) => ({
        id: control.id,
        target: control.target,
        targetFallbacks: control.targetFallbacks,
        snapshot: control.snapshot,
        mapperFact: control.mapperFact,
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

        case Messages.PrepareHostFallback:
          return await this.prepareHostFallback(request.step, request.runId || "");

        case Messages.VerifyHostFallback:
          return await this.verifyHostFallback(request.step, request.runId || "");

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

        case Messages.HighlightMapperComponent:
          return this.highlightMapperComponent(
            request.component,
            request.pageMap,
          );

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

      this.mapperHighlightBox = document.createElement("div");
      this.mapperHighlightBox.id = "brunner-mapper-inspector-highlight";
      Object.assign(this.mapperHighlightBox.style, {
        position: "fixed",
        zIndex: "2147483646",
        pointerEvents: "none",
        border: "2px solid #22c55e",
        background: "rgba(34, 197, 94, 0.14)",
        borderRadius: "4px",
        boxShadow: "0 0 0 2px rgba(34, 197, 94, 0.24)",
        display: "none",
      });

      this.mapperHighlightLabel = document.createElement("div");
      this.mapperHighlightLabel.id = "brunner-mapper-inspector-highlight-label";
      Object.assign(this.mapperHighlightLabel.style, {
        position: "fixed",
        zIndex: "2147483646",
        pointerEvents: "none",
        background: "#166534",
        color: "#ffffff",
        fontFamily: "system-ui, sans-serif",
        fontSize: "11px",
        fontWeight: "650",
        padding: "4px 7px",
        borderRadius: "4px",
        display: "none",
        maxWidth: "360px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      });

      document.documentElement.appendChild(this.mapperHighlightBox);
      document.documentElement.appendChild(this.mapperHighlightLabel);

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
          if (this.mapperHighlightedElement) {
            this.refreshMapperInspectorHighlight();
          }
        },
        true,
      );

      window.addEventListener("resize", () => {
        if (this.highlightedElement && this.isRecording) {
          this.showRecorderHighlight(this.highlightedElement);
        }
        if (this.mapperHighlightedElement) {
          this.refreshMapperInspectorHighlight();
        }
      });
    }

    async highlightMapperComponent(component = {}, pageMap = {}) {
      if (!component?.componentId) {
        this.hideMapperInspectorHighlight();
        return {
          ok: false,
          error: "Missing mapper component.",
        };
      }

      const result = this.resolveMapperComponentTarget({
        mapperContext: {
          state: "ready",
          pageMap: {
            classification: pageMap?.classification || "",
          },
          component,
        },
      }, component.action || "");

      if (result.element) {
        await this.showMapperInspectorHighlight(
          result.element,
          component,
          result.mapperState || "resolved",
        );
      } else {
        this.hideMapperInspectorHighlight();
      }

      return {
        ok: true,
        mapperState: result.mapperState || "not_found",
        mapperReason: result.mapperReason || "",
        confidence: result.confidence || 0,
        attempts: result.attempts || [],
        resolverLog: result.resolverLog || null,
        highlighted: Boolean(result.element),
      };
    }

    async showMapperInspectorHighlight(element, component = {}, state = "resolved") {
      if (!element || !this.isVisibleElement(element)) {
        this.hideMapperInspectorHighlight();
        return;
      }

      element.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });
      await this.afterNextPaint();

      this.mapperHighlightedElement = element;
      this.mapperHighlightedComponent = component;
      this.mapperHighlightedState = state;

      const rect = element.getBoundingClientRect();
      this.drawMapperInspectorHighlight(rect, component, state);
    }

    refreshMapperInspectorHighlight() {
      const element = this.mapperHighlightedElement;
      if (!element || !this.isVisibleElement(element)) {
        this.hideMapperInspectorHighlight();
        return;
      }

      this.drawMapperInspectorHighlight(
        element.getBoundingClientRect(),
        this.mapperHighlightedComponent || {},
        this.mapperHighlightedState || "resolved",
      );
    }

    drawMapperInspectorHighlight(rect = {}, component = {}, state = "resolved") {
      const color = this.mapperHighlightColor(state, component.status);
      const labelTop = Math.max(0, Number(rect.top ?? rect.y) - 26);
      const left = Math.max(0, Number(rect.left ?? rect.x) || 0);
      const top = Math.max(0, Number(rect.top ?? rect.y) || 0);
      const width = Math.max(4, Number(rect.width) || 4);
      const height = Math.max(4, Number(rect.height) || 4);

      Object.assign(this.mapperHighlightBox.style, {
        display: "block",
        left: `${Math.round(left)}px`,
        top: `${Math.round(top)}px`,
        width: `${Math.round(width)}px`,
        height: `${Math.round(height)}px`,
        borderColor: color.border,
        background: color.background,
        boxShadow: `0 0 0 2px ${color.shadow}`,
      });

      this.mapperHighlightLabel.textContent = `${component.componentId || "component"}: ${state}`;
      Object.assign(this.mapperHighlightLabel.style, {
        display: "block",
        left: `${Math.round(left)}px`,
        top: `${Math.round(labelTop)}px`,
        background: color.label,
      });
    }

    hideMapperInspectorHighlight() {
      this.mapperHighlightedElement = null;
      this.mapperHighlightedComponent = null;
      this.mapperHighlightedState = "";

      if (this.mapperHighlightBox) {
        this.mapperHighlightBox.style.display = "none";
      }
      if (this.mapperHighlightLabel) {
        this.mapperHighlightLabel.style.display = "none";
      }
    }

    afterNextPaint() {
      return new Promise((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(resolve);
        });
      });
    }

    mapperHighlightColor(state = "", status = "") {
      const key = state || status || "";
      if (key.includes("ambiguous")) {
        return {
          border: "#f59e0b",
          background: "rgba(245, 158, 11, 0.16)",
          shadow: "rgba(245, 158, 11, 0.28)",
          label: "#92400e",
        };
      }
      if (key.includes("not_found") || status === "removed") {
        return {
          border: "#ef4444",
          background: "rgba(239, 68, 68, 0.14)",
          shadow: "rgba(239, 68, 68, 0.26)",
          label: "#991b1b",
        };
      }
      if (key.includes("dynamic") || key.includes("unsupported")) {
        return {
          border: "#8b5cf6",
          background: "rgba(139, 92, 246, 0.14)",
          shadow: "rgba(139, 92, 246, 0.24)",
          label: "#5b21b6",
        };
      }
      if (key.includes("fallback") || status === "changed") {
        return {
          border: "#06b6d4",
          background: "rgba(6, 182, 212, 0.14)",
          shadow: "rgba(6, 182, 212, 0.24)",
          label: "#155e75",
        };
      }
      return {
        border: "#22c55e",
        background: "rgba(34, 197, 94, 0.14)",
        shadow: "rgba(34, 197, 94, 0.24)",
        label: "#166534",
      };
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

      const element = this.findRecordableElementFromEvent(event);
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

      const step = element.tagName?.toLowerCase?.() === "select"
        ? this.createRecordedStep(Actions.ElementSelect, element, {
            value: this.getSelectedOptionText(element) || value,
            optionText: this.getSelectedOptionText(element),
            optionValue: value,
            optionIndex: Number(element.selectedIndex),
          })
        : this.createRecordedStep(Actions.ElementType, element, {
            value,
          });

      this.emitRecordedStep(step);
    }

    createRecordedStep(action, element, extra = {}) {
      const ctrlHash = this.getOrCreateControlHash(element);
      const targetInfo = resolver.buildElementTarget(element, ctrlHash);
      const friendlyName = this.getFriendlyName(element, targetInfo);
      const mapperFact = this.buildMapperComponentFact(
        element,
        action,
        targetInfo,
      );
      const componentRef = this.createComponentRef(mapperFact);

      return {
        action,
        componentRef,
        mapperFact,
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

    enumerateStaticCandidateElements() {
      const selector = [
        "button",
        "a",
        "input",
        "textarea",
        "select",
        "[role='button']",
        "[role='link']",
        "[role='textbox']",
        "[contenteditable='true']",
      ].join(",");
      const roots = this.getOpenDomRoots();
      const elements = [];
      const seen = new Set();

      roots.forEach((root) => {
        root.querySelectorAll(selector).forEach((element) => {
          if (seen.has(element)) return;
          seen.add(element);
          elements.push(element);
        });
      });

      return elements;
    }

    getOpenDomRoots() {
      const roots = [document];
      const seenRoots = new Set(roots);
      const visit = (root) => {
        root.querySelectorAll?.("*")?.forEach((element) => {
          if (!element.shadowRoot || seenRoots.has(element.shadowRoot)) return;
          seenRoots.add(element.shadowRoot);
          roots.push(element.shadowRoot);
          visit(element.shadowRoot);
        });
      };

      visit(document);
      return roots;
    }

    findRecordableElementFromEvent(event) {
      const path = typeof event?.composedPath === "function"
        ? event.composedPath()
        : [];

      for (const candidate of path) {
        const element = this.findRecordableElement(candidate);
        if (element) return element;
      }

      return this.findRecordableElement(event?.target);
    }

    buildMapperComponentFact(element, action = "", targetInfo = {}) {
      const snapshot = targetInfo.snapshot || {};
      const page = this.getCurrentPageContext();
      const siteKey = this.toMapperIdentifier(page.hostname || location.hostname);
      const pageName = this.mapperPageName(page.path || location.pathname);
      const pageProfileKey = `${siteKey}::${pageName}`;
      const semantic = this.buildMapperSemanticFacts(element, snapshot);
      const structural = this.buildMapperStructuralFacts(element, snapshot);
      const technical = this.buildMapperTechnicalFacts(element, snapshot);
      const behavioral = this.buildMapperBehavioralFacts(element, action, snapshot);
      const visual = {
        bounds: snapshot.bounds || this.getViewportBounds(element),
        viewportBounds: snapshot.bounds || this.getViewportBounds(element),
        documentBounds: this.getDocumentBounds(element),
        viewport: {
          width: Math.round(window.innerWidth || 0),
          height: Math.round(window.innerHeight || 0),
          scrollX: Math.round(window.scrollX || window.pageXOffset || 0),
          scrollY: Math.round(window.scrollY || window.pageYOffset || 0),
        },
      };
      const locatorCandidates = (targetInfo.candidates || [
        targetInfo.primary,
        ...(targetInfo.fallbacks || []),
      ])
        .filter(Boolean)
        .map((locator) => ({
          strategy: locator.strategy || "",
          value: locator.value || "",
          reliability: Number(locator.score || locator.reliability || 50),
          selectedAtCapture: locator === targetInfo.primary,
        }));
      const componentSeed = this.mapperComponentSeed(semantic, technical);
      const componentContext = structural.ancestorTokens
        .map((token) => this.toMapperIdentifier(token))
        .filter(Boolean)
        .slice(0, 1)
        .join("_");
      const componentId = [
        siteKey,
        pageName,
        componentContext,
        componentSeed,
      ].filter(Boolean).join("_");
      const fingerprint = {
        semantic,
        structural,
        technical,
        behavioral,
        visual,
      };
      const fingerprintDigest = this.hashString(JSON.stringify(fingerprint));
      const componentUid = `uid_${fingerprintDigest}`;
      const mapVersionId = `map_${this.hashString(`${pageProfileKey}|${fingerprintDigest}`)}`;

      return {
        mapperSchemaVersion: 1,
        mapperCoreVersion: "content-adapter.v1",
        action,
        siteKey,
        pageProfileKey,
        componentId,
        componentUid,
        capturedMapVersionId: mapVersionId,
        displayName: this.mapperDisplayName(semantic, technical),
        locatorCandidates,
        fingerprint,
        expectedCapabilities: behavioral.capabilities,
      };
    }

    createComponentRef(mapperFact = {}) {
      return {
        mapperSchemaVersion: 1,
        componentId: mapperFact.componentId || "",
        componentUid: mapperFact.componentUid || "",
        siteKey: mapperFact.siteKey || "",
        pageProfileKey: mapperFact.pageProfileKey || "",
        capturedMapVersionId: mapperFact.capturedMapVersionId || "",
      };
    }

    buildMapperSemanticFacts(element, snapshot = {}) {
      return {
        role: this.toMapperIdentifier(
          element.getAttribute("role") || this.inferRole(element),
        ),
        accessibleName: this.cleanMapperText(
          element.getAttribute("aria-label") ||
            this.getAssociatedLabelText(element) ||
            resolver.getStableElementText(element),
        ),
        labelText: this.cleanMapperText(this.getAssociatedLabelText(element)),
        stableText: this.cleanMapperText(resolver.getStableElementText(element)),
        placeholder: this.cleanMapperText(element.getAttribute("placeholder")),
        title: this.cleanMapperText(element.getAttribute("title")),
        name: this.toMapperIdentifier(element.getAttribute("name")),
        inputType: this.toMapperIdentifier(
          element.getAttribute("type") || snapshot.type || "",
        ),
        stableAttributes: this.getStableDataAttributes(element),
      };
    }

    buildMapperStructuralFacts(element, snapshot = {}) {
      return {
        ancestorTokens: this.getMeaningfulAncestorTokens(element),
        formName: this.toMapperIdentifier(
          element.closest("form")?.getAttribute("name") ||
            element.closest("form")?.id ||
            "",
        ),
        relativeIndex: this.getSiblingIndex(element),
        nearbyLabel: this.cleanMapperText(snapshot.nearbyText || ""),
      };
    }

    buildMapperTechnicalFacts(element, snapshot = {}) {
      return {
        tag: this.toMapperIdentifier(element.tagName),
        id: this.toMapperIdentifier(element.id),
        classes: Array.from(element.classList || [])
          .map((item) => this.toMapperIdentifier(item))
          .filter(Boolean)
          .slice(0, 8),
        domPath: snapshot.domPath || this.getDomIndexPath(element),
      };
    }

    buildMapperBehavioralFacts(element, action = "", snapshot = {}) {
      return {
        capabilities: this.inferMapperCapabilities(element, action),
        href: this.cleanMapperText(element.getAttribute("href") || snapshot.href || ""),
        state: {
          disabled: Boolean(element.disabled) ||
            element.getAttribute("aria-disabled") === "true",
          readonly: Boolean(element.readOnly),
        },
      };
    }

    getViewportBounds(element) {
      if (!element?.getBoundingClientRect) return null;
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }

    getDocumentBounds(element) {
      if (!element?.getBoundingClientRect) return null;
      const rect = element.getBoundingClientRect();
      const scrollX = window.scrollX || window.pageXOffset || 0;
      const scrollY = window.scrollY || window.pageYOffset || 0;
      return {
        x: Math.round(rect.left + scrollX),
        y: Math.round(rect.top + scrollY),
        left: Math.round(rect.left + scrollX),
        top: Math.round(rect.top + scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }

    inferMapperCapabilities(element, action = "") {
      const tag = element.tagName?.toLowerCase?.() || "";
      const type = (element.getAttribute("type") || "").toLowerCase();
      const role = (element.getAttribute("role") || "").toLowerCase();
      const capabilities = new Set(["extract"]);

      if (
        ["button", "a", "summary", "select"].includes(tag) ||
        ["button", "link", "menuitem", "tab", "checkbox", "radio"].includes(role)
      ) {
        capabilities.add("click");
      }

      if (
        ["textarea"].includes(tag) ||
        element.isContentEditable ||
        role === "textbox" ||
        (tag === "input" && ![
          "button",
          "submit",
          "reset",
          "checkbox",
          "radio",
          "file",
          "hidden",
        ].includes(type))
      ) {
        capabilities.add("type");
        capabilities.add("clear");
      }

      if (tag === "select") capabilities.add("select");
      if (tag === "input" && type === "file") capabilities.add("upload");
      if (action === Actions.ElementToggle) capabilities.add("toggle");

      return Array.from(capabilities);
    }

    getAssociatedLabelText(element) {
      if (!element || !(element instanceof Element)) return "";

      if (element.id) {
        const label = document.querySelector(
          `label[for="${this.escapeCssString(element.id)}"]`,
        );
        const text = this.cleanMapperText(label?.innerText || label?.textContent || "");
        if (text) return text;
      }

      const wrappingLabel = element.closest("label");
      return this.cleanMapperText(
        wrappingLabel?.innerText || wrappingLabel?.textContent || "",
      );
    }

    getStableDataAttributes(element) {
      const attrs = {};
      [
        "data-testid",
        "data-test",
        "data-qa",
        "data-cy",
        "data-automation-id",
        "data-component",
      ].forEach((name) => {
        const value = this.cleanMapperText(element.getAttribute(name));
        if (value) attrs[name] = value;
      });
      return attrs;
    }

    getMeaningfulAncestorTokens(element) {
      const tokens = [];
      let current = element.parentElement;

      while (current && tokens.length < 2 && current !== document.body) {
        const token = this.cleanMapperText(
          current.getAttribute("aria-label") ||
            current.getAttribute("data-testid") ||
            current.getAttribute("data-test") ||
            current.getAttribute("data-qa") ||
            current.id ||
            current.getAttribute("role") ||
            current.tagName,
        );
        if (token) tokens.push(token);
        current = current.parentElement;
      }

      return tokens;
    }

    getSiblingIndex(element) {
      const parent = element?.parentElement;
      if (!parent) return null;
      return Array.from(parent.children).indexOf(element);
    }

    inferRole(element) {
      const tag = element.tagName?.toLowerCase?.() || "";
      if (tag === "a") return "link";
      if (tag === "button") return "button";
      if (["input", "textarea"].includes(tag)) return "textbox";
      if (tag === "select") return "listbox";
      return tag;
    }

    mapperComponentSeed(semantic = {}, technical = {}) {
      return this.toMapperIdentifier(
        semantic.stableAttributes?.["data-testid"] ||
          semantic.stableAttributes?.["data-test"] ||
          semantic.stableAttributes?.["data-qa"] ||
          [semantic.accessibleName, semantic.role].filter(Boolean).join(" ") ||
          [semantic.labelText, semantic.role || semantic.inputType].filter(Boolean).join(" ") ||
          [semantic.stableText, semantic.role].filter(Boolean).join(" ") ||
          semantic.name ||
          semantic.placeholder ||
          semantic.title ||
          technical.id ||
          semantic.role ||
          technical.tag ||
          "component",
      );
    }

    mapperDisplayName(semantic = {}, technical = {}) {
      return this.cleanMapperText(
        semantic.accessibleName ||
          semantic.labelText ||
          semantic.stableText ||
          semantic.placeholder ||
          semantic.title ||
          semantic.name ||
          semantic.role ||
          technical.tag ||
          "Component",
      );
    }

    mapperPageName(path = "/") {
      const cleaned = String(path || "/").replace(/^\/+|\/+$/g, "");
      return cleaned ? this.toMapperIdentifier(cleaned.replace(/\//g, "_")) : "home";
    }

    cleanMapperText(value) {
      return String(value || "").trim().replace(/\s+/g, " ");
    }

    toMapperIdentifier(value) {
      return String(value || "")
        .normalize("NFKD")
        .replace(/[^\x00-\x7F]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/_+/g, "_");
    }

    escapeCssString(value) {
      return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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

      const resolved = this.resolveStepTarget(step, action);

      if (!resolved.element) {
        return {
          ok: false,
          error: resolved.mapperState
            ? `Mapper could not resolve target: ${resolved.mapperState}`
            : `Could not resolve target for step: ${action || "unknown"}`,
          diagnostics: this.createExecutionDiagnostics(
            step,
            resolved,
            resolved.mapperState
              ? `mapper_${resolved.mapperState}`
              : "target_resolution_failed",
          ),
        };
      }

      const element = resolved.element;

      if (action === Actions.FileInputUpload) {
        const value = this.executeFileInputUpload(element, step.config || {});

        return {
          ok: true,
          value,
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        };
      }

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
        this.assertPostActionVerification(step, resolved);

        return {
          ok: true,
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        };
      }

      if (action === Actions.ElementType) {
        await this.executeType(element, this.stepTextValue(step));
        this.assertPostActionVerification(step, resolved);

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
        this.assertPostActionVerification(step, resolved);

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
          this.stepOptionValue(step),
        );

        return {
          ok: true,
          usedStrategy: resolved.strategy,
          usedValue: resolved.value,
        };
      }

      if (action === Actions.ElementToggle) {
        await this.executeToggle(element, this.stepToggleValue(step));

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

    async prepareHostFallback(step = {}, runId = "") {
      this.throwIfExecutionCancelled(runId);

      const action = step.action || step.type;
      const hostAction = this.toHostFallbackAction(action);
      if (!hostAction) {
        return {
          ok: false,
          error: `Host fallback is not supported for ${action || "unknown"}.`,
          diagnostics: {
            action: action || "unknown",
            finalReason: "host_fallback_unsupported_action",
          },
        };
      }

      const resolved = this.resolveStepTarget(step, action);
      if (!resolved.element) {
        return {
          ok: false,
          error: `Could not resolve target for host fallback: ${action || "unknown"}`,
          diagnostics: this.createExecutionDiagnostics(
            step,
            resolved,
            "host_fallback_target_resolution_failed",
          ),
        };
      }

      const element = resolved.element;
      element.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });
      await this.delay(50);

      const rect = element.getBoundingClientRect();
      const clientPoint = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
      const devicePixelRatio = Number(window.devicePixelRatio || 1);
      const clientBounds = {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        devicePixelRatio,
      };
      const point = this.clientPointToScreen(
        clientPoint.x,
        clientPoint.y,
      );
      const confidence = this.normalizeHostCoordinateConfidence(
        resolved.confidence,
      );
      const visible = this.isVisibleElement(element);
      const interactable = this.passesJitOcclusionCheck(element);

      return {
        ok: true,
        action: hostAction,
        text: action === Actions.ElementType ? this.stepTextValue(step) : "",
        confidence,
        clientPoint,
        clientBounds,
        devicePixelRatio,
        point,
        target: {
          left: point.x - rect.width / 2,
          top: point.y - rect.height / 2,
          width: rect.width,
          height: rect.height,
          confidence,
        },
        window: {
          title: document.title || "",
          url: window.location.href,
        },
        visible,
        interactable,
        usedStrategy: resolved.strategy,
        usedValue: resolved.value,
      };
    }

    async verifyHostFallback(step = {}, runId = "") {
      this.throwIfExecutionCancelled(runId);

      const action = step.action || step.type;
      const resolved = this.resolveStepTarget(step, action);
      if (!resolved.element) {
        return {
          ok: false,
          error: "Host fallback verification could not resolve target.",
          diagnostics: this.createExecutionDiagnostics(
            step,
            resolved,
            "host_fallback_verification_target_missing",
          ),
        };
      }

      if (action === Actions.ElementType) {
        const expected = this.stepTextValue(step);
        const actual = this.extractValue(resolved.element);
        if (actual !== expected) {
          return {
            ok: false,
            error: "Host fallback typed value verification failed.",
            diagnostics: {
              ...this.createExecutionDiagnostics(
                step,
                resolved,
                "host_fallback_verification_failed",
              ),
              expectedLength: expected.length,
              actualLength: actual.length,
            },
          };
        }
      }

      this.assertPostActionVerification(step, resolved);

      return {
        ok: true,
        usedStrategy: resolved.strategy,
        usedValue: resolved.value,
        verification: "target_resolved",
      };
    }

    toHostFallbackAction(action) {
      if (action === Actions.ElementClick) return "click";
      if (action === Actions.ElementDoubleClick) return "doubleClick";
      if (action === Actions.ElementType) return "type";
      return "";
    }

    resolveStepTarget(step = {}, action = "") {
      if (step.mapperContext?.component) {
        return this.resolveMapperComponentTarget(step, action);
      }

      return resolver.resolveRecordedTarget(step, this.controls);
    }

    resolveMapperComponentTarget(step = {}, action = "") {
      const context = step.mapperContext || {};
      const component = context.component;
      const classification = context.pageMap?.classification || "";

      if (context.state && context.state !== "ready") {
        return this.withMapperResolverLog({
          element: null,
          mode: "mapper",
          mapperState: context.state,
          mapperReason: context.reason || "mapper_context_not_ready",
          strategy: null,
          value: null,
          confidence: 0,
          attempts: [],
        }, component, action, []);
      }

      if (classification === "dynamic_deferred") {
        return this.withMapperResolverLog({
          element: null,
          mode: "mapper",
          mapperState: "dynamic_deferred",
          mapperReason: "dynamic_deferred",
          strategy: null,
          value: null,
          confidence: 0,
          attempts: [],
        }, component, action, []);
      }

      const candidates = this.enumerateMapperCandidates(action);
      const primaryMatches = candidates.filter((candidate) => {
        return this.mapperCandidateHasLocator(candidate, component.primaryLocator);
      });

      if (primaryMatches.length === 1) {
        return this.mapperResolutionFromCandidate(
          primaryMatches[0],
        component.primaryLocator,
        "resolved",
        "primary_locator_unique",
        100,
        component,
      );
      }

      if (primaryMatches.length > 1) {
        return this.withMapperResolverLog({
          element: null,
          mode: "mapper",
          mapperState: "ambiguous",
          mapperReason: "primary_locator_ambiguous",
          strategy: component.primaryLocator?.strategy || null,
          value: component.primaryLocator?.value || null,
          confidence: 0,
          attempts: primaryMatches.map((candidate) => candidate.summary),
        }, component, action, primaryMatches.map((candidate) => ({
          candidate,
          score: 100,
          evidence: ["primary_locator"],
        })));
      }

      const scored = candidates
        .map((candidate) => ({
          candidate,
          ...this.scoreMapperCandidateWithEvidence(component, candidate),
        }))
        .sort((a, b) => b.score - a.score);
      const best = scored[0];
      const runnerUp = scored[1];

      if (!best || best.score < 75) {
        return this.withMapperResolverLog({
          element: null,
          mode: "mapper",
          mapperState: "not_found",
          mapperReason: "below_threshold",
          strategy: null,
          value: null,
          confidence: best?.score || 0,
          attempts: scored.slice(0, 3).map((result) => ({
            ...result.candidate.summary,
            score: result.score,
            evidence: result.evidence,
          })),
        }, component, action, scored);
      }

      if (runnerUp && best.score - runnerUp.score < 15) {
        return this.withMapperResolverLog({
          element: null,
          mode: "mapper",
          mapperState: "ambiguous",
          mapperReason: "runner_up_margin_too_small",
          strategy: null,
          value: null,
          confidence: best.score,
          attempts: scored.slice(0, 3).map((result) => ({
            ...result.candidate.summary,
            score: result.score,
            evidence: result.evidence,
          })),
        }, component, action, scored);
      }

      return this.mapperResolutionFromCandidate(
        best.candidate,
        best.candidate.bestLocator || component.primaryLocator,
        "resolved_with_fallback",
        "fingerprint_unique",
        best.score,
        component,
        scored,
      );
    }

    enumerateMapperCandidates(action = "") {
      return this.enumerateStaticCandidateElements()
        .filter((element) => this.isUsableControl(element))
        .map((element) => {
          const ctrlHash = this.getOrCreateControlHash(element);
          const targetInfo = resolver.buildElementTarget(element, ctrlHash);
          const fact = this.buildMapperComponentFact(element, action, targetInfo);
          return {
            element,
            fact,
            locators: fact.locatorCandidates || [],
            bestLocator: targetInfo.primary || null,
            summary: {
              source: "live_candidate",
              componentId: fact.componentId,
              componentUid: fact.componentUid,
              displayName: fact.displayName,
              action: fact.action,
              primary: targetInfo.primary || null,
              locatorCandidates: fact.locatorCandidates || [],
              fingerprint: fact.fingerprint || {},
              expectedCapabilities: fact.expectedCapabilities || [],
              mapperFact: {
                componentId: fact.componentId,
                componentUid: fact.componentUid,
                displayName: fact.displayName,
                action: fact.action,
                locatorCandidates: fact.locatorCandidates || [],
                fingerprint: fact.fingerprint || {},
                expectedCapabilities: fact.expectedCapabilities || [],
              },
            },
          };
        })
        .filter((candidate) => {
          return this.mapperActionCompatible(candidate.fact.expectedCapabilities, action);
        });
    }

    mapperResolutionFromCandidate(candidate, locator, state, reason, confidence, component = null, scored = null) {
      const result = {
        element: candidate.element,
        mode: "mapper",
        mapperState: state,
        mapperReason: reason,
        strategy: locator?.strategy || "mapper_fingerprint",
        value: locator?.value || candidate.fact.componentId,
        confidence,
        attempts: [candidate.summary],
      };
      return this.withMapperResolverLog(result, component, candidate.fact?.action || "", scored || [{
        candidate,
        score: confidence,
        evidence: state === "resolved" ? ["primary_locator"] : [],
      }]);
    }

    withMapperResolverLog(result = {}, component = null, action = "", scored = []) {
      const attempts = Array.isArray(result.attempts) ? result.attempts : [];
      const ranked = (Array.isArray(scored) ? scored : [])
        .slice(0, 5)
        .map((item, index) => ({
          rank: index + 1,
          score: Number(item.score) || 0,
          evidence: Array.isArray(item.evidence) ? item.evidence : [],
          componentId: item.candidate?.summary?.componentId || "",
          componentUid: item.candidate?.summary?.componentUid || "",
          displayName: item.candidate?.summary?.displayName || "",
          primary: item.candidate?.summary?.primary || null,
        }));
      const best = ranked[0] || null;
      const runnerUp = ranked[1] || null;
      return {
        ...result,
        resolverLog: {
          version: "mapper.resolver.log.v1",
          createdAt: new Date().toISOString(),
          action: String(action || component?.action || ""),
          componentId: String(component?.componentId || ""),
          componentUid: String(component?.componentUid || ""),
          state: result.mapperState || "",
          reason: result.mapperReason || "",
          confidence: Number(result.confidence) || 0,
          strategy: result.strategy || null,
          value: result.value || null,
          thresholds: {
            minimumScore: 75,
            minimumMargin: 15,
          },
          selected: best,
          runnerUp,
          margin: best && runnerUp ? best.score - runnerUp.score : null,
          attemptCount: attempts.length,
          attempts,
          rankedCandidates: ranked,
        },
      };
    }

    mapperCandidateHasLocator(candidate, expected = {}) {
      if (!expected?.strategy || !expected?.value) return false;
      return candidate.locators.some((locator) => {
        return locator.strategy === expected.strategy &&
          locator.value === expected.value;
      });
    }

    scoreMapperCandidate(component = {}, candidate = {}) {
      return this.scoreMapperCandidateWithEvidence(component, candidate).score;
    }

    scoreMapperCandidateWithEvidence(component = {}, candidate = {}) {
      const expected = component.fingerprint || {};
      const actual = candidate.fact?.fingerprint || {};
      let score = 0;
      const evidence = [];

      const expectedSemantic = expected.semantic || {};
      const actualSemantic = actual.semantic || {};
      if (expectedSemantic.role && expectedSemantic.role === actualSemantic.role) {
        score += 10;
        evidence.push("role");
      }
      if (expectedSemantic.inputType && expectedSemantic.inputType === actualSemantic.inputType) {
        score += 6;
        evidence.push("input_type");
      }

      const expectedName = this.normalizeMapperText(
        expectedSemantic.accessibleName ||
          expectedSemantic.labelText ||
          expectedSemantic.stableText ||
          expectedSemantic.placeholder,
      );
      const actualName = this.normalizeMapperText(
        actualSemantic.accessibleName ||
          actualSemantic.labelText ||
          actualSemantic.stableText ||
          actualSemantic.placeholder,
      );
      if (expectedName && expectedName === actualName) {
        score += 29;
        evidence.push("exact_name");
      } else if (expectedName && actualName && this.mapperTextOverlap(expectedName, actualName) >= 0.5) {
        score += 12;
        evidence.push("partial_name");
      }

      const expectedStructural = this.mapperStructuralTokens(expected.structural);
      const actualStructural = this.mapperStructuralTokens(actual.structural);
      const structuralScore = Math.round(this.mapperSetOverlap(expectedStructural, actualStructural) * 30);
      score += structuralScore;
      if (structuralScore) evidence.push("structural");

      const locatorMatches = [
        component.primaryLocator,
        ...(component.fallbackLocators || []),
      ].filter(Boolean).filter((locator) => {
        return this.mapperCandidateHasLocator(candidate, locator);
      }).length;
      if (locatorMatches) {
        score += Math.min(15, locatorMatches * 8);
        evidence.push("locator");
      }

      const expectedCapabilities = expected.behavioral?.capabilities || component.expectedCapabilities || [];
      const actualCapabilities = actual.behavioral?.capabilities || candidate.fact?.expectedCapabilities || [];
      const capabilityScore = Math.round(this.mapperSetOverlap(expectedCapabilities, actualCapabilities) * 8);
      score += capabilityScore;
      if (capabilityScore) evidence.push("capabilities");

      return {
        score: Math.min(Math.round(score), 100),
        evidence,
      };
    }

    mapperActionCompatible(capabilities = [], action = "") {
      const capabilitySet = new Set(capabilities || []);
      if (action.includes("click") || action.includes("hover")) return capabilitySet.has("click");
      if (action.includes("type") || action.includes("clear")) return capabilitySet.has("type") || capabilitySet.has("clear");
      if (action.includes("select")) return capabilitySet.has("select");
      if (action.includes("toggle")) return capabilitySet.has("click") || capabilitySet.has("toggle");
      if (action.includes("upload")) return capabilitySet.has("upload");
      if (action.includes("extract") || action.startsWith("wait.element.")) return capabilitySet.has("extract") || capabilitySet.size > 0;
      return true;
    }

    mapperStructuralTokens(structural = {}) {
      return [
        ...(Array.isArray(structural.ancestorTokens) ? structural.ancestorTokens : []),
        structural.formName,
        structural.nearbyLabel,
      ].map((value) => this.normalizeMapperText(value)).filter(Boolean);
    }

    mapperSetOverlap(a = [], b = []) {
      const aSet = new Set((a || []).map((value) => this.normalizeMapperText(value)).filter(Boolean));
      const bSet = new Set((b || []).map((value) => this.normalizeMapperText(value)).filter(Boolean));
      if (!aSet.size || !bSet.size) return 0;
      let overlap = 0;
      for (const item of aSet) {
        if (bSet.has(item)) overlap += 1;
      }
      return overlap / Math.max(aSet.size, bSet.size);
    }

    mapperTextOverlap(a = "", b = "") {
      return this.mapperSetOverlap(
        String(a).split(/\s+/).filter((word) => word.length > 2),
        String(b).split(/\s+/).filter((word) => word.length > 2),
      );
    }

    normalizeMapperText(value) {
      return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
    }

    stepTextValue(step = {}) {
      return String(step.config?.value ?? step.value ?? step.text ?? "");
    }

    stepOptionValue(step = {}) {
      return String(step.config?.value ?? step.value ?? step.option ?? step.text ?? "");
    }

    stepToggleValue(step = {}) {
      return step.config?.value ?? step.value;
    }

    normalizeHostCoordinateConfidence(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) return 0;
      if (numeric <= 1) return numeric;
      return Math.max(0, Math.min(1, numeric / 100));
    }

    clientPointToScreen(clientX, clientY) {
      const horizontalInset = Math.max(0, window.outerWidth - window.innerWidth);
      const verticalInset = Math.max(0, window.outerHeight - window.innerHeight);
      const chromeX = Math.min(16, horizontalInset / 2);
      const chromeY = Math.max(0, verticalInset - chromeX);
      return {
        x: (window.screenX ?? window.screenLeft ?? 0) + chromeX + clientX,
        y: (window.screenY ?? window.screenTop ?? 0) + chromeY + clientY,
        chromeX,
        chromeY,
        horizontalInset,
        verticalInset,
        sideUiInset: Math.max(0, horizontalInset - chromeX * 2),
      };
    }

    assertPostActionVerification(step = {}, resolved = {}) {
      const config = step.config || {};
      const expected = String(config.verificationText || "").trim();
      if (!expected) return;

      const selector = String(config.verificationSelector || "").trim();
      let verificationElement = null;

      if (selector) {
        try {
          verificationElement = document.querySelector(selector);
        } catch {
          verificationElement = null;
        }
      } else {
        verificationElement = resolved.element || null;
      }

      const actual = this.extractVerificationText(verificationElement);

      if (actual.includes(expected)) return;

      const error = new Error("Post-action verification failed.");
      error.diagnostics = {
        ...this.createExecutionDiagnostics(
          step,
          resolved,
          "post_action_verification_failed",
        ),
        verificationSelector: selector,
        expectedText: expected,
        actualText: actual,
      };
      throw error;
    }

    extractVerificationText(element) {
      if (!element) return "";

      if (element.isContentEditable) {
        return String(element.innerText || element.textContent || "");
      }

      if (["INPUT", "TEXTAREA"].includes(element.tagName)) {
        if (element.type === "checkbox" || element.type === "radio") {
          return String(element.checked);
        }
        return String(element.value || "");
      }

      if (element.tagName === "SELECT") {
        const selectedText = element.selectedOptions?.[0]?.textContent || "";
        return `${element.value || ""} ${selectedText}`.trim();
      }

      return String(
        element.innerText ??
          element.textContent ??
          ("value" in element ? element.value : "") ??
          "",
      );
    }

    createExecutionDiagnostics(step, resolved, finalReason) {
      return {
        action: step?.action || step?.type || "unknown",
        expectedPage: step?.page || null,
        actualPage: this.getCurrentPageContext(),
        targetResolution: {
          mode: resolved?.mode || "failed",
          mapperState: resolved?.mapperState || "",
          mapperReason: resolved?.mapperReason || "",
          strategy: resolved?.strategy || null,
          value: resolved?.value || null,
          confidence: resolved?.confidence || 0,
          attempts: Array.isArray(resolved?.attempts)
            ? resolved.attempts
            : [],
          resolverLog: resolved?.resolverLog || null,
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
        const hasDesiredState = ![
          undefined,
          null,
          "",
        ].includes(desiredState);
        const desiredChecked = hasDesiredState
          ? [true, 1, "1", "true", "checked", "on"].includes(desiredState)
          : !element.checked;

        if (element.checked !== desiredChecked) {
          if (type === "radio" && !desiredChecked) {
            element.checked = false;
            element.dispatchEvent(new Event("input", { bubbles: true }));
          } else {
            element.click();
          }
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

    executeFileInputUpload(element, config) {
      if (!filePayload) {
        throw new Error("BRunner file payload helper is unavailable.");
      }

      if (
        element.tagName?.toLowerCase() !== "input" ||
        String(element.type || "").toLowerCase() !== "file"
      ) {
        throw new Error("File Input Upload target must be <input type=\"file\">.");
      }

      const payload = filePayload.buildFilePayload(config);
      const file = new File([payload.bytes], payload.filename, {
        type: payload.mimeType,
      });
      const transfer = new DataTransfer();
      transfer.items.add(file);

      element.dataset.brunnerSuppressRecord = "true";
      element.files = transfer.files;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));

      window.setTimeout(() => {
        delete element.dataset.brunnerSuppressRecord;
      }, 250);

      return {
        name: file.name,
        type: file.type,
        size: file.size,
      };
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

        const waitResult = this.isWaitConditionSatisfied(action, step);
        if (waitResult?.mapperState) {
          return {
            ok: false,
            error: `Mapper could not resolve wait target: ${waitResult.mapperState}`,
            diagnostics: this.createExecutionDiagnostics(
              step,
              waitResult.resolved,
              `mapper_${waitResult.mapperState}`,
            ),
          };
        }

        if (waitResult === true || waitResult?.satisfied === true) {
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

      const resolved = this.resolveStepTarget(step, action);
      const element = resolved.element;

      if (!element && resolved.mapperState) {
        return {
          satisfied: false,
          mapperState: resolved.mapperState,
          mapperReason: resolved.mapperReason || "",
          resolved,
        };
      }

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

    getSelectedOptionText(element) {
      if (!element || element.tagName?.toLowerCase?.() !== "select") return "";
      const option = element.selectedOptions?.[0] ||
        element.options?.[element.selectedIndex] ||
        null;
      return String(option?.text || option?.label || "").trim();
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
