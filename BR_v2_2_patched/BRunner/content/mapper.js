// content/mapper.js - AAA-Grade Live Page Mapper

class BRunnerMapper {
  constructor() {
    this.controlsTree = [];
    this.observer = null;
    this.debounceTimer = null;

    // Iframe offset variables (if injected inside an iframe)
    this.iframeOffsetX = 0;
    this.iframeOffsetY = 0;
  }

  async initialize() {
    console.log("[BRunner Agent] Initializing AAA Execution Agent...");
    await this.calculateIframeOffset();
    this.startMonitoring();
  }

  // ==========================================================================
  // 1. Iframe Coordinate Translation
  // ==========================================================================
  async calculateIframeOffset() {
    if (window.top !== window.self) {
      console.log(
        "[BRunner Agent] Detected execution inside an iframe. Requesting relative offsets.",
      );
      // Defaults to 0 for now. Full cross-origin implementation requires
      // parent-window message passing.
      this.iframeOffsetX = 0;
      this.iframeOffsetY = 0;
    }
  }

  // ==========================================================================
  // 2. Deterministic ID Generation
  // ==========================================================================
  generateDeterministicId(el) {
    let path = "";
    let current = el;
    while (current && current !== document.documentElement) {
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) index++;
        sibling = sibling.previousElementSibling;
      }
      path = `${current.tagName.toLowerCase()}:${index}>${path}`;
      current = current.parentElement || current.getRootNode().host; // Handles shadow boundary
    }

    const uniqueString = `${path}|${el.id || ""}|${el.name || ""}`;

    // Simple 32-bit integer hash for speed
    let hash = 0;
    for (let i = 0; i < uniqueString.length; i++) {
      const char = uniqueString.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `ctrl_${Math.abs(hash)}`;
  }

  // ==========================================================================
  // 3. Shadow DOM Piercing
  // ==========================================================================
  getInteractableElements(root = document) {
    let elements = [];
    const baseElements = root.querySelectorAll(
      'a, button, input, select, textarea, [role="button"], [role="checkbox"], [role="tab"], *',
    );

    baseElements.forEach((el) => {
      // If it has a shadow root, pierce it and recursively grab elements
      if (el.shadowRoot) {
        elements = elements.concat(this.getInteractableElements(el.shadowRoot));
      }

      // Filter strictly for interactive tags or ARIA roles
      const isInteractive =
        ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) ||
        el.hasAttribute("role");

      if (isInteractive) {
        elements.push(el);
      }
    });

    return elements;
  }

  // ==========================================================================
  // 4. State & Visibility Geometry
  // ==========================================================================
  isElementVisible(el, rect) {
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    )
      return false;
    return true;
  }

  // ==========================================================================
  // 5. The Core Loop & Garbage Collection
  // ==========================================================================
  updateControlsMap() {
    const rawElements = this.getInteractableElements();
    const newTree = [];

    rawElements.forEach((el) => {
      // Natural Garbage Collection: Skip if detached from DOM
      if (!el.isConnected) return;

      const rect = el.getBoundingClientRect();
      const isVisible = this.isElementVisible(el, rect);

      newTree.push({
        internalId: this.generateDeterministicId(el),
        tagName: el.tagName.toLowerCase(),
        attributes: {
          id: el.id || null,
          className: el.className || null,
          placeholder: el.getAttribute("placeholder") || null,
          type: el.getAttribute("type") || null,
          name: el.getAttribute("name") || null,
        },
        state: {
          isVisible: isVisible,
          isEnabled:
            !el.disabled && el.getAttribute("aria-disabled") !== "true",
          isReadOnly: el.readOnly || el.hasAttribute("readonly"),
          isChecked:
            el.checked !== undefined
              ? el.checked
              : el.getAttribute("aria-checked"),
          isOccluded: false, // JIT calculated at execution time
          blockerSelector: null,
        },
        coordinates: {
          viewport: {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
            centerX: rect.left + rect.width / 2,
            centerY: rect.top + rect.height / 2,
          },
          page: {
            centerX:
              rect.left + window.scrollX + rect.width / 2 + this.iframeOffsetX,
            centerY:
              rect.top + window.scrollY + rect.height / 2 + this.iframeOffsetY,
          },
        },
      });
    });

    this.controlsTree = newTree;

    // Send telemetry to the Background Worker so we can see it working
    chrome.runtime
      .sendMessage({
        type: "SYSTEM_LOG",
        payload: `Map updated. Tracking ${this.controlsTree.length} interactable nodes.`,
      })
      .catch(() => {
        /* Ignore errors if background isn't ready */
      });
  }

  // ==========================================================================
  // 6. Passive Layout Monitoring
  // ==========================================================================
  startMonitoring() {
    this.updateControlsMap();

    this.observer = new MutationObserver((mutations) => {
      let relevantChange = false;
      for (let m of mutations) {
        if (
          m.type === "childList" ||
          (m.type === "attributes" &&
            [
              "class",
              "disabled",
              "readonly",
              "checked",
              "style",
              "hidden",
            ].includes(m.attributeName))
        ) {
          relevantChange = true;
          break;
        }
      }

      if (relevantChange) {
        clearTimeout(this.debounceTimer);
        // 200ms debounce prevents CPU freezing during heavy animations
        this.debounceTimer = setTimeout(() => this.updateControlsMap(), 200);
      }
    });

    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "class",
        "id",
        "disabled",
        "readonly",
        "checked",
        "style",
        "hidden",
      ],
    });
  }
}

