import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

test("background selects runtime only from canonical preparation", async () => {
  const source = await readFile(
    new URL("BRunner/background.js", root),
    "utf8",
  );

  assert.match(source, /prepareWorkflowForExecution\(rawWorkflow/);
  assert.match(source, /const executionPlan = preparedWorkflow\.executionPlan/);
  assert.match(
    source,
    /executionPlan\.executionModel === WorkflowExecutionModels\.CanonicalGraph/,
  );
  assert.match(source, /const workflow = executionPlan\.workflow/);
  assert.match(source, /executionPlan\.nodeInvocations\.map\(graphNodeToStep\)/);
  assert.match(
    source,
    /const executionResult = canonicalGraph[\s\S]*executeMapperGraphWorkflow[\s\S]*executeLinearWorkflowSteps/,
  );
  assert.doesNotMatch(source, /isMapperGraphWorkflow\(rawWorkflow\)/);
  assert.doesNotMatch(source, /function normalizeMapperGraphWorkflowForRun/);
  assert.match(source, /validateFinalizedConfig: validateFinalizedWorkflowConfiguration/);
  assert.match(source, /createWorkflowVariableState/);
  assert.match(source, /executionModel: executionPlan\.executionModel/);
  assert.match(source, /nodeInvocations: executionPlan\.nodeInvocations/);
  assert.match(source, /function setWorkflowVariable/);
});

test("both supported run messages converge on the same prepared runner", async () => {
  const source = await readFile(
    new URL("BRunner/background.js", root),
    "utf8",
  );

  assert.match(
    source,
    /case Messages\.RunWorkflowByName:[\s\S]*runWorkflowByName\(request\.filename\)/,
  );
  assert.match(
    source,
    /case Messages\.StartWorkflow:[\s\S]*runWorkflow\(request\.workflow \|\| request\.content\)/,
  );
  assert.match(
    source,
    /async function runWorkflowByName[\s\S]*return await runWorkflow\(workflow/,
  );
});
