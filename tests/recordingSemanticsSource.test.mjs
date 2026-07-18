import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

test("recorder captures dropdowns as semantic select steps", async () => {
  const source = await readFile(
    new URL("BRunner/content/mapper.js", root),
    "utf8",
  );

  assert.match(source, /Actions\.ElementSelect/);
  assert.match(source, /getSelectedOptionText/);
  assert.match(source, /optionText/);
  assert.match(source, /optionValue/);
  assert.match(source, /optionIndex/);
  assert.match(source, /value:\s*this\.getSelectedOptionText\(element\) \|\| value/);
});

test("recorder emits mapper component refs from live DOM facts", async () => {
  const source = await readFile(
    new URL("BRunner/content/mapper.js", root),
    "utf8",
  );

  assert.match(source, /enumerateStaticCandidateElements/);
  assert.match(source, /observeMapperRoots/);
  assert.match(source, /observedMapperRoots/);
  assert.match(source, /getMapperShadowPath/);
  assert.match(source, /getMapperPathWithinRoot/);
  assert.match(source, /getMapperFrameScope/);
  assert.match(source, /mapper\.frame_scope\.v1/);
  assert.match(source, /pageWindow = window\.top/);
  assert.match(source, /extensionAccessible:\s*true/);
  assert.match(source, /contextKey/);
  assert.match(source, /cross_origin_frame_unreachable/);
  assert.match(source, /identityAmbiguous/);
  assert.match(source, /cross_origin_frame_context_ambiguous/);
  assert.match(source, /highlightMapperContainer/);
  assert.match(source, /container_path_unique/);
  assert.match(source, /container_path_ambiguous/);
  assert.match(source, /::shadow::/);
  assert.match(source, /getOpenDomRoots/);
  assert.match(source, /event\.composedPath/);
  assert.match(source, /buildMapperComponentFact/);
  assert.match(source, /createComponentRef/);
  assert.match(source, /getMapperPlatformScope/);
  assert.match(source, /detectKnownMapperPlatformProfile/);
  assert.match(source, /web\.whatsapp\.com/);
  assert.match(source, /hasExplicitMapperPlatformRoots/);
  assert.match(source, /if \(hasExplicitPlatformRoots\) return null/);
  assert.match(source, /getInferredChatPlatformScope/);
  assert.match(source, /getInferredSocialPlatformScope/);
  assert.match(source, /const profileControls = !chatShell/);
  assert.match(source, /const profileControls = !socialShell/);
  assert.match(source, /majorRegion = "chat_shell"/);
  assert.match(source, /majorRegion = "social_shell"/);
  assert.match(source, /subregion = "profile_controls"/);
  assert.match(source, /getMapperStableContainerToken/);
  assert.match(source, /unsupported_scope/);
  assert.match(source, /mapperPlatformScopeAllowsAction/);
  assert.match(source, /getMapperIdentityText/);
  assert.match(source, /isMapperEphemeralElement/);
  assert.match(source, /exclude_ephemeral_descendants/);
  assert.match(source, /mappingDisposition: ephemeral \? "context_only"/);
  assert.match(source, /dynamicContext: this\.isMapperEphemeralElement/);
  assert.match(source, /recordMapperRegionMutation/);
  assert.match(source, /getMapperRegionDynamics/);
  assert.match(source, /getMapperRepeatScope/);
  assert.match(source, /mapperRepeatScopeToken/);
  assert.match(source, /mapper\.repeat_scope\.v1/);
  assert.match(source, /pattern_requires_condition/);
  assert.match(source, /mapper\.region_dynamics\.v1/);
  assert.match(source, /loadedContentOnly: loadedWindow/);
  assert.match(source, /platformScopeToken/);
  assert.match(source, /platformScope/);
  assert.match(source, /mapper\.platform_scope\.v1/);
  assert.match(source, /majorRegion/);
  assert.match(source, /subregion/);
  assert.match(source, /templateKind/);
  assert.match(source, /repeatedRecordPath/);
  assert.match(source, /getMapperRepeatedCollectionBoundary/);
  assert.match(source, /resolveMapperContainerAnchor/);
  assert.match(source, /getMapperComposedParentElement/);
  assert.match(source, /getMapperComposedAncestorDistance/);
  assert.match(source, /container_anchor_resolved/);
  assert.match(source, /mapperPlatformScopesCompatible/);
  assert.match(source, /platform_scope_contradiction/);
  assert.match(source, /\["majorRegion", "threadId", "containerId", "repeatedKind"\]/);
  assert.match(source, /componentRef/);
  assert.match(source, /mapperFact/);
  assert.match(source, /capturedMapVersionId/);
  assert.match(source, /"img"/);
  assert.match(source, /isPassiveTextCandidate/);
  assert.match(source, /"pre"/);
  assert.match(source, /\[role='status'\]/);
  assert.match(source, /\["heading", "status", "log"\]\.includes\(role\)/);
  assert.match(source, /hasMappableMediaSignal/);
});