// ============================================================================
// PHASE 3: AAA-Grade Target Identification & Execution Engine
// ============================================================================

class BRunnerExecutor {
  constructor(mapperInstance) {
    this.mapper = mapperInstance;
    this.listenForCommands();
  }

  // --------------------------------------------------------------------------
  // JIT Occlusion Tester (Checks if a modal/overlay is blocking the target)
  // --------------------------------------------------------------------------
  checkOcclusion(targetElement, viewportCoords) {
    const { centerX, centerY } = viewportCoords;

    // 1. Check if out of bounds (needs scrolling, not occluded)
    if (
      centerX < 0 ||
      centerX > window.innerWidth ||
      centerY < 0 ||
      centerY > window.innerHeight
    ) {
      return { isOccluded: false, blocker: null, needsScroll: true };
    }

    // 2. Query the topmost visible DOM element at the center point
    // Note: If using Shadow DOM, elementFromPoint returns the Shadow Host.
    const topElement = document.elementFromPoint(centerX, centerY);
    if (!topElement)
      return { isOccluded: true, blocker: "unknown", needsScroll: false };

    // 3. Verify if the topmost element is our target OR contains our target
    // (e.g., clicking an <i> icon inside a <button>)
    if (
      topElement === targetElement ||
      targetElement.contains(topElement) ||
      topElement.contains(targetElement)
    ) {
      return { isOccluded: false, blocker: null, needsScroll: false };
    }

    // 4. Element is visually blocked. Generate a helpful identifier for the Brain.
    const blockerSelector = topElement.id
      ? `#${topElement.id}`
      : `.${Array.from(topElement.classList).join(".")}` ||
        topElement.tagName.toLowerCase();

    return { isOccluded: true, blocker: blockerSelector, needsScroll: false };
  }

