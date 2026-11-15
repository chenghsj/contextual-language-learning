import test from "node:test";
import assert from "node:assert/strict";
import { buildRequest } from "pi-antigravity/src/stream/stream.js";
import { withAntigravityAccountDirectory } from "pi-antigravity/src/auth/accounts.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model, Context } from "@earendil-works/pi-ai";
const model: Model<any> = {
  id: "gemini-3.7-flash",
  provider: "antigravity",
  api: "antigravity-api",
  name: "Gemini",
  baseUrl: "https://example.test",
  reasoning: true,
  input: ["text"],
  contextWindow: 1048576,
  maxTokens: 65536,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const context: Context = {
  systemPrompt: "Return a JSON object.",
  messages: [{ role: "user", content: 'Return {"ok":true}.', timestamp: 0 }],
};
test("Gemini JSON mode is opt-in and preserves the selected reasoning configuration/output cap", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-json-wire-"));
  try {
    withAntigravityAccountDirectory(root, () => {
      const json = buildRequest(
        model,
        context,
        "offline-project",
        { jsonOutput: true, reasoning: "medium", maxTokens: 16384, sessionId: "offline" },
        "gemini-3.7-flash",
      );
      const normal = buildRequest(
        model,
        context,
        "offline-project",
        { reasoning: "medium", maxTokens: 16384, sessionId: "offline" },
        "gemini-3.7-flash",
      );
      assert.equal(json.request.generationConfig?.responseMimeType, "application/json");
      assert.equal(normal.request.generationConfig?.responseMimeType, undefined);
      assert.deepEqual(
        json.request.generationConfig?.thinkingConfig,
        normal.request.generationConfig?.thinkingConfig,
      );
      assert.equal(json.request.generationConfig?.maxOutputTokens, 16384);
      const claude = buildRequest(
        { ...model, id: "claude-sonnet-4-5" },
        context,
        "offline-project",
        { jsonOutput: true, reasoning: "medium" },
        "claude-sonnet-4-5",
      );
      assert.equal(claude.request.generationConfig?.responseMimeType, undefined);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import { streamAntigravity } from "pi-antigravity/src/stream/stream.js";
import { getCurrentAntigravityRouting } from "pi-antigravity/src/models/models.js";
test("a paid empty JSON response is attempted once and preserves available usage", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-empty-wire-"));
  const originalFetch = globalThis.fetch;
  let posts = 0;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "HEAD") return new Response("", { status: 200 });
    posts++;
    return new Response(
      "data: " +
        JSON.stringify({
          response: {
            candidates: [{ content: { parts: [] }, finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 10, thoughtsTokenCount: 3, totalTokenCount: 13 },
          },
        }) +
        "\n\n",
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  };
  try {
    const id = Object.keys(getCurrentAntigravityRouting()).find(id => id.startsWith("gemini-"))!;
    const result = await withAntigravityAccountDirectory(root, () =>
      streamAntigravity({ ...model, id }, context, {
        jsonOutput: true,
        reasoning: "medium",
        apiKey: JSON.stringify({ token: "offline-test-token", projectId: "offline-project" }),
        signal: AbortSignal.timeout(5000),
      }).result(),
    );
    assert.equal(posts, 1);
    assert.equal(result.stopReason, "error");
    assert.equal(result.usage.input, 10);
    assert.equal(result.usage.reasoning, 3);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test("a truncated or trailing-error paid stream is not reported as success or automatically replayed", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-incomplete-wire-"));
  const originalFetch = globalThis.fetch;
  try {
    for (const trailingError of [false, true]) {
      let posts = 0;
      globalThis.fetch = async (_url, init) => {
        if (init?.method === "HEAD") return new Response("", { status: 200 });
        posts++;
        const first = {
          response: {
            candidates: [
              {
                content: { parts: [{ text: '{"partial":' }] },
                ...(trailingError ? { finishReason: "STOP" } : {}),
              },
            ],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
          },
        };
        const body =
          "data: " +
          JSON.stringify(first) +
          "\n\n" +
          (trailingError
            ? 'data: {"error":{"code":503,"message":"Synthetic trailing failure"}}\n\n'
            : "");
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      };
      const id = Object.keys(getCurrentAntigravityRouting()).find(id => id.startsWith("gemini-"))!;
      const result = await withAntigravityAccountDirectory(root, () =>
        streamAntigravity({ ...model, id }, context, {
          jsonOutput: true,
          reasoning: "medium",
          apiKey: JSON.stringify({ token: "offline-test-token", projectId: "offline-project" }),
          signal: AbortSignal.timeout(5000),
        }).result(),
      );
      assert.equal(posts, 1);
      assert.equal(result.stopReason, "error");
      assert.equal(result.usage.input, 10);
      assert.match(result.errorMessage!, trailingError ? /503/ : /without a finish reason/);
    }
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test("a transport failure before response headers does not replay generation at another endpoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-transport-wire-"));
  const originalFetch = globalThis.fetch;
  let posts = 0;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "HEAD") return new Response("", { status: 200 });
    posts++;
    throw new Error("Synthetic transport failure before response headers");
  };
  try {
    const id = Object.keys(getCurrentAntigravityRouting()).find(id => id.startsWith("gemini-"))!;
    const result = await withAntigravityAccountDirectory(root, () =>
      streamAntigravity({ ...model, id }, context, {
        jsonOutput: true,
        apiKey: JSON.stringify({ token: "offline-test-token", projectId: "offline-project" }),
        signal: AbortSignal.timeout(5000),
      }).result(),
    );
    assert.equal(posts, 1);
    assert.equal(result.stopReason, "error");
    assert.match(result.errorMessage!, /Synthetic transport failure before response headers/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

import { sanitizeText } from "pi-antigravity/src/utils/util.js";
test("source emoji and combining characters survive upstream sanitization", () => {
  const source = "日文 👩‍👩‍👧‍👧 e\u0301 😄";
  assert.equal(sanitizeText(source), source);
  assert.equal(sanitizeText("broken \ud800"), "broken �");
});

import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { generatePiText } from "./pi";
test("the Session forwards JSON format to the Antigravity adapter and leaves Markdown requests unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-json-session-"));
  try {
    const runtime = await ModelRuntime.create({
      modelsPath: null,
      modelsStorePath: join(root, "models.json"),
      refreshOnCreate: false,
      credentials: {
        read: async () => undefined,
        list: async () => [],
        modify: async (_id, fn) => fn(undefined),
        delete: async () => {},
      },
    });
    const fake = fauxProvider({
      provider: "antigravity",
      models: [{ id: "offline-json", reasoning: true, maxTokens: 65536 }],
    });
    const flags: boolean[] = [];
    const original = fake.provider.streamSimple;
    runtime.registerNativeProvider({
      ...fake.provider,
      streamSimple: (m, c, o) => {
        flags.push((o as typeof o & { jsonOutput?: boolean })?.jsonOutput === true);
        return original(m, c, o);
      },
    });
    await runtime.setRuntimeApiKey("antigravity", "synthetic-test-only");
    fake.setResponses([fauxAssistantMessage('{"ok":true}'), fauxAssistantMessage("# Test")]);
    const settings = {
      provider: "antigravity",
      modelId: "offline-json",
      thinkingLevel: "medium" as const,
    };
    await generatePiText(settings, "Return JSON", new AbortController().signal, {
      runtime,
      root,
      format: "json",
      maxOutputTokens: 16384,
    });
    await generatePiText(settings, "Return Markdown", new AbortController().signal, {
      runtime,
      root,
      format: "markdown",
      maxOutputTokens: 512,
    });
    assert.deepEqual(flags, [true, false]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("only opted-in completed responses survive cancellation during usage persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-completed-cancel-"));
  try {
    const runtime = await ModelRuntime.create({
      modelsPath: null,
      modelsStorePath: join(root, "models.json"),
      refreshOnCreate: false,
      credentials: {
        read: async () => undefined,
        list: async () => [],
        modify: async (_id, fn) => fn(undefined),
        delete: async () => {},
      },
    });
    const fake = fauxProvider({
      provider: "antigravity",
      models: [{ id: "offline-cancel", reasoning: true, maxTokens: 65536 }],
    });
    runtime.registerNativeProvider(fake.provider);
    await runtime.setRuntimeApiKey("antigravity", "synthetic-test-only");
    const settings = {
      provider: "antigravity",
      modelId: "offline-cancel",
      thinkingLevel: "medium" as const,
    };
    for (const retain of [false, true]) {
      fake.setResponses([fauxAssistantMessage('{"done":true}')]);
      const controller = new AbortController();
      let calls = 0;
      const run = generatePiText(settings, "Return JSON", controller.signal, {
        runtime,
        root,
        format: "json",
        retainCompletedOutputOnCancel: retain,
        onCall: () => {
          calls++;
          controller.abort();
        },
      });
      if (retain) assert.equal((await run).text, '{"done":true}');
      else await assert.rejects(run, { name: "AbortError" });
      assert.equal(calls, 1);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
