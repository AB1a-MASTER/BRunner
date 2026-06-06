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
      console.log("[BRunner Agent] Detected execution inside an iframe. Requesting relative offsets.");
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
    let path = '';
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
    
    const uniqueString = `${path}|${el.id || ''}|${el.name || ''}`;
    
    // Simple 32-bit integer hash for speed
    let hash = 0;
    for (let i = 0; i < uniqueString.length; i++) {
      const char = uniqueString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; 
    }
    return `ctrl_${Math.abs(hash)}`;
  }

  // ==========================================================================
  // 3. Shadow DOM Piercing
  // ==========================================================================
  getInteractableElements(root = document) {
    let elements = [];
    const baseElements = root.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="checkbox"], [role="tab"], *');
    
    baseElements.forEach(el => {
      // If it has a shadow root, pierce it and recursively grab elements
      if (el.shadowRoot) {
        elements = elements.concat(this.getInteractableElements(el.shadowRoot));
      }
      
      // Filter strictly for interactive tags or ARIA roles
      const isInteractive = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) || 
                            el.hasAttribute('role');
                            
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
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
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
          placeholder: el.getAttribute('placeholder') || null,
          type: el.getAttribute('type') || null,
          name: el.getAttribute('name') || null
        },
        state: {
          isVisible: isVisible,
          isEnabled: !el.disabled && el.getAttribute('aria-disabled') !== 'true',
          isReadOnly: el.readOnly || el.hasAttribute('readonly'),
          isChecked: el.checked !== undefined ? el.checked : el.getAttribute('aria-checked'),
          isOccluded: false, // JIT calculated at execution time
          blockerSelector: null
        },
        coordinates: {
          viewport: {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
            centerX: rect.left + (rect.width / 2),
            centerY: rect.top + (rect.height / 2)
          },
          page: {
            centerX: rect.left + window.scrollX + (rect.width / 2) + this.iframeOffsetX,
            centerY: rect.top + window.scrollY + (rect.height / 2) + this.iframeOffsetY
          }
        }
      });
    });

    this.controlsTree = newTree;
    
    // Send telemetry to the Background Worker so we can see it working
    chrome.runtime.sendMessage({
      type: "SYSTEM_LOG",
      payload: `Map updated. Tracking ${this.controlsTree.length} interactable nodes.`
    }).catch(() => { /* Ignore errors if background isn't ready */ });
  }

  // ==========================================================================
  // 6. Passive Layout Monitoring
  // ==========================================================================
  startMonitoring() {
    this.updateControlsMap(); 

    this.observer = new MutationObserver((mutations) => {
      let relevantChange = false;
      for (let m of mutations) {
        if (m.type === 'childList' || 
           (m.type === 'attributes' && ['class', 'disabled', 'readonly', 'checked', 'style', 'hidden'].includes(m.attributeName))) {
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
      attributeFilter: ['class', 'id', 'disabled', 'readonly', 'checked', 'style', 'hidden']
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
    if (centerX < 0 || centerX > window.innerWidth || centerY < 0 || centerY > window.innerHeight) {
      return { isOccluded: false, blocker: null, needsScroll: true };
    }

    // 2. Query the topmost visible DOM element at the center point
    // Note: If using Shadow DOM, elementFromPoint returns the Shadow Host.
    const topElement = document.elementFromPoint(centerX, centerY);
    if (!topElement) return { isOccluded: true, blocker: 'unknown', needsScroll: false };

    // 3. Verify if the topmost element is our target OR contains our target 
    // (e.g., clicking an <i> icon inside a <button>)
    if (topElement === targetElement || targetElement.contains(topElement) || topElement.contains(targetElement)) {
      return { isOccluded: false, blocker: null, needsScroll: false };
    }

    // 4. Element is visually blocked. Generate a helpful identifier for the Brain.
    const blockerSelector = topElement.id 
      ? `#${topElement.id}` 
      : `.${Array.from(topElement.classList).join('.')}` || topElement.tagName.toLowerCase();

    return { isOccluded: true, blocker: blockerSelector, needsScroll: false };
  }

  // --------------------------------------------------------------------------
  // 3-Tier Resolution Algorithm
  // --------------------------------------------------------------------------
  // resolveTarget(stepPayload) {
  //   const { targetId, fallbackSignature } = stepPayload;
    
  //   // Tier 1: Direct Deterministic Map Match
  //   let matchedNodeData = this.mapper.controlsTree.find(c => c.internalId === targetId);
  //   let physicalElement = null;

  //   if (matchedNodeData && matchedNodeData.attributes.id) {
  //     physicalElement = document.getElementById(matchedNodeData.attributes.id);
  //   }

  //   // Tier 2: Fuzzy Match (If IDs changed dynamically)
  //   if (!physicalElement && fallbackSignature) {
  //     console.log("[BRunner Executor] Tier 1 failed. Attempting Tier 2 Fuzzy Match...");
  //     matchedNodeData = this.mapper.controlsTree.find(c => 
  //       c.tagName === fallbackSignature.tagName &&
  //       (c.attributes.placeholder === fallbackSignature.placeholder || 
  //        c.attributes.name === fallbackSignature.name)
  //     );
      
  //     if (matchedNodeData) {
  //       // Find the Nth element of this tag to locate the physical node
  //       const elements = this.mapper.getInteractableElements();
  //       physicalElement = elements.find(el => this.mapper.generateDeterministicId(el) === matchedNodeData.internalId);
  //     }
  //   }

  //   return { matchedNodeData, physicalElement };
  // }

  // // --------------------------------------------------------------------------
  // // The Micro-Retry Loop (Bypasses UI Animations)
  // // --------------------------------------------------------------------------
  // async attemptExecution(stepPayload, maxRetries = 4) {
  //   let attempt = 0;
  //   const baseDelay = 150; // milliseconds

  //   while (attempt < maxRetries) {
  //     attempt++;
  //     const { matchedNodeData, physicalElement } = this.resolveTarget(stepPayload);

  //     if (!matchedNodeData || !physicalElement) {
  //       if (attempt === maxRetries) return { status: "failed", reason: "ElementNotFound" };
  //       await new Promise(res => setTimeout(res, baseDelay * attempt)); // Exponential backoff
  //       continue;
  //     }

  //     // Sync latest geometry before physical interaction
  //     const rect = physicalElement.getBoundingClientRect();
  //     const freshCoords = {
  //       centerX: rect.left + (rect.width / 2),
  //       centerY: rect.top + (rect.height / 2)
  //     };

  //     const occlusionCheck = this.checkOcclusion(physicalElement, freshCoords);

  //   //   // If obstructed by an animation fading out, wait and retry
  //   //   if (occlusionCheck.isOccluded) {
  //   //     console.warn(`[BRunner Executor] Target occluded by ${occlusionCheck.blocker}. Retrying... (${attempt}/${maxRetries})`);
  //   //     if (attempt === maxRetries) {
  //   //       // Tier 3 Trigger: Tell the Brain we need Hardware Simulation
          
  //   //       return { 
  //   //         status: "fallback_required", 
  //   //         reason: "UI_Occluded", 
  //   //         blocker: occlusionCheck.blocker,
  //   //         coordinates: matchedNodeData.coordinates.page // Send absolute coords for CDP
  //   //       };
  //   //     }
  //   //     await new Promise(res => setTimeout(res, baseDelay * attempt));
  //   //     continue;
  //   //   }

  //   // If obstructed by an animation fading out, wait and retry
  //     if (occlusionCheck.isOccluded) {
  //       console.warn(`[BRunner Executor] Target occluded by ${occlusionCheck.blocker}. Retrying... (${attempt}/${maxRetries})`);
        
  //       if (attempt === maxRetries) {
  //         // Tier 3 Trigger: Tell the Brain we need Hardware Simulation
  //         console.warn("[BRunner Executor] Tier 1 & 2 failed. Requesting Tier 3 Hardware CDP Click...");
          
  //         return new Promise((resolve) => {
  //           chrome.runtime.sendMessage({
  //             type: "REQUEST_HARDWARE_SIMULATION",
  //             payload: {
  //               reason: "UI_Occluded",
  //               blocker: occlusionCheck.blocker,
  //               coordinates: matchedNodeData.coordinates.page // Send absolute page coords
  //             }
  //           }, (response) => resolve(response));
  //         });
  //       }
        
  //       await new Promise(res => setTimeout(res, baseDelay * attempt));
  //       continue;
  //     }


  //     // SUCCESS PATH: Execute standard DOM interaction
  //     if (stepPayload.action === "element.click") {
  //       if (occlusionCheck.needsScroll) physicalElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  //       physicalElement.click();
  //       return { status: "success", strategy_used: "DOM_Native" };
  //     }
      
  //     if (stepPayload.action === "element.type") {
  //       if (occlusionCheck.needsScroll) physicalElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  //       physicalElement.focus();
  //       physicalElement.value = stepPayload.value;
  //       physicalElement.dispatchEvent(new Event('input', { bubbles: true }));
  //       physicalElement.dispatchEvent(new Event('change', { bubbles: true }));
  //       return { status: "success", strategy_used: "DOM_Native" };
  //     }
  //   }

// --------------------------------------------------------------------------
  // The Smart Resolution Engine (Translates human inputs to physical nodes)
  // --------------------------------------------------------------------------
  resolveTarget(userTarget) {
    if (!userTarget) return { physicalElement: null, matchedNodeData: null };
    let physicalElement = null;

    // Strategy 1: Direct CSS Selector Match (IDs, Classes, structured queries)
    try {
      physicalElement = document.querySelector(userTarget);
    } catch (e) { /* Ignore invalid selector strings */ }

    // Strategy 2: Fuzzy Text / Attribute Match (If Strategy 1 fails)
    if (!physicalElement) {
      const elements = this.mapper.getInteractableElements();
      const lowerTarget = userTarget.toLowerCase();
      
      physicalElement = elements.find(el => {
        const textMatch = el.innerText?.toLowerCase().includes(lowerTarget);
        const placeholderMatch = el.getAttribute('placeholder')?.toLowerCase().includes(lowerTarget);
        const nameMatch = el.getAttribute('name')?.toLowerCase() === lowerTarget;
        const ariaMatch = el.getAttribute('aria-label')?.toLowerCase().includes(lowerTarget);
        return textMatch || placeholderMatch || nameMatch || ariaMatch;
      });
    }

    if (physicalElement) {
      // Map it back to our internal tree so we have accurate JIT occlusion data
      const internalId = this.mapper.generateDeterministicId(physicalElement);
      const matchedNodeData = this.mapper.controlsTree.find(c => c.internalId === internalId);
      
      // If we found the physical element but our map missed it, we generate temporary node data
      if (!matchedNodeData) {
         const rect = physicalElement.getBoundingClientRect();
         return { 
           physicalElement, 
           matchedNodeData: { coordinates: { page: { centerX: rect.left + rect.width/2, centerY: rect.top + rect.height/2 } } } 
         };
      }
      return { matchedNodeData, physicalElement };
    }

    return { physicalElement: null, matchedNodeData: null };
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
       target.dispatchEvent(new KeyboardEvent('keydown', { key: stepPayload.payload.primary, bubbles: true }));
       target.dispatchEvent(new KeyboardEvent('keyup', { key: stepPayload.payload.primary, bubbles: true }));
       return { status: "success", strategy_used: "DOM_Native" };
    }

    while (attempt < maxRetries) {
      attempt++;
      const { matchedNodeData, physicalElement } = this.resolveTarget(stepPayload.target);

      if (!physicalElement) {
        if (attempt === maxRetries) return { status: "failed", reason: `Element NotFound: ${stepPayload.target}` };
        await new Promise(res => setTimeout(res, baseDelay * attempt));
        continue;
      }

      const rect = physicalElement.getBoundingClientRect();
      const freshCoords = { centerX: rect.left + (rect.width / 2), centerY: rect.top + (rect.height / 2) };
      const occlusionCheck = this.checkOcclusion(physicalElement, freshCoords);

      if (occlusionCheck.isOccluded) {
        if (attempt === maxRetries) {
          return { 
            status: "fallback_required", 
            reason: "UI_Occluded", 
            blocker: occlusionCheck.blocker,
            coordinates: matchedNodeData.coordinates.page 
          };
        }
        await new Promise(res => setTimeout(res, baseDelay * attempt));
        continue;
      }

      // Execute Comprehensive Action Palette
      if (occlusionCheck.needsScroll) physicalElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

      try {
        switch (stepPayload.action) {
          case "element.click":
            physicalElement.click();
            break;
            
          case "element.type":
            physicalElement.focus();
            physicalElement.value = stepPayload.payload.primary;
            physicalElement.dispatchEvent(new Event('input', { bubbles: true }));
            physicalElement.dispatchEvent(new Event('change', { bubbles: true }));
            break;
            
          case "element.focus":
            physicalElement.focus();
            break;
            
          case "element.select":
            physicalElement.value = stepPayload.payload.primary;
            physicalElement.dispatchEvent(new Event('change', { bubbles: true }));
            break;
            
          case "element.toggle":
            if (physicalElement.type === 'checkbox' || physicalElement.type === 'radio') {
              physicalElement.checked = !physicalElement.checked;
              physicalElement.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              physicalElement.click(); // Fallback to click if not standard toggle
            }
            break;
        }
        return { status: "success", strategy_used: "DOM_Native" };
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
        console.log("[BRunner Executor] Received Execution Command:", request.payload);
        
        // Run asynchronously and respond when finished
        this.attemptExecution(request.payload).then(result => {
          console.log("[BRunner Executor] Execution Result:", result);
          sendResponse(result);
        });

        return true; // Keep message port open for the async response
      }
    });
  }
}

// Boot the agent
const bRunnerAgent = new BRunnerMapper();
// Boot the Executor and link it to our AAA Mapper
const bRunnerExecutor = new BRunnerExecutor(bRunnerAgent);

bRunnerAgent.initialize();