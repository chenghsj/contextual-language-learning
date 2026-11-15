import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pointsFixture } from "../../../packages/core/test/learning-points-fixture";
import { listGoogleAccounts } from "../src/drive/oauth";
import { createFavoriteDrive } from "../src/drive/favorites";
import { googleFetch } from "../src/drive/api";
import { createFavoritesService, favoriteCollectionId } from "../src/favorites/service";

const email = process.argv[2];
if (!email) throw new Error("Pass the explicitly selected Google test account email");
const account = (await listGoogleAccounts()).find(item => item.email === email);
if (!account) throw new Error("Selected Google test account is not connected");
const root = await mkdtemp(join(tmpdir(), "cll-favorites-live-"));
const namespace = "favorites-verification-" + randomUUID();
const document = pointsFixture().document;
document.source.title = "Synthetic scene favorite verification";
const collection = { kind: "account" as const, accountId: account.id };
const drive = createFavoriteDrive();
const create = (name: string) =>
  createFavoritesService({
    root: join(root, name),
    loadDocument: async () => document,
    drive,
    namespace,
  });
const a = create("a"),
  b = create("b");
const identity = { documentId: document.id, sceneId: document.sections[0].id };
const checks: string[] = [];
async function synced(service: ReturnType<typeof create>) {
  const result = await service.sync(collection);
  assert.equal(result.state, "synced", result.issue);
}
for (const service of [a, b])
  await service.configure({
    kind: "enable",
    accountId: account.id,
    importLocal: false,
    mutationId: randomUUID(),
  });
await a.set({ ...identity, collection, desired: true, mutationId: randomUUID() });
await synced(a);
await synced(b);
let page = await b.list(collection, { limit: 40 });
assert.equal(page.items.length, 1);
assert.equal((await b.get(collection, page.items[0].key)).scene.title, document.sections[0].title);
checks.push("A added, B downloaded and read exact synthetic scene");
await a.set({ ...identity, collection, desired: false, mutationId: randomUUID() });
await b.set({ ...identity, collection, desired: true, mutationId: randomUUID() });
await synced(b);
await synced(a);
await synced(b);
assert.equal((await b.list(collection, { limit: 40 })).items.length, 0);
checks.push("Offline concurrent cancellation wins on both stores");
await b.set({ ...identity, collection, desired: true, mutationId: randomUUID() });
await synced(b);
await synced(a);
assert.equal((await a.list(collection, { limit: 40 })).items.length, 1);
checks.push("Observed explicit re-add converges");
const restarted = create("a");
await synced(restarted);
assert.equal((await restarted.list(collection, { limit: 40 })).items.length, 1);
checks.push("Restarted service reads persisted favorite and resumes sync");
await restarted.set({ ...identity, collection, desired: false, mutationId: randomUUID() });
await synced(restarted);
await synced(b);
assert.equal((await b.list(collection, { limit: 40 })).items.length, 0);
checks.push("Final cancellation leaves no active test favorite");
const files = await drive.list(account.id, favoriteCollectionId(collection, namespace));
for (const file of files)
  await googleFetch(
    account.id,
    "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(file.id),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    },
  );
const report = {
  account: email,
  syntheticOnly: true,
  namespace,
  collectionId: favoriteCollectionId(collection, namespace),
  localRoots: [join(root, "a"), join(root, "b")],
  checks,
  remoteOperations: files.length,
  remoteFileIds: files.map(file => file.id),
  activeFavorites: 0,
  cleanup: { trashedTestOperations: files.length, reversible: true },
};
await writeFile(join(root, "result.json"), JSON.stringify(report, null, 2));
process.stdout.write(
  JSON.stringify({ ...report, evidence: join(root, "result.json") }, null, 2) + "\n",
);
