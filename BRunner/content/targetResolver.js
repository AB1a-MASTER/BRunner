// content/targetResolver.js
// Shared DOM target generation and resolution logic for recorder + executor.
// Loaded before mapper.js by manifest.json.

(function () {
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

  function buildElementTarget(element, ctrlHash = "") {
    const candidates = [];

    if (!isElement(element)) {
      return {
        primary: null,
        candidates: [],
        fallbacks: [],
        snapshot: null,
      };
    }

    addCandidate(candidates, TargetStrategies.Id, element.id, 100);

    addCandidate(
      candidates,
      TargetStrategies.Name,
      element.getAttribute("name"),
      95,
    );

    addCandidate(
      candidates,
      TargetStrategies.AriaLabel,
      element.getAttribute("aria-label"),
      92,
    );

    addCandidate(
      candidates,
      "placeholder",
      element.getAttribute("placeholder"),
      86,
    );

    addCandidate(candidates, "title", element.getAttribute("title"), 84);

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

    const labelText = getAssociatedLabelText(element);
    addCandidate(candidates, TargetStrategies.LabelText, labelText, 82);

    const stableText = getStableElementText(element);
    addCandidate(candidates, TargetStrategies.Text, stableText, 76);

    const role = element.getAttribute("role");
    if (role && stableText) {
      addCandidate(candidates, "role_text", `${role}::${stableText}`, 74);
    }

    const formContextSelector = buildFormContextSelector(element);
    addCandidate(candidates, "form_context", formContextSelector, 72);

    const cssSelector = buildStableCssSelector(element);
    addCandidate(candidates, TargetStrategies.CssSelector, cssSelector, 68);

    const domPath = buildDomPath(element);
    addCandidate(candidates, "dom_path", domPath, 55);

    if (ctrlHash) {
      addCandidate(candidates, TargetStrategies.CtrlHash, ctrlHash, 40);
    }

    const uniqueCandidates = dedupeCandidates(candidates);

    return {
      primary: uniqueCandidates[0] || null,
      candidates: uniqueCandidates,
      fallbacks: uniqueCandidates.slice(1),
      snapshot: buildElementSnapshot(element),
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

  function buildDomPath(element) {
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
      const index = Array.from(parent.children).indexOf(current);

      parts.unshift(`${tag}:${index}`);
      current = parent;
    }

    return parts.join("/");
  }

  function buildFormContextSelector(element) {
    if (!isElement(element)) return "";

    const form = element.closest("form");
    if (!form) return "";

    const elementTag = element.tagName.toLowerCase();
    const elementType = element.getAttribute("type");
    const elementText = getStableElementText(element);

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

  function resolveRecordedTarget(stepOrTarget, controlsTree = null) {
    const target = normalizeTargetInput(stepOrTarget);
    const attempts = [];

    const candidates = dedupeCandidates([
      ...(target.primary ? [target.primary] : []),
      ...(Array.isArray(target.candidates) ? target.candidates : []),
      ...(Array.isArray(target.fallbacks) ? target.fallbacks : []),
    ]);

    for (const candidate of candidates) {
      const element = resolveByStrategy(candidate);
      const compatible =
        element && snapshotLooksCompatible(element, target.snapshot);

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
          confidence: candidate.score || 0,
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
    );

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

    const fuzzy = resolveBySnapshotFuzzy(target.snapshot);

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

  function resolveFromControlsTree(controlsTree, candidates, snapshot) {
    const controls = normalizeControlsTree(controlsTree);

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
      const control = controls.find((item) => item.id === candidate.value);

      if (
        control?.element &&
        isVisibleElement(control.element) &&
        snapshotLooksCompatible(control.element, snapshot)
      ) {
        return {
          element: control.element,
          strategy: "controls_tree_hash",
          value: candidate.value,
          confidence: candidate.score || 0,
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
      if (!control?.element || !isVisibleElement(control.element)) continue;

      const result = scoreElementAgainstSnapshot(control.element, snapshot);

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

  function normalizeControlsTree(controlsTree) {
    if (controlsTree instanceof Map) {
      return Array.from(controlsTree.values());
    }

    if (Array.isArray(controlsTree)) {
      return controlsTree;
    }

    return [];
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
        candidates: [
          primary,
          ...(Array.isArray(stepOrTarget.targetFallbacks)
            ? stepOrTarget.targetFallbacks
            : []),
        ],
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
        candidates: [
          primary,
          ...(Array.isArray(stepOrTarget.targetFallbacks)
            ? stepOrTarget.targetFallbacks
            : []),
        ],
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

  function resolveByStrategy(candidate) {
    if (!candidate || !candidate.strategy) return null;

    const strategy = candidate.strategy;
    const value = cleanValue(candidate.value);

    if (!value) return null;

    switch (strategy) {
      case TargetStrategies.Id:
        return document.getElementById(value);

      case TargetStrategies.Name:
        return firstVisible(document.getElementsByName(value));

      case TargetStrategies.AriaLabel:
        return firstVisible(
          document.querySelectorAll(`[aria-label="${escapeCssString(value)}"]`),
        );

      case TargetStrategies.DataTestId:
      case TargetStrategies.DataTest:
      case TargetStrategies.DataQa:
        return firstVisible(
          document.querySelectorAll(
            `[${strategy}="${escapeCssString(value)}"]`,
          ),
        );

      case TargetStrategies.LabelText:
        return resolveByLabelText(value);

      case TargetStrategies.Text:
        return resolveByText(value);

      case TargetStrategies.CssSelector:
        return safeQuerySelector(value);

      case TargetStrategies.CtrlHash:
      case TargetStrategies.FallbackHash:
        return resolveByCtrlHash(value);

      case "placeholder":
        return firstVisible(
          document.querySelectorAll(
            `[placeholder="${escapeCssString(value)}"]`,
          ),
        );

      case "title":
        return firstVisible(
          document.querySelectorAll(`[title="${escapeCssString(value)}"]`),
        );

      case "data-cy":
      case "data-automation-id":
      case "data-component":
        return firstVisible(
          document.querySelectorAll(
            `[${strategy}="${escapeCssString(value)}"]`,
          ),
        );

      case "role_text": {
        const [role, text] = value.split("::");
        return firstVisible(
          Array.from(
            document.querySelectorAll(`[role="${escapeCssString(role)}"]`),
          ).filter((element) => {
            return (
              normalizeText(getStableElementText(element)) ===
              normalizeText(text)
            );
          }),
        );
      }

      case "form_context":
        return resolveByFormContext(value);

      case "dom_path":
        return resolveByDomPath(value);

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

  function resolveByLabelText(value) {
    const expected = normalizeText(value);

    const labels = Array.from(document.querySelectorAll("label"));
    for (const label of labels) {
      const text = normalizeText(label.innerText || label.textContent || "");

      if (text !== expected) continue;

      const forId = label.getAttribute("for");
      if (forId) {
        const byFor = document.getElementById(forId);
        if (isVisibleElement(byFor)) return byFor;
      }

      const nestedControl = label.querySelector(
        "input, textarea, select, button, [role='button'], [contenteditable='true']",
      );

      if (isVisibleElement(nestedControl)) return nestedControl;
    }

    return null;
  }

  function resolveByText(value) {
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

    const elements = Array.from(document.querySelectorAll(selectors.join(",")));

    return (
      elements.find((element) => {
        if (!isVisibleElement(element)) return false;

        const text = getStableElementText(element);
        return normalizeText(text) === expected;
      }) || null
    );
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

  function buildElementSnapshot(element) {
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
      text: getStableElementText(element),
      value: getSafeValue(element),
      href: element.getAttribute("href") || "",
      classes: Array.from(element.classList || []).slice(0, 8),
      domPath: buildDomPath(element),
      nearbyText: getNearbyText(element),
      bounds: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  }

  function getAssociatedLabelText(element) {
    if (!isElement(element)) return "";

    if (element.id) {
      const label = document.querySelector(
        `label[for="${escapeCssString(element.id)}"]`,
      );

      const text = cleanValue(label?.innerText || label?.textContent || "");
      if (text) return text;
    }

    const wrappingLabel = element.closest("label");
    if (wrappingLabel) {
      const text = cleanValue(
        wrappingLabel.innerText || wrappingLabel.textContent || "",
      );
      if (text) return text;
    }

    return "";
  }

  function getStableElementText(element) {
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

    const text = cleanValue(element.innerText || element.textContent || "");

    if (!text) return "";
    if (text.length > 80) return "";

    return text;
  }

  function buildStableCssSelector(element) {
    if (!isElement(element)) return "";

    if (element.id) {
      return `#${cssEscape(element.id)}`;
    }

    const parts = [];
    let current = element;

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
        break;
      }

      const parent = current.parentElement;

      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (sibling) => sibling.tagName === current.tagName,
        );

        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          part += `:nth-of-type(${index})`;
        }
      }

      parts.unshift(part);
      current = parent;
    }

    return parts.join(" > ");
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

  function getNearbyText(element) {
    if (!isElement(element)) return "";

    const container =
      element.closest("form") ||
      element.closest("section") ||
      element.closest("main") ||
      element.parentElement;

    if (!container) return "";

    return cleanValue(container.innerText || container.textContent || "")
      .replace(/\s+/g, " ")
      .slice(0, 300);
  }

  function snapshotLooksCompatible(element, snapshot) {
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
        normalizeText(getStableElementText(element)) ===
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

  function resolveBySnapshotFuzzy(snapshot) {
    if (!snapshot) {
      return {
        element: null,
        score: 0,
        reason: "no_snapshot",
      };
    }

    const candidates = Array.from(
      document.querySelectorAll(
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
      ),
    ).filter(isVisibleElement);

    let best = {
      element: null,
      score: 0,
      reason: "",
    };

    for (const element of candidates) {
      const result = scoreElementAgainstSnapshot(element, snapshot);

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

  function scoreElementAgainstSnapshot(element, snapshot) {
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
      normalizeText(getStableElementText(element)) ===
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

    const nearbyText = getNearbyText(element);

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

  function resolveByFormContext(value) {
    if (!value) return null;

    // Only use normal CSS part. Custom ::text(...) is intentionally ignored here.
    const cssPart = value.replace(/::text\(.*\)$/i, "");

    return safeQuerySelector(cssPart);
  }

  function resolveByDomPath(path) {
    if (!path) return null;

    const parts = String(path).split("/").filter(Boolean);
    let current = document.documentElement;

    for (const part of parts) {
      const [tag, indexText] = part.split(":");
      const index = Number(indexText);

      if (!current || !tag || Number.isNaN(index)) return null;

      const children = Array.from(current.children);
      const next = children[index];

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
    buildStableCssSelector,
  };
})();
