import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";

import { Defaults, Messages, NativeCommands } from "../BRunner/core/constants.js";
import {
  NativeBridgeClient,
  isValidProfileInstanceId,
  loadOrCreateProfileInstanceId,
} from "../BRunner/core/nativeBridge.js";

const root = new URL("../", import.meta.url);

test("execution-log persistence uses canonical extension and native commands", async () => {
  assert.equal(Messages.OsSaveExecutionLog, "OS_SAVE_EXECUTION_LOG");
  assert.equal(NativeCommands.SaveExecutionLog, "SAVE_EXECUTION_LOG");

  const [background, bridge, host] = await Promise.all([
    readFile(new URL("BRunner/background.js", root), "utf8"),
    readFile(new URL("BRunner/core/nativeBridge.js", root), "utf8"),
    readFile(new URL("BRunner_Host/brunner_host.py", root), "utf8"),
  ]);
  assert.match(background, /case Messages\.OsSaveExecutionLog/);
  assert.match(bridge, /NativeCommands\.SaveExecutionLog/);
  assert.match(host, /command == "SAVE_EXECUTION_LOG"/);
  assert.match(host, /save_execution_log/);
});

test("data-source read uses canonical extension and native commands", async () => {
  assert.equal(Messages.OsReadDataSource, "OS_READ_DATA_SOURCE");
  assert.equal(NativeCommands.ReadDataSource, "READ_DATA_SOURCE");

  const [background, bridge, host] = await Promise.all([
    readFile(new URL("BRunner/background.js", root), "utf8"),
    readFile(new URL("BRunner/core/nativeBridge.js", root), "utf8"),
    readFile(new URL("BRunner_Host/brunner_host.py", root), "utf8"),
  ]);
  assert.match(background, /case Messages\.OsReadDataSource/);
  assert.match(bridge, /NativeCommands\.ReadDataSource/);
  assert.match(host, /command == "READ_DATA_SOURCE"/);
  assert.match(host, /read_data_source/);
  assert.match(background, /loadWorkflowDataSources/);
  assert.match(background, /data\.source\.load/);
});

test("approved-directory services expose canonical native commands", async () => {
  assert.equal(NativeCommands.HostHello, "HOST_HELLO");
  assert.equal(NativeCommands.HostWindow, "HOST_WINDOW");
  assert.equal(NativeCommands.HostAction, "HOST_ACTION");
  assert.equal(NativeCommands.HostVisualMatch, "HOST_VISUAL_MATCH");
  assert.equal(Messages.OsListApprovedDirectories, "OS_LIST_APPROVED_DIRECTORIES");
  assert.equal(NativeCommands.ListApprovedDirectories, "LIST_APPROVED_DIRECTORIES");
  assert.equal(NativeCommands.FindApprovedFiles, "FIND_APPROVED_FILES");
  assert.equal(NativeCommands.WriteApprovedFile, "WRITE_APPROVED_FILE");
  assert.equal(NativeCommands.ExportDataFile, "EXPORT_DATA_FILE");

  const [bridge, host] = await Promise.all([
    readFile(new URL("BRunner/core/nativeBridge.js", root), "utf8"),
    readFile(new URL("BRunner_Host/brunner_host.py", root), "utf8"),
  ]);
  assert.match(host, /command == "HOST_HELLO"/);
  assert.match(host, /command == "HOST_WINDOW"/);
  assert.match(host, /command == "HOST_ACTION"/);
  assert.match(host, /command == "HOST_VISUAL_MATCH"/);
  assert.match(host, /capability == "host\.hello"/);
  assert.match(host, /capability == "host\.window"/);
  assert.match(host, /capability == "host\.action"/);
  assert.match(host, /capability == "host\.visual_match"/);
  assert.match(host, /protocolVersion/);
  assert.match(bridge, /NativeCommands\.HostHello/);
  assert.match(bridge, /requestCapability/);
  assert.match(bridge, /hostHello/);
  assert.match(bridge, /hostWindow/);
  assert.match(bridge, /hostAction/);
  assert.match(bridge, /hostVisualMatch/);
  assert.match(bridge, /lastHello/);
  assert.match(host, /command == "LIST_APPROVED_DIRECTORIES"/);
  assert.match(bridge, /NativeCommands\.ListApprovedDirectories/);
});

