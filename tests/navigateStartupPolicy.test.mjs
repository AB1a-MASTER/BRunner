import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  navigateCanBootstrapWithoutTab,
  workflowCanBootstrapNavigateWithoutTab,
} from "../BRunner/nodes/navigation/navigate/index.js";

const root = new URL("../", import.meta.url);

function finalizedNewTab(overrides = {}) {
  return {
    id: "navigate-entry",
    type: "browser.navigate",
    version: 2,
    ...overrides,
    config: {
      enabled: true,
      operation: "goto_url",
      tabSource: "current",
      url: "https://example.com/",
      openDestinationIn: "new_tab",
      ...overrides.config,
    },
  };
}

test("Navigate startup policy permits only an enabled v2 current-source new tab", () => {
  assert.equal(navigateCanBootstrapWithoutTab(finalizedNewTab()), true);
  assert.equal(
    navigateCanBootstrapWithoutTab(finalizedNewTab({
      config: { openDestinationIn: "current_tab" },
    })),
    false,
  );
  assert.equal(
    navigateCanBootstrapWithoutTab(finalizedNewTab({
      config: { tabSource: "active" },
    })),
    false,
  );
  assert.equal(
    navigateCanBootstrapWithoutTab(finalizedNewTab({
      config: { operation: "reload", openDestinationIn: "new_tab" },
    })),
    false,
  );
  assert.equal(
    navigateCanBootstrapWithoutTab(finalizedNewTab({
      version: 1,
      openIn: "newTab",
    })),
    false,
  );
  assert.equal(
    navigateCanBootstrapWithoutTab(finalizedNewTab({
      config: { enabled: false },
    })),
    false,
  );
  assert.equal(
    navigateCanBootstrapWithoutTab(finalizedNewTab({
      data: { executionMode: "conditional", skipWhen: "{{ skip }}" },
    })),
    false,
  );
});

test("Navigate startup policy uses the real graph entry and the first linear step", () => {
  const graph = {
    entryNodeId: "navigate-entry",
    nodes: [
      { id: "not-entry", type: "browser.navigate", version: 1, config: {} },
      finalizedNewTab(),
    ],
  };
  assert.equal(workflowCanBootstrapNavigateWithoutTab(graph), true);
  assert.equal(
    workflowCanBootstrapNavigateWithoutTab({
      ...graph,
      entryNodeId: "missing",
    }),
    false,
  );
  assert.equal(
    workflowCanBootstrapNavigateWithoutTab({
      steps: [{
        action: "browser.navigate",
        version: 2,
        config: {
          operation: "goto_url",
          tabSource: "current",
          openDestinationIn: "new_tab",
        },
      }],
    }),
    true,
  );
  assert.equal(
    workflowCanBootstrapNavigateWithoutTab({
      steps: [
        { action: "logic.wait", version: 1, config: {} },
        finalizedNewTab(),
      ],
    }),
    false,
  );
});

test("background startup integrates the fail-closed Navigate policy", async () => {
  const source = await readFile(
    new URL("BRunner/background.js", root),
    "utf8",
  );

  assert.match(source, /workflowCanBootstrapNavigateWithoutTab\(workflow\)/);
  assert.match(source, /allowTablessBootstrap:\s*workflowCanBootstrap/);
  assert.match(
    source,
    /if \(options\.allowTablessBootstrap === true\) return null/,
  );
});

test("Navigate acceptance workflow exercises safe Studio tabless startup", async () => {
  const source = await readFile(
    new URL(
      "BRunner_Host/Workflows/node_acceptance/001_navigate_acceptance.json",
      root,
    ),
    "utf8",
  );
  const workflow = JSON.parse(source);

  assert.equal(
    workflow.nodes.find((node) => node.id === workflow.entryNodeId)
      ?.config?.openDestinationIn,
    "new_tab",
  );
  assert.equal(workflowCanBootstrapNavigateWithoutTab(workflow), true);
});
