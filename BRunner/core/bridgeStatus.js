// Canonical native-bridge status projection shared by the service worker and tests.

export function normalizeBridgeStatus(status = {}) {
  const socketConnected = status?.socketConnected === true;
  const paired = status?.paired === true;
  const reportedReady = status?.ready === true || status?.connected === true;
  const ready = Boolean(reportedReady && socketConnected && paired);
  const capabilities = ready
    ? [...new Set((Array.isArray(status?.capabilities) ? status.capabilities : [])
      .map((capability) => String(capability || "").trim())
      .filter(Boolean))].sort()
    : [];

  return {
    connected: ready,
    ready,
    socketConnected,
    paired,
    pairingState: String(status?.pairingState || (socketConnected ? "checking" : "disconnected")),
    pairingError: String(status?.pairingError || ""),
    profileInstanceId: String(status?.profileInstanceId || ""),
    protocolVersion: ready ? status?.protocolVersion ?? null : null,
    host: ready ? status?.host ?? null : null,
    capabilities,
  };
}

export function createBridgeStatusTransitionTracker() {
  let previousSignature = null;

  return {
    next(status = {}) {
      const bridge = normalizeBridgeStatus(status);
      const signature = JSON.stringify(bridge);
      if (signature === previousSignature) return null;
      previousSignature = signature;
      return bridge;
    },
    reset() {
      previousSignature = null;
    },
  };
}
