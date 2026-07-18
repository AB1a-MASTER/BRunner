// content/targetResolver.js
// Shared DOM target generation and resolution logic for recorder + executor.
// Loaded before mapper.js by manifest.json.

(function () {
  const DEFAULT_TARGET_RESOLUTION_MAX_WORK = 10000;
  const MAX_TARGET_RESOLUTION_MAX_WORK = 50000;
  const MAX_TARGET_RESOLUTION_CANDIDATES = 32;

  const TargetStrategies = Object.freeze({
    Id: "id",
    Name: "name",
    AriaLabel: "ariaLabel",
    DataTestId: "data-testid",
    DataTest: "data-test",
    DataQa: "data-qa",
    LabelText: "labelText",
    Text: "text",
    CssSelector: "css_selector",
    CtrlHash: "ctrlHash",
    FallbackHash: "fallback_hash",
  });

  function buildElementTarget(element, ctrlHash = "", options = {}) {
    const candidates = [];
    const workBudget = options.workBudget || createTargetWorkBudget(options.maxWork);

    if (!isElement(element)) {
      return {
        primary: null,
        candidates: [],
        fallbacks: [],
        snapshot: null,
      };
    }
    const form = boundedClosest(
      element,
      "form",
      workBudget,
      "target_form_ancestor",
    );
    const targetOptions = {
      ...options,
      workBudget,
      form,
      formResolved: true,
    };

    addCandidate(
      candidates,
      TargetStrategies.AriaLabel,
      element.getAttribute("aria-label"),
      110,
    );

    const labelText = getAssociatedLabelText(element, targetOptions);
    addCandidate(candidates, TargetStrategies.LabelText, labelText, 108);

    const stableText = getStableElementText(element, {
      ...targetOptions,
      skipSelector: options.skipSelector,
    });
    addCandidate(candidates, TargetStrategies.Text, stableText, 104);

    const role = element.getAttribute("role");
    if (role && stableText) {
      addCandidate(candidates, "role_text", `${role}::${stableText}`, 102);
    }

    addCandidate(
      candidates,
      "placeholder",
      element.getAttribute("placeholder"),
      100,
    );

    addCandidate(candidates, "title", element.getAttribute("title"), 98);

    addCandidate(candidates, TargetStrategies.Id, element.id, 92);

    addCandidate(
      candidates,
      TargetStrategies.Name,
      element.getAttribute("name"),
      90,
    );

    for (const attr of [
      TargetStrategies.DataTestId,
      TargetStrategies.DataTest,
      TargetStrategies.DataQa,
      "data-cy",
      "data-automation-id",
      "data-component",
      "data-testid",
    ]) {
      addCandidate(candidates, attr, element.getAttribute(attr), 88);
    }

    const formContextSelector = buildFormContextSelector(element, targetOptions);
    addCandidate(candidates, "form_context", formContextSelector, 72);

    const cssSelector = buildStableCssSelector(element, targetOptions);
    addCandidate(candidates, TargetStrategies.CssSelector, cssSelector, 68);

    const domPath = buildDomPath(element, targetOptions);
    addCandidate(candidates, "dom_path", domPath, 55);

    if (ctrlHash) {
      addCandidate(candidates, TargetStrategies.CtrlHash, ctrlHash, 40);
    }

    const uniqueCandidates = dedupeCandidates(candidates);

    return {
      primary: uniqueCandidates[0] || null,
      candidates: uniqueCandidates,
      fallbacks: uniqueCandidates.slice(1),
      snapshot: buildElementSnapshot(element, targetOptions),
      overflow: workBudget?.overflow === true,
    };
  }

  function addCandidate(candidates, strategy, rawValue, score) {
    const value = cleanValue(rawValue);

    if (!strategy || !value) return;

    candidates.push({
      strategy,
      value,
      score,
    });
  }

  function dedupeCandidates(candidates) {
    const seen = new Set();

    return candidates
      .filter((candidate) => {
        const key = `${candidate.strategy}::${candidate.value}`;

        if (seen.has(key)) return false;

        seen.add(key);
        return true;
      })
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  }

  function buildDomPath(element, options = {}) {
    if (!isElement(element)) return "";

    const parts = [];
    let current = element;

    while (
      current &&
      current.nodeType === Node.ELEMENT_NODE &&
      current !== document.documentElement &&
      parts.length < 10
    ) {
      const parent = current.parentElement;
      if (!parent) break;

      const tag = current.tagName.toLowerCase();
      const index = getElementSiblingIndex(current, options.workBudget, "target_dom_path_sibling");
      if (index < 0) return "";

      parts.unshift(`${tag}:${index}`);
      current = parent;
    }

    // A DOM path is resolved from document.documentElement. Returning only the
    // last ten segments would therefore point at an unrelated element (or
    // nothing) when the target is nested more deeply. Deep paths are a normal
    // page shape, so omit this fallback without failing the shared work budget.
    if (current !== document.documentElement) return "";

    return parts.join("/");
  }

  function buildFormContextSelector(element, options = {}) {
    if (!isElement(element)) return "";

    const form = options.formResolved === true
      ? options.form || null
      : boundedClosest(element, "form", options.workBudget, "target_form_ancestor");
    if (!form) return "";

    const elementTag = element.tagName.toLowerCase();
    const elementType = element.getAttribute("type");
    const elementText = getStableElementText(element, options);

    const formId = form.id ? `#${cssEscape(form.id)}` : "";
    const formName = form.getAttribute("name")
      ? `form[name="${escapeCssString(form.getAttribute("name"))}"]`
      : "";

    const formSelector = formId || formName || "form";

    if (element.id) {
      return `${formSelector} #${cssEscape(element.id)}`;
    }

    if (element.getAttribute("name")) {
      return `${formSelector} ${elementTag}[name="${escapeCssString(element.getAttribute("name"))}"]`;
    }

    if (elementType) {
      return `${formSelector} ${elementTag}[type="${escapeCssString(elementType)}"]`;
    }

    if (elementText) {
      return `${formSelector} ${elementTag}::text(${elementText})`;
    }

    return "";
  }

  function resolveRecordedTarget(stepOrTarget, controlsTree = null, options = {}) {
    const target = normalizeTargetInput(stepOrTarget);
    const attempts = [];
    const workBudget = options.workBudget || createTargetWorkBudget(options.maxWork);

    const candidates = collectBoundedTargetCandidates(target, workBudget);
    if (workBudget.overflow) {
      return targetWorkOverflowResolution(attempts, workBudget);
    }

    for (const candidate of candidates) {
      const element = resolveByStrategy(candidate, { workBudget });
      if (workBudget.overflow) {
        return targetWorkOverflowResolution(attempts, workBudget);
      }
      const compatible =
        element && snapshotLooksCompatible(element, target.snapshot, { workBudget });

      attempts.push({
        stage: "direct",
        strategy: candidate.strategy,
        value: candidate.value,
        outcome: !element
          ? "not_found"
          : compatible
            ? "matched"
            : "snapshot_mismatch",
      });

      if (compatible) {
        return {
          element,
          strategy: candidate.strategy,
          value: candidate.value,
          confidence: candidateConfidence(candidate),
          mode: "direct",
          attempts,
          controlsTreeAttempted: false,
          fuzzyAttempted: false,
        };
      }
    }

    const controlsTreeMatch = resolveFromControlsTree(
      controlsTree,
      candidates,
      target.snapshot,
      { workBudget },
    );
    if (workBudget.overflow) {
      return targetWorkOverflowResolution(attempts, workBudget);
    }

    const controlsTreeAttempted =
      controlsTreeMatch.mode !== "controls_tree_unavailable";

    attempts.push({
      stage: "controls_tree",
      strategy: controlsTreeMatch.strategy,
      value: controlsTreeMatch.value,
      outcome: controlsTreeMatch.element
        ? "matched"
        : controlsTreeMatch.mode,
      confidence: controlsTreeMatch.confidence,
    });

    if (controlsTreeMatch.element) {
      return {
        ...controlsTreeMatch,
        attempts,
        controlsTreeAttempted,
        fuzzyAttempted: false,
      };
    }

    const fuzzy = resolveBySnapshotFuzzy(target.snapshot, { workBudget });
    if (workBudget.overflow) {
      return targetWorkOverflowResolution(attempts, workBudget);
    }

    attempts.push({
      stage: "document_fuzzy",
      strategy: "snapshot_fuzzy",
      value: fuzzy.reason,
      outcome: fuzzy.element ? "matched" : fuzzy.reason,
      confidence: fuzzy.score,
    });

    if (fuzzy.element) {
      return {
        element: fuzzy.element,
        strategy: "snapshot_fuzzy",
        value: fuzzy.reason,
        confidence: fuzzy.score,
        mode: "fuzzy",
        attempts,
        controlsTreeAttempted,
        fuzzyAttempted: true,
      };
    }

    return {
      element: null,
      strategy: null,
      value: null,
      confidence: 0,
      mode: "failed",
      attempts,
      controlsTreeAttempted,
      fuzzyAttempted: true,
    };
  }

  function resolveFromControlsTree(controlsTree, candidates, snapshot, options = {}) {
    const controls = normalizeControlsTree(controlsTree, options);

    if (controls.length === 0) {
      return {
        element: null,
        strategy: null,
        value: null,
        confidence: 0,
        mode: "controls_tree_unavailable",
      };
    }

    const hashCandidates = candidates.filter((candidate) => {
      return [
        TargetStrategies.CtrlHash,
        TargetStrategies.FallbackHash,
      ].includes(candidate.strategy);
    });

    for (const candidate of hashCandidates) {
      if (!consumeWork(options.workBudget, "target_controls_hash")) break;
      let control = null;
      for (const item of controls) {
        if (!consumeWork(options.workBudget, "target_controls_hash_entry")) break;
        if (item?.id === candidate.value) {
          control = item;
          break;
        }
      }

      if (
        control?.element &&
        isVisibleElement(control.element) &&
        snapshotLooksCompatible(control.element, snapshot, options)
      ) {
        return {
          element: control.element,
          strategy: "controls_tree_hash",
          value: candidate.value,
          confidence: candidateConfidence(candidate),
          mode: "controls_tree",
        };
      }
    }

    if (!snapshot) {
      return {
        element: null,
        strategy: null,
        value: null,
        confidence: 0,
        mode: "controls_tree_no_snapshot",
      };
    }

    let best = {
      element: null,
      score: 0,
      reason: "",
    };

    for (const control of controls) {
      if (!consumeWork(options.workBudget, "target_controls_fuzzy")) break;
      if (!control?.element || !isVisibleElement(control.element)) continue;

      const result = scoreElementAgainstSnapshot(control.element, snapshot, options);

      if (result.score > best.score) {
        best = {
          element: control.element,
          score: result.score,
          reason: result.reason,
        };
      }
    }

    if (best.score < 45) {
      return {
        element: null,
        strategy: null,
        value: best.reason || "below_threshold",
        confidence: best.score,
        mode: "controls_tree_below_threshold",
      };
    }

    return {
      element: best.element,
      strategy: "controls_tree_fuzzy",
      value: best.reason,
      confidence: best.score,
      mode: "controls_tree",
    };
  }

  function normalizeControlsTree(controlsTree, options = {}) {
    if (controlsTree instanceof Map) {
      const controls = [];
      for (const control of controlsTree.values()) {
        if (!consumeWork(options.workBudget, "target_controls_tree_normalize")) break;
        controls.push(control);
      }
      return controls;
    }

    if (Array.isArray(controlsTree)) {
      return controlsTree;
    }

    return [];
  }

  function collectBoundedTargetCandidates(target = {}, workBudget = null) {
    const candidates = [];
    const seen = new Set();
    const append = (candidate) => {
      if (!candidate) return true;
      const key = `${candidate.strategy}::${candidate.value}`;
      if (seen.has(key)) return true;
      if (candidates.length >= MAX_TARGET_RESOLUTION_CANDIDATES) {
        failWorkBudget(workBudget, "target_locator_candidate_budget");
        return false;
      }
      if (!consumeWork(workBudget, "target_locator_candidate")) return false;
      seen.add(key);
      candidates.push(candidate);
      return true;
    };
    if (!append(target.primary)) return [];
    for (const source of [target.candidates, target.fallbacks]) {
      if (!Array.isArray(source)) continue;
      for (let index = 0; index < source.length; index += 1) {
        if (!append(source[index])) return [];
      }
    }
    return dedupeCandidates(candidates);
  }

  function candidateConfidence(candidate = {}) {
    const score = Number(candidate.score);
    if (Number.isFinite(score) && score > 0) return score;

    return defaultStrategyScore(candidate.strategy);
  }

  function defaultStrategyScore(strategy) {
    const scores = {
      [TargetStrategies.AriaLabel]: 100,
      [TargetStrategies.LabelText]: 98,
      [TargetStrategies.Text]: 94,
      [TargetStrategies.Id]: 92,
      [TargetStrategies.Name]: 90,
      [TargetStrategies.DataTestId]: 88,
      [TargetStrategies.DataTest]: 88,
      [TargetStrategies.DataQa]: 88,
      [TargetStrategies.CssSelector]: 68,
      [TargetStrategies.CtrlHash]: 40,
      [TargetStrategies.FallbackHash]: 40,
    };

    return scores[strategy] || 50;
  }

  function createTargetWorkBudget(value) {
    const parsed = Number(value);
    const maxWork = Number.isInteger(parsed)
      ? Math.min(MAX_TARGET_RESOLUTION_MAX_WORK, Math.max(1, parsed))
      : DEFAULT_TARGET_RESOLUTION_MAX_WORK;
    const budget = {
      maxWork,
      workCount: 0,
      overflow: false,
      overflowAt: "",
      consume(kind = "target_resolution_work", count = 1) {
        if (budget.overflow) return false;
        const amount = Math.max(1, Number(count) || 1);
        if (budget.workCount + amount > budget.maxWork) {
          budget.overflow = true;
          budget.overflowAt = String(kind || "target_resolution_work");
          return false;
        }
        budget.workCount += amount;
        return true;
      },
      fail(kind = "target_resolution_work") {
        budget.overflow = true;
        budget.overflowAt ||= String(kind || "target_resolution_work");
        return false;
      },
    };
    return budget;
  }

  function consumeWork(workBudget, kind, count = 1) {
    if (!workBudget) return true;
    if (typeof workBudget.consume === "function") {
      return workBudget.consume(kind, count);
    }
    return workBudget.overflow !== true;
  }

  function failWorkBudget(workBudget, kind) {
    if (!workBudget) return false;
    if (typeof workBudget.fail === "function") return workBudget.fail(kind);
    workBudget.overflow = true;
    workBudget.overflowAt ||= String(kind || "target_resolution_work");
    return false;
  }

  function targetWorkOverflowResolution(attempts = [], workBudget = {}) {
    return {
      element: null,
      strategy: null,
      value: null,
      confidence: 0,
      mode: "work_budget_exceeded",
      mapperState: "protected_unsupported",
      mapperReason: "component_scan_overflow",
      attempts,
      controlsTreeAttempted: false,
      fuzzyAttempted: false,
      scanDiagnostics: {
        version: "mapper.scan.v1",
        overflow: true,
        reason: "component_scan_overflow",
        overflowKind: "target_resolution_work_budget",
        workCount: Number(workBudget.workCount || 0),
        maxWork: Number(workBudget.maxWork || 0),
        overflowAt: String(workBudget.overflowAt || "target_resolution_work"),
      },
    };
  }

  function normalizeTargetInput(stepOrTarget) {
    if (!stepOrTarget) {
      return {
        primary: null,
        candidates: [],
        fallbacks: [],
        snapshot: null,
      };
    }

    // New AAA shape:
    // {
    //   target: {
    //     primary,
    //     candidates,
    //     snapshot
    //   }
    // }
    if (
      stepOrTarget.target &&
      typeof stepOrTarget.target === "object" &&
      (stepOrTarget.target.primary || stepOrTarget.target.candidates)
    ) {
      const target = stepOrTarget.target;

      return {
        primary: target.primary || null,
        candidates: Array.isArray(target.candidates) ? target.candidates : [],
        fallbacks: Array.isArray(target.fallbacks) ? target.fallbacks : [],
        snapshot: target.snapshot || stepOrTarget.targetSnapshot || null,
      };
    }

    // Transitional shape:
    // {
    //   target: { strategy, value },
    //   targetFallbacks: [...]
    // }
    if (stepOrTarget.target && typeof stepOrTarget.target === "object") {
      const primary = stepOrTarget.target;

      return {
        primary,
        candidates: [primary],
        fallbacks: Array.isArray(stepOrTarget.targetFallbacks)
          ? stepOrTarget.targetFallbacks
          : [],
        snapshot: stepOrTarget.targetSnapshot || null,
      };
    }

    // Direct resolver shape:
    // {
    //   primary,
    //   candidates,
    //   fallbacks,
    //   snapshot
    // }
    if (
      stepOrTarget.primary ||
      stepOrTarget.candidates ||
      stepOrTarget.fallbacks
    ) {
      return {
        primary: stepOrTarget.primary || null,
        candidates: Array.isArray(stepOrTarget.candidates)
          ? stepOrTarget.candidates
          : [],
        fallbacks: Array.isArray(stepOrTarget.fallbacks)
          ? stepOrTarget.fallbacks
          : [],
        snapshot: stepOrTarget.snapshot || null,
      };
    }

    // Legacy shape:
    // {
    //   target: "ctrl_abc123",
    //   targetType: "ctrlHash"
    // }
    if (typeof stepOrTarget.target === "string") {
      const primary = {
        strategy:
          stepOrTarget.targetType || inferLegacyStrategy(stepOrTarget.target),
        value: stepOrTarget.target,
      };

      return {
        primary,
        candidates: [primary],
        fallbacks: Array.isArray(stepOrTarget.targetFallbacks)
          ? stepOrTarget.targetFallbacks
          : [],
        snapshot: stepOrTarget.targetSnapshot || null,
      };
    }

    return {
      primary: null,
      candidates: [],
      fallbacks: [],
      snapshot: null,
    };
  }

  function inferLegacyStrategy(value) {
    if (String(value).startsWith("ctrl_")) {
      return TargetStrategies.CtrlHash;
    }

    return TargetStrategies.FallbackHash;
  }

  function resolveByStrategy(candidate, options = {}) {
    if (!candidate || !candidate.strategy) return null;

    const strategy = candidate.strategy;
    const value = cleanValue(candidate.value);

    if (!value) return null;

    switch (strategy) {
      case TargetStrategies.Id:
        return document.getElementById(value);

      case TargetStrategies.Name:
        return findFirstVisibleMatching(`[name="${escapeCssString(value)}"]`, options);

      case TargetStrategies.AriaLabel:
        return findFirstVisibleMatching(`[aria-label="${escapeCssString(value)}"]`, options);

      case TargetStrategies.DataTestId:
      case TargetStrategies.DataTest:
      case TargetStrategies.DataQa:
        return findFirstVisibleMatching(`[${strategy}="${escapeCssString(value)}"]`, options);

      case TargetStrategies.LabelText:
        return resolveByLabelText(value, options);

      case TargetStrategies.Text:
        return resolveByText(value, options);

      case TargetStrategies.CssSelector:
        return findFirstVisibleMatching(value, options);

      case TargetStrategies.CtrlHash:
      case TargetStrategies.FallbackHash:
        return resolveByCtrlHash(value);

      case "placeholder":
        return findFirstVisibleMatching(`[placeholder="${escapeCssString(value)}"]`, options);

      case "title":
        return findFirstVisibleMatching(`[title="${escapeCssString(value)}"]`, options);

      case "data-cy":
      case "data-automation-id":
      case "data-component":
        return findFirstVisibleMatching(`[${strategy}="${escapeCssString(value)}"]`, options);

      case "role_text": {
        const [role, text] = value.split("::");
        return findFirstVisibleMatching(`[role="${escapeCssString(role)}"]`, {
          ...options,
          predicate: (element) => {
            return normalizeText(getStableElementText(element, options)) ===
              normalizeText(text);
          },
        });
      }

      case "form_context":
        return resolveByFormContext(value, options);

      case "dom_path":
        return resolveByDomPath(value, options);

      default:
        return null;
    }
  }

  function resolveByCtrlHash(value) {
    return (
      document.querySelector(`[data-brunner-id="${escapeCssString(value)}"]`) ||
      document.querySelector(
        `[data-brunner-fallback="${escapeCssString(value)}"]`,
      ) ||
      null
    );
  }

  function resolveByLabelText(value, options = {}) {
    const expected = normalizeText(value);

    const labels = enumerateBoundedElements("label", options);
    for (const label of labels) {
      const text = normalizeText(getBoundedElementText(label, {
        ...options,
        maxChars: 160,
      }));

      if (text !== expected) continue;

      const forId = label.getAttribute("for");
      if (forId) {
        const byFor = document.getElementById(forId);
        if (isVisibleElement(byFor)) return byFor;
      }

      const nestedControl = findFirstVisibleMatching(
        "input, textarea, select, button, [role='button'], [contenteditable='true']",
        { ...options, root: label },
      );

      if (isVisibleElement(nestedControl)) return nestedControl;
    }

    return null;
  }

  function resolveByText(value, options = {}) {
    const expected = normalizeText(value);

    const selectors = [
      "button",
      "a",
      "[role='button']",
      "input[type='button']",
      "input[type='submit']",
      "textarea",
      "select",
    ];

    return findFirstVisibleMatching(selectors.join(","), {
      ...options,
      predicate: (element) => {
        const text = getStableElementText(element, options);
        return normalizeText(text) === expected;
      },
    });
  }

  function firstVisible(collection) {
    return Array.from(collection).find(isVisibleElement) || null;
  }

  function safeQuerySelector(selector) {
    try {
      const element = document.querySelector(selector);
      return isVisibleElement(element) ? element : null;
    } catch {
      return null;
    }
  }

  function buildElementSnapshot(element, options = {}) {
    if (!isElement(element)) return null;

    const rect = element.getBoundingClientRect();

    return {
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role") || "",
      type: element.getAttribute("type") || "",
      id: element.id || "",
      name: element.getAttribute("name") || "",
      ariaLabel: element.getAttribute("aria-label") || "",
      placeholder: element.getAttribute("placeholder") || "",
      title: element.getAttribute("title") || "",
      text: getStableElementText(element, options),
      value: getSafeValue(element),
      href: element.getAttribute("href") || "",
      classes: Array.from(element.classList || []).slice(0, 8),
      domPath: buildDomPath(element, options),
      nearbyText: getNearbyText(element, options),
      bounds: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  }

  function getAssociatedLabelText(element, options = {}) {
    if (!isElement(element)) return "";

    const labels = element.labels || [];
    for (let index = 0; index < Number(labels.length || 0); index += 1) {
      if (!consumeWork(options.workBudget, "target_label_reference")) return "";
      const label = labels[index];
      const text = getBoundedElementText(label, {
        ...options,
        maxChars: 160,
      });
      if (text) return text;
    }

    const wrappingLabel = boundedClosest(
      element,
      "label",
      options.workBudget,
      "target_label_ancestor",
    );
    if (wrappingLabel) {
      const text = getBoundedElementText(wrappingLabel, {
        ...options,
        maxChars: 160,
      });
      if (text) return text;
    }

    return "";
  }

  function getStableElementText(element, options = {}) {
    if (!isElement(element)) return "";

    const tag = element.tagName.toLowerCase();

    if (tag === "input") {
      const type = (element.getAttribute("type") || "").toLowerCase();

      if (["button", "submit", "reset"].includes(type)) {
        return cleanValue(element.value || element.getAttribute("value"));
      }

      return "";
    }

    const role = (element.getAttribute("role") || "").toLowerCase();
    const isTextSafe =
      ["button", "a", "summary", "option"].includes(tag) ||
      ["button", "link", "menuitem", "tab"].includes(role);

    if (!isTextSafe) return "";

    const text = getBoundedElementText(element, {
      ...options,
      maxChars: 81,
    });

    if (!text) return "";
    if (text.length > 80) return "";

    return text;
  }

  function buildStableCssSelector(element, options = {}) {
    if (!isElement(element)) return "";

    if (element.id) {
      return `#${cssEscape(element.id)}`;
    }

    const parts = [];
    let current = element;
    let anchored = false;

    while (
      current &&
      current.nodeType === Node.ELEMENT_NODE &&
      parts.length < 5
    ) {
      let part = current.tagName.toLowerCase();

      const name = current.getAttribute("name");
      if (name) {
        part += `[name="${escapeCssString(name)}"]`;
        parts.unshift(part);
        anchored = true;
        break;
      }

      const testId =
        current.getAttribute("data-testid") ||
        current.getAttribute("data-test") ||
        current.getAttribute("data-qa");

      if (testId) {
        const attrName = current.getAttribute("data-testid")
          ? "data-testid"
          : current.getAttribute("data-test")
            ? "data-test"
            : "data-qa";

        part += `[${attrName}="${escapeCssString(testId)}"]`;
        parts.unshift(part);
        anchored = true;
        break;
      }

      const parent = current.parentElement;

      if (parent) {
        const siblingPosition = getSameTagSiblingPosition(
          current,
          options.workBudget,
        );
        if (siblingPosition.count > 1) {
          const index = siblingPosition.index;
          part += `:nth-of-type(${index})`;
        }
      }

      parts.unshift(part);
      current = parent;
    }

    // An unanchored selector is only valid when it reaches the document root.
    // Silently returning the final five segments can select an arbitrary match
    // elsewhere on the page, so omit that locator instead.
    if (!anchored && current) return "";

    return parts.join(" > ");
  }

  function boundedClosest(element, selector, workBudget, kind = "target_ancestor") {
    if (!isElement(element) || !selector) return null;
    let current = element;
    while (current) {
      if (!consumeWork(workBudget, kind)) return null;
      try {
        if (current.matches(selector)) return current;
      } catch {
        return null;
      }
      current = current.parentElement;
    }
    return null;
  }

  function getElementSiblingIndex(element, workBudget, kind = "target_sibling") {
    const parent = element?.parentElement;
    if (!parent) return 0;
    let index = 0;
    let current = parent.firstElementChild;
    while (current) {
      if (!consumeWork(workBudget, kind)) return -1;
      if (current === element) return index;
      index += 1;
      current = current.nextElementSibling;
    }
    return -1;
  }

  function getSameTagSiblingPosition(element, workBudget) {
    const parent = element?.parentElement;
    if (!parent) return { count: 1, index: 1 };
    let count = 0;
    let index = 0;
    let current = parent.firstElementChild;
    while (current) {
      if (!consumeWork(workBudget, "target_css_sibling")) {
        return { count: 0, index: 0 };
      }
      if (current.tagName === element.tagName) {
        count += 1;
        if (current === element) index = count;
      }
      current = current.nextElementSibling;
    }
    return { count, index };
  }

  function getBoundedElementText(element, options = {}) {
    if (!isElement(element)) return "";
    const workBudget = options.workBudget || createTargetWorkBudget(options.maxWork);
    const maxChars = Math.min(1000, Math.max(1, Number(options.maxChars) || 300));
    const skipSelector = [
      "script",
      "style",
      "noscript",
      "template",
      options.skipSelector || "",
    ].filter(Boolean).join(",");
    let text = "";
    let current = element.firstChild || null;

    while (current) {
      if (!consumeWork(workBudget, "target_text_descendant")) return "";
      const isElementNode = current.nodeType === 1;
      const skipChildren = isElementNode && (() => {
        try {
          return current.matches?.(skipSelector) === true;
        } catch {
          return false;
        }
      })();
      if (current.nodeType === 3) {
        text += ` ${String(current.nodeValue || "").slice(0, maxChars + 1)}`;
        if (cleanValue(text).replace(/\s+/g, " ").length > maxChars) break;
      }

      if (!skipChildren && current.firstChild) {
        current = current.firstChild;
        continue;
      }
      while (current && current !== element && !current.nextSibling) {
        current = current.parentNode;
      }
      current = !current || current === element ? null : current.nextSibling;
    }

    const normalized = cleanValue(text).replace(/\s+/g, " ");
    return normalized.slice(0, maxChars + 1);
  }

  function enumerateBoundedElements(selector, options = {}) {
    const elements = [];
    const root = options.root || document;
    let walker;
    try {
      const ownerDocument = root.ownerDocument || document;
      walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      root.documentElement?.matches?.(selector);
    } catch {
      return elements;
    }
    let element = walker.nextNode();
    while (element) {
      if (!consumeWork(options.workBudget, "target_dom_visit")) break;
      try {
        if (element.matches?.(selector)) elements.push(element);
      } catch {
        return [];
      }
      element = walker.nextNode();
    }
    return elements;
  }

  function findFirstVisibleMatching(selector, options = {}) {
    const root = options.root || document;
    let walker;
    try {
      const ownerDocument = root.ownerDocument || document;
      walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      root.documentElement?.matches?.(selector);
    } catch {
      return null;
    }
    let element = walker.nextNode();
    while (element) {
      if (!consumeWork(options.workBudget, "target_dom_visit")) return null;
      let matches = false;
      try {
        matches = element.matches?.(selector) === true;
      } catch {
        return null;
      }
      if (
        matches &&
        (options.includeHidden === true || isVisibleElement(element)) &&
        (typeof options.predicate !== "function" || options.predicate(element))
      ) {
        return element;
      }
      element = walker.nextNode();
    }
    return null;
  }

  function isElement(value) {
    return value instanceof Element;
  }

  function isVisibleElement(element) {
    if (!isElement(element)) return false;

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none"
    );
  }

  function cleanValue(value) {
    return String(value || "").trim();
  }

  function normalizeText(value) {
    return cleanValue(value).replace(/\s+/g, " ").toLowerCase();
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }

    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function escapeCssString(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function getSafeValue(element) {
    if (!isElement(element)) return "";

    const tag = element.tagName.toLowerCase();

    if (tag === "input") {
      const type = (element.getAttribute("type") || "").toLowerCase();

      if (["button", "submit", "reset"].includes(type)) {
        return cleanValue(element.value || element.getAttribute("value"));
      }

      return "";
    }

    return "";
  }

  function getNearbyText(element, options = {}) {
    if (!isElement(element)) return "";

    let container = options.formResolved === true ? options.form || null : null;
    if (!container) {
      let section = null;
      let main = null;
      let current = element;
      while (current) {
        if (!consumeWork(options.workBudget, "target_nearby_ancestor")) return "";
        if (!section && current.matches?.("section")) section = current;
        if (!main && current.matches?.("main")) main = current;
        current = current.parentElement;
      }
      container = section || main || element.parentElement;
    }

    if (!container) return "";

    return getBoundedElementText(container, {
      ...options,
      maxChars: 300,
    });
  }

  function snapshotLooksCompatible(element, snapshot, options = {}) {
    if (!snapshot || !isElement(element)) return true;

    let score = 0;
    let possible = 0;

    possible += 2;
    if (element.tagName.toLowerCase() === snapshot.tag) score += 2;

    if (snapshot.type) {
      possible += 1;
      if ((element.getAttribute("type") || "") === snapshot.type) score += 1;
    }

    if (snapshot.role) {
      possible += 1;
      if ((element.getAttribute("role") || "") === snapshot.role) score += 1;
    }

    if (snapshot.text) {
      possible += 2;
      if (
        normalizeText(getStableElementText(element, options)) ===
        normalizeText(snapshot.text)
      ) {
        score += 2;
      }
    }

    if (snapshot.ariaLabel) {
      possible += 2;
      if (
        normalizeText(element.getAttribute("aria-label") || "") ===
        normalizeText(snapshot.ariaLabel)
      ) {
        score += 2;
      }
    }

    if (snapshot.placeholder) {
      possible += 1;
      if (
        normalizeText(element.getAttribute("placeholder") || "") ===
        normalizeText(snapshot.placeholder)
      ) {
        score += 1;
      }
    }

    // If there was not much to compare, do not reject.
    if (possible <= 2) return true;

    return score / possible >= 0.45;
  }

  function resolveBySnapshotFuzzy(snapshot, options = {}) {
    if (!snapshot) {
      return {
        element: null,
        score: 0,
        reason: "no_snapshot",
      };
    }

    const candidates = enumerateBoundedElements(
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
      options,
    );

    let best = {
      element: null,
      score: 0,
      reason: "",
    };

    for (const element of candidates) {
      if (!consumeWork(options.workBudget, "target_fuzzy_candidate")) break;
      if (!isVisibleElement(element)) continue;
      const result = scoreElementAgainstSnapshot(element, snapshot, options);

      if (result.score > best.score) {
        best = {
          element,
          score: result.score,
          reason: result.reason,
        };
      }
    }

    if (best.score < 45) {
      return {
        element: null,
        score: best.score,
        reason: "below_threshold",
      };
    }

    return best;
  }

  function scoreElementAgainstSnapshot(element, snapshot, options = {}) {
    let score = 0;
    const reasons = [];

    const tag = element.tagName.toLowerCase();

    if (snapshot.tag && tag === snapshot.tag) {
      score += 15;
      reasons.push("tag");
    }

    if (snapshot.type && element.getAttribute("type") === snapshot.type) {
      score += 10;
      reasons.push("type");
    }

    if (
      snapshot.role &&
      normalizeText(element.getAttribute("role") || "") ===
        normalizeText(snapshot.role)
    ) {
      score += 10;
      reasons.push("role");
    }

    if (
      snapshot.text &&
      normalizeText(getStableElementText(element, options)) ===
        normalizeText(snapshot.text)
    ) {
      score += 25;
      reasons.push("text");
    }

    if (
      snapshot.ariaLabel &&
      normalizeText(element.getAttribute("aria-label") || "") ===
        normalizeText(snapshot.ariaLabel)
    ) {
      score += 25;
      reasons.push("ariaLabel");
    }

    if (
      snapshot.placeholder &&
      normalizeText(element.getAttribute("placeholder") || "") ===
        normalizeText(snapshot.placeholder)
    ) {
      score += 20;
      reasons.push("placeholder");
    }

    if (
      snapshot.name &&
      normalizeText(element.getAttribute("name") || "") ===
        normalizeText(snapshot.name)
    ) {
      score += 20;
      reasons.push("name");
    }

    const nearbyText = getNearbyText(element, options);

    if (
      snapshot.nearbyText &&
      nearbyText &&
      textOverlapScore(snapshot.nearbyText, nearbyText) > 0.35
    ) {
      score += 10;
      reasons.push("nearbyText");
    }

    return {
      score,
      reason: reasons.join("+") || "weak_match",
    };
  }

  function textOverlapScore(a, b) {
    const wordsA = new Set(
      normalizeText(a)
        .split(/\s+/)
        .filter((word) => word.length > 2),
    );

    const wordsB = new Set(
      normalizeText(b)
        .split(/\s+/)
        .filter((word) => word.length > 2),
    );

    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let overlap = 0;

    for (const word of wordsA) {
      if (wordsB.has(word)) overlap++;
    }

    return overlap / Math.max(wordsA.size, wordsB.size);
  }

  function resolveByFormContext(value, options = {}) {
    if (!value) return null;

    // Only use normal CSS part. Custom ::text(...) is intentionally ignored here.
    const cssPart = value.replace(/::text\(.*\)$/i, "");

    return findFirstVisibleMatching(cssPart, options);
  }

  function resolveByDomPath(path, options = {}) {
    if (!path) return null;

    const parts = String(path).split("/").filter(Boolean);
    let current = document.documentElement;

    for (const part of parts) {
      if (!consumeWork(options.workBudget, "target_saved_dom_path")) return null;
      const [tag, indexText] = part.split(":");
      const index = Number(indexText);

      if (!current || !tag || Number.isNaN(index)) return null;

      const next = current.children?.[index];

      if (!next || next.tagName.toLowerCase() !== tag) {
        return null;
      }

      current = next;
    }

    return isVisibleElement(current) ? current : null;
  }

  window.BRunnerTargetResolver = {
    TargetStrategies,
    buildElementTarget,
    resolveRecordedTarget,
    resolveFromControlsTree,
    resolveByStrategy,
    getStableElementText,
    getBoundedElementText,
    buildStableCssSelector,
  };
})();
