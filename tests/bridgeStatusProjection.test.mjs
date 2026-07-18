import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  createBridgeStatusTransitionTracker,
  normalizeBridgeStatus,
} from "../BRunner/core/bridgeStatus.js";
import { NativeBridgeClient } from "../BRunner/core/nativeBridge.js";
import { normalizeHostCheckpoint } from "../BRunner/core/runtimeSession.js";

const root = new URL("../", import.meta.url);

function readyStatus(capabilities) {
  return {
    connected: true,
    ready: true,
    socketConnected: true,
    paired: true,
    pairingState: "paired_connected",
    profileInstanceId: "profile-1",
    protocolVersion: 1,
    host: { name: "BRunner Host" },
    capabilities,
  };
}

test("bridge projection emits actual disconnect and reconnect transitions without stale capabilities", () => {
  const transitions = createBridgeStatusTransitionTracker();
  const connected = transitions.next(readyStatus(["workflow.list", "host.action"]));
  assert.equal(connected.ready, true);
  assert.deepEqual(connected.capabilities, ["host.action", "workflow.list"]);
  assert.equal(transitions.next(readyStatus(["host.action", "workflow.list"])), null);

  const disconnected = transitions.next({
    ...readyStatus(["stale.capability"]),
    connected: false,
    ready: false,
    socketConnected: false,
    paired: false,
    pairingState: "disconnected",
  });
  assert.equal(disconnected.ready, false);
  assert.deepEqual(disconnected.capabilities, []);
  assert.equal(disconnected.protocolVersion, null);
  assert.equal(disconnected.host, null);
  assert.equal(transitions.next(disconnected), null);

  const reconnected = transitions.next(readyStatus(["workflow.list", "host.visual_match"]));
  assert.equal(reconnected.ready, true);
  assert.deepEqual(reconnected.capabilities, ["host.visual_match", "workflow.list"]);
  assert.deepEqual(normalizeHostCheckpoint({
    connected: false,
    helloAccepted: false,
    pairedProfileAccepted: false,
    capabilities: ["stale.capability"],
  }).capabilities, []);
});

test("native bridge listener clears capabilities on disconnect and restores new hello data", () => {
  const previousWebSocket = globalThis.WebSocket;
  const sockets = [];

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor() {
      this.readyState = FakeWebSocket.CONNECTING;
      sockets.push(this);
    }

    close() {
      this.readyState = FakeWebSocket.CLOSED;
    }
  }

  globalThis.WebSocket = FakeWebSocket;
  try {
    const client = new NativeBridgeClient();
    const statuses = [];
    client.startProfileSession = () => Promise.resolve();
    client.subscribeStatus((status) => statuses.push(status));

    client.connect();
    const firstSocket = sockets[0];
    firstSocket.readyState = FakeWebSocket.OPEN;
    firstSocket.onopen();
    client.isPaired = true;
    client.pairingState = "paired_connected";
    client.lastHello = {
      protocolVersion: 1,
      host: { name: "first" },
      capabilities: ["workflow.list"],
    };
    client.notifyStatus();
    assert.deepEqual(statuses.at(-1).capabilities, ["workflow.list"]);

    firstSocket.readyState = FakeWebSocket.CLOSED;
    firstSocket.onclose();
    assert.equal(statuses.at(-1).ready, false);
    assert.deepEqual(statuses.at(-1).capabilities, []);
    assert.equal(statuses.at(-1).host, null);

    client.connect();
    const secondSocket = sockets[1];
    secondSocket.readyState = FakeWebSocket.OPEN;
    secondSocket.onopen();
    client.isPaired = true;
    client.pairingState = "paired_connected";
    client.lastHello = {
      protocolVersion: 2,
      host: { name: "second" },
      capabilities: ["workflow.list", "host.action"],
    };
    client.notifyStatus();
    assert.equal(statuses.at(-1).ready, true);
    assert.equal(statuses.at(-1).protocolVersion, 2);
    assert.deepEqual(statuses.at(-1).capabilities, ["workflow.list", "host.action"]);
  } finally {
    globalThis.WebSocket = previousWebSocket;
  }
});

test("background and every open extension UI consume live bridge transitions", async () => {
  const [background, sidebar, sequential, graph] = await Promise.all([
    readFile(new URL("BRunner/background.js", root), "utf8"),
    readFile(new URL("BRunner/sidebar/sidebar.js", root), "utf8"),
    readFile(new URL("BRunner/studio/app.js", root), "utf8"),
    readFile(new URL("BRunner/studio-graph-src/src/GraphStudio.jsx", root), "utf8"),
  ]);

  assert.match(background, /createBridgeStatusTransitionTracker/);
  assert.match(background, /NativeBridge\.subscribeStatus\(publishNativeBridgeStatus\)/);
  assert.match(background, /type:\s*Messages\.BridgeStatus/);
  assert.match(background, /capabilities:\s*bridge\.capabilities/);

  for (const source of [sidebar, sequential, graph]) {
    assert.match(source, /BridgeStatus:\s*"BRIDGE_STATUS"/);
    assert.match(source, /request\?\.type === Messages\.BridgeStatus/);
    assert.match(source, /request\.bridge \|\| request/);
  }
  assert.match(sidebar, /applyPairingResponse/);
  assert.match(sequential, /applyBridgeStatus/);
  assert.match(graph, /setHostCapabilities\([\s\S]{0,120}connected[\s\S]{0,120}: \[\]/);
  assert.match(graph, /setApprovedDirectories\(\[\]\)/);
});