  // --------------------------------------------------------------------------
  // The Smart Resolution Engine (Translates recorded targets to physical nodes)
  // --------------------------------------------------------------------------
  escapeCssValue(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  getCandidateList(stepPayload) {
    if (!stepPayload) return [];

    // New resilient schema: target.primary + target.fallbacks.
    if (stepPayload.target && typeof stepPayload.target === "object") {
      const target = stepPayload.target;
      const candidates = [];
      if (target.primary) candidates.push(target.primary);
      if (Array.isArray(target.fallbacks)) candidates.push(...target.fallbacks);
      return candidates.filter((c) => c && c.value);
    }

    // Current v2.2-compatible flat schema: target + targetType + targetFallbacks.
    const candidates = [];
    if (stepPayload.target) {
      candidates.push({
        type: stepPayload.selectorType || stepPayload.targetType || "css_selector",
        value: stepPayload.target,
      });
    }
    if (Array.isArray(stepPayload.targetFallbacks)) {
      candidates.push(...stepPayload.targetFallbacks);
    }
    return candidates.filter((c) => c && c.value);
  }

  resolveByCandidate(candidate) {
    const type = candidate.type || candidate.strategy || "css_selector";
    const value = candidate.value;
    let physicalElement = null;

    try {
      switch (type) {
        case "id": {
          const rawId = String(value).startsWith("#") ? String(value).slice(1) : value;
          physicalElement = document.getElementById(rawId) || document.querySelector(value);
          break;
        }

        case "name": {
          const rawName = String(value).startsWith("[name=")
            ? value.match(/\[name=["']?([^"'\]]+)/)?.[1]
            : value;
          physicalElement =
            document.querySelector(`[name="${this.escapeCssValue(rawName)}"]`) ||
            document.querySelector(value);
          break;
        }

        case "ariaLabel":
        case "aria-label": {
          physicalElement = document.querySelector(
            `[aria-label="${this.escapeCssValue(value)}"]`,
          );
          break;
        }

        case "data-testid":
        case "data-test":
        case "data-qa": {
          physicalElement = document.querySelector(
            `[${type}="${this.escapeCssValue(value)}"]`,
          );
          break;
        }

        case "attribute":
        case "css_selector":
        case "css": {
          physicalElement = document.querySelector(value);
          break;
        }

        case "text":
        case "labelText": {
          const lowerTarget = String(value).trim().toLowerCase();
          physicalElement = this.mapper.getInteractableElements().find((el) => {
            const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
            const aria = (el.getAttribute("aria-label") || "").toLowerCase();
            const placeholder = (el.getAttribute("placeholder") || "").toLowerCase();
            return text === lowerTarget || aria === lowerTarget || placeholder === lowerTarget;
          });
          break;
        }

        case "ctrlHash":
        case "fallback_hash":
        case "internalId": {
          physicalElement = this.mapper
            .getInteractableElements()
            .find((el) => this.mapper.generateDeterministicId(el) === value);
          break;
        }

        default: {
          physicalElement = document.querySelector(value);
        }
      }
    } catch (e) {
      // Invalid selector strings are expected during manual editing; fall through to fuzzy matching.
    }

    return physicalElement;
  }

  resolveTarget(stepPayloadOrTarget, selectorType) {
    const stepPayload =
      typeof stepPayloadOrTarget === "object" && stepPayloadOrTarget !== null
        ? stepPayloadOrTarget
        : { target: stepPayloadOrTarget, selectorType };

    const candidates = this.getCandidateList(stepPayload);
    let physicalElement = null;
    let matchedCandidate = null;

    for (const candidate of candidates) {
      physicalElement = this.resolveByCandidate(candidate);
      if (physicalElement) {
        matchedCandidate = candidate;
        break;
      }
    }

    // Last-resort fuzzy text / attribute matching for old and manually edited workflows.
    if (!physicalElement && stepPayload.target && typeof stepPayload.target === "string") {
      const elements = this.mapper.getInteractableElements();
      const lowerTarget = stepPayload.target.toLowerCase();

      physicalElement = elements.find((el) => {
        const textMatch = el.innerText?.toLowerCase().includes(lowerTarget);
        const placeholderMatch = el
          .getAttribute("placeholder")
          ?.toLowerCase()
          .includes(lowerTarget);
        const nameMatch = el.getAttribute("name")?.toLowerCase() === lowerTarget;
        const ariaMatch = el
          .getAttribute("aria-label")
          ?.toLowerCase()
          .includes(lowerTarget);
        return textMatch || placeholderMatch || nameMatch || ariaMatch;
      });
      if (physicalElement) matchedCandidate = { type: "fuzzy", value: stepPayload.target };
    }

    if (physicalElement) {
      const internalId = this.mapper.generateDeterministicId(physicalElement);
      const matchedNodeData = this.mapper.controlsTree.find(
        (c) => c.internalId === internalId,
      );

      if (!matchedNodeData) {
        const rect = physicalElement.getBoundingClientRect();
        return {
          physicalElement,
          matchedCandidate,
          matchedNodeData: {
            coordinates: {
              page: {
                centerX: rect.left + window.scrollX + rect.width / 2,
                centerY: rect.top + window.scrollY + rect.height / 2,
              },
            },
          },
        };
      }
      return { matchedNodeData, physicalElement, matchedCandidate };
    }

    return { physicalElement: null, matchedNodeData: null, matchedCandidate: null };
  }

  // --------------------------------------------------------------------------
  // The Comprehensive Action Executor
  // --------------------------------------------------------------------------
  async attemptExecution(stepPayload, maxRetries = 4) {
    let attempt = 0;
    const baseDelay = 150;

    // Handle non-element actions first
    if (stepPayload.action === "keyboard.send_keys") {
      // Note: Full hardware keystrokes require CDP (Hardware Sim Layer),
      // but we dispatch standard JS events here for Tier 1 functionality.
      const target = document.activeElement || document.body;
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: stepPayload.payload.primary,
          bubbles: true,
        }),
      );
      target.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: stepPayload.payload.primary,
          bubbles: true,
        }),
      );
      return { status: "success", strategy_used: "DOM_Native" };
    }

    while (attempt < maxRetries) {
      attempt++;
      const { matchedNodeData, physicalElement, matchedCandidate } = this.resolveTarget(stepPayload);

      if (!physicalElement) {
        if (attempt === maxRetries)
          return {
            status: "failed",
            reason: `Element NotFound: ${typeof stepPayload.target === "string" ? stepPayload.target : JSON.stringify(stepPayload.target)}`,
          };
        await new Promise((res) => setTimeout(res, baseDelay * attempt));
        continue;
      }

      const rect = physicalElement.getBoundingClientRect();
      const freshCoords = {
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
      };
      const occlusionCheck = this.checkOcclusion(physicalElement, freshCoords);

      if (occlusionCheck.isOccluded) {
        if (attempt === maxRetries) {
          return {
            status: "fallback_required",
            reason: "UI_Occluded",
            blocker: occlusionCheck.blocker,
            coordinates: matchedNodeData.coordinates.page,
          };
        }
        await new Promise((res) => setTimeout(res, baseDelay * attempt));
        continue;
      }

      // Execute Comprehensive Action Palette
      if (occlusionCheck.needsScroll)
        physicalElement.scrollIntoView({ behavior: "smooth", block: "center" });

      try {
        switch (stepPayload.action) {
          case "element.click":
            physicalElement.click();
            break;

          case "element.type":
            physicalElement.focus();
            physicalElement.value = stepPayload.payload.primary;
            physicalElement.dispatchEvent(
              new Event("input", { bubbles: true }),
            );
            physicalElement.dispatchEvent(
              new Event("change", { bubbles: true }),
            );
            break;

          case "element.focus":
            physicalElement.focus();
            break;

          case "element.select":
            physicalElement.value = stepPayload.payload.primary;
            physicalElement.dispatchEvent(
              new Event("change", { bubbles: true }),
            );
            break;

          case "element.toggle":
            if (
              physicalElement.type === "checkbox" ||
              physicalElement.type === "radio"
            ) {
              physicalElement.checked = !physicalElement.checked;
              physicalElement.dispatchEvent(
                new Event("change", { bubbles: true }),
              );
            } else {
              physicalElement.click(); // Fallback to click if not standard toggle
            }
            break;
          case "element.extract":
            // Prioritize input values, fallback to inner text
            const extractedValue =
              physicalElement.value || physicalElement.innerText || "";
            return {
              status: "success",
              strategy_used: "DOM_Native",
              extractedData: extractedValue.trim(),
            };
        }
        return {
          status: "success",
          strategy_used: "DOM_Native",
          selector_used: matchedCandidate?.type || matchedCandidate?.strategy || null,
          selector_value: matchedCandidate?.value || null,
        };
      } catch (e) {
        return { status: "failed", error: e.message };
      }
    }
  }

  // --------------------------------------------------------------------------
  // Message Listener (Receives orders from the Brain)
  // --------------------------------------------------------------------------
  listenForCommands() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.type === "EXECUTE_STEP") {
        console.log(
          "[BRunner Executor] Received Execution Command:",
          request.payload,
        );

        // Run asynchronously and respond when finished
        this.attemptExecution(request.payload).then((result) => {
          console.log("[BRunner Executor] Execution Result:", result);
          sendResponse(result);
        });

        return true; // Keep message port open for the async response
      }
    });
  }
}

