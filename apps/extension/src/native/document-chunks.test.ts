import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { DocumentChunkAssembler } from "./document-chunks";
import { v7Fixture } from "../../dev/reader-v7-fixture";

test("reassembles UTF-8 characters split between native messages", () => {
  const id = randomUUID();
  const doc = structuredClone(v7Fixture);
  doc.id = id;
  doc.source.title = "日本語 🎬";
  const buffer = Buffer.from(JSON.stringify(doc), "utf8");
  const mid = Math.floor(buffer.length / 2);
  const assembler = new DocumentChunkAssembler();
  const chunks = [buffer.subarray(0, mid), buffer.subarray(mid)];
  assert.equal(
    assembler.push({
      id: randomUUID(),
      type: "documentChunk",
      documentId: id,
      index: 0,
      total: 2,
      dataBase64: chunks[0].toString("base64"),
    }),
    null,
  );
  assert.deepEqual(
    assembler.push({
      id: randomUUID(),
      type: "documentChunk",
      documentId: id,
      index: 1,
      total: 2,
      dataBase64: chunks[1].toString("base64"),
    }),
    doc,
  );
});
