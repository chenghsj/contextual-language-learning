import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { CustomGenerationRequestSchema, CustomDocumentSchema } from "@immersive/core";
import { planCustomJob } from "../generation/custom-pipeline";
import {
  publishCustomDriveDocument,
  getCustomDriveDocument,
  listCustomDriveDocuments,
  findCustomDriveDuplicates,
  type CustomDrivePorts,
} from "./api";

test("custom Drive upload commits metadata last, retries partial upload without duplicates and restores checked content", async () => {
  const request = CustomGenerationRequestSchema.parse({
    id: randomUUID(),
    kind: "custom",
    source: { platform: "import", title: "Source" },
    agent: { provider: "openai", modelId: "pinned" },
    prompt: "Summarize",
    context: { title: true, subtitles: true },
    cues: [{ id: "original", startMs: 0, endMs: 1000, originalText: "Dialogue" }],
  });
  const job = planCustomJob(request, {
    agent: request.agent,
    contextWindow: 16384,
    maxOutputTokens: 4096,
  });
  const document = CustomDocumentSchema.parse({
    schemaVersion: "custom-v1",
    kind: "custom",
    id: request.id,
    title: "自訂筆記",
    createdAt: new Date().toISOString(),
    request,
    execution: job.execution,
    markdown: "# 自訂\n\nSource-backed notes.",
  });
  const files: Awaited<ReturnType<CustomDrivePorts["files"]>> = [];
  const contents = new Map<string, Buffer>();
  let failMetadata = true,
    uploads = 0;
  const ports: CustomDrivePorts = {
    files: async (_account, id) =>
      files.filter(file => !id || file.appProperties?.immersiveDocumentId === id),
    fetch: async (_account, url) =>
      new Response(new Uint8Array(contents.get(url.match(/\/files\/([^?]+)/)![1])!)),
    folder: async () => "folder",
    upload: async (_account, _folder, name, _mime, bytes, properties) => {
      if (properties.immersiveFormat === "json" && failMetadata) {
        failMetadata = false;
        throw new Error("HTTP 503");
      }
      uploads++;
      const file = {
        id: randomUUID(),
        name,
        appProperties: properties,
        webViewLink: "https://drive.google.com/file/d/fixture/view",
      };
      files.push(file);
      contents.set(file.id, bytes);
      return file;
    },
  };
  await assert.rejects(publishCustomDriveDocument("account", document, ports), /503/);
  assert.equal(files.length, 1);
  assert.equal(files[0].appProperties?.immersiveFormat, "md");
  assert.deepEqual(await listCustomDriveDocuments("account", ports), []);
  await assert.rejects(getCustomDriveDocument("account", document.id, ports), /incomplete/);
  await publishCustomDriveDocument("account", document, ports);
  assert.equal(uploads, 2, "retry reuses already-uploaded Markdown");
  await publishCustomDriveDocument("account", document, ports);
  assert.equal(uploads, 2, "published versions are idempotent");
  assert.deepEqual(await getCustomDriveDocument("account", document.id, ports), document);
  assert.equal((await listCustomDriveDocuments("account", ports))[0].title, "自訂筆記");
  assert.equal(
    (await findCustomDriveDuplicates("account", job.execution.inputFingerprint, ports))[0]
      .documentId,
    document.id,
  );
  const markdownFile = files.find(file => file.appProperties?.immersiveFormat === "md")!;
  contents.set(markdownFile.id, Buffer.from("Edited elsewhere"));
  await assert.rejects(getCustomDriveDocument("account", document.id, ports), /changed outside/);
  await assert.rejects(publishCustomDriveDocument("account", document, ports), /changed outside/);
  assert.equal(uploads, 2, "conflicting remote content is never overwritten");
  markdownFile.appProperties!.immersiveContentHash = createHash("sha256")
    .update(contents.get(markdownFile.id)!)
    .digest("hex");
  await assert.rejects(
    getCustomDriveDocument("account", document.id, ports),
    /pair does not match/,
  );
  files.push({ ...markdownFile, id: randomUUID() });
  await assert.rejects(getCustomDriveDocument("account", document.id, ports), /duplicated/);
});
