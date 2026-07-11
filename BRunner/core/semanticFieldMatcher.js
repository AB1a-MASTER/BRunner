const DEFAULT_MINIMUM_SCORE = 72;
const DEFAULT_MINIMUM_MARGIN = 12;

const FIELD_ALIASES = Object.freeze({
  first_name: ["first name", "firstname", "given name", "forename"],
  last_name: ["last name", "lastname", "family name", "surname"],
  full_name: ["full name", "name", "your name", "contact name"],
  email: ["email", "email address", "e mail"],
  phone: ["phone", "phone number", "telephone", "mobile", "mobile number"],
  company: ["company", "company name", "organization", "organisation", "business"],
  address_line_1: ["address", "address line 1", "street", "street address"],
  address_line_2: ["address line 2", "apartment", "apt", "suite", "unit"],
  city: ["city", "town", "locality"],
  state: ["state", "province", "region", "county"],
  postal_code: ["postal code", "postcode", "zip", "zip code"],
  country: ["country", "country region", "nation"],
  subject: ["subject", "topic", "title"],
  message: ["message", "description", "details", "comments", "comment", "body"],
  username: ["username", "user name", "login", "login name"],
  password: ["password", "passcode", "pin"],
});

const ALIAS_LOOKUP = new Map(Object.entries(FIELD_ALIASES).flatMap(([canonical, aliases]) => {
  return aliases.map((alias) => [normalizeText(alias), canonical]);
}));

export function matchSemanticFields({ data = {}, controls = [], metadata = {} } = {}, options = {}) {
  const minimumScore = boundedNumber(options.minimumScore, 0, 100, DEFAULT_MINIMUM_SCORE);
  const minimumMargin = boundedNumber(options.minimumMargin, 0, 100, DEFAULT_MINIMUM_MARGIN);
  const fields = normalizeDataFields(data, metadata);
  const candidates = [];

  fields.forEach((field) => {
    controls.forEach((control, index) => {
      const normalizedControl = normalizeControl(control, index);
      const result = scoreSemanticField(field, normalizedControl);
      if (!result.disqualified) {
        candidates.push({ field, control: normalizedControl, ...result });
      }
    });
  });

  const rankedByField = groupRanked(candidates, (candidate) => candidate.field.key);
  const rankedByControl = groupRanked(candidates, (candidate) => candidate.control.id);
  const accepted = [];
  const usedFields = new Set();
  const usedControls = new Set();
  const ambiguous = [];

  candidates
    .slice()
    .sort(compareCandidates)
    .forEach((candidate) => {
      if (usedFields.has(candidate.field.key) || usedControls.has(candidate.control.id)) return;
      const fieldRanking = rankedByField.get(candidate.field.key) || [];
      const controlRanking = rankedByControl.get(candidate.control.id) || [];
      if (fieldRanking[0] !== candidate || controlRanking[0] !== candidate) return;

      const fieldMargin = candidate.score - (fieldRanking[1]?.score || 0);
      const controlMargin = candidate.score - (controlRanking[1]?.score || 0);
      const margin = Math.min(fieldMargin, controlMargin);
      if (candidate.score < minimumScore) return;
      if (margin < minimumMargin) {
        ambiguous.push({
          dataKey: candidate.field.key,
          controlId: candidate.control.id,
          score: candidate.score,
          margin,
          reason: "semantic_margin_too_small",
        });
        return;
      }

      usedFields.add(candidate.field.key);
      usedControls.add(candidate.control.id);
      accepted.push({
        dataKey: candidate.field.key,
        controlId: candidate.control.id,
        componentId: candidate.control.componentId,
        value: candidate.field.value,
        score: candidate.score,
        margin,
        evidence: candidate.evidence,
        inputType: candidate.control.inputType,
      });
    });

  return {
    mappings: accepted,
    ambiguous,
    unmatchedDataKeys: fields
      .map((field) => field.key)
      .filter((key) => !usedFields.has(key)),
    unmatchedControlIds: controls
      .map((control, index) => normalizeControl(control, index).id)
      .filter((id) => !usedControls.has(id)),
    policy: { minimumScore, minimumMargin },
  };
}

