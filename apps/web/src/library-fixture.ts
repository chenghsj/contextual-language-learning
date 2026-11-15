import { document } from "../../extension/dev/reader-fixture";
import { CustomDocumentSchema, learningDocumentToMarkdown } from "@contextual/core";
import { sha256 } from "./drive";
import type { LibraryFile, LibraryReadPort } from "./library";

export async function libraryFixture() {
  const id = crypto.randomUUID();
  const custom = CustomDocumentSchema.parse({
    schemaVersion: "custom-v1",
    kind: "custom",
    id,
    title: "雲端自訂筆記｜第10話內容理解、對話練習與完整複習教材",
    createdAt: "2026-10-23T00:00:00.000Z",
    markdown:
      "# 第10話內容理解與練習\n\n完整的自訂教材內容。可邊看影片邊閱讀，並回到需要複習的段落。\n\n" +
      Array.from(
        { length: 8 },
        (_, index) =>
          `## ${index + 1}、理解與應用\n\n**根據影片對話，哪個選項最符合角色的意思？**\n\n角色需要在不同的情境中表達自己的想法，請比較對話中的語氣與省略的資訊。\n\n- A. 先確認彼此的理解，再提出自己的看法。\n- B. 直接結束對話，不需要進一步說明。\n- C. 只按照字面解讀，不考慮上下文。\n- D. 任何選項都沒有差異。\n\n### 對話與解析\n\n「まだ決めていないけれど、もう少し考えてから話してもいいですか。」\n\n這句話保留了表達意見的空間，也讓對方知道自己仍在考慮。可以先聽一遍影片，再比較台詞與翻譯。\n\n`,
      ).join(""),
    request: {
      id,
      kind: "custom",
      source: {
        platform: "youtube",
        title: "Synthetic custom source",
        url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      },
      agent: { provider: "openai", modelId: "offline-fixture" },
      prompt: "Synthetic prompt",
      context: { subtitles: true, title: true },
      cues: [
        { id: "custom-cue", startMs: null, endMs: null, originalText: "ありがとうございます。" },
      ],
    },
    execution: {
      workflowVersion: "custom-workflow-v1",
      promptVersion: "custom-prompt-v1",
      schemaVersion: "custom-v1",
      inputFingerprint: "a".repeat(64),
      provider: "openai",
      modelId: "offline-fixture",
      contextWindow: 16384,
      maxOutputTokens: 4096,
      chunkPlan: [["custom-cue"]],
      calls: [],
    },
  });
  const files: LibraryFile[] = [],
    bodies = new Map<string, Uint8Array>(),
    reads: string[] = [];
  async function add(
    id: string,
    documentId: string,
    schema: string,
    format: string,
    title: string,
    body: string,
    language = "unspecified",
  ) {
    bodies.set(id, new TextEncoder().encode(body));
    files.push({
      id,
      name: id + "." + format,
      modifiedTime: "2026-10-23T00:00:00.000Z",
      appProperties: {
        contextualDocumentId: documentId,
        contextualSchemaVersion: schema,
        contextualFormat: format,
        contextualTitle: title,
        contextualCreatedAt: "2026-10-23T00:00:00.000Z",
        contextualLanguage: language,
        contextualContentHash: await sha256(body),
      },
    });
  }
  await add(
    "standard-json",
    document.id,
    "7",
    "json",
    "完整情境教材",
    JSON.stringify(document),
    document.profile.targetLanguage,
  );
  await add(
    "standard-md",
    document.id,
    "7",
    "md",
    "完整情境教材",
    learningDocumentToMarkdown(document),
    document.profile.targetLanguage,
  );
  const { markdown, ...metadata } = custom;
  await add(
    "custom-json",
    custom.id,
    "custom-v1",
    "json",
    custom.title,
    JSON.stringify({ ...metadata, markdownHash: await sha256(markdown) }),
  );
  await add("custom-md", custom.id, "custom-v1", "md", custom.title, markdown);
  await add(
    "legacy-json",
    "00000000-0000-4000-8000-0000000000dd",
    "5",
    "json",
    "舊版教材備份",
    JSON.stringify({
      id: "00000000-0000-4000-8000-0000000000dd",
      source: {
        platform: "youtube",
        title: "Legacy video",
        url: "https://youtu.be/M7lc1UVf-VE?t=30",
      },
    }),
    "ja",
  );
  await add(
    "legacy-md",
    "00000000-0000-4000-8000-0000000000dd",
    "5",
    "md",
    "舊版教材備份",
    "# 舊版教材備份\n\n舊版本仍然可以閱讀。",
    "ja",
  );
  let fail = false;
  const drive: LibraryReadPort = {
    async listLibrary() {
      if (fail) throw new Error("合成清單讀取失敗");
      return files;
    },
    async readLibrary(file) {
      reads.push(file.id);
      const value = bodies.get(file.id);
      if (!value) throw new Error("Missing fixture");
      return value;
    },
  };
  return {
    document,
    custom,
    files,
    bodies,
    reads,
    drive,
    setFailure: (value: boolean) => (fail = value),
  };
}
