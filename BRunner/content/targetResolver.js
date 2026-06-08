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
        fallbacks: [],
        snapshot: null,
      };
    }

    const id = cleanValue(element.id);
    if (id) {
      candidates.push({
        strategy: TargetStrategies.Id,
        value: id,
        confidence: 1,
      });
    }

    const name = cleanValue(element.getAttribute("name"));
    if (name) {
      candidates.push({
        strategy: TargetStrategies.Name,
        value: name,
        confidence: 0.95,
      });
    }

    const ariaLabel = cleanValue(element.getAttribute("aria-label"));
    if (ariaLabel) {
      candidates.push({
        strategy: TargetStrategies.AriaLabel,
        value: ariaLabel,
        confidence: 0.9,
      });
    }

    for (const attr of [
      TargetStrategies.DataTestId,
      TargetStrategies.DataTest,
      TargetStrategies.DataQa,
    ]) {
      const value = cleanValue(element.getAttribute(attr));
      if (value) {
        candidates.push({
          strategy: attr,
          value,
          confidence: 0.88,
        });
      }
    }

    const labelText = getAssociatedLabelText(element);
    if (labelText) {
      candidates.push({
        strategy: TargetStrategies.LabelText,
        value: labelText,
        confidence: 0.82,
      });
    }

    const stableText = getStableElementText(element);
    if (stableText) {
      candidates.push({
        strategy: TargetStrategies.Text,
        value: stableText,
        confidence: 0.72,
      });
    }

    const cssSelector = buildStableCssSelector(element);
    if (cssSelector) {
      candidates.push({
        strategy: TargetStrategies.CssSelector,
        value: cssSelector,
        confidence: 0.62,
      });
    }

    if (ctrlHash) {
      candidates.push({
        strategy: TargetStrategies.CtrlHash,
        value: ctrlHash,
        confidence: 0.45,
      });
    }

    return {
      primary: candidates[0] || null,
      fallbacks: candidates.slice(1),
      snapshot: buildElementSnapshot(element),
    };
  }

  function resolveRecordedTarget(stepOrTarget) {
    const target = normalizeTargetInput(stepOrTarget);
    const candidates = [];

    if (target.primary) candidates.push(target.primary);
    if (Array.isArray(target.fallbacks)) candidates.push(...target.fallbacks);

    for (const candidate of candidates) {
      const element = resolveByStrategy(candidate);

      if (element) {
        return {
          element,
          strategy: candidate.strategy,
          value: candidate.value,
        };
      }
    }

    return {
      element: null,
      strategy: null,
      value: null,
    };
  }

  function normalizeTargetInput(stepOrTarget) {
    if (!stepOrTarget) {
      return {
        primary: null,
        fallbacks: [],
      };
    }

    // New preferred shape:
    // {
    //   target: { strategy, value },
    //   targetFallbacks: [...]
    // }
    if (stepOrTarget.target && typeof stepOrTarget.target === "object") {
      return {
        primary: stepOrTarget.target,
        fallbacks: Array.isArray(stepOrTarget.targetFallbacks)
          ? stepOrTarget.targetFallbacks
          : [],
      };
    }

    // Direct resolver shape:
    // {
    //   primary: { strategy, value },
    //   fallbacks: [...]
    // }
    if (stepOrTarget.primary || stepOrTarget.fallbacks) {
      return {
        primary: stepOrTarget.primary || null,
        fallbacks: Array.isArray(stepOrTarget.fallbacks)
          ? stepOrTarget.fallbacks
          : [],
      };
    }

    // Legacy shape:
    // {
    //   target: "ctrl_abc123",
    //   targetType: "ctrlHash"
    // }
    if (typeof stepOrTarget.target === "string") {
      return {
        primary: {
          strategy:
            stepOrTarget.targetType || inferLegacyStrategy(stepOrTarget.target),
          value: stepOrTarget.target,
        },
        fallbacks: Array.isArray(stepOrTarget.targetFallbacks)
          ? stepOrTarget.targetFallbacks
          : [],
      };
    }

    return {
      primary: null,
      fallbacks: [],
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
      text: getStableElementText(element),
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

  window.BRunnerTargetResolver = {
    TargetStrategies,
    buildElementTarget,
    resolveRecordedTarget,
    resolveByStrategy,
    getStableElementText,
    buildStableCssSelector,
  };
})();