test("native host pairing uses a stable profile instance and accepted live session", async () => {
  const [constants, background, bridge, host, coordinator] = await Promise.all([
    readFile(new URL("BRunner/core/constants.js", root), "utf8"),
    readFile(new URL("BRunner/background.js", root), "utf8"),
    readFile(new URL("BRunner/core/nativeBridge.js", root), "utf8"),
    readFile(new URL("BRunner_Host/brunner_host.py", root), "utf8"),
    readFile(new URL("BRunner_Host/pairing_coordinator.py", root), "utf8"),
  ]);
  assert.match(constants, /GetNativePairing/);
  assert.match(constants, /PairNativeProfile/);
  assert.match(constants, /UnpairNativeProfile/);
  assert.match(constants, /ProfileInstanceStorageKey/);
  assert.equal(NativeCommands.ProfileHello, "PROFILE_HELLO");
  assert.equal(NativeCommands.PairProfile, "PAIR_PROFILE");
  assert.equal(NativeCommands.UnpairProfile, "UNPAIR_PROFILE");
  assert.match(background, /case Messages\.GetNativePairing/);
  assert.match(background, /case Messages\.PairNativeProfile/);
  assert.match(background, /case Messages\.UnpairNativeProfile/);
  assert.match(bridge, /loadOrCreateProfileInstanceId/);
  assert.match(bridge, /waitForPairing/);
  assert.match(bridge, /subscribeStatus/);
  assert.match(bridge, /profileInstanceId/);
  assert.match(
    host,
    /command in \{"PROFILE_HELLO", "PAIR_PROFILE", "UNPAIR_PROFILE"\}/,
  );
  assert.match(host, /await handle_profile_hello/);
  assert.match(host, /await handle_pair_profile/);
  assert.match(host, /await handle_unpair_profile/);
  assert.match(coordinator, /paired_to_other_profile/);
  assert.match(coordinator, /paired_connection_active/);
});

test("profile instance ID is generated once per extension storage profile", async () => {
  const values = {};
  let writes = 0;
  const storage = {
    async get(name) {
      return { [name]: values[name] };
    },
    async set(update) {
      Object.assign(values, update);
      writes += 1;
    },
  };

  const first = await loadOrCreateProfileInstanceId(storage);
  const second = await loadOrCreateProfileInstanceId(storage);

  assert.equal(first, second);
  assert.equal(isValidProfileInstanceId(first), true);
  assert.equal(values[Defaults.ProfileInstanceStorageKey], first);
  assert.equal(writes, 1);
});

test("native bridge ignores delayed events from a replaced socket", () => {
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
      this.readyState = FakeWebSocket.CLOSING;
    }
  }

  globalThis.WebSocket = FakeWebSocket;
  try {
    const client = new NativeBridgeClient();
    client.startProfileSession = () => {
      client.isPaired = true;
      client.pairingState = "paired_connected";
      client.lastHello = { capabilities: ["workflow.list"] };
      return Promise.resolve();
    };

    client.connect();
    const oldSocket = sockets[0];
    oldSocket.readyState = FakeWebSocket.CLOSING;

    client.connect();
    const currentSocket = sockets[1];
    currentSocket.readyState = FakeWebSocket.OPEN;
    currentSocket.onopen();

    let rejected = false;
    client.pendingRequests.set("current-request", {
      reject: () => {
        rejected = true;
      },
      timer: null,
    });

    oldSocket.onclose();
    oldSocket.onerror(new Error("stale socket error"));
    oldSocket.onmessage({ data: JSON.stringify({ id: "current-request", ok: true }) });

    assert.equal(client.socket, currentSocket);
    assert.equal(client.isConnected, true);
    assert.equal(client.isPaired, true);
    assert.equal(client.pairingState, "paired_connected");
    assert.deepEqual(client.lastHello, { capabilities: ["workflow.list"] });
    assert.equal(rejected, false);
    assert.equal(client.pendingRequests.has("current-request"), true);
  } finally {
    globalThis.WebSocket = previousWebSocket;
  }
});

