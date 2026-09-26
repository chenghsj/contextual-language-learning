import { build } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The Manifest loads content scripts as classic scripts, not ES modules.
// Build each entry in its own IIFE to prevent Rollup from extracting shared
// chunks and leaving `import{...}from"./assets/..."` in the entrypoints.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entries = [
  ["youtube", "youtube.ts"],
  ["youtube-page", "youtube-page.ts"],
  ["netflix", "netflix.ts"],
  ["netflix-page", "netflix-page.ts"],
];
for (const [name, filename] of entries) {
  await build({
    configFile: false,
    root,
    logLevel: "warn",
    build: {
      outDir: resolve(root, "dist"),
      emptyOutDir: false,
      target: "chrome114",
      minify: "esbuild",
      sourcemap: false,
      lib: {
        entry: resolve(root, "src/content", filename),
        name: "Immersive" + name.replace(/(^|-)([a-z])/g, (_all, _dash, letter) => letter.toUpperCase()),
        formats: ["iife"],
        fileName: () => name + ".js",
      },
      rollupOptions: {
        output: { inlineDynamicImports: true },
      },
    },
  });
}
