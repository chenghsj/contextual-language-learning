import { build } from "esbuild";
import { piBundlePlugin, piRequireBanner } from "./pi-bundle.mjs";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version: hostVersion } = JSON.parse(readFileSync(resolve(root, "../../package.json"), "utf8"));
if (typeof hostVersion !== "string" || !/^\d+\.\d+\.\d+/.test(hostVersion)) {
  throw new Error("Invalid Native Host package version");
}
const envFile = resolve(root, "../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? "";
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "";
if (clientId && !/^[A-Za-z0-9_.-]+[.]apps[.]googleusercontent[.]com$/.test(clientId)) {
  throw new Error("GOOGLE_OAUTH_CLIENT_ID must be a Google Desktop OAuth Client ID");
}
if (clientSecret.length > 512) throw new Error("GOOGLE_OAUTH_CLIENT_SECRET is too long");
await build({
  plugins: [piBundlePlugin],
  entryPoints: [resolve(root, "src/index.ts")],
  outfile: resolve(root, "dist/native-host.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: { js: "#!/usr/bin/env node\n" + piRequireBanner },
  define: {
    __GOOGLE_OAUTH_CLIENT_ID__: JSON.stringify(clientId),
    __GOOGLE_OAUTH_CLIENT_SECRET__: JSON.stringify(clientSecret),
    __IMMERSIVE_HOST_VERSION__: JSON.stringify(hostVersion),
  },
  logLevel: "info",
});