test("native bridge keeps a healthy paired session after non-pairing command errors", () => {
  const client = new NativeBridgeClient();
  client.isConnected = true;
  client.isPaired = true;
  client.pairingState = "paired";
  client.lastHello = { capabilities: ["workflow.list"] };

  let commandError = null;
  client.pendingRequests.set("command-error", {
    reject: (error) => {
      commandError = error;
    },
    timer: null,
  });
  client.handleMessage(JSON.stringify({
    id: "command-error",
    error: "Workflow payload is invalid.",
    code: "validation_failed",
  }));

  assert.equal(commandError?.code, "validation_failed");
  assert.equal(client.isPaired, true);
  assert.equal(client.pairingState, "paired");
  assert.deepEqual(client.lastHello, { capabilities: ["workflow.list"] });

  client.pendingRequests.set("pairing-error", {
    reject: () => {},
    timer: null,
  });
  client.handleMessage(JSON.stringify({
    id: "pairing-error",
    error: "Pair this profile first.",
    code: "pairing_required",
    pairingState: "unpaired",
  }));

  assert.equal(client.isPaired, false);
  assert.equal(client.pairingState, "unpaired");
  assert.equal(client.lastHello, null);
});

test("native local-file bridge exposes canonical input without finalizing the provisional node", async () => {
  const client = new NativeBridgeClient();
  const requests = [];
  client.request = async (command, payload) => {
    requests.push({ command, payload });
    return { ok: true };
  };

  await client.readLocalFile("AllowedFiles/sample.txt");
  await client.readLocalFile({
    directoryAlias: " imports ",
    relativePath: " rows.csv ",
  });

  assert.deepEqual(requests, [
    {
      command: NativeCommands.ReadFile,
      payload: { path: "AllowedFiles/sample.txt" },
    },
    {
      command: NativeCommands.ReadFile,
      payload: {
        request: {
          directoryAlias: "imports",
          relativePath: "rows.csv",
        },
      },
    },
  ]);
});

test("extension lists approved directories for graph authoring", async () => {
  const [background, studio] = await Promise.all([
    readFile(new URL("BRunner/background.js", root), "utf8"),
    readFile(new URL("BRunner/studio-graph-src/src/GraphStudio.jsx", root), "utf8"),
  ]);
  assert.match(background, /case Messages\.OsListApprovedDirectories/);
  assert.match(background, /NativeBridge\.hostHello/);
  assert.match(background, /NativeBridge\.listApprovedDirectories/);
  assert.match(studio, /OS_LIST_APPROVED_DIRECTORIES/);
  assert.match(studio, /directoryAlias/);
  assert.match(studio, /Approved folder alias/);
});

test("approved-directory service bridge helpers are present", async () => {
  const [constants, background, bridge, registry, host, workflow] = await Promise.all([
    readFile(new URL("BRunner/core/constants.js", root), "utf8"),
    readFile(new URL("BRunner/background.js", root), "utf8"),
    readFile(new URL("BRunner/core/nativeBridge.js", root), "utf8"),
    readFile(new URL("BRunner/core/nodeRegistry.js", root), "utf8"),
    readFile(new URL("BRunner_Host/brunner_host.py", root), "utf8"),
    readFile(new URL("BRunner_Host/Workflows/approved_directory_acceptance.json", root), "utf8"),
  ]);
  assert.match(constants, /OsFindApprovedFiles/);
  assert.match(constants, /ApprovedFilesFind/);
  assert.match(background, /case Messages\.OsFindApprovedFiles/);
  assert.match(background, /isApprovedDirectoryAction/);
  assert.match(background, /executeApprovedDirectoryStep/);
  assert.match(bridge, /NativeCommands\.ListApprovedDirectories/);
  assert.match(bridge, /NativeCommands\.FindApprovedFiles/);
  assert.match(bridge, /NativeCommands\.WriteApprovedFile/);
  assert.match(bridge, /NativeCommands\.ExportDataFile/);
  assert.match(registry, /Actions\.ApprovedFilesFind/);
  assert.match(registry, /Actions\.ApprovedFileWrite/);
  assert.match(registry, /Actions\.DataFileExport/);
  assert.match(registry, /NativeHostCapabilities\.ApprovedFileFind/);
  assert.match(registry, /NativeHostCapabilities\.ApprovedFileWrite/);
  assert.match(registry, /NativeHostCapabilities\.DataFileExport/);
  assert.match(host, /command == "FIND_APPROVED_FILES"/);
  assert.match(host, /command == "WRITE_APPROVED_FILE"/);
  assert.match(host, /command == "EXPORT_DATA_FILE"/);
  assert.match(workflow, /approved\.file\.write/);
  assert.match(workflow, /data\.file\.export/);
  assert.match(workflow, /approved\.files\.find/);
});

