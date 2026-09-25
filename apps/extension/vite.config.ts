import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, "sidepanel.html"),
        background: resolve(__dirname, "src/background.ts"),
        youtube: resolve(__dirname, "src/content/youtube.ts"),
      },
      output: {
        entryFileNames: chunk => {
          if (chunk.name === "background") return "background.js";
          if (chunk.name === "youtube") return "youtube.js";
          return "assets/[name]-[hash].js";
        },
      },
    },
  },
});
