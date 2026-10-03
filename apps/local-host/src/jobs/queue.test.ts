import assert from "node:assert/strict";
import test from "node:test";
import { GenerationQueue } from "./queue";
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { promise, release };
}

test("admission persists each snapshot during earlier work; execution is FIFO and failure releases worker", async () => {
  const queue = new GenerationQueue(),
    held = gate(),
    events: string[] = [];
  const first = await queue.submit(
    "standard",
    async () => {
      events.push("save 1");
    },
    async () => {
      events.push("run 1");
      await held.promise;
      throw new Error("model rejected");
    },
  );
  const failed = assert.rejects(first.completion, /rejected/);
  const second = await queue.submit(
    "custom",
    async () => {
      events.push("save 2");
    },
    async () => {
      events.push("run 2");
      return "custom saved";
    },
  );
  assert.deepEqual(events, ["save 1", "run 1", "save 2"]);
  await assert.rejects(
    queue.submit(
      "custom",
      async () => {},
      async () => {},
    ),
    /already queued/,
  );
  held.release();
  await failed;
  assert.equal(await second.completion, "custom saved");
  assert.deepEqual(events, ["save 1", "run 1", "save 2", "run 2"]);
});
test("cancel queued work without calling model, and pause queued work when connection closes", async () => {
  for (const closing of [false, true]) {
    const queue = new GenerationQueue(),
      held = gate();
    let calls = 0;
    const first = await queue.submit(
      "running",
      async () => {},
      async () => {
        await held.promise;
      },
    );
    const second = await queue.submit(
      "queued",
      async () => {},
      async () => {
        calls++;
      },
    );
    const rejected = assert.rejects(second.completion, closing ? /connection closed/ : /aborted/);
    if (closing) queue.close();
    else queue.cancel("queued");
    held.release();
    await first.completion;
    await rejected;
    assert.equal(calls, 0);
  }
});
test("failed snapshot persistence does not occupy the queue", async () => {
  const queue = new GenerationQueue();
  await assert.rejects(
    queue.submit(
      "id",
      async () => {
        throw new Error("disk full");
      },
      async () => {},
    ),
    /disk full/,
  );
  const retry = await queue.submit(
    "id",
    async () => {},
    async () => "saved",
  );
  assert.equal(await retry.completion, "saved");
});
