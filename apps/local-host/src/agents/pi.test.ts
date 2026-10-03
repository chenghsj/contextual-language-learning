import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  fauxProvider,
  fauxAssistantMessage,
  createAssistantMessageEventStream,
  type Credential,
  type CredentialStore,
} from "@earendil-works/pi-ai";
import {
  generatePi,
  generatePiText,
  lessonResources,
  piProviders,
  piDeviceId,
  piModels,
} from "./pi";

test("isolated SDK generates JSON with no tools, global resources or cross-stage history", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-pi-"));
  try {
    const data = new Map<string, Credential>([
      ["openai", { type: "api_key", key: "test-not-a-real-key" }],
    ]);
    const credentials: CredentialStore = {
      read: async id => data.get(id),
      list: async () => [...data].map(([providerId, value]) => ({ providerId, type: value.type })),
      modify: async (id, fn) => {
        const value = await fn(data.get(id));
        if (value) data.set(id, value);
        return value;
      },
      delete: async id => {
        data.delete(id);
      },
    };
    const runtime = await ModelRuntime.create({
      credentials,
      modelsPath: null,
      modelsStorePath: join(root, "models.json"),
      refreshOnCreate: false,
    });
    const fake = fauxProvider({
      provider: "openai",
      models: [{ id: "test-model", reasoning: true }, { id: "catalog-only" }],
    });
    fake.setResponses([
      (context, options) => {
        assert.equal(options?.reasoning, "high", "saved intensity reaches the provider request");
        assert.equal(context.messages.filter(m => m.role === "user").length, 1);
        assert.equal(context.messages.filter(m => m.role === "assistant").length, 0);

        return fauxAssistantMessage('{"stage":"first"}');
      },
      context => {
        assert.equal(
          context.messages.filter(m => m.role === "user").length,
          1,
          "a new stage cannot inherit earlier stage history",
        );
        return fauxAssistantMessage('{"stage":"second"}');
      },
      fauxAssistantMessage('{"partial":', { stopReason: "length" }),
      (context, options) => {
        assert.match(
          JSON.stringify(context.messages.find(message => message.role === "system")),
          /Markdown document/,
        );
        assert.doesNotMatch(
          JSON.stringify(context.messages.find(message => message.role === "system")),
          /requested JSON object/,
        );
        assert.equal(context.messages.filter(message => message.role === "user").length, 1);
        assert.equal(options?.maxTokens, 512);
        return fauxAssistantMessage("# Markdown\n\nContent");
      },
    ]);
    runtime.registerNativeProvider({
      ...fake.provider,
      filterModels: models => models.filter(model => model.id === "test-model"),
    });
    assert.equal(runtime.getModels("openai").length, 2);
    const listed = await piModels({ provider: "openai", modelId: "" }, runtime);
    assert.deepEqual(
      listed.models.map(model => model.id),
      ["test-model"],
    );
    const settings = { provider: "openai", modelId: "test-model", thinkingLevel: "high" as const };
    const options = { root, runtime };
    assert.deepEqual(
      await generatePi(settings, "First stage", new AbortController().signal, options),
      { stage: "first" },
    );
    assert.deepEqual(
      await generatePi(settings, "Second stage", new AbortController().signal, options),
      { stage: "second" },
    );
    await assert.rejects(
      generatePi(settings, "Truncated", new AbortController().signal, options),
      /did not finish/,
    );
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(generatePi(settings, "Stopped", aborted.signal, options));
    const markdown = await generatePiText(
      settings,
      "Custom document",
      new AbortController().signal,
      { ...options, format: "markdown", maxOutputTokens: 512 },
    );
    assert.equal(markdown.text, "# Markdown\n\nContent");
    assert.equal(markdown.call.modelId, "test-model");
    assert.ok(markdown.call.usage?.input && markdown.call.usage.output);
    assert.equal(
      markdown.call.usage.cacheRead,
      undefined,
      "unreported cache use is not shown as actual zero",
    );
    assert.equal(fake.state.callCount, 4);
    const loader = lessonResources();
    assert.deepEqual(loader.getAgentsFiles().agentsFiles, []);
    assert.deepEqual(loader.getSkills().skills, []);
    assert.deepEqual(loader.getExtensions().extensions, []);
    const providers = await piProviders(runtime);
    assert.equal(providers.find(p => p.id === "openai")?.connected, true);
    fake.setResponses([fauxAssistantMessage("# Recovered")]);
    let rejected = false;
    runtime.registerNativeProvider({
      ...fake.provider,
      filterModels: models => models.filter(model => model.id === "test-model"),
      streamSimple(model, context, streamOptions) {
        if (rejected) return fake.provider.streamSimple(model, context, streamOptions);
        rejected = true;
        const stream = createAssistantMessageEventStream();
        const error = {
          ...fauxAssistantMessage("", {
            stopReason: "error",
            errorMessage: "HTTP 503 temporarily unavailable",
          }),
          provider: "openai",
          model: "test-model",
          api: fake.api,
        };
        queueMicrotask(() => {
          stream.push({ type: "error", reason: "error", error });
          stream.end(error);
        });
        return stream;
      },
    });
    const retries: number[] = [];
    const recovered = await generatePiText(
      settings,
      "Retry rejected stage",
      new AbortController().signal,
      {
        ...options,
        format: "markdown",
        onRetry: notice => {
          retries.push(notice.attempt);
        },
      },
    );
    assert.equal(recovered.text, "# Recovered");
    assert.deepEqual(retries, [1]);
    assert.equal(recovered.call.retries?.length, 1);
    await runtime.logout("openai");
    await assert.rejects(
      generatePi(settings, "Logged out", new AbortController().signal, options),
      /Connect this/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SDK OAuth loads and can be cancelled before exchanging any credential", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-pi-oauth-"));
  try {
    const runtime = await ModelRuntime.create({
      authPath: join(root, "auth.json"),
      modelsPath: null,
      modelsStorePath: join(root, "models.json"),
      refreshOnCreate: false,
    });
    const controller = new AbortController();
    const deviceId = await piDeviceId(root);
    assert.equal(await piDeviceId(root), deviceId);
    let opened = false;
    await assert.rejects(
      runtime.login(
        "openai",
        "oauth",
        {
          signal: controller.signal,
          notify(event) {
            if (event.type === "auth_url") {
              opened = true;
              controller.abort();
            }
          },
          prompt: async () => {
            throw new Error("cancelled");
          },
        },
        { getDeviceId: () => deviceId },
      ),
    );
    assert.equal(opened, true, "OAuth implementation must be included in the standalone bundle");
    assert.deepEqual(await runtime.listCredentials(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Antigravity is registered offline with OAuth, models and product-owned credentials", async () => {
  const { createPiRuntime } = await import("./pi");
  const { readFile, readdir } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "immersive-antigravity-"));
  const previousDirectory = process.env.PI_CODING_AGENT_DIR;
  try {
    const runtime = await createPiRuntime(root);
    const providers = await piProviders(runtime);
    const provider = providers.find(item => item.id === "antigravity");
    assert.ok(provider);
    assert.deepEqual(provider.methods, ["oauth"]);
    assert.equal(provider.connected, false);
    assert.equal(provider.label, "Antigravity");
    assert.ok(runtime.getModels("antigravity").length > 0);
    assert.equal(
      process.env.PI_CODING_AGENT_DIR,
      previousDirectory,
      "runtime creation must not mutate the process environment",
    );
    assert.deepEqual(lessonResources().getExtensions().extensions, []);
    const controller = new AbortController();
    let opened = false;
    await assert.rejects(
      runtime.login("antigravity", "oauth", {
        signal: controller.signal,
        notify(event) {
          if (event.type === "auth_url") {
            assert.equal(new URL(event.url).hostname, "accounts.google.com");
            opened = true;
            controller.abort();
          }
        },
        prompt: async () => {
          throw new Error("Cancelled by test");
        },
      }),
      /cancel|abort/i,
    );
    assert.equal(opened, true);
    assert.deepEqual(await runtime.listCredentials(), []);
    // A second start also proves cancellation released the loopback listener.
    const second = new AbortController();
    await assert.rejects(
      runtime.login("antigravity", "oauth", {
        signal: second.signal,
        notify(event) {
          if (event.type === "auth_url") second.abort();
        },
        prompt: async () => {
          throw new Error("Cancelled by test");
        },
      }),
    );
    await runtime.logout("antigravity");
    assert.deepEqual(await runtime.listCredentials(), []);
    assert.equal((await readdir(root)).includes("antigravity-accounts.json"), false);
    const saved = JSON.parse(await readFile(join(root, "auth.json"), "utf8"));
    assert.equal("antigravity" in saved, false);
  } finally {
    if (previousDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDirectory;
    await rm(root, { recursive: true, force: true });
  }
});

test("Antigravity streams a lesson through the real SDK provider without tools or external requests", async () => {
  const { createPiRuntime } = await import("./pi");
  const { writeFile } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "immersive-antigravity-stream-"));
  const previousFetch = globalThis.fetch;
  const previousDirectory = process.env.PI_CODING_AGENT_DIR;
  const requests: Record<string, any>[] = [];
  try {
    await writeFile(
      join(root, "auth.json"),
      JSON.stringify({
        antigravity: {
          type: "oauth",
          access: "synthetic-access-token",
          refresh: "synthetic-refresh-token",
          expires: Date.now() + 3_600_000,
          projectId: "synthetic-project",
        },
      }),
      { mode: 0o600 },
    );
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      assert.ok(url.includes("streamGenerateContent"), `Unexpected request: ${url}`);
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      assert.equal(body.project, "synthetic-project");
      assert.deepEqual(body.request.tools ?? [], []);
      const chunk = {
        response: {
          candidates: [
            { content: { parts: [{ text: '{"stage":"antigravity"}' }] }, finishReason: "STOP" },
          ],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        },
      };
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
        headers: { "content-type": "text/event-stream" },
      });
    };
    const runtime = await createPiRuntime(root);
    const model = runtime.getModels("antigravity").find(item => item.id.startsWith("gemini-"));
    assert.ok(model);
    const output = await generatePi(
      { provider: "antigravity", modelId: model.id },
      "Synthetic lesson stage",
      new AbortController().signal,
      { root, runtime },
    );
    assert.deepEqual(output, { stage: "antigravity" });
    assert.equal(requests.length, 1);
    assert.match(JSON.stringify(requests[0].request.contents), /Synthetic lesson stage/);
    await runtime.logout("antigravity");
    await assert.rejects(
      generatePi(
        { provider: "antigravity", modelId: model.id },
        "Logged out",
        new AbortController().signal,
        { root, runtime },
      ),
      /Connect this/,
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDirectory;
    await rm(root, { recursive: true, force: true });
  }
});