export function scoreSemanticField(field = {}, control = {}) {
  const normalizedField = field.normalized
    ? field
    : normalizeDataFields({ [field.key || "field"]: field.value }, {})[0];
  const normalizedControl = control.terms
    ? control
    : normalizeControl(control, 0);

  if (isSensitiveMismatch(normalizedField, normalizedControl)) {
    return { score: 0, evidence: ["sensitive_type_mismatch"], disqualified: true };
  }

  const evidence = [];
  let score = 0;
  const fieldTerms = normalizedField.terms;
  const controlTerms = normalizedControl.terms;

  if (fieldTerms.some((term) => controlTerms.includes(term))) {
    score = 100;
    evidence.push("exact_semantic_text");
  } else if (
    normalizedField.canonical &&
    normalizedControl.canonicals.includes(normalizedField.canonical)
  ) {
    score = 96;
    evidence.push("canonical_alias");
  } else {
    const overlap = bestTokenSimilarity(fieldTerms, controlTerms);
    score = Math.round(overlap * 82);
    if (overlap) evidence.push("token_overlap");
  }

  if (normalizedField.description && controlTerms.includes(normalizedField.description)) {
    score = Math.max(score, 94);
    evidence.push("metadata_description");
  }
  if (typeCompatible(normalizedField.value, normalizedControl)) {
    score = Math.min(100, score + 4);
    evidence.push("type_compatible");
  }
  if (normalizedControl.required) {
    score = Math.min(100, score + 1);
    evidence.push("required_control");
  }

  return { score, evidence, disqualified: false };
}

function normalizeDataFields(data, metadata) {
  return Object.entries(data || {}).map(([key, value]) => {
    const normalized = normalizeText(key);
    const description = normalizeText(metadata?.[key]?.description || metadata?.[key]?.title || "");
    const terms = unique([normalized, description].filter(Boolean));
    return {
      key,
      value,
      normalized,
      description,
      terms,
      canonical: canonicalField(normalized) || canonicalField(description),
    };
  });
}

function normalizeControl(control = {}, index = 0) {
  const semantic = control.semantic || control.fingerprint?.semantic || {};
  const structural = control.structural || control.fingerprint?.structural || {};
  const terms = unique([
    semantic.accessibleName,
    semantic.labelText,
    semantic.placeholder,
    semantic.title,
    semantic.name,
    semantic.stableText,
    structural.nearbyLabel,
    structural.formName,
    control.displayName,
  ].map(normalizeText).filter(Boolean));
  return {
    id: String(control.id || control.componentId || `control_${index + 1}`),
    componentId: String(control.componentId || control.id || ""),
    terms,
    canonicals: unique(terms.map(canonicalField).filter(Boolean)),
    inputType: normalizeText(semantic.inputType || control.inputType || control.type),
    role: normalizeText(semantic.role || control.role),
    tag: normalizeText(control.technical?.tag || control.fingerprint?.technical?.tag || control.tag),
    required: control.required === true || semantic.stableAttributes?.required === "true",
  };
}

function canonicalField(value) {
  return ALIAS_LOOKUP.get(normalizeText(value)) || "";
}

function isSensitiveMismatch(field, control) {
  const passwordControl = control.inputType === "password";
  return passwordControl && field.canonical !== "password";
}

function typeCompatible(value, control) {
  if (typeof value === "boolean") {
    return ["checkbox", "radio"].includes(control.inputType) || control.role === "switch";
  }
  if (control.tag === "select" || ["combobox", "listbox"].includes(control.role)) return true;
  if (["email", "tel", "number", "date", "text", "search", "url", "password"].includes(control.inputType)) {
    return ["string", "number"].includes(typeof value);
  }
  return ["textbox", "searchbox"].includes(control.role) || ["input", "textarea"].includes(control.tag);
}

function groupRanked(candidates, keyFor) {
  const groups = new Map();
  candidates.forEach((candidate) => {
    const key = keyFor(candidate);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(candidate);
  });
  groups.forEach((group) => group.sort(compareCandidates));
  return groups;
}

function compareCandidates(a, b) {
  return b.score - a.score ||
    a.field.key.localeCompare(b.field.key) ||
    a.control.id.localeCompare(b.control.id);
}

function bestTokenSimilarity(fieldTerms, controlTerms) {
  let best = 0;
  fieldTerms.forEach((fieldTerm) => {
    controlTerms.forEach((controlTerm) => {
      const left = new Set(fieldTerm.split(" ").filter(Boolean));
      const right = new Set(controlTerm.split(" ").filter(Boolean));
      const intersection = [...left].filter((token) => right.has(token)).length;
      const union = new Set([...left, ...right]).size;
      best = Math.max(best, union ? intersection / union : 0);
    });
  });
  return best;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function unique(values) {
  return [...new Set(values)];
}

function boundedNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, number))
    : fallback;
}
