/** Opt-in live model acceptance using isolated storage; never changes the original failed task. */
import { readFile, writeFile, mkdtemp, mkdir } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EXPLANATION_TYPES,
  readLearningDocument,
  pronunciationMissingCount,
  type GenerationRequest,
} from "@contextual/core";
import { JobManager } from "../src/jobs/manager";
import { localStoragePorts } from "../src/storage/file";
const originalPath = process.argv.find(a => a.startsWith("--source-job="))?.slice(13);
if (!originalPath) throw new Error("--source-job=<existing failed MV checkpoint> required");
const original = JSON.parse(await readFile(originalPath, "utf8"));
const originalHash = createHash("sha256")
  .update(await readFile(originalPath))
  .digest("hex");
const resumeRoot = process.argv.find(a => a.startsWith("--resume-root="))?.slice(14);
const root = resumeRoot ?? (await mkdtemp(join(tmpdir(), "cll-reading-quality-")));
const reportName = resumeRoot ? `resume-report-${Date.now()}.json` : "report.json";
const model = { ...original.request.agent, thinkingLevel: "medium" as const };
const filter = process.argv.find(a => a.startsWith("--case="))?.slice(7);
const detailedPronunciation = process.argv.includes("--pronunciation-detailed");
const mvBase = { ...original.request, agent: model };
const requests: { name: string; request: GenerationRequest }[] = [
  ...[false, true].map(detailed => ({
    name: "ja-mv-" + (detailed ? "detailed" : "normal"),
    request: {
      ...mvBase,
      id: randomUUID(),
      profile: {
        ...mvBase.profile,
        emphasizedExplanations: detailed ? [...EXPLANATION_TYPES] : [],
      },
      destination: undefined,
    },
  })),
  ...[
    {
      name: "ja-monologue",
      language: "ja" as const,
      level: "N3",
      lines: [
        "今日は、忘れ物を減らす方法について話します。",
        "私は出かける前に、財布と鍵とメモを確認しています。",
        "最初は面倒でしたが、習慣にすると安心です。",
        "友達からメッセージが来ても、確認を終えてから返事をします。",
      ],
    },
    {
      name: "ko-readings",
      language: "ko" as const,
      level: "3",
      lines: [
        "오늘은 학교 도서관에 가려고 해요.",
        "학교까지 걸어서 가요?",
        "아니요. 버스를 타고 갈 거예요.",
        "그럼 도착하면 연락해 주세요.",
      ],
    },
    {
      name: "en-ipa",
      language: "en" as const,
      level: "B1",
      lines: [
        "Have you finished the report?",
        "Almost. I still need to check the figures.",
        "Can you send it before lunch?",
        "Yes, I will send it as soon as it is ready.",
      ],
    },
  ].map(c => ({
    name: c.name,
    request: {
      id: randomUUID(),
      outputSchemaVersion: 7 as const,
      source: { platform: "import" as const, title: c.name },
      agent: model,
      profile: {
        targetLanguage: c.language,
        instructionLanguage: "zh-TW" as const,
        level: c.level,
        sceneCount: 2 as const,
        contextualExampleCount: 1,
        enabledExplanations: [...EXPLANATION_TYPES],
        emphasizedExplanations: detailedPronunciation ? ["pronunciation"] : [],
      },
      cues: c.lines.map((originalText, i) => ({
        id: `c${i + 1}`,
        originalText,
        startMs: i * 3000,
        endMs: i * 3000 + 2800,
      })),
    },
  })),
];
console.log(
  JSON.stringify({
    root,
    sourceJob: originalPath,
    originalHash,
    model,
    cases: requests.filter(c => !filter || c.name === filter).map(c => c.name),
  }),
);
const results: any[] = [];
for (const sourceCase of requests) {
  const { name } = sourceCase;
  let request = sourceCase.request;
  if (resumeRoot && !name.startsWith("ja-mv")) continue;
  if (filter && name !== filter) continue;
  const folder = join(root, name);
  await mkdir(folder, { recursive: true });
  const storage = localStoragePorts(folder),
    manager = new JobManager({ storage }, (_id, j) =>
      console.log(
        JSON.stringify({
          name,
          phase: j.phase,
          status: j.status,
          completed: j.completed,
          total: j.total,
          readingGaps: j.pronunciationMissingCount,
        }),
      ),
    );
  if (resumeRoot) {
    const saved = (await storage.jobs.list(1))[0];
    const job = saved && (await storage.jobs.get(saved.id));
    if (!job) throw new Error("Missing resume job");
    request = job.request;
  }
  const started = Date.now();
  try {
    const document = resumeRoot
      ? await manager.resume(request.id, request.id, AbortSignal.timeout(600000))
      : await manager.start(request.id, request, AbortSignal.timeout(600000));
    readLearningDocument(document);
    if (document.schemaVersion !== 7) throw new Error("Expected V6");
    if (!isDeepStrictEqual(document.cues, request.cues)) throw new Error("Source evidence changed");
    results.push({
      name,
      status: "generated",
      durationMs: Date.now() - started,
      documentId: document.id,
      storageRoot: folder,
      sourceUnchanged: true,
      scenes: document.sections.length,
      points: document.points.length,
      reusableItems: document.reusableItems.length,
      readingGaps: pronunciationMissingCount(document.execution?.pronunciationDiagnostics),
      settings: request.profile,
      execution: document.execution,
      qualityReview: "pending",
    });
  } catch (error) {
    results.push({
      name,
      status: "failed",
      durationMs: Date.now() - started,
      error: String(error),
      settings: request.profile,
      execution: (await storage.jobs.get(request.id))?.execution,
    });
  }
  console.log(JSON.stringify({ name, result: results.at(-1).status, error: results.at(-1).error }));
  await writeFile(
    join(root, reportName),
    JSON.stringify({ root, model, originalHash, results }, null, 2),
  );
}
if (
  createHash("sha256")
    .update(await readFile(originalPath))
    .digest("hex") !== originalHash
)
  throw new Error("Original job was modified");
console.log(
  JSON.stringify({
    finished: true,
    root,
    passed: results.filter(r => r.status === "generated").length,
    total: results.length,
    originalJobUnchanged: true,
  }),
);