// ============================================================================
// PHASE 4 & 5: Intelligent Macro Recorder (With Friendly Naming & Keystrokes)
// ============================================================================

// class BRunnerRecorder {
//   constructor(mapperInstance) {
//     this.mapper = mapperInstance;
//     this.isRecording = false;
//     this.overlay = this.createOverlay();
//     this.setupListeners();
//   }

//   createOverlay() {
//     const div = document.createElement("div");
//     div.style.position = "fixed";
//     div.style.pointerEvents = "none";
//     div.style.zIndex = "2147483647";
//     div.style.border = "2px solid #ef4444";
//     div.style.backgroundColor = "rgba(239, 68, 68, 0.15)";
//     div.style.transition = "all 0.1s ease-out";
//     div.style.display = "none";

//     setInterval(() => {
//       if (!document.body.contains(div)) document.body.appendChild(div);
//     }, 1000);

//     return div;
//   }

//   // --- NEW: Phase 5.1 Friendly Naming Engine ---
//   generateFriendlyName(el) {
//     const tag = el.tagName.toLowerCase();
//     // Cascade through attributes to find the most human-readable descriptor
//     let descriptor =
//       el.getAttribute("placeholder") ||
//       el.getAttribute("aria-label") ||
//       el.innerText?.trim().substring(0, 25) ||
//       el.value?.substring(0, 25) ||
//       el.getAttribute("name") ||
//       el.id ||
//       "Element";

