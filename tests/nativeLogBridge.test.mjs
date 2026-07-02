import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";

import { Messages, NativeCommands } from "../BRunner/core/constants.js";

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
  assert.match(background, /NativeBridge\.hostWindow/);
  assert.match(background, /NativeBridge\.hostAction/);
  assert.match(background, /NativeBridge\.hostVisualMatch/);
  assert.match(background, /capturePreparedComponentImage/);
  assert.match(background, /Messages\.PrepareHostFallback/);
  assert.match(background, /Messages\.VerifyHostFallback/);
  assert.match(mapper, /PrepareHostFallback/);
  assert.match(mapper, /prepareHostFallback/);
  assert.match(mapper, /verifyHostFallback/);
  assert.match(mapper, /clientPointToScreen/);
  assert.match(mapper, /clientBounds/);
  assert.match(mapper, /assertPostActionVerification/);
  assert.match(workflow, /Visible Host Fallback Acceptance/);
  assert.match(workflow, /allowVisibleHostFallback/);
  assert.match(workflow, /allowVisualMatchFallback/);
  assert.match(workflow, /verificationText/);
  assert.match(fixture, /trusted-submit/);
  assert.match(fixture, /event\.isTrusted/);
});

test("live acceptance workflows open the fixture harness explicitly", async () => {
  const workflowDir = new URL("BRunner_Host/Workflows/", root);
  const filenames = (await readdir(workflowDir))
    .filter((filename) => filename.endsWith("_acceptance.json"));

  assert.ok(filenames.length >= 8);

  for (const filename of filenames) {
    const workflow = JSON.parse(await readFile(new URL(filename, workflowDir), "utf8"));
    assert.match(workflow.name, /^\[NEW 2026-07-02\]/, filename);
    assert.deepEqual(
      workflow.tags,
      ["new-2026-07-02", "host-served-8765", "acceptance"],
      filename,
    );
    assert.equal(workflow.boundDomain, "http://127.0.0.1:8765/test.html", filename);
    assert.equal(Array.isArray(workflow.steps), true, filename);
    assert.equal(workflow.steps[0]?.action, "browser.navigate", filename);
    assert.equal(workflow.steps[0]?.url, "http://127.0.0.1:8765/test.html", filename);
    assert.doesNotMatch(JSON.stringify(workflow), /\/BRunner\/test\.html/, filename);
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
