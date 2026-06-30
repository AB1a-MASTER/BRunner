import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