//     // Clean up excessive whitespace/newlines
//     descriptor = descriptor.replace(/\s+/g, " ").trim();
//     return `${tag.charAt(0).toUpperCase() + tag.slice(1)}: ${descriptor}`;
//   }

//   // Add this method to BRunnerRecorder class in content/mapper.js
//   getStableIdentifier(el) {
//     // Priority 1: ID
//     if (el.id && document.getElementById(el.id) === el) {
//       return { type: "id", value: `#${el.id}` };
//     }
//     // Priority 2: Name
//     if (el.name) {
//       return { type: "name", value: `[name="${el.name}"]` };
//     }
//     // Priority 3: Aria-label or specialized attribute
//     const stableAttr =
//       el.getAttribute("aria-label") || el.getAttribute("data-testid");
//     if (stableAttr) {
//       return { type: "attribute", value: `[aria-label="${stableAttr}"]` };
//     }

//     // Fallback: Internal DOM Hash (for visual/CDP operations)
//     return {
//       type: "fallback_hash",
//       value: this.mapper.generateDeterministicId(el),
//     };
//   }

//   setupListeners() {
//     chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
//       if (request.type === "SET_RECORDING_STATE") {
//         this.isRecording = request.isRecording;
//         console.log(
//           `[BRunner Recorder] Recording mode: ${this.isRecording ? "ACTIVE 🔴" : "OFF ⚪"}`,
//         );
//         if (!this.isRecording) this.overlay.style.display = "none";
//         sendResponse({ status: "acknowledged" });
//       }
//     });

//     window.addEventListener(
//       "mouseover",
//       (e) => {
//         if (!this.isRecording) return;
//         const rect = e.target.getBoundingClientRect();
//         this.overlay.style.display = "block";
//         this.overlay.style.top = `${rect.top}px`;
//         this.overlay.style.left = `${rect.left}px`;
//         this.overlay.style.width = `${rect.width}px`;
//         this.overlay.style.height = `${rect.height}px`;
//       },
//       true,
//     );

//     // 1. Intercept Clicks
//     window.addEventListener(
//       "click",
//       (e) => {
//         if (!this.isRecording) return;

//         this.overlay.style.backgroundColor = "rgba(34, 197, 94, 0.4)";
//         setTimeout(
//           () =>
//             (this.overlay.style.backgroundColor = "rgba(239, 68, 68, 0.15)"),
//           200,
//         );
//         const identifier = this.getStableIdentifier(e.target);
//         this.dispatchRecordedStep({
//           action: "element.click",
//           target: identifier.value, // Now saved as #id or [name=...]
//           targetType: identifier.type, // We can store this to know how to resolve it later
//           friendlyName: this.generateFriendlyName(e.target),
//           payload: {},
//           // const targetId = this.mapper.generateDeterministicId(e.target);
//           // this.dispatchRecordedStep({
//           //   action: "element.click",
//           //   target: targetId,
//           //   friendlyName: this.generateFriendlyName(e.target), // Inject friendly name
//           //   payload: {},
//         });
//       },
//       true,
//     );

