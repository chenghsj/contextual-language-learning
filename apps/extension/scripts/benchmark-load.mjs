// Production-mode App + existing simulated browser/Host fixture, in a fresh browser context per run.
// This does not measure installed extension startup, real Native Messaging, or model latency.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { build, preview } from "vite";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const reused = process.env.CLL_PERF_REUSE
  ? JSON.parse(await readFile(process.env.CLL_PERF_REUSE, "utf8"))
  : null;
const output = reused?.artifactsDir ?? (await mkdtemp(join(tmpdir(), "cll-load-")));
const reportPath = resolve(process.argv[2] ?? join(output, "report.json"));
const runs = Number(process.env.CLL_PERF_RUNS ?? 5);
assert.ok(Number.isInteger(runs) && runs > 0 && runs <= 20);
const graphs = reused?.graphs ?? {};
function graph(name) {
  return {
    name: "load-benchmark-graph",
    generateBundle(_options, bundle) {
      graphs[name] = Object.values(bundle)
        .filter(item => item.type === "chunk")
        .map(chunk => ({
          file: chunk.fileName,
          bytes: Buffer.byteLength(chunk.code),
          gzipBytes: gzipSync(chunk.code).length,
          isEntry: chunk.isEntry,
          imports: chunk.imports,
          dynamicImports: chunk.dynamicImports,
          modules: Object.entries(chunk.modules)
            .map(([id, info]) => ({
              id: id.replace(root, "<extension>"),
              bytes: info.renderedLength,
            }))
            .sort((a, b) => b.bytes - a.bytes),
        }));
    },
  };
}
for (const name of reused ? [] : ["release"]) {
  await build({
    root,
    configFile: join(root, "vite.config.ts"),
    logLevel: "warn",
    plugins: [graph(name)],
    build: {
      outDir: join(output, name),
      emptyOutDir: true,
    },
  });
}
// Inject only the existing browser/Host adapter. The UI comes from the exact release HTML/JS.
const require = createRequire(import.meta.url);
const { build: bundleFixture } = createRequire(require.resolve("vite/package.json"))("esbuild");
const fixtureSource = (await readFile(join(root, "dev/redesign-preview.tsx"), "utf8"))
  .replace(/^import React from "react";\n/m, "")
  .replace(/^import \{ createRoot \} from "react-dom\/client";\n/m, "")
  .replace(/^import App from "\.\.\/src\/App";\n/m, "")
  .replace(/^import "\.\.\/src\/styles.css";\n/m, "")
  .replace(/^createRoot\(document.getElementById\("root"\)!\)\.render\(<App \/>\);\n?/m, "");
assert.ok(!fixtureSource.includes("createRoot") && !fixtureSource.includes("import App from"));
const fixtureBundle = await bundleFixture({
  stdin: { contents: fixtureSource, resolveDir: join(root, "dev"), loader: "tsx" },
  bundle: true,
  format: "iife",
  platform: "browser",
  write: false,
  define: { "process.env.NODE_ENV": '"production"' },
});
const fixtureSetup = fixtureBundle.outputFiles[0].text;
await writeFile(join(output, "fixture-setup.js"), fixtureSetup);
for (const chunk of graphs.release) {
  const bytes = await readFile(join(output, "release", chunk.file));
  chunk.bytes = bytes.length;
  chunk.gzipBytes = gzipSync(bytes).length;
}
const server = await preview({
  root,
  configFile: join(root, "vite.config.ts"),
  build: { outDir: join(output, "release") },
  preview: { host: "127.0.0.1", port: 0, strictPort: true },
  logLevel: "warn",
});
let browser;
const samples = [];
const deadline = setTimeout(() => {
  console.error("Load benchmark exceeded 120 seconds");
  process.exit(1);
}, 120_000);
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  for (let run = 0; run < runs; run++) {
    const context = await browser.newContext({ viewport: { width: 400, height: 800 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("Performance.enable");
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript({ content: fixtureSetup });
    await page.addInitScript(() => {
      window.loadBenchmark = { longTasks: [] };
      new PerformanceObserver(list => {
        window.loadBenchmark.longTasks.push(...list.getEntries().map(entry => entry.duration));
      }).observe({ type: "longtask", buffered: true });
    });
    const finish = async () => {
      const sample = await page.evaluate(
        () =>
          new Promise(resolve =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                const resources = performance
                  .getEntriesByType("resource")
                  .filter(entry => new URL(entry.name).pathname.endsWith(".js"));
                resolve({
                  ms: performance.now() - (window.loadBenchmark.start ?? 0),
                  jsBytes: resources.reduce((total, entry) => total + entry.decodedBodySize, 0),
                  jsFiles: resources.map(entry => new URL(entry.name).pathname),
                  longTaskMs: window.loadBenchmark.longTasks.reduce((a, b) => a + b, 0),
                  fcpMs:
                    performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
                });
              }),
            ),
          ),
      );
      const metrics = Object.fromEntries(
        (await cdp.send("Performance.getMetrics")).metrics.map(metric => [
          metric.name,
          metric.value,
        ]),
      );
      return { ...sample, scriptMs: metrics.ScriptDuration * 1000 };
    };
    async function action(locator, ready) {
      await locator.evaluate(element => {
        window.loadBenchmark.start = performance.now();
        element.click();
      });
      await ready.waitFor();
      return finish();
    }
    await page.goto(server.resolvedUrls.local[0] + "sidepanel.html?motion=reduced");
    await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
    const sample = { create: await finish() };
    sample.library = await action(
      page.locator("#page-nav-lessons"),
      page
        .locator(
          '#page-panel-lessons [data-ui="library-entry"], #page-panel-lessons [data-ui="library-group"]',
        )
        .first(),
    );
    const group = page
      .locator('#page-panel-lessons [data-ui="library-group"] button[aria-expanded]')
      .first();
    if (await group.count()) await group.click();
    sample.reader = await action(
      page
        .locator('#page-panel-lessons [data-ui="library-entry"]')
        .getByRole("button", { name: "開啟教材", exact: true })
        .first(),
      page.locator('[data-ui="unifiedReader"]'),
    );
    await page.locator('[data-ui="reader-header"] button').first().click();
    sample.settings = await action(
      page.locator("#header-settings"),
      page.locator("#page-panel-settings"),
    );
    sample.general = await action(
      page.locator("#page-panel-settings").getByRole("button", { name: /^一般/ }),
      page.locator('#page-panel-settings section[aria-label="系統朗讀"]'),
    );
    assert.deepEqual(errors, []);
    samples.push(sample);
    console.log("PASS production fixture run " + (run + 1));
    await context.close();
  }
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = Object.fromEntries(
    Object.keys(samples[0]).map(stage => [
      stage,
      Object.fromEntries(
        ["ms", "jsBytes", "longTaskMs", "scriptMs", "fcpMs"].map(metric => [
          metric,
          median(samples.map(sample => sample[stage][metric])),
        ]),
      ),
    ]),
  );
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        artifactsDir: output,
        environment: {
          browser: await browser.version(),
          cpuThrottle: 4,
          viewport: [400, 800],
          runs,
          network: "local, unthrottled",
          cache: "fresh context each run",
          fixture:
            "exact release sidepanel.html/JS with injected simulated browser/Host adapter; reduced motion",
          order: ["create", "library", "reader", "settings", "general"],
        },
        summary,
        samples,
        graphs,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ reportPath, output, summary }, null, 2));
} finally {
  clearTimeout(deadline);
  await browser?.close();
  server.httpServer.closeAllConnections();
  await new Promise(resolve => server.httpServer.close(resolve));
}
