import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  computeStudioBuildFingerprint,
  listStudioBuildInputs,
} from "../studioBuildFingerprint.mjs";

test("Studio build fingerprint is deterministic and changes with source input", async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "brunner-studio-fingerprint-"));

  try {
    await mkdir(path.join(repositoryRoot, "BRunner", "studio-graph-src", "src"), {
      recursive: true,
    });
    await Promise.all([
      mkdir(path.join(repositoryRoot, "BRunner", "core"), { recursive: true }),
      mkdir(path.join(repositoryRoot, "BRunner", "shared"), { recursive: true }),
      mkdir(path.join(repositoryRoot, "BRunner", "icons"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(repositoryRoot, "package.json"), "{}\n"),
      writeFile(path.join(repositoryRoot, "package-lock.json"), "{}\n"),
      writeFile(path.join(repositoryRoot, "vite.studio.config.js"), "export default {};\n"),
      writeFile(path.join(repositoryRoot, "studioBuildFingerprint.mjs"), "export {};\n"),
      writeFile(
        path.join(repositoryRoot, "BRunner", "studio-graph-src", "src", "z.jsx"),
        "export const z = 1;\n",
      ),
      writeFile(
        path.join(repositoryRoot, "BRunner", "studio-graph-src", "src", "a.jsx"),
        "export const a = 1;\n",
      ),
      writeFile(
        path.join(repositoryRoot, "BRunner", "studio-graph-src", "src", "main.jsx"),
        [
          'import "../../core/external.js";',
          'import "../../shared/tokens.css";',
          "export const main = true;",
          "",
        ].join("\n"),
      ),
      writeFile(
        path.join(repositoryRoot, "BRunner", "core", "external.js"),
        'export { nested } from "./nested.js";\n',
      ),
      writeFile(
        path.join(repositoryRoot, "BRunner", "core", "nested.js"),
        "export const nested = 1;\n",
      ),
      writeFile(
        path.join(repositoryRoot, "BRunner", "shared", "tokens.css"),
        '.brand { background-image: url("../icons/icon.png"); }\n',
      ),
      writeFile(
        path.join(repositoryRoot, "BRunner", "icons", "icon.png"),
        Buffer.from([0, 1, 2, 3]),
      ),
    ]);

    const inputs = await listStudioBuildInputs(repositoryRoot);
    const first = await computeStudioBuildFingerprint(repositoryRoot);
    const second = await computeStudioBuildFingerprint(repositoryRoot);

    assert.deepEqual(inputs, [...inputs].sort());
    assert.deepEqual(first, second);
    assert.equal(first.version, 2);
    assert.equal(first.algorithm, "sha256");
    for (const externalInput of [
      "BRunner/core/external.js",
      "BRunner/core/nested.js",
      "BRunner/shared/tokens.css",
      "BRunner/icons/icon.png",
    ]) {
      assert.equal(inputs.includes(externalInput), true, externalInput);
    }

    await writeFile(
      path.join(repositoryRoot, "BRunner", "core", "nested.js"),
      "export const nested = 2;\n",
    );
    const externalChanged = await computeStudioBuildFingerprint(repositoryRoot);
    assert.notEqual(externalChanged.inputHash, first.inputHash);

    await writeFile(
      path.join(repositoryRoot, "BRunner", "icons", "icon.png"),
      Buffer.from([0, 1, 2, 4]),
    );
    const assetChanged = await computeStudioBuildFingerprint(repositoryRoot);
    assert.notEqual(assetChanged.inputHash, externalChanged.inputHash);

    await writeFile(
      path.join(repositoryRoot, "BRunner", "studio-graph-src", "src", "a.jsx"),
      "export const a = 2;\n",
    );
    const changed = await computeStudioBuildFingerprint(repositoryRoot);
    assert.notEqual(changed.inputHash, assetChanged.inputHash);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});