//     // 2. Intercept Typing / Dropdowns
//     window.addEventListener(
//       "change",
//       (e) => {
//         if (!this.isRecording) return;

//         const targetId = this.mapper.generateDeterministicId(e.target);
//         const actionType =
//           e.target.tagName === "SELECT" ? "element.select" : "element.type";

//         this.dispatchRecordedStep({
//           action: actionType,
//           target: targetId,
//           friendlyName: this.generateFriendlyName(e.target), // Inject friendly name
//           payload: { primary: e.target.value },
//         });
//       },
//       true,
//     );

//     // --- NEW: Phase 5.2 Functional Keystroke Capture ---
//     window.addEventListener(
//       "keydown",
//       (e) => {
//         if (!this.isRecording) return;

//         // We only care about functional keys, standard typing is caught by 'change' above
//         const functionalKeys = [
//           "Enter",
//           "Escape",
//           "Tab",
//           "ArrowUp",
//           "ArrowDown",
//         ];
//         if (functionalKeys.includes(e.key)) {
//           this.dispatchRecordedStep({
//             action: "keyboard.send_keys",
//             target: null,
//             friendlyName: `Key: ${e.key}`,
//             payload: { primary: e.key },
//           });
//         }
//       },
//       true,
//     );
//   }

//   dispatchRecordedStep(stepTemplate) {
//     console.log("[BRunner Recorder] Captured step:", stepTemplate);
//     chrome.runtime.sendMessage({
//       type: "RECORDED_STEP",
//       payload: { step: stepTemplate },
//     });
//   }
// }

// ============================================================================
// PHASE 5.1 & 5.2: Intelligent Macro Recorder (Combined Logic)
// ============================================================================

class BRunnerRecorder {
  constructor(mapperInstance) {
    this.mapper = mapperInstance;
    this.isRecording = false;
    this.overlay = this.createOverlay();
    this.setupListeners();
    this.syncInitialRecordingState();
  }

  // Visual highlight box
  createOverlay() {
    const div = document.createElement("div");
    div.style.position = "fixed";
    div.style.pointerEvents = "none";
    div.style.zIndex = "2147483647";
    div.style.border = "2px solid #ef4444";
    div.style.backgroundColor = "rgba(239, 68, 68, 0.15)";
    div.style.transition = "all 0.1s ease-out";
    div.style.display = "none";

    setInterval(() => {
      if (!document.body.contains(div)) document.body.appendChild(div);
    }, 1000);

    return div;
  }

  // UX: Readable name for Studio UI
  generateFriendlyName(el) {
    const tag = el.tagName.toLowerCase();
    let descriptor =
      el.getAttribute("placeholder") ||
      el.getAttribute("aria-label") ||
      el.innerText?.trim().substring(0, 25) ||
      el.value?.substring(0, 25) ||
      el.getAttribute("name") ||
      el.id ||
      "Element";
    descriptor = descriptor.replace(/\s+/g, " ").trim();
    return `${tag.charAt(0).toUpperCase() + tag.slice(1)}: ${descriptor}`;
  }

