import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { readLearningDocument } from "../../../packages/core/src/jobs";
import { FavoriteRecordSchema } from "../../../packages/core/src/favorites";
import { captureFavoriteCatalog } from "../../../packages/core/src/favorite-catalog";
import { importJSON, importFavoriteJSON } from "./entry";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
Object.assign(globalThis, { CLLNativeSHA256: hash });
const fixture = () =>
  readLearningDocument(
    JSON.parse(
      readFileSync(
        new URL("../ContextualLearning/Resources/sample-lesson.json", import.meta.url),
        "utf8",
      ),
    ),
  );
const youtube = () => {
  const document = fixture();
  document.source.platform = "youtube";
  document.source.url = "https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=999s#old";
  return document;
};
const netflix = () => {
  const document = fixture();
  document.source.platform = "netflix";
  document.source.url = "https://www.netflix.com/watch/80057281?trackId=old&t=999#old";
  return document;
};
const project = (document: ReturnType<typeof fixture>) =>
  JSON.parse(importJSON(JSON.stringify(document), null, null));

test("zero is playable, stale timestamps are discarded, both translations and source rows agree", () => {
  const scene = project(youtube()).scenes[0];
  assert.deepEqual(scene.playbackLink, {
    startMs: 0,
    endMs: 3800,
    webURL: "https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=0s",
  });
  for (const mode of [scene.groups, scene.untranslatedGroups]) {
    const rows = mode.flatMap(group => group.rows);
    assert.deepEqual(
      rows.map(row => row.playbackLink.startMs),
      [0, 2000],
    );
    assert.deepEqual(
      rows.map(row => row.id),
      ["cue-1", "cue-2"],
    );
    assert.ok(
      mode
        .flatMap(group => group.analyses)
        .every(analysis => !JSON.stringify(analysis).includes("playbackLink")),
    );
  }
});

test("scene overrides win over calibrated cue aggregation and raw scene timing", () => {
  const document = youtube();
  document.playbackOverrides = {
    "cue-1": { startMs: 83000, endMs: 85000 },
    "cue-2": { startMs: 86000, endMs: 88000 },
  };
  assert.equal(project(document).scenes[0].playbackLink.startMs, 83000);
  assert.equal(project(document).scenes[0].playbackLink.endMs, 88000);
  assert.equal(project(document).scenes[0].groups[0].rows[0].playbackLink.startMs, 83000);
  document.scenePlaybackOverrides = {
    [document.sections[0].id]: { startMs: 81000, endMs: 89000 },
  };
  assert.equal(project(document).scenes[0].playbackLink.startMs, 81000);
  assert.equal(project(document).scenes[0].playbackLink.endMs, 89000);
  assert.equal(project(document).scenes[0].groups[0].rows[0].playbackLink.startMs, 83000);
  assert.equal(project(document).scenes[0].groups[0].rows[0].playbackLink.endMs, 85000);
});

test("YouTube inference handles missing ends and repeated overlays without a preroll", () => {
  const document = youtube();
  document.cues[0].startMs = 1000;
  document.cues[0].endMs = null;
  document.sections[0].startMs = null;
  document.sections[0].endMs = null;
  document.cues.push({ ...document.cues[0], id: "overlay", startMs: 1500 });
  assert.equal(project(document).scenes[0].groups[0].rows[0].playbackLink.startMs, 1000);
  document.source.platform = "import";
  assert.equal(project(document).scenes[0].groups[0].rows[0].playbackLink, null);
});

test("unknown and degenerate windows have no timestamp", () => {
  const document = youtube();
  document.cues.forEach(cue => {
    cue.startMs = null;
    cue.endMs = null;
  });
  document.sections[0].startMs = null;
  document.sections[0].endMs = null;
  const scene = project(document).scenes[0];
  assert.ok(scene.groups.flatMap(group => group.rows).every(row => row.playbackLink === null));
  assert.equal(project(document).scenes[0].playbackLink, null);
  document.cues[1].startMs = 4000;
  document.cues[1].endMs = 4000;
  assert.equal(project(document).scenes[0].groups.at(-1).rows[0].playbackLink, null);
  document.cues[1].startMs = 43_200_001;
  document.cues[1].endMs = 43_200_002;
  assert.equal(project(document).scenes[0].groups.at(-1).rows[0].playbackLink, null);
});

