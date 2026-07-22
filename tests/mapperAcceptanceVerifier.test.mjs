import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MapperAcceptanceExportVersion,
  verifyMapperAcceptanceSnapshot,
} from "../BRunner/mapper/acceptanceVerifier.js";

const root = new URL("../", import.meta.url);

test("mapper acceptance export matches stable DOM identities and body ancestry", () => {
  const result = verifyMapperAcceptanceSnapshot({
    pageMap: {
      status: "ready",
      classification: "hybrid_dynamic",
      diagnostics: { scanOverflow: false },
      components: [
        component({
          id: "profile_save",
          testId: "profile-save",
          tag: "button",
          domPath: "html:0/body:1/main:0/form:0/button:2",
        }),
        component({
          id: "shadow_save",
          testId: "shadow-save",
          tag: "button",
          domPath:
            "html:0/body:1/main:0/shadow-stress-card:2::shadow::div:0/button:1",
        }),
        component({
          id: "append_feed",
          tag: "button",
          domPath: "html:0/body:1/main:0/section:4/button:0",
        }),
        component({
          id: "anonymous_copy",
          technicalId: "",
          tag: "p",
          domPath: "html:0/body:1/main:0/section:4/article:0/p:1",
        }),
      ],
    },
    domManifest: {
      entries: [
        manifest({ testId: "profile-save", tag: "button" }),
        manifest({ testId: "shadow-save", tag: "button" }),
        manifest({ id: "append-feed", tag: "button" }),
        manifest({
          tag: "p",
          domPath: "html:0/body:1/main:0/section:4/article:0/p:1",
        }),
      ],
    },
  });

  assert.equal(result.schemaVersion, MapperAcceptanceExportVersion);
  assert.equal(result.ok, true);
  assert.equal(result.summary.expectedDomElementCount, 4);
  assert.equal(result.summary.matchedDomElementCount, 4);
  assert.equal(result.summary.outsideDocumentBodyCount, 0);
});

test("mapper acceptance export reports missing, duplicate, and outside-body records", () => {
  const result = verifyMapperAcceptanceSnapshot({
    pageMap: {
      status: "ready",
      classification: "static",
      diagnostics: { scanOverflow: false },
      components: [
        component({
          id: "first",
          testId: "duplicate",
          tag: "button",
          domPath: "section:0/button:0",
        }),
        component({
          id: "second",
          testId: "duplicate",
          tag: "button",
          domPath: "html:0/body:1/section:0/button:1",
        }),
      ],
    },
    domManifest: {
      entries: [
        manifest({ testId: "duplicate", tag: "button" }),
        manifest({ testId: "missing-feed-action", tag: "button" }),
      ],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.summary.missingCount, 1);
  assert.equal(result.summary.duplicateMatchCount, 1);
  assert.equal(result.summary.outsideDocumentBodyCount, 1);
  assert.equal(result.missing[0].identity.value, "missing-feed-action");
});

test("mapper live verifier independently exports map and DOM evidence", async () => {
  const [background, inspector, inspectorHtml, constants, mapper, stressFixture] = await Promise.all([
    readFile(new URL("BRunner/background.js", root), "utf8"),
    readFile(new URL("BRunner/mapper-inspector/app.js", root), "utf8"),
    readFile(new URL("BRunner/mapper-inspector/index.html", root), "utf8"),
    readFile(new URL("BRunner/core/constants.js", root), "utf8"),
    readFile(new URL("BRunner/content/mapper.js", root), "utf8"),
    readFile(new URL("BRunner_Host/mapper_stress_test.html", root), "utf8"),
  ]);

  assert.match(constants, /VerifyMapperAcceptance: "VERIFY_MAPPER_ACCEPTANCE"/);
  assert.match(background, /verifyCurrentPageMapperAcceptance/);
  assert.match(background, /chrome\.scripting\.executeScript/);
  assert.match(background, /collectMapperAcceptanceFrameManifest/);
  assert.match(background, /verifyMapperAcceptanceSnapshot/);
  assert.match(background, /snapshotMode: "settled_current_dom"/);
  assert.match(background, /passive_text_over_180_chars/);
  assert.match(background, /entry\.eligible !== false/);
  assert.match(background, /excludedCandidateCount/);
  assert.match(inspectorHtml, /id="btn-verify-export"/);
  assert.match(inspector, /verifyAndExportActivePage/);
  assert.match(inspector, /downloadMapperAcceptanceExport/);
  assert.match(inspector, /brunner-mapper-verification-/);
  assert.match(mapper, /MAPPER_FACT_WORK_PER_COMPONENT = 256/);
  assert.match(mapper, /domPath: this\.getMapperDomPath\(element\)/);
  assert.match(stressFixture, /data-testid="infinite-feed"/);
  assert.match(stressFixture, /data-testid="feed-action-\$\{recordKey\}"/);
  assert.match(stressFixture, /id="event-log"/);
});

test("DOM manifest exclusions are not reported as missing mapper records", () => {
  const result = verifyMapperAcceptanceSnapshot({
    pageMap: {
      status: "ready",
      classification: "hybrid_dynamic",
      diagnostics: { scanOverflow: false },
      components: [],
    },
    domManifest: {
      entries: [{
        expectedMapped: false,
        eligible: false,
        exclusionReason: "passive_text_over_180_chars",
        frameId: 0,
        tag: "pre",
        id: "event-log",
        domPath: "html:0/body:1/main:1/section:7/pre:2",
      }],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.expectedDomElementCount, 0);
  assert.equal(result.summary.missingCount, 0);
});

function component({
  id,
  technicalId = id,
  testId = "",
  tag,
  domPath,
}) {
  return {
    componentId: `component-${id}`,
    status: "same",
    displayName: id,
    fingerprint: {
      semantic: {
        stableAttributes: testId ? { "data-testid": testId } : {},
      },
      structural: {
        frameScope: {
          path: "top",
        },
      },
      technical: {
        id: technicalId,
        tag,
        domPath,
      },
    },
  };
}

function manifest({
  testId = "",
  id = "",
  tag,
  domPath = "",
}) {
  return {
    expectedMapped: true,
    frameId: 0,
    frameUrl: "http://127.0.0.1:8765/BRunner_Host/mapper_stress_test.html",
    tag,
    id,
    domPath,
    identity: testId
      ? {
          attribute: "data-testid",
          value: testId,
        }
      : null,
  };
}