  escapeCssValue(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  getShortStableText(el) {
    const tag = el.tagName.toLowerCase();
    if (!["button", "a"].includes(tag) && !el.hasAttribute("role")) return null;

    const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    if (!text || text.length > 80) return null;
    return text;
  }

  getLabelText(el) {
    if (el.id) {
      const label = document.querySelector(`label[for="${this.escapeCssValue(el.id)}"]`);
      const text = label?.innerText?.replace(/\s+/g, " ").trim();
      if (text) return text;
    }

    const wrappedLabel = el.closest("label");
    const wrappedText = wrappedLabel?.innerText?.replace(/\s+/g, " ").trim();
    return wrappedText || null;
  }

  buildElementSnapshot(el, internalId) {
    const rect = el.getBoundingClientRect();
    return {
      internalId,
      tagName: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || null,
      type: el.getAttribute("type") || null,
      text: (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
      bounds: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
    };
  }

  // EXECUTION: Robust address for Orchestration Engine.
  // Saves semantic selectors first and keeps ctrl_HASH only as a fallback.
  getStableIdentifier(el) {
    const candidates = [];
    const internalId = this.mapper.generateDeterministicId(el);

    if (el.id && document.getElementById(el.id) === el) {
      candidates.push({ type: "id", value: el.id });
    }

    if (el.getAttribute("name")) {
      candidates.push({ type: "name", value: el.getAttribute("name") });
    }

    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) {
      candidates.push({ type: "ariaLabel", value: ariaLabel });
    }

    for (const attr of ["data-testid", "data-test", "data-qa"]) {
      const value = el.getAttribute(attr);
      if (value) candidates.push({ type: attr, value });
    }

    const labelText = this.getLabelText(el);
    if (labelText) {
      candidates.push({ type: "labelText", value: labelText });
    }

    const shortText = this.getShortStableText(el);
    if (shortText) {
      candidates.push({ type: "text", value: shortText });
    }

    candidates.push({ type: "ctrlHash", value: internalId });

    const primary = candidates[0];
    return {
      type: primary.type,
      value: primary.value,
      fallbacks: candidates.slice(1),
      target: {
        primary,
        fallbacks: candidates.slice(1),
        snapshot: this.buildElementSnapshot(el, internalId),
      },
    };
  }

  syncInitialRecordingState() {
    chrome.runtime
      .sendMessage({ type: "GET_RECORDING_STATE" }, (response) => {
        if (chrome.runtime.lastError) return;
        this.isRecording = !!response?.isRecording;
      });
  }

  setupListeners() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.type === "SET_RECORDING_STATE") {
        this.isRecording = request.isRecording;
        if (!this.isRecording) this.overlay.style.display = "none";
        sendResponse({ status: "acknowledged" });
      }
    });

    window.addEventListener(
      "mouseover",
      (e) => {
        if (!this.isRecording) return;
        const rect = e.target.getBoundingClientRect();
        this.overlay.style.display = "block";
        this.overlay.style.top = `${rect.top}px`;
        this.overlay.style.left = `${rect.left}px`;
        this.overlay.style.width = `${rect.width}px`;
        this.overlay.style.height = `${rect.height}px`;
      },
      true,
    );

    // Click Capture
    window.addEventListener(
      "click",
      (e) => {
        if (!this.isRecording) return;

        const identifier = this.getStableIdentifier(e.target);
        this.dispatchRecordedStep({
          action: "element.click",
          target: identifier.value,
          targetType: identifier.type,
          targetFallbacks: identifier.fallbacks,
          targetSnapshot: identifier.target.snapshot,
          friendlyName: this.generateFriendlyName(e.target),
          payload: {},
        });
      },
      true,
    );

    // Typing/Change Capture
    window.addEventListener(
      "change",
      (e) => {
        if (!this.isRecording) return;

        const identifier = this.getStableIdentifier(e.target);
        const actionType =
          e.target.tagName === "SELECT" ? "element.select" : "element.type";

        this.dispatchRecordedStep({
          action: actionType,
          target: identifier.value,
          targetType: identifier.type,
          targetFallbacks: identifier.fallbacks,
          targetSnapshot: identifier.target.snapshot,
          friendlyName: this.generateFriendlyName(e.target),
          payload: { primary: e.target.value },
        });
      },
      true,
    );

    // Keydown Capture
    window.addEventListener(
      "keydown",
      (e) => {
        if (!this.isRecording) return;
        if (["Enter", "Escape", "Tab"].includes(e.key)) {
          this.dispatchRecordedStep({
            action: "keyboard.send_keys",
            target: null,
            friendlyName: `Key: ${e.key}`,
            payload: { primary: e.key },
          });
        }
      },
      true,
    );
  }

  dispatchRecordedStep(stepTemplate) {
    chrome.runtime.sendMessage({
      type: "RECORDED_STEP",
      payload: { step: stepTemplate },
    });
  }
}

// Boot the agent
const bRunnerAgent = new BRunnerMapper();

// Boot the recorder and link it to the mapper
const bRunnerRecorder = new BRunnerRecorder(bRunnerAgent);
// Boot the Executor and link it to our AAA Mapper
const bRunnerExecutor = new BRunnerExecutor(bRunnerAgent);

bRunnerAgent.initialize();
