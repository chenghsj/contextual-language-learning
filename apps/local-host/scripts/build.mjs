import { build } from "esbuild";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = resolve(root, "../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? "";
if (clientId && !/^[A-Za-z0-9_.-]+[.]apps[.]googleusercontent[.]com$/.test(clientId)) {
  throw new Error("GOOGLE_OAUTH_CLIENT_ID must be a Google Desktop OAuth Client ID");
}
await build({
  entryPoints: [resolve(root, "src/index.ts")],
  outfile: resolve(root, "dist/native-host.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: { js: "#!/usr/bin/env node" },
  define: { __GOOGLE_OAUTH_CLIENT_ID__: JSON.stringify(clientId) },
  logLevel: "info",
});