test("visible host fallback is gated and verified", async () => {
  const [background, mapper, registry, workflow, fixture] = await Promise.all([
    readFile(new URL("BRunner/background.js", root), "utf8"),
    readFile(new URL("BRunner/content/mapper.js", root), "utf8"),
    readFile(new URL("BRunner/core/nodeRegistry.js", root), "utf8"),
    readFile(new URL("BRunner_Host/Workflows/visible_host_fallback_acceptance.json", root), "utf8"),
    readFile(new URL("BRunner_Host/test.html", root), "utf8"),
  ]);
  assert.match(registry, /allowVisibleHostFallback/);
  assert.match(registry, /allowVisualMatchFallback/);
  assert.match(registry, /verificationSelector/);
  assert.match(registry, /verificationText/);
  assert.match(registry, /NativeHostRequirementModes\.Fallback/);
  assert.match(background, /shouldAllowVisibleHostFallback/);
  assert.match(background, /shouldAllowVisualMatchFallback/);
  assert.doesNotMatch(background, /shouldPreferVisualMatchFallback/);
  assert.match(background, /NativeBridge\.hostWindow/);
  assert.match(background, /NativeBridge\.hostAction/);
  assert.match(background, /NativeBridge\.hostVisualMatch/);
  assert.match(background, /capturePreparedComponentImage/);
  assert.match(background, /mapperCoordinator\.attachExecutionContext/);
  assert.match(background, /frame_host_fallback_unsupported/);
  assert.match(background, /if \(isMapperUnresolvedError\(error\)\)/);
  assert.match(background, /Messages\.PrepareHostFallback/);
  assert.match(background, /Messages\.VerifyHostFallback/);
  assert.match(mapper, /PrepareHostFallback/);
  assert.match(mapper, /prepareHostFallback/);
  assert.match(mapper, /verifyHostFallback/);
  assert.match(mapper, /clientPoint/);
  assert.match(mapper, /clientBounds/);
  assert.match(mapper, /coordinateSpace: "css_viewport"/);
  assert.match(background, /coordinateSpace: prepared\.coordinateSpace/);
  assert.match(background, /clientPoint: prepared\.clientPoint/);
  assert.match(background, /clientBounds: prepared\.clientBounds/);
  assert.match(background, /devicePixelRatio: prepared\.devicePixelRatio/);
  const fallbackSource = background.slice(
    background.indexOf("async function executeVisibleHostFallback"),
    background.indexOf("async function verifyVisibleHostFallback"),
  );
  assert.ok(
    fallbackSource.indexOf("chrome.windows.update") <
      fallbackSource.indexOf("Messages.PrepareHostFallback"),
    "the browser window must be focused before coordinate preparation",
  );
  assert.doesNotMatch(fallbackSource, /point: prepared\.point/);
  assert.doesNotMatch(fallbackSource, /target: prepared\.target/);
  assert.doesNotMatch(fallbackSource, /cssWindow: prepared\.cssWindow/);
  assert.match(mapper, /assertPostActionVerification/);
  assert.match(workflow, /Visible Host Fallback Acceptance/);
  assert.match(workflow, /allowVisibleHostFallback/);
  assert.match(workflow, /allowVisualMatchFallback/);
  assert.match(workflow, /verificationText/);
  assert.match(fixture, /trusted-submit/);
  assert.match(fixture, /event\.isTrusted/);
});

test("typed host fallback focuses and verifies the resolved editable before host input", async () => {
  const mapper = await readFile(
    new URL("BRunner/content/mapper.js", root),
    "utf8",
  );
  const prepareSource = mapper.slice(
    mapper.indexOf("async prepareHostFallback"),
    mapper.indexOf("async verifyHostFallback"),
  );
  const focusStart = mapper.indexOf("async focusHostFallbackTypeTarget");
  const focusSource = mapper.slice(
    focusStart,
    mapper.indexOf("    assertPostActionVerification(step", focusStart),
  );

  assert.ok(
    prepareSource.indexOf("element.scrollIntoView") <
      prepareSource.indexOf("await this.focusHostFallbackTypeTarget(element)"),
    "the target must be scrolled into view before focus is prepared",
  );
  assert.match(prepareSource, /if \(action === Actions\.ElementType\)/);
  assert.match(prepareSource, /if \(!focusResult\.ok\)/);
  assert.match(prepareSource, /focusResult\.reason/);
  assert.match(focusSource, /element\.focus\(\{ preventScroll: true \}\)/);
  assert.match(focusSource, /await this\.delay\(0\)/);
  assert.match(focusSource, /const activeElement = this\.getDeepActiveElement\(\)/);
  assert.match(
    focusSource,
    /!this\.isElementOrComposedDescendant\(element, activeElement\)/,
  );
  assert.match(focusSource, /host_fallback_type_focus_failed/);
});

