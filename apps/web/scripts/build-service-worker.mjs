import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../dist/", import.meta.url));
const files = (await readdir(root, { recursive: true })).filter(
  f => /\.(js|css|html|woff2|svg|png|webmanifest)$/.test(f) && f !== "sw.js",
);
const hash = createHash("sha256");
for (const file of [...files].sort()) hash.update(await readFile(root + file));
const cache = "cll-web-shell-" + hash.digest("hex").slice(0, 12);
await writeFile(
  root + "sw.js",
  `const CACHE=${JSON.stringify(cache)}; const FILES=${JSON.stringify(files.map(f => (f === "index.html" ? "/" : "/" + f)))};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('cll-web-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname==='/sw.js')return;
if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(()=>caches.open(CACHE).then(cache=>cache.match('/'))));return;}
if(FILES.includes(url.pathname))event.respondWith(caches.open(CACHE).then(cache=>cache.match(url.pathname)).then(cached=>cached||fetch(event.request)));});`,
);
