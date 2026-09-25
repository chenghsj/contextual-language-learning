import assert from "node:assert/strict";
import test from "node:test";
import { youtubeAdapter } from "./youtube";
import { netflixAdapter } from "./netflix";

const youtubeUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const netflixUrl = "https://www.netflix.com/watch/81234567";

test("speed command is sent only to the matching video tab, without disrupting the active tab", async () => {
  const globalChrome = globalThis as unknown as { chrome?: typeof chrome };
  const previous = globalChrome.chrome;
  const sent: { id: number; message: unknown }[] = [];
  let activated = false;
  try {
    globalChrome.chrome = {
      tabs: {
        query: async () => [
          { id: 100, url: "https://www.youtube.com/watch?v=invalid" },
          { id: 101, url: youtubeUrl },
          { id: 102, url: netflixUrl },
        ],
        sendMessage: async (id: number, message: unknown) => {
          sent.push({ id, message });
          return { ok: true };
        },
        update: async () => { activated = true; },
      },
    } as unknown as typeof chrome;
    await youtubeAdapter.setPlaybackRate?.(youtubeUrl, 0.75);
    await netflixAdapter.setPlaybackRate?.(netflixUrl, 1.5);
    assert.deepEqual(sent, [
      { id: 101, message: { type: "PLAYBACK_RATE_SET", rate: 0.75 } },
      { id: 102, message: { type: "NETFLIX_PLAYBACK_RATE_SET", rate: 1.5 } },
    ]);
    assert.equal(activated, false);
  } finally {
    globalChrome.chrome = previous;
  }
});

test("playback rate errors propagate to the reader instead of falsely reporting success", async () => {
  const globalChrome = globalThis as unknown as { chrome?: typeof chrome };
  const previous = globalChrome.chrome;
  try {
    globalChrome.chrome = {
      tabs: {
        query: async () => [{ id: 101, url: youtubeUrl }],
        sendMessage: async () => ({ ok: false, error: "The player rejected this speed." }),
      },
    } as unknown as typeof chrome;
    await assert.rejects(
      youtubeAdapter.setPlaybackRate!(youtubeUrl, 0.75),
      /The player rejected this speed/,
    );
  } finally {
    globalChrome.chrome = previous;
  }
});