test("mapper graph traversal routes unresolved outcomes explicitly", async () => {
  const [background, runtimeProjection] = await Promise.all([
    readFile(new URL("BRunner/background.js", root), "utf8"),
    readFile(new URL("BRunner/studio-graph-src/src/runtimeProjection.js", root), "utf8"),
  ]);

  assert.match(background, /executeMapperGraphWorkflow/);
  assert.match(background, /GraphEdgeHandles\.Unresolved/);
  assert.match(background, /handleMapperUnresolvedNode/);
  assert.match(background, /status:\s*"unresolved"/);
  assert.match(background, /MapperAttentionNodeType/);
  assert.match(background, /action === MapperAttentionNodeType/);
  assert.match(runtimeProjection, /unresolvedNodeIds/);
  assert.match(runtimeProjection, /runtimeStatus = "unresolved"/);
});

test("host-served workflows reference files exposed by the repository-root server", async () => {
  const workflowDir = new URL("BRunner_Host/Workflows/", root);
  const filenames = (await readdir(workflowDir))
    .filter((filename) => filename.endsWith(".json"));
  const workflows = [];

  for (const filename of filenames) {
    const workflow = JSON.parse(await readFile(new URL(filename, workflowDir), "utf8"));
    if (workflow.tags?.includes("host-served-8765")) {
      workflows.push({ filename, workflow });
    }
  }

  assert.ok(workflows.length >= 12);

  for (const { filename, workflow } of workflows) {
    assert.match(workflow.name, /^\[NEW 2026-07-\d{2}\]/, filename);
    assert.ok(workflow.tags.includes("host-served-8765"), filename);
    assert.equal(
      workflow.boundDomain,
      "http://127.0.0.1:8765/BRunner_Host/test.html",
      filename,
    );
    assert.equal(Array.isArray(workflow.steps), true, filename);
    assert.equal(workflow.steps[0]?.action, "browser.navigate", filename);
    assert.equal(
      workflow.steps[0]?.url,
      "http://127.0.0.1:8765/BRunner_Host/test.html",
      filename,
    );
    assert.doesNotMatch(
      JSON.stringify(workflow),
      /127\.0\.0\.1:8765\/(?:test\.html|BRunner\/test\.html)/,
      filename,
    );

    const localUrls = JSON.stringify(workflow).match(
      /http:\/\/127\.0\.0\.1:8765\/[^"\\]+/g,
    ) || [];
    for (const value of new Set(localUrls)) {
      const pathname = new URL(value).pathname.replace(/^\/+/, "");
      const content = await readFile(new URL(pathname, root));
      assert.ok(content.length > 0, `${filename}: ${value}`);
    }
  }
});

test("manual smoke workflow uses Studio config fields", async () => {
  const workflow = JSON.parse(await readFile(
    new URL("BRunner_Host/Workflows/manual_smoke_acceptance.json", root),
    "utf8",
  ));
  const selectStep = workflow.steps.find((step) => step.id === "manual_smoke_select_country");
  const toggleStep = workflow.steps.find((step) => step.id === "manual_smoke_accept_terms");
  const typeStep = workflow.steps.find((step) => step.id === "manual_smoke_type_name");
  assert.equal(typeStep.config.value, "BRunner manual smoke");
  assert.equal(selectStep.config.value, "Pakistan");
  assert.equal(toggleStep.config.value, true);
  assert.equal(Object.hasOwn(selectStep, "value"), false);
  assert.equal(Object.hasOwn(toggleStep, "value"), false);
});

test("post-action verification reads form control values", async () => {
  const mapper = await readFile(new URL("BRunner/content/mapper.js", root), "utf8");
  assert.match(mapper, /extractVerificationText/);
  assert.match(mapper, /\["INPUT", "TEXTAREA"\]\.includes\(element\.tagName\)/);
  assert.match(mapper, /return String\(element\.value \|\| ""\)/);
  assert.match(mapper, /element\.selectedOptions/);
  assert.match(mapper, /actualText: actual/);
});

test("visible host fallback normalizes resolver confidence for native host", async () => {
  const [background, mapper] = await Promise.all([
    readFile(new URL("BRunner/background.js", root), "utf8"),
    readFile(new URL("BRunner/content/mapper.js", root), "utf8"),
  ]);
  assert.match(mapper, /normalizeHostCoordinateConfidence/);
  assert.match(mapper, /numeric \/ 100/);
  assert.match(mapper, /clientPoint/);
  assert.match(background, /coordinateConfidence: prepared\.confidence/);
  assert.match(background, /recoverVisibleHostFallbackWithDebugger/);
  assert.match(background, /Input\.dispatchMouseEvent/);
});

test("simple id targets receive nonzero resolver confidence", async () => {
  const resolver = await readFile(new URL("BRunner/content/targetResolver.js", root), "utf8");
  assert.match(resolver, /candidateConfidence/);
  assert.match(resolver, /defaultStrategyScore/);
  assert.match(resolver, /\[TargetStrategies\.Id\]: 92/);
});

test("host-served acceptance page has smoke and upload targets", async () => {
  const hostHarness = await readFile(
    new URL("BRunner_Host/test.html", root),
    "utf8",
  );
  assert.match(hostHarness, /id="name-input"/);
  assert.match(hostHarness, /id="country"/);
  assert.match(hostHarness, /id="agree"/);
  assert.match(hostHarness, /id="upload-file"/);
  assert.match(hostHarness, /id="result-button"/);
  assert.match(hostHarness, /id="download-fixture"/);
  assert.match(hostHarness, /id="trusted-submit"/);
  assert.match(hostHarness, /id="status"/);
  assert.match(hostHarness, /uploaded-file-result/);
  assert.match(hostHarness, /tests\/fixtures\/download-acceptance\.txt/);
  assert.match(hostHarness, /event\.isTrusted/);
});

test("mapper acceptance page covers tracking and ambiguity fixtures", async () => {
  const mapperHarness = await readFile(
    new URL("BRunner_Host/mapper_test.html", root),
    "utf8",
  );

  assert.match(mapperHarness, /BRunner Mapper Acceptance Harness/);
  assert.match(mapperHarness, /data-testid="profile-save"/);
  assert.match(mapperHarness, /data-testid="billing-save"/);
  assert.match(mapperHarness, /data-testid="profile-help"/);
  assert.match(mapperHarness, /data-testid="billing-auto-renew"[\s\S]*type="checkbox"/);
  assert.match(mapperHarness, /data-testid="billing-monthly"[\s\S]*type="radio"/);
  assert.match(mapperHarness, /Apply ID\/Class Drift/);
  assert.match(mapperHarness, /Apply Text\/Label Drift/);
  assert.match(mapperHarness, /Apply Layout Drift/);
  assert.match(mapperHarness, /Apply Container Drift/);
  assert.match(mapperHarness, /Replace With Weak Lookalike/);
  assert.match(mapperHarness, /Remove Primary Locator/);
  assert.match(mapperHarness, /Add Equal Duplicate/);
  assert.match(mapperHarness, /Create Close-Score Pair/);
  assert.match(mapperHarness, /data-testid="capability-input"/);
  assert.match(mapperHarness, /data-testid="capability-button"/);
  assert.match(mapperHarness, /customElements\.define\("shadow-mapper-card"/);
  assert.match(mapperHarness, /attachShadow\(\{ mode: "open" \}\)/);
  assert.match(mapperHarness, /customElements\.define\("closed-shadow-mapper-card"/);
  assert.match(mapperHarness, /attachShadow\(\{ mode: "closed" \}\)/);
  assert.match(mapperHarness, /id="protected-frame"/);
  assert.match(mapperHarness, /history\.pushState/);
  assert.match(mapperHarness, /window\.addEventListener\("popstate"/);
  assert.match(mapperHarness, /searchParams\.set\("route", route\)/);
  assert.match(mapperHarness, /mutation storm started/);
  assert.match(mapperHarness, /materialMutationCount/);
});

test("mapper stress page covers static dynamic infinite and shadow fixtures", async () => {
  const [stressHarness, frameHarness] = await Promise.all([
    readFile(new URL("BRunner_Host/mapper_stress_test.html", root), "utf8"),
    readFile(new URL("BRunner_Host/mapper_frame_child.html", root), "utf8"),
  ]);

  assert.match(stressHarness, /BRunner Mapper Stress Harness/);
  assert.match(stressHarness, /data-testid="static-section"/);
  assert.match(stressHarness, /data-testid="dynamic-section"/);
  assert.match(stressHarness, /data-testid="mutation-heavy-section"/);
  assert.match(stressHarness, /data-testid="infinite-scroll-section"/);
  assert.match(stressHarness, /customElements\.define\("shadow-stress-card"/);
  assert.match(stressHarness, /attachShadow\(\{ mode: "open" \}\)/);
  assert.match(stressHarness, /materialMutationCount/);
  assert.match(stressHarness, /Run Finite Mutation Count/);
  assert.match(stressHarness, /Reset Mutation Region/);
  assert.match(stressHarness, /appendFeedItems/);
  assert.match(stressHarness, /Append Unkeyed Twins/);
  assert.match(stressHarness, /Remove First Feed Item/);
  assert.match(stressHarness, /Replace Loaded Feed Window/);
  assert.match(stressHarness, /Reset Repeated Records/);
  assert.match(stressHarness, /data-testid="unkeyed-feed"/);
  assert.match(stressHarness, /Generate Large Control Set/);
  assert.match(stressHarness, /data-testid="large-control-container"/);
  assert.match(stressHarness, /data-testid="mapper-same-origin-frame"/);
  assert.match(stressHarness, /mapper_frame_child\.html/);
  assert.match(frameHarness, /data-testid="frame-save"/);
  assert.match(frameHarness, /Mapper frame form/);
});

test("mapper platform profile page covers chat and social fixtures", async () => {
  const platformHarness = await readFile(
    new URL("BRunner_Host/mapper_platform_profiles_test.html", root),
    "utf8",
  );

  assert.match(platformHarness, /BRunner Mapper Platform Profile Harness/);
  assert.match(platformHarness, /data-platform-profile="chat"/);
  assert.match(platformHarness, /data-testid="conversation-list"/);
  assert.match(platformHarness, /data-testid="account-navigation"/);
  assert.match(platformHarness, /data-testid="contacts-pane"/);
  assert.match(platformHarness, /data-testid="chat-search-filters"/);
  assert.match(platformHarness, /data-testid="active-thread-region"/);
  assert.match(platformHarness, /data-testid="thread-header"/);
  assert.match(platformHarness, /data-testid="message-composer"/);
  assert.match(platformHarness, /data-testid="message-loaded-window"/);
  assert.match(platformHarness, /Swap Active Thread/);
  assert.match(platformHarness, /Load Older Messages/);
  assert.match(platformHarness, /Replace Message Window/);
  assert.match(platformHarness, /tick-chat-ephemeral/);
  assert.match(platformHarness, /data-platform-profile="social"/);
  assert.match(platformHarness, /data-testid="home-feed-region"/);
  assert.match(platformHarness, /data-testid="social-right-rail"/);
  assert.match(platformHarness, /data-testid="social-loaded-window"/);
  assert.match(platformHarness, /data-testid="global-comment-composer"/);
  assert.match(platformHarness, /Append Feed Window/);
  assert.match(platformHarness, /Replace Social Window/);
  assert.match(platformHarness, /tick-social-ephemeral/);
  assert.match(platformHarness, /loadedWindowIndex/);
});

test("mapper acceptance fixture inline scripts parse", async () => {
  const fixturePaths = [
    "BRunner_Host/mapper_test.html",
    "BRunner_Host/mapper_stress_test.html",
    "BRunner_Host/mapper_platform_profiles_test.html",
    "BRunner_Host/mapper_frame_child.html",
  ];

  for (const fixturePath of fixturePaths) {
    const source = await readFile(new URL(fixturePath, root), "utf8");
    const scripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
    assert.ok(scripts.length > 0, fixturePath);
    scripts.forEach((match, index) => {
      assert.doesNotThrow(
        () => new Function(match[1]),
        `${fixturePath} inline script ${index + 1}`,
      );
    });
  }
});