test("mapper content scripts run in frames for path-scoped routing", async () => {
  const manifest = JSON.parse(await readFile(new URL("BRunner/manifest.json", root), "utf8"));
  const mapperScript = manifest.content_scripts.find((entry) => {
    return entry.js?.includes("content/mapper.js");
  });
  assert.equal(mapperScript.all_frames, true);
  assert.equal(mapperScript.match_about_blank, true);
  assert.equal(mapperScript.match_origin_as_fallback, true);
});

test("content execution resolves mapper context before legacy targets", async () => {
  const source = await readFile(
    new URL("BRunner/content/mapper.js", root),
    "utf8",
  );

  assert.match(source, /resolveStepTarget/);
  assert.match(source, /resolveMapperComponentTarget/);
  assert.match(source, /mapperState/);
  assert.match(source, /dynamic_deferred/);
  assert.match(source, /primary_locator_ambiguous/);
  assert.match(source, /mapper_resolved_with_fallback|resolved_with_fallback/);
  assert.match(source, /withMapperRuntimeResolution/);
  assert.match(source, /createMapperRuntimeResolutionOutcome/);
  assert.match(source, /normalizeMapperRuntimeCandidate/);
  assert.match(source, /displayName:\s*candidate\.displayName/);
  assert.doesNotMatch(source, /rawLocatorStored|rawTextStored|redactMapperRuntimeCandidate/);
});

test("background persists mapper runtime resolver outcomes", async () => {
  const source = await readFile(
    new URL("BRunner/background.js", root),
    "utf8",
  );

  assert.match(source, /recordMapperResolutionOutcome/);
  assert.match(source, /mapperCoordinator\.recordResolverOutcome/);
  assert.match(source, /response\.diagnostics\?\.targetResolution\?\.mapperResolution/);
  assert.match(source, /response\?\.mapperResolution/);
});

test("wait conditions return mapper diagnostics before generic timeouts", async () => {
  const source = await readFile(
    new URL("BRunner/content/mapper.js", root),
    "utf8",
  );

  assert.match(source, /const waitResult = this\.isWaitConditionSatisfied\(action, step\)/);
  assert.match(source, /Mapper could not resolve wait target/);
  assert.match(source, /this\.createExecutionDiagnostics\(\s*step,\s*waitResult\.resolved,\s*`mapper_\$\{waitResult\.mapperState\}`/);
  assert.match(source, /const resolved = this\.resolveStepTarget\(step, action\)/);
});

test("recorded targets prefer user-facing semantics before structural selectors", async () => {
  const source = await readFile(
    new URL("BRunner/content/targetResolver.js", root),
    "utf8",
  );

  assert.match(source, /TargetStrategies\.AriaLabel[\s\S]*110/);
  assert.match(source, /TargetStrategies\.LabelText[\s\S]*108/);
  assert.match(source, /TargetStrategies\.Text[\s\S]*104/);
  assert.match(source, /"role_text"[\s\S]*102/);
  assert.match(source, /TargetStrategies\.Id[\s\S]*92/);
  assert.match(source, /TargetStrategies\.CssSelector[\s\S]*68/);
});
