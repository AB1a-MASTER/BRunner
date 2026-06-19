import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getExecutionPresentation,
  getNodeSummaryRows,
} from "../BRunner/studio-graph-src/src/nodePresentation.js";

test("node summary prioritizes target, output, and useful configuration", () => {
  const rows = getNodeSummaryRows({
    target: "#results",
    config: {
      variableName: "items",
      itemSelector: ".result-row",
      attributeName: "href",
      valueMode: "attribute",
    },
    definition: {
      config: [
        { key: "itemSelector", label: "Item CSS Selector" },
        { key: "valueMode", label: "Value Mode" },
        { key: "attributeName", label: "Attribute Name", visibleWhen: { field: "valueMode", equals: "attribute" } },
        { key: "variableName", label: "Output Variable" },
      ],
    },
  });

  assert.deepEqual(rows.map((row) => row.key), ["target", "variableName", "itemSelector"]);
  assert.equal(rows[1].value, "items");
});

test("node summaries do not expose sensitive field contents", () => {
  const rows = getNodeSummaryRows({
    config: { headers: '{"Authorization":"secret"}', body: "private" },
    definition: {
      config: [
        { key: "headers", label: "Headers" },
        { key: "body", label: "Body" },
      ],
    },
  });

  assert.deepEqual(rows.map((row) => row.value), ["Configured", "Configured"]);
});

test("execution presentation distinguishes enabled, bypassed, and conditional", () => {
  assert.equal(getExecutionPresentation({}).label, "Enabled");
  assert.equal(getExecutionPresentation({ executionMode: "disabled" }).label, "Bypassed");
  assert.deepEqual(
    getExecutionPresentation({ executionMode: "conditional", skipWhen: "{{skip_login}}" }),
    { mode: "conditional", label: "Conditional", detail: "{{skip_login}}" },
  );
});