test("blank source cues stay unlinked until explicitly calibrated", () => {
  const document = youtube();
  document.cues[0].originalText = " ".repeat(document.cues[0].originalText.length);
  assert.equal(project(document).scenes[0].groups[0].rows[0].playbackLink, null);
  document.playbackOverrides = { "cue-1": { startMs: 83000, endMs: 85000 } };
  assert.equal(project(document).scenes[0].groups[0].rows[0].playbackLink.startMs, 83000);
});

test("only real YouTube URL shapes and exact hosts produce canonical links", () => {
  const document = youtube();
  for (const url of [
    "http://youtube.com/watch?v=aqz-KE-bpKQ&start=5",
    "https://m.youtube.com/shorts/aqz-KE-bpKQ",
    "https://music.youtube.com/watch?v=aqz-KE-bpKQ",
    "https://youtube.com/embed/aqz-KE-bpKQ?start=8",
    "https://www.youtube.com/live/aqz-KE-bpKQ",
    "https://youtu.be/aqz-KE-bpKQ?t=123#t=8",
  ]) {
    document.source.url = url;
    assert.equal(
      project(document).scenes[0].playbackLink.webURL,
      "https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=0s",
      url,
    );
  }
  for (const url of [
    "https://youtube.com.evil.test/watch?v=aqz-KE-bpKQ",
    "https://evil.test/youtube.com/watch?v=aqz-KE-bpKQ",
    "https://user@youtube.com/watch?v=aqz-KE-bpKQ",
    "https://youtube.com:444/watch?v=aqz-KE-bpKQ",
    "https://www.youtube.com/watch?v=short",
    "https://youtu.be/aqz-KE-bpKQ/extra",
    "https://youtube.com/playlist?v=aqz-KE-bpKQ",
  ]) {
    document.source.url = url;
    assert.equal(project(document).scenes[0].playbackLink, null, url);
  }
  document.source.url = undefined;
  assert.equal(project(document).scenes[0].playbackLink, null);
});

test("Netflix rows and scenes retain reference times without generating seek parameters", () => {
  const document = netflix();
  assert.deepEqual(project(document).scenes[0].playbackLink, {
    startMs: 0,
    endMs: 3800,
    webURL: "https://www.netflix.com/watch/80057281",
  });
  document.playbackOverrides = { "cue-1": { startMs: 83125, endMs: 85500 } };
  document.scenePlaybackOverrides = {
    [document.sections[0].id]: { startMs: 81000, endMs: 89000 },
  };
  const scene = project(document).scenes[0];
  assert.equal(scene.playbackLink.webURL, "https://www.netflix.com/watch/80057281");
  for (const mode of [scene.groups, scene.untranslatedGroups]) {
    assert.deepEqual(mode[0].rows[0].playbackLink, {
      startMs: 83125,
      endMs: 85500,
      webURL: "https://www.netflix.com/watch/80057281",
    });
  }
  delete document.playbackOverrides;
  document.cues[0].startMs = null;
  document.cues[0].endMs = null;
  document.sections[0].startMs = null;
  document.sections[0].endMs = null;
  assert.equal(project(document).scenes[0].groups[0].rows[0].playbackLink, null);
});

