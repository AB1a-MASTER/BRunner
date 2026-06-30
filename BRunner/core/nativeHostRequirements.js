// core/nativeHostRequirements.js
// Shared native-host dependency contract for node definitions and runtime checks.

export const NativeHostRequirementModes = Object.freeze({
  None: "none",
  Fallback: "fallback",
  Required: "required",
});

export const NativeHostCapabilities = Object.freeze({
  OsKeystroke: "os.keystroke",
  LocalFileRead: "local_file.read",
  DataSourceRead: "data_source.read",
  ExecutionLogSave: "execution_log.save",
});

export const DEFAULT_NATIVE_HOST_REQUIREMENT = Object.freeze({
  mode: NativeHostRequirementModes.None,
  capabilities: [],
});

const CAPABILITY_LABELS = Object.freeze({
  [NativeHostCapabilities.OsKeystroke]: "OS keystroke",
  [NativeHostCapabilities.LocalFileRead]: "local file read",
  [NativeHostCapabilities.DataSourceRead]: "data source read",
  [NativeHostCapabilities.ExecutionLogSave]: "execution log save",
});

export function normalizeNativeHostRequirement(requirement = {}) {
  const mode = Object.values(NativeHostRequirementModes).includes(requirement?.mode)
    ? requirement.mode
    : NativeHostRequirementModes.None;
  const capabilities = Array.isArray(requirement?.capabilities)
    ? [...new Set(requirement.capabilities.map((capability) => String(capability || "").trim()).filter(Boolean))]
    : [];

  return {
    mode,
    capabilities,
  };
}

export function normalizeNativeHostStatus(status = {}) {
  return {
    connected: status?.connected === true,
    capabilities: Array.isArray(status?.capabilities)
      ? [...new Set(status.capabilities.map((capability) => String(capability || "").trim()).filter(Boolean))]
      : null,
  };
}

export function evaluateNativeHostRequirement(requirement = {}, status = {}) {
  const normalizedRequirement = normalizeNativeHostRequirement(requirement);
  const normalizedStatus = normalizeNativeHostStatus(status);

  if (normalizedRequirement.mode !== NativeHostRequirementModes.Required) {
    return {
      ok: true,
      requirement: normalizedRequirement,
      status: normalizedStatus,
      missingCapabilities: [],
      finalReason: "",
      message: "",
    };
  }

  if (!normalizedStatus.connected) {
    return {
      ok: false,
      requirement: normalizedRequirement,
      status: normalizedStatus,
      missingCapabilities: normalizedRequirement.capabilities,
      finalReason: "native_host_unavailable",
      message: "Native host is required for this node but is unavailable.",
    };
  }

  const missingCapabilities = normalizedStatus.capabilities === null
    ? []
    : normalizedRequirement.capabilities.filter((capability) => {
        return !normalizedStatus.capabilities.includes(capability);
      });

  if (missingCapabilities.length) {
    return {
      ok: false,
      requirement: normalizedRequirement,
      status: normalizedStatus,
      missingCapabilities,
      finalReason: "native_capability_unavailable",
      message: `Native host is missing required capability: ${formatNativeCapabilities(missingCapabilities)}.`,
    };
  }

  return {
    ok: true,
    requirement: normalizedRequirement,
    status: normalizedStatus,
    missingCapabilities: [],
    finalReason: "",
    message: "",
  };
}

export function formatNativeCapabilities(capabilities = []) {
  const labels = capabilities.map((capability) => {
    const value = String(capability || "").trim();
    return CAPABILITY_LABELS[value] || value;
  }).filter(Boolean);

  if (!labels.length) return "native host";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}
