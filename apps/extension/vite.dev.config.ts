import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { crx, defineManifest } from "@crxjs/vite-plugin";
import { resolve } from "node:path";
import releaseManifest from "./public/manifest.json";

// CRXJS consumes source entries; the release manifest points to built files.
// Keep this config separate so the existing release packaging stays intact.
const manifest = defineManifest({
  ...releaseManifest,
  name: "Contextual Language Learning (Dev)",
  manifest_version: 3,
  background: { service_worker: "src/background.ts", type: "module" },
  content_scripts: releaseManifest.content_scripts.map(script => ({
    ...script,
    world: script.world === "MAIN" ? "MAIN" : "ISOLATED",
    js: script.js.map(filename => "src/content/" + filename.replace(/\.js$/, ".ts")),
  })),
});

export default defineConfig(({ command }) => {
  // A production build here would remove the HMR loaders while Chrome still
  // holds their manifest, disconnecting both the Side Panel and video readers.
  if (command === "build") {
    throw new Error(
      "Use pnpm --filter @contextual/extension build. This config is only for pnpm dev; building it would overwrite the loaded HMR extension in dist-dev.",
    );
  }
  return {
    // Preview/acceptance servers use vite.config.ts. Their dependency optimizer
    // must not replace the React chunks still loaded by the running extension.
    cacheDir: "node_modules/.vite-extension",
    plugins: [
      react(),
      tailwindcss(),
      crx({
        manifest,
        // These MAIN-world bridges patch player APIs before the page runs.
        contentScripts: {
          standaloneFiles: ["src/content/youtube-page.ts", "src/content/netflix-page.ts"],
        },
      }),
    ],
    resolve: { alias: { "@": resolve(__dirname, "src") } },
    server: {
      host: "127.0.0.1",
      port: 5174,
      strictPort: true,
      hmr: { host: "127.0.0.1", clientPort: 5174 },
      cors: { origin: /^chrome-extension:\/\// },
    },
    build: { outDir: "dist-dev", emptyOutDir: true },
  };
});