test("Netflix requires an exact HTTPS watch URL, not a series title or share redirect", () => {
  const document = netflix();
  for (const url of [
    "https://netflix.com/watch/80057281",
    "https://www.netflix.com/watch/80057281/?t=999",
  ]) {
    document.source.url = url;
    assert.equal(
      project(document).scenes[0].playbackLink.webURL,
      "https://www.netflix.com/watch/80057281",
    );
  }
  for (const url of [
    "http://www.netflix.com/watch/80057281",
    "https://www.netflix.com.evil.test/watch/80057281",
    "https://evil.test/netflix.com/watch/80057281",
    "https://user@www.netflix.com/watch/80057281",
    "https://www.netflix.com:444/watch/80057281",
    "https://www.netflix.com/title/80057281",
    "https://www.netflix.com/watch/80057281/extra",
    "https://www.netflix.com/watch/not-an-id",
    "https://www.netflix.com/watch/%38%30%30%35%37%32%38%31",
    "https://www.netflix.com/watch/",
    "nflx://www.netflix.com/watch/80057281",
  ]) {
    document.source.url = url;
    const scene = project(document).scenes[0];
    assert.equal(scene.playbackLink, null, url);
    assert.ok(
      scene.groups.every(group => group.rows.every(row => row.playbackLink === null)),
      url,
    );
  }
});

test("favorite snapshots use the same calibrated row and scene projection", () => {
  const corpus = JSON.parse(
    readFileSync(
      new URL("../ContextualLearningTests/Fixtures/favorite-corpus.json", import.meta.url),
      "utf8",
    ),
  );
  const value = JSON.parse(corpus.records[0].operation);
  value.snapshot.source.platform = "youtube";
  value.snapshot.source.url = "https://youtu.be/aqz-KE-bpKQ?t=5";
  value.snapshot.playbackOverrides = {
    "cue-1": { startMs: 83000, endMs: 85000 },
  };
  value.snapshot.scenePlaybackOverrides = {
    [value.snapshot.scene.id]: { startMs: 81000, endMs: 89000 },
  };
  const record = FavoriteRecordSchema.parse(value);
  const operation = JSON.stringify(record);
  const catalog = captureFavoriteCatalog(record, {
    id: "source-0",
    hash: hash(operation),
  });
  const scene = JSON.parse(
    importFavoriteJSON(
      JSON.stringify({
        collectionID: record.collectionId,
        key: record.key,
        catalog: JSON.stringify(catalog),
        operation,
      }),
    ),
  ).scenes[0];
  assert.equal(scene.playbackLink.startMs, 81000);
  assert.equal(scene.playbackLink.endMs, 89000);
  for (const mode of [scene.groups, scene.untranslatedGroups])
    assert.deepEqual(
      [mode[0].rows[0].playbackLink.startMs, mode[0].rows[0].playbackLink.endMs],
      [83000, 85000],
    );
});

test("Netflix favorite snapshots retain external scene and row links", () => {
  const corpus = JSON.parse(
    readFileSync(
      new URL("../ContextualLearningTests/Fixtures/favorite-corpus.json", import.meta.url),
      "utf8",
    ),
  );
  const value = JSON.parse(corpus.records[0].operation);
  value.snapshot.source.platform = "netflix";
  value.snapshot.source.url = "https://www.netflix.com/watch/80057281?t=999";
  value.snapshot.playbackOverrides = { "cue-1": { startMs: 83000, endMs: 85000 } };
  value.snapshot.scenePlaybackOverrides = {
    [value.snapshot.scene.id]: { startMs: 81000, endMs: 89000 },
  };
  const record = FavoriteRecordSchema.parse(value);
  const operation = JSON.stringify(record);
  const catalog = captureFavoriteCatalog(record, { id: "source-0", hash: hash(operation) });
  const scene = JSON.parse(
    importFavoriteJSON(
      JSON.stringify({
        collectionID: record.collectionId,
        key: record.key,
        catalog: JSON.stringify(catalog),
        operation,
      }),
    ),
  ).scenes[0];
  assert.equal(scene.playbackLink.webURL, "https://www.netflix.com/watch/80057281");
  assert.equal(
    scene.groups[0].rows[0].playbackLink.webURL,
    "https://www.netflix.com/watch/80057281",
  );
  assert.deepEqual(
    scene.groups[0].rows[0].playbackLink,
    scene.untranslatedGroups[0].rows[0].playbackLink,
  );
});
