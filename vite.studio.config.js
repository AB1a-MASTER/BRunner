import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { computeStudioBuildFingerprint } from "./studioBuildFingerprint.mjs";

function studioBuildFingerprint() {
  return {
    name: "brunner-studio-build-fingerprint",
    apply: "build",
    async generateBundle() {
      const metadata = await computeStudioBuildFingerprint();
      this.emitFile({
        type: "asset",
        fileName: "build-meta.json",
        source: `${JSON.stringify(metadata, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL("./BRunner/studio-graph-src", import.meta.url)),
  base: "./",
  plugins: [react(), studioBuildFingerprint()],
  build: {
    outDir: fileURLToPath(new URL("./BRunner/studio-graph", import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    target: "chrome120",
  },
});
