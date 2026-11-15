import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "../apps/extension/node_modules/playwright/index.mjs";

// Keep every platform's branding derived from the supplied original artwork.
const root = new URL("../", import.meta.url);
const source = await readFile(new URL("assets/branding/icon.png", root));
const image = "data:image/png;base64," + source.toString("base64");
const web = "apps/web/public/icons/";
const extension = "apps/extension/public/icons/";
const catalog = "apps/ios/ContextualLearning/Resources/Assets.xcassets/";
const appIcon = catalog + "AppIcon.appiconset/";
for (const path of [web, extension, appIcon]) await mkdir(new URL(path, root), { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  async function png(path, size, background, scale = 1) {
    const data = await page.evaluate(
      async ({ image, size, background, scale }) => {
        const artwork = new Image();
        artwork.src = image;
        await artwork.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const context = canvas.getContext("2d", { alpha: !background });
        if (background) {
          context.fillStyle = background;
          context.fillRect(0, 0, size, size);
        }
        context.imageSmoothingQuality = "high";
        const padding = (size * (1 - scale)) / 2;
        context.drawImage(artwork, padding, padding, size * scale, size * scale);
        return canvas.toDataURL("image/png").split(",")[1];
      },
      { image, size, background, scale },
    );
    await writeFile(new URL(path, root), Buffer.from(data, "base64"));
  }
  for (const size of [16, 32, 48]) await png(extension + `icon${size}.png`, size);
  await writeFile(new URL(extension + "icon128.png", root), source);
  for (const size of [180, 192, 512]) await png(web + `icon${size}.png`, size);
  // Maskable launchers may crop to a circle; keep the artwork in the safe area.
  await png(web + "icon-maskable512.png", 512, "#faf9f5", 0.7);
  await png(appIcon + "AppIcon.png", 1024, "#faf9f5", 0.8);
  execFileSync("swift", [
    "-module-cache-path",
    join(tmpdir(), "cll-icon-swift-cache"),
    fileURLToPath(new URL("scripts/opaque-icon.swift", root)),
    fileURLToPath(new URL(appIcon + "AppIcon.png", root)),
  ]);
} finally {
  await browser.close();
}

await writeFile(
  new URL(web + "icon.svg", root),
  `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><image width="128" height="128" href="${image}"/></svg>\n`,
);
await writeFile(
  new URL(catalog + "Contents.json", root),
  JSON.stringify({ info: { author: "xcode", version: 1 } }, null, 2) + "\n",
);
await writeFile(
  new URL(appIcon + "Contents.json", root),
  JSON.stringify(
    {
      images: [{ filename: "AppIcon.png", idiom: "universal", platform: "ios", size: "1024x1024" }],
      info: { author: "xcode", version: 1 },
    },
    null,
    2,
  ) + "\n",
);
const callback = new URL("apps/local-host/src/drive/oauth-callback-page.ts", root);
const callbackSource = await readFile(callback, "utf8");
const embedded = await readFile(new URL(extension + "icon48.png", root));
await writeFile(
  callback,
  callbackSource.replace(
    /data:image\/png;base64,[A-Za-z0-9+/=]+/,
    "data:image/png;base64," + embedded.toString("base64"),
  ),
);
// Vite serves updated public assets, but Chrome reads installed icons from disk.
// Update only icons in existing outputs so the running CRXJS HMR loaders survive.
for (const output of ["dist-dev", "dist"]) {
  try {
    await readFile(new URL(`apps/extension/${output}/manifest.json`, root));
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  const destination = new URL(`apps/extension/${output}/icons/`, root);
  await mkdir(destination, { recursive: true });
  for (const size of [16, 32, 48, 128])
    await copyFile(
      new URL(extension + `icon${size}.png`, root),
      new URL(`icon${size}.png`, destination),
    );
}
console.log("Updated extension, web/PWA, iOS and OAuth brand icons.");
