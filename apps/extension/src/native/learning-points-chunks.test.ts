import test from "node:test";
import assert from "node:assert/strict";
import {
  pointsFixture,
  withReadingDiagnostics,
} from "../../../../packages/core/test/learning-points-fixture";
import { DocumentChunkAssembler } from "./document-chunks";
test("V6 chunk transport retains points and validates source references", () => {
  const document = withReadingDiagnostics(pointsFixture().document);
  document.cues[0].ruby = [{ start: 0, end: 2, reading: "source reading", position: "under" }];
  const bytes = Buffer.from(JSON.stringify(document)),
    assembler = new DocumentChunkAssembler();
  const size = 333,
    total = Math.ceil(bytes.length / size);
  let result;
  for (let index = total - 1; index >= 0; index--)
    result = assembler.push({
      id: "wire",
      type: "documentChunk",
      documentId: document.id,
      index,
      total,
      dataBase64: bytes.subarray(index * size, (index + 1) * size).toString("base64"),
    });
  assert.deepEqual(result, JSON.parse(JSON.stringify(document)));
  document.points[0].sourceCueIds = ["invented"];
  assert.throws(() =>
    new DocumentChunkAssembler().push({
      id: "bad",
      type: "documentChunk",
      documentId: document.id,
      index: 0,
      total: 1,
      dataBase64: Buffer.from(JSON.stringify(document)).toString("base64"),
    }),
  );
});
