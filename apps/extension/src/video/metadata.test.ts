import assert from "node:assert/strict";
import test from "node:test";
import { cleanVideoTitle, titleForVideoTab } from "./metadata";
import { netflixAdapter } from "./netflix";

const url = "https://www.netflix.com/watch/81234567";

test("remove platform suffix and avoid generic video titles", () => {
  assert.equal(cleanVideoTitle("Episode 12 - Netflix"), "Episode 12");
  assert.equal(cleanVideoTitle("Making a decision | YouTube"), "Making a decision");
  assert.equal(cleanVideoTitle("Netflix"), null);
  assert.equal(cleanVideoTitle("YouTube Premium"), null);
  assert.equal(cleanVideoTitle(""), null);
  assert.equal(cleanVideoTitle("  Movie title  "), "Movie title");
});

test("prefer matching video metadata over a generic Netflix browser tab title", async () => {
  const globalChrome = globalThis as unknown as { chrome?: typeof chrome };
  const previous = globalChrome.chrome;
  let requested = 0;
  try {
    globalChrome.chrome = {
      tabs: { sendMessage: async (id: number) => {
        requested = id;
        return { ok: true, url, title: "Real episode name - Netflix" };
      } },
    } as unknown as typeof chrome;
    assert.equal(await titleForVideoTab({ id: 42, url, title: "Netflix" }, netflixAdapter),
      "Real episode name");
    assert.equal(requested, 42);
  } finally {
    if (previous) globalChrome.chrome = previous;
    else delete globalChrome.chrome;
  }
});

test("never use stale metadata from a different Netflix video", async () => {
  const globalChrome = globalThis as unknown as { chrome?: typeof chrome };
  const previous = globalChrome.chrome;
  try {
    globalChrome.chrome = {
      tabs: { sendMessage: async () => ({
        ok: true, url: "https://www.netflix.com/watch/76543210", title: "Wrong episode",
      }) },
    } as unknown as typeof chrome;
    assert.equal(await titleForVideoTab({ id: 42, url, title: "Right episode - Netflix" }, netflixAdapter),
      "Right episode");
  } finally {
    if (previous) globalChrome.chrome = previous;
    else delete globalChrome.chrome;
  }
});

test("fallback to browser tab title when the page metadata is unavailable", async () => {
  const globalChrome = globalThis as unknown as { chrome?: typeof chrome };
  const previous = globalChrome.chrome;
  try {
    globalChrome.chrome = {
      tabs: { sendMessage: async () => { throw new Error("Receiving end does not exist"); } },
    } as unknown as typeof chrome;
    assert.equal(await titleForVideoTab({ id: 42, url, title: "Known title - Netflix" }, netflixAdapter),
      "Known title");
    assert.equal(await titleForVideoTab({ id: 42, url, title: "Netflix" }, netflixAdapter), null);
  } finally {
    if (previous) globalChrome.chrome = previous;
    else delete globalChrome.chrome;
  }
});