test("Antigravity model refresh reports network errors and retains the offline catalog", async () => {
  const { createPiRuntime, piModels } = await import("./pi");
  const { writeFile } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "immersive-antigravity-models-"));
  const previousFetch = globalThis.fetch;
  const previousDirectory = process.env.PI_CODING_AGENT_DIR;
  try {
    await writeFile(
      join(root, "auth.json"),
      JSON.stringify({
        antigravity: {
          type: "oauth",
          access: "synthetic-models-token",
          refresh: "synthetic-refresh",
          expires: Date.now() + 3_600_000,
          projectId: "synthetic-project",
        },
      }),
      { mode: 0o600 },
    );
    const runtime = await createPiRuntime(root);
    const before = runtime.getModels("antigravity").map(model => model.id);
    let requests = 0;
    globalThis.fetch = async input => {
      assert.match(String(input), /fetchAvailableModels/);
      requests++;
      return new Response("Synthetic catalog unavailable", { status: 503 });
    };
    await assert.rejects(
      piModels({ provider: "antigravity", modelId: "" }, runtime),
      /fetchAvailableModels|503/,
    );
    assert.ok(requests > 0);
    assert.deepEqual(
      runtime.getModels("antigravity").map(model => model.id),
      before,
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDirectory;
    await rm(root, { recursive: true, force: true });
  }
});
