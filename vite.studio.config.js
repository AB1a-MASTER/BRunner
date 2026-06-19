import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./BRunner/studio-graph-src", import.meta.url)),
  base: "./",
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("./BRunner/studio-graph", import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    target: "chrome120",
  },
});
