import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, "sidepanel.html"),
        background: resolve(__dirname, "src/background.ts"),
        youtube: resolve(__dirname, "src/content/youtube.ts"),
        netflix: resolve(__dirname, "src/content/netflix.ts"),
        netflixPage: resolve(__dirname, "src/content/netflix-page.ts"),
      },
      output: {
        entryFileNames: chunk => {
          if (chunk.name === "background") return "background.js";
          if (chunk.name === "youtube") return "youtube.js";
          if (chunk.name === "netflix") return "netflix.js";
          if (chunk.name === "netflixPage") return "netflix-page.js";
          return "assets/[name]-[hash].js";
        },
      },
    },
  },
});
