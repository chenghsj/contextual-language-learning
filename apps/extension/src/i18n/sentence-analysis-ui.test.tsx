import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import type { LearningProfile, ExpressionOccurrence } from "@contextual/core";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://extension.test",
});
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLFormElement",
  "HTMLButtonElement",
  "Element",
  "Node",
  "NodeFilter",
  "DocumentFragment",
  "MutationObserver",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "KeyboardEvent",
  "FocusEvent",
] as const)
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
Object.assign(globalThis, {
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});
dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { SentenceDialogue } = await import("../components/sentence-dialogue");
const { v7Fixture } = await import("../../dev/reader-v7-fixture");

async function click(element: Element | null) {
  assert.ok(element);
  await act(async () => {
    (element as HTMLElement).click();
  });
}

test("opened source groups retain complete core and optional sections, including legacy examples", async () => {
  const doc = structuredClone(v7Fixture);
  const scene = doc.sections[0];
  const completeExplanation =
    "「when」連接兩件事的時間，說明這個場景中先後發生的事情與彼此關係。".repeat(6) +
    "結尾的標點也要保留！？";
  doc.points[0].title = "時間關係「when」";
  doc.points[0].explanation = completeExplanation;
  const extension = {
    ...doc.points[0],
    id: "comparison",
    presentation: "extended" as const,
    title: "A useful contrast",
    explanation: "An optional alternative with a distinct meaning.",
  };
  doc.points.push(extension);
  scene.utterances[1].pointIds.push(extension.id);
  doc.reusableItems[0].examples.push({
    ...structuredClone(doc.reusableItems[0].examples[0]),
    situation: "Another saved example",
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (key = scene.id) =>
    root.render(
      <SentenceDialogue
        key={key}
        document={doc}
        scene={scene}
        locale="en"
        playingCueId={null}
        disabled={false}
        playbackDisabled={false}
        translationVisible={false}
        onPlayCue={() => {}}
        onPlayOccurrence={() => {}}
        annotatedText={text => text}
      />,
    );
  try {
    await act(async () => render());
    await click(container.querySelector('[data-ui="analysis-toggle-all"]'));
    assert.ok(container.textContent?.includes(doc.points[0].explanation));
    const explanation = container.querySelector(
      '[data-ui="coreExplanation"] [data-ui="explanation-text"]',
    )!;
    assert.equal(
      explanation.textContent,
      completeExplanation,
      "paragraphs retain the complete saved explanation",
    );
    assert.ok(
      explanation.querySelectorAll("p").length > 1,
      "long explanations are divided into readable paragraphs",
    );
    assert.ok(
      explanation.querySelector("strong")?.textContent === "when",
      "saved title terms are highlighted",
    );
    assert.equal(container.textContent?.includes(extension.explanation), false);
    await click(
      [...container.querySelectorAll("button")].find(b => b.textContent === "More explanation")!,
    );
    assert.ok(container.textContent?.includes(extension.explanation));
    assert.equal(container.querySelectorAll("[data-point-id='comparison']").length, 1);
    await click(
      [...container.querySelectorAll("button")].find(b => b.textContent === "AI-created examples")!,
    );
    assert.equal(
      container.querySelectorAll('[data-ui="inlineAnalysis"] button[data-state="open"]').length,
      2,
      "optional sections keep their own expanded state",
    );
    assert.equal(container.textContent?.includes(extension.explanation), true);
    assert.equal(container.textContent?.includes("Another saved example"), false);
    await click(
      [...container.querySelectorAll("button")].find(b => b.textContent === "More results")!,
    );
    assert.ok(container.textContent?.includes("Another saved example"));
    const example = doc.reusableItems[0].examples[0];
    assert.equal(container.textContent?.includes(example.dialogue[0].translation), false);
    await click(
      [...container.querySelectorAll("button")].find(b => b.textContent === "Show translation")!,
    );
    assert.ok(container.textContent?.includes(example.dialogue[0].translation));
    assert.ok(container.querySelector('[data-ui="coreExplanation"]'));
    await click(
      [...container.querySelectorAll("button")].find(b => b.textContent === "Hide translation")!,
    );
    assert.equal(container.textContent?.includes(example.dialogue[0].translation), false);

    assert.equal(
      [...container.querySelectorAll("button")].some(
        b => b.textContent === "Other occurrences in this video",
      ),
      false,
    );
    await act(async () => render("different-scene"));
    assert.equal(container.querySelectorAll('[data-ui="inlineAnalysis"]').length, 2);
    assert.equal(container.textContent?.includes(extension.explanation), false);
    assert.equal(container.textContent?.includes("Another saved example"), false);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("source groups own analysis disclosure while source fragments and playback stay independent", async () => {
  const doc = (await import("../../dev/reader-v7-fixture")).crossCueV7Fixture();
  const scene = doc.sections[0];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const played: string[] = [];
  const render = () =>
    root.render(
      <SentenceDialogue
        document={doc}
        scene={scene}
        locale="zh-TW"
        playingCueId={null}
        disabled={false}
        playbackDisabled={false}
        translationVisible={false}
        onPlayCue={id => played.push(id)}
        onPlayOccurrence={() => {}}
        annotatedText={text => text}
      />,
    );
  try {
    await act(async () => render());
    const toggles = [...container.querySelectorAll('[data-ui="analysis-toggle"]')];
    assert.equal(toggles.length, 2, "one disclosure per source group, including a cross-cue group");
    assert.equal(container.querySelector('[data-ui="core-explanation-toggle"]'), null);
    const panel = (toggle: Element) =>
      document.getElementById(toggle.getAttribute("aria-controls")!)!;
    for (const toggle of toggles) {
      assert.equal(toggle.getAttribute("aria-expanded"), "false");
      assert.equal(panel(toggle).hidden, true);
    }
    await click(container.querySelector('[data-source-cue="cue-1"] [data-ui="sentence-text"]'));
    assert.equal(toggles[0].getAttribute("aria-expanded"), "true");
    assert.equal(panel(toggles[0]).hidden, false);
    await click(toggles[1]);
    assert.equal(
      toggles[0].getAttribute("aria-expanded"),
      "true",
      "opening another group retains the first",
    );
    assert.equal(toggles[1].getAttribute("aria-expanded"), "true");
    await click(container.querySelector('[data-source-cue="cue-3"] [data-ui="cue-play"]'));
    assert.deepEqual(played, ["cue-3"]);
    assert.equal(
      toggles[1].getAttribute("aria-expanded"),
      "true",
      "playback does not collapse analysis",
    );
    await click(container.querySelector('[data-ui="coreExplanation"]'));
    assert.equal(toggles[1].getAttribute("aria-expanded"), "true");
    await click(container.querySelector('[data-source-cue="cue-3"] [data-ui="sentence-text"]'));
    assert.equal(
      toggles[1].getAttribute("aria-expanded"),
      "false",
      "either cross-cue source controls the same panel",
    );
    const fragment = container.querySelector('[data-ui="source-chunk-hover"]');
    await click(fragment);
    assert.equal(toggles[1].getAttribute("aria-expanded"), "true");
    assert.ok(container.querySelector('[data-ui="selectedChunkMeaning"]'));
    await click(fragment);
    assert.equal(container.querySelector('[data-ui="selectedChunkMeaning"]'), null);
    assert.equal(toggles[1].getAttribute("aria-expanded"), "true");
    const all = container.querySelector('[data-ui="analysis-toggle-all"]');
    await click(all);
    for (const toggle of toggles) assert.equal(panel(toggle).hidden, true);
    await click(all);
    for (const toggle of toggles) assert.equal(panel(toggle).hidden, false);
    scene.id = "next-scene";
    await act(async () => render());
    for (const toggle of container.querySelectorAll('[data-ui="analysis-toggle"]')) {
      assert.equal(toggle.getAttribute("aria-expanded"), "false");
      assert.equal(panel(toggle).hidden, true);
    }
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("basic-only responses retain meaning when translation is hidden and skip empty or identical context", async () => {
  const doc = structuredClone(v7Fixture);
  const scene = doc.sections[0];
  doc.cues = doc.cues.slice(0, 1);
  doc.cues[0].originalText = "うん。";
  doc.points = [];
  doc.reusableItems = [];
  scene.cueIds = [doc.cues[0].id];
  scene.contextCueIds = [];
  scene.translations = [{ cueId: doc.cues[0].id, text: "嗯。" }];
  scene.utterances = [
    {
      ...scene.utterances[0],
      cueIds: scene.cueIds,
      meaning: "表示同意。",
      contextExplanation: "",
      decision: "basic_only",
      pointIds: [],
      chunks: undefined,
    },
  ];
  scene.pronunciations = undefined;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = () =>
    root.render(
      <SentenceDialogue
        document={doc}
        scene={scene}
        locale="zh-TW"
        playingCueId={null}
        disabled={false}
        playbackDisabled={false}
        translationVisible={false}
        onPlayCue={() => {}}
        onPlayOccurrence={() => {}}
        annotatedText={text => text}
      />,
    );
  try {
    await act(async () => render());
    const analysis = container.querySelector('[data-ui="inlineAnalysis"]')!;
    assert.equal(analysis.querySelector('[data-ui="whole-meaning"] p')?.textContent, "表示同意。");
    assert.ok(container.textContent?.includes("うん。"));
    assert.ok(!container.textContent?.includes("嗯。"));
    assert.ok(!analysis.querySelector('[data-ui="coreExplanation"]'));
    scene.utterances[0].contextExplanation = "表示同意。";
    // Fresh scene identity recomputes the presentation after changing the saved fixture.
    await act(async () =>
      root.render(
        <SentenceDialogue
          document={{ ...doc }}
          scene={{ ...scene }}
          locale="zh-TW"
          playingCueId={null}
          disabled={false}
          playbackDisabled={false}
          translationVisible={false}
          onPlayCue={() => {}}
          onPlayOccurrence={() => {}}
          annotatedText={text => text}
        />,
      ),
    );
    assert.equal(container.querySelector('[data-ui="whole-meaning"] p')?.textContent, "表示同意。");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("one cue displays both analyses in source order and a cross-cue analysis follows its complete source", async () => {
  const doc = structuredClone(v7Fixture),
    scene = doc.sections[0];
  const cut = doc.cues[1].originalText.indexOf(" when");
  scene.utterances = [
    scene.utterances[0],
    ...["topic-a", "topic-b"].map((id, i) => ({
      ...scene.utterances[1],
      id,
      pointIds: [],
      decision: "basic_only" as const,
      meaning: i ? "電話打來的時間。" : "正要出門。",
      contextExplanation: "",
      sourceSpans: [
        { cueId: "cue-2", start: i ? cut : 0, end: i ? doc.cues[1].originalText.length : cut },
      ],
    })),
  ];
  doc.points = [];
  doc.reusableItems = [];
  const plays: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = () =>
    root.render(
      <SentenceDialogue
        document={doc}
        scene={{ ...scene }}
        locale="zh-TW"
        playingCueId={null}
        disabled={false}
        playbackDisabled={false}
        translationVisible={false}
        onPlayCue={id => plays.push(id)}
        onPlayOccurrence={() => {}}
        annotatedText={text => text}
      />,
    );
  try {
    await act(async () => render());
    assert.equal(container.querySelectorAll('[data-ui="sourceSentence"]').length, 2);
    assert.equal(container.querySelector('[data-ui="teaching-unit-selector"]'), null);
    assert.ok(container.textContent?.includes("正要出門。"));
    assert.ok(container.textContent?.includes("電話打來的時間。"));
    assert.equal(container.querySelectorAll('[data-ui="inlineAnalysis"]').length, 3);
    const titles = [...container.querySelectorAll('[data-ui="analysis-source-title"]')].map(
      e => e.textContent,
    );
    assert.deepEqual(titles, [
      doc.cues[1].originalText.slice(0, cut).trim(),
      doc.cues[1].originalText.slice(cut).trim(),
    ]);
    await click(container.querySelectorAll('[data-ui="sentence-actions"] button')[1]);
    assert.deepEqual(plays, ["cue-2"]);
    scene.utterances = [
      {
        ...scene.utterances[0],
        id: "both",
        cueIds: ["cue-1", "cue-2"],
        sourceSpans: doc.cues.map(c => ({ cueId: c.id, start: 0, end: c.originalText.length })),
        meaning: "共用完整解析。",
      },
    ];
    await act(async () => render());
    assert.equal(container.querySelectorAll('[data-ui="sourceSentence"]').length, 2);
    assert.equal(container.querySelectorAll('[data-ui="inlineAnalysis"]').length, 1);
    assert.equal(container.querySelectorAll('[data-ui="sentence-text"]').length, 2);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("translation-only reactions and sound labels keep source and playback without analysis selectors", async () => {
  for (const level of ["N1", "N3"] as const) {
    const doc = structuredClone(v7Fixture);
    const scene = doc.sections[0];
    doc.profile.targetLanguage = "ja";
    doc.profile.level = level;
    doc.cues = [{ ...doc.cues[0], originalText: "やった。[叫び声]" }];
    doc.points = [];
    doc.reusableItems = [];
    scene.cueIds = [doc.cues[0].id];
    scene.contextCueIds = [];
    scene.translations = [{ cueId: doc.cues[0].id, text: "太好了！[喊叫聲]" }];
    scene.pronunciations = undefined;
    scene.utterances = [0, 1].map(i => ({
      ...scene.utterances[0],
      id: "reaction-" + i,
      cueIds: scene.cueIds,
      sourceSpans: [{ cueId: doc.cues[0].id, start: i ? 4 : 0, end: i ? 9 : 4 }],
      meaning: "",
      contextExplanation: "",
      decision: "basic_only" as const,
      pointIds: [],
      chunks: undefined,
    }));
    const plays: string[] = [];
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = (translationVisible: boolean) =>
      root.render(
        <SentenceDialogue
          document={doc}
          scene={scene}
          locale="zh-TW"
          playingCueId={null}
          disabled={false}
          playbackDisabled={false}
          translationVisible={translationVisible}
          onPlayCue={id => plays.push(id)}
          onPlayOccurrence={() => {}}
          annotatedText={text => text}
        />,
      );
    try {
      await act(async () => render(true));
      assert.equal(
        container.querySelector('[data-ui="sentence-text"]')?.textContent,
        "やった。[叫び声]太好了！[喊叫聲]",
      );
      assert.equal(container.querySelectorAll('[data-ui="analysis-toggle"]').length, 0);
      assert.equal(container.querySelectorAll('[data-ui="teaching-unit-selector"]').length, 0);
      assert.equal(container.querySelectorAll('[data-ui="analysis-toggle-all"]').length, 0);
      await click(container.querySelector('[data-ui="sentence-actions"] button'));
      assert.deepEqual(plays, [doc.cues[0].id]);
      await click(container.querySelector('[data-ui="sourceSentence"]'));
      assert.equal(container.querySelectorAll('[data-ui="inlineAnalysis"]').length, 0);
      await act(async () => render(false));
      assert.equal(
        container.querySelector('[data-ui="sentence-text"]')?.textContent,
        "やった。[叫び声]",
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  }
});

test("empty sound units do not add selectors beside a useful clarification", async () => {
  const doc = structuredClone(v7Fixture);
  const scene = doc.sections[0];
  const unit = scene.utterances[1];
  const cue = doc.cues[1];
  const start = cue.originalText.length;
  cue.originalText += "[叫び声]";
  unit.pointIds = [];
  unit.chunks = undefined;
  unit.meaning = "";
  unit.contextExplanation = "這裡的省略指涉需要補充說明。";
  unit.decision = "basic_only";
  scene.utterances.push({
    ...unit,
    id: "sound-only",
    contextExplanation: "",
    sourceSpans: [{ cueId: cue.id, start, end: cue.originalText.length }],
  });
  doc.points = [];
  doc.reusableItems = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <SentenceDialogue
          document={doc}
          scene={scene}
          locale="zh-TW"
          playingCueId={null}
          disabled={false}
          playbackDisabled={false}
          translationVisible={false}
          onPlayCue={() => {}}
          onPlayOccurrence={() => {}}
          annotatedText={text => text}
        />,
      ),
    );
    assert.equal(container.querySelectorAll('[data-ui="teaching-unit-selector"]').length, 0);
    assert.ok(
      container
        .querySelectorAll('[data-ui="inlineAnalysis"]')[1]
        ?.textContent?.includes(unit.contextExplanation),
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("complete originals share blocks without moving intervening subtitles, and retain per-cue playback", async () => {
  const { crossCueV7Fixture } = await import("../../dev/reader-v7-fixture");
  for (const cueGroups of [[["cue-1", "cue-2", "cue-3"]], [["cue-1", "cue-3"], ["cue-2"]]]) {
    const doc = crossCueV7Fixture();
    const scene = doc.sections[0];
    const template = scene.utterances[0];
    doc.points = [];
    doc.reusableItems = [];
    scene.utterances = cueGroups.map((cueIds, index) => ({
      ...template,
      id: `grouped-${index}`,
      cueIds,
      sourceSpans: cueIds.map(cueId => ({
        cueId,
        start: 0,
        end: doc.cues.find(cue => cue.id === cueId)!.originalText.length,
      })),
      decision: "basic_only" as const,
      pointIds: [],
      chunks: undefined,
      meaning: "The complete original sentence.",
      contextExplanation: "",
    }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const played: string[] = [];
    try {
      await act(async () =>
        root.render(
          <SentenceDialogue
            document={doc}
            scene={scene}
            locale="en"
            playingCueId={null}
            disabled={false}
            playbackDisabled={false}
            translationVisible={false}
            onPlayCue={id => played.push(id)}
            onPlayOccurrence={() => {}}
            annotatedText={text => text}
          />,
        ),
      );
      const blocks = [...container.querySelectorAll('[data-ui="sourceUtterance"]')];
      const rows = [...container.querySelectorAll('[data-ui="sourceSentence"]')];
      assert.deepEqual(
        rows.map(row => row.getAttribute("data-source-cue")),
        scene.cueIds,
      );
      assert.deepEqual(
        blocks.map(block =>
          [...block.querySelectorAll('[data-ui="sourceSentence"]')].map(row =>
            row.getAttribute("data-source-cue"),
          ),
        ),
        cueGroups.length === 1 ? [["cue-1", "cue-2", "cue-3"]] : [["cue-1"], ["cue-2"], ["cue-3"]],
      );
      for (const row of rows) await click(row.querySelector('[data-ui="cue-play"]'));
      assert.deepEqual(played, scene.cueIds);
      if (cueGroups.length === 1) {
        assert.equal(container.querySelectorAll('[data-ui="analysis-group"]').length, 1);
        const analysis = blocks[0].querySelector('[data-ui="analysis-group"]')!;
        assert.ok(rows[2].compareDocumentPosition(analysis) & Node.DOCUMENT_POSITION_FOLLOWING);
        assert.equal(container.querySelectorAll('[data-ui="analysis-group"]').length, 1);
        assert.equal(container.querySelectorAll('[data-ui="sourceSentence"]').length, 3);
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  }
});

test("source-group disclosure retains complete originals and source-ordered analysis panels", async () => {
  const doc = (await import("../../dev/reader-v7-fixture")).crossCueV7Fixture();
  const scene = doc.sections[0];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = () =>
    root.render(
      <SentenceDialogue
        document={{ ...doc }}
        scene={{ ...scene }}
        locale="zh-TW"
        playingCueId={null}
        disabled={false}
        playbackDisabled={false}
        translationVisible={false}
        onPlayCue={() => {}}
        onPlayOccurrence={() => {}}
        annotatedText={text => text}
      />,
    );
  try {
    await act(async () => render());
    const blocks = [...container.querySelectorAll('[data-ui="sourceUtterance"]')];
    assert.deepEqual(
      blocks.map(block =>
        [...block.querySelectorAll('[data-ui="sourceSentence"]')].map(row =>
          row.getAttribute("data-source-cue"),
        ),
      ),
      [["cue-1"], ["cue-2", "cue-3"]],
    );
    assert.equal(container.querySelectorAll('[data-ui="analysis-group"]').length, 2);
    assert.equal(container.querySelectorAll('[data-ui="analysis-toggle"]').length, 2);
    assert.ok(container.querySelector('[data-ui="analysis-toggle-all"]'));
    assert.ok(
      [...container.querySelectorAll<HTMLElement>('[data-ui="analysis-content"]')].every(
        panel => panel.hidden,
      ),
    );
    const lastSource = blocks[1].querySelector('[data-source-cue="cue-3"]')!;
    assert.ok(
      lastSource.compareDocumentPosition(blocks[1].querySelector('[data-ui="analysis-group"]')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const before = container.querySelector('[data-ui="analysis-group"]');
    await click(container.querySelector('[data-ui="sentence-text"]'));
    assert.equal(container.querySelector('[data-ui="analysis-group"]'), before);
    scene.id = "another-scene";
    await act(async () => render());
    assert.equal(container.querySelectorAll('[data-ui="analysis-group"]').length, 2);
    assert.equal(container.querySelector('[data-ui="selectedChunkMeaning"]'), null);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("fragment meanings and roles remain available without a separate comparison section", async () => {
  const doc = (await import("../../dev/reader-v7-fixture")).longReadingV7Fixture("ja");
  const scene = doc.sections[0],
    chunks = scene.utterances[1].chunks!;
  chunks[0].role = "先提出條件，再接後續結果。";
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <SentenceDialogue
          document={doc}
          scene={scene}
          locale="zh-TW"
          playingCueId={null}
          disabled={false}
          playbackDisabled={false}
          translationVisible={false}
          onPlayCue={() => {}}
          onPlayOccurrence={() => {}}
          annotatedText={text => text}
        />,
      ),
    );
    assert.equal(container.querySelectorAll('[data-ui="analysis-group"]').length, 2);
    assert.equal(container.querySelector('[data-ui="chunk-explanations"]'), null);
    const meanings = [...container.querySelectorAll('[data-ui="whole-meaning"]')].map(
      e => e.textContent,
    );
    assert.equal(container.querySelector('[data-ui="chunk-comparison-toggle"]'), null);
    const fragments = [...container.querySelectorAll('[data-ui="source-chunk-hover"]')];
    for (const [index, chunk] of chunks.entries()) {
      await click(fragments[index]);
      const lookup = container.querySelector('[data-ui="selectedChunkMeaning"]')!;
      assert.ok(lookup.textContent?.includes(chunk.meaning));
      if (chunk.role) assert.ok(lookup.textContent?.includes(chunk.role));
    }
    assert.equal(container.querySelector('[data-ui="close-chunk"]'), null);
    await click(fragments[chunks.length - 1]);
    assert.equal(container.querySelector('[data-ui="selectedChunkMeaning"]'), null);
    assert.deepEqual(
      [...container.querySelectorAll('[data-ui="whole-meaning"]')].map(e => e.textContent),
      meanings,
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("fragment lookup updates in place, preserves the complete reading, and closes by selecting its source again", async () => {
  const doc = (await import("../../dev/reader-v7-fixture")).longReadingV7Fixture("ja");
  const scene = doc.sections[0],
    chunks = scene.utterances[1].chunks!;
  chunks[0].role = "Selected condition role.";
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = () =>
    root.render(
      <SentenceDialogue
        document={{ ...doc }}
        scene={{ ...scene }}
        locale="zh-TW"
        playingCueId={null}
        disabled={false}
        playbackDisabled={false}
        translationVisible={false}
        onPlayCue={() => {}}
        onPlayOccurrence={() => {}}
        annotatedText={text => text}
      />,
    );
  const previousScroll = dom.window.HTMLElement.prototype.scrollIntoView;
  let scrollCalls = 0;
  dom.window.HTMLElement.prototype.scrollIntoView = () => {
    scrollCalls++;
  };
  try {
    await act(async () => render());
    const buttons = [...container.querySelectorAll<HTMLElement>('[data-ui="source-chunk-hover"]')];
    assert.equal(buttons.length, 2);
    const fullPanels = [...container.querySelectorAll('[data-ui="analysis-group"]')];
    const fullText = fullPanels.map(e => e.textContent);
    await act(async () => buttons[0].focus());
    await click(buttons[0]);
    const panel = container.querySelector('[data-ui="selectedChunkMeaning"]')!;
    assert.ok(panel.textContent?.includes(chunks[0].meaning));
    assert.ok(panel.textContent?.includes(chunks[0].role!));
    assert.equal(panel.textContent?.includes(chunks[1].meaning), false);
    assert.equal(buttons[0].getAttribute("aria-checked"), "true");
    assert.equal(panel.parentElement?.id, buttons[0].getAttribute("aria-controls"));
    assert.ok(document.getElementById(panel.getAttribute("aria-labelledby")!));
    await act(async () => buttons[1].focus());
    await click(buttons[1]);
    assert.equal(container.querySelector('[data-ui="selectedChunkMeaning"]'), panel);
    assert.ok(panel.textContent?.includes(chunks[1].meaning));
    assert.equal(panel.textContent?.includes(chunks[0].meaning), false);
    assert.equal(buttons[0].getAttribute("aria-checked"), "false");
    assert.equal(buttons[1].getAttribute("aria-checked"), "true");
    assert.deepEqual([...container.querySelectorAll('[data-ui="analysis-group"]')], fullPanels);
    assert.deepEqual(
      fullPanels.map(e => e.textContent),
      fullText,
      "selection must not hide sentence-only notes or examples",
    );
    assert.equal(container.querySelector('[data-ui="close-chunk"]'), null);
    await click(buttons[1]);
    assert.equal(container.querySelector('[data-ui="selectedChunkMeaning"]'), null);
    assert.equal(document.activeElement, buttons[1]);
    assert.equal(buttons[1].getAttribute("aria-checked"), "false");
    await click(buttons[0]);
    await click(buttons[0]);
    assert.equal(
      container.querySelector('[data-ui="selectedChunkMeaning"]'),
      null,
      "clicking selected fragment closes lookup",
    );
    await click(buttons[0]);
    scene.id = "selection-reset";
    await act(async () => render());
    assert.equal(container.querySelector('[data-ui="selectedChunkMeaning"]'), null);
    assert.equal(
      container.querySelector('[data-ui="source-chunk-hover"][aria-checked="true"]'),
      null,
    );
    assert.equal(container.querySelectorAll('[data-ui="analysis-group"]').length, 2);
    assert.equal(scrollCalls, 0);
  } finally {
    await act(async () => root.unmount());
    dom.window.HTMLElement.prototype.scrollIntoView = previousScroll;
    container.remove();
  }
});

test("duplicate content has no empty analysis or extension entry, and translation visibility recalculates it", async () => {
  const doc = structuredClone(v7Fixture),
    scene = doc.sections[0];
  const unit = scene.utterances[0],
    translated = scene.translations[0].text;
  unit.meaning = translated;
  unit.contextExplanation = translated;
  const explained = scene.utterances[1];
  const duplicate = "same saved explanation";
  explained.meaning = duplicate;
  explained.contextExplanation = duplicate;
  doc.points.forEach(p => {
    p.presentation = "extended";
    p.explanation = duplicate;
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (translationVisible: boolean) =>
    root.render(
      <SentenceDialogue
        document={{ ...doc }}
        scene={{ ...scene }}
        locale="en"
        playingCueId={null}
        disabled={false}
        playbackDisabled={false}
        translationVisible={translationVisible}
        onPlayCue={() => {}}
        onPlayOccurrence={() => {}}
        annotatedText={text => text}
      />,
    );
  try {
    await act(async () => render(true));
    assert.equal(container.querySelectorAll('[data-ui="analysis-group"]').length, 1);
    assert.equal(
      [...container.querySelectorAll("button")].some(b => b.textContent === "More explanation"),
      false,
    );
    await act(async () => render(false));
    assert.equal(container.querySelectorAll('[data-ui="analysis-group"]').length, 2);
    assert.ok(
      container.querySelector('[data-ui="inlineAnalysis"]')?.textContent?.includes(translated),
    );
    unit.meaning = "";
    unit.contextExplanation = "";
    await act(async () => render(false));
    assert.equal(container.querySelectorAll('[data-ui="analysis-group"]').length, 1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("source, fragment and paced example read-aloud send exact original text through the system speech controller", async context => {
  const { crossCueV7Fixture } = await import("../../dev/reader-v7-fixture");
  const { SystemSpeechProvider } = await import("../components/system-speech");
  const { SpeechController } = await import("../native/speech-controller");
  const doc = crossCueV7Fixture(),
    scene = doc.sections[0];
  const spoken: string[] = [],
    played: string[] = [];
  let preparations = 0;
  const controller = new SpeechController(onMessage => ({
    close() {},
    send(request) {
      queueMicrotask(() => {
        if (request.type === "listSpeechVoices")
          onMessage({
            id: request.id,
            type: "speechVoices",
            supported: true,
            voices: [{ id: "en", name: "English", language: "en-US", quality: "enhanced" }],
          });
        else if (request.type === "speak") {
          spoken.push(request.input.text);
          onMessage({ id: request.id, type: "speechFinished", status: "completed" });
        } else if ("id" in request) onMessage({ id: request.id, type: "speechStopped" });
      });
    },
  }));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <SystemSpeechProvider controller={controller}>
          <SentenceDialogue
            document={doc}
            scene={scene}
            locale="en"
            playingCueId={null}
            disabled={false}
            playbackDisabled={false}
            translationVisible={false}
            onPlayCue={id => played.push(id)}
            onPlayOccurrence={() => {}}
            annotatedText={text => text}
            beforeSpeak={async () => {
              preparations++;
            }}
          />
        </SystemSpeechProvider>,
      ),
    );
    const sourceSpeech = container.querySelectorAll(
      '[data-ui="analysis-source-header"] button[aria-label="Read complete sentence"]',
    );
    assert.equal(sourceSpeech.length, 2);
    await click(sourceSpeech[1]);
    assert.equal(
      spoken[0].replace(/\s+/gu, " "),
      doc.cues
        .slice(1)
        .map(c => c.originalText)
        .join(" "),
    );
    await click(container.querySelector('[data-ui="source-chunk-hover"]'));
    await click(
      container.querySelector(
        '[data-ui="selectedChunkMeaning"] button[aria-label="Read selected phrase"]',
      ),
    );
    const chunk = scene.utterances[1].chunks![0];
    assert.equal(
      spoken[1],
      chunk.spans
        .map(s => doc.cues.find(c => c.id === s.cueId)!.originalText.slice(s.start, s.end))
        .join(" "),
    );
    assert.equal(preparations, 2);
    await click(
      [...container.querySelectorAll("button")].find(b => b.textContent === "AI-created examples")!,
    );
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const example = doc.reusableItems[0].examples[0];
    const dialogue = container.querySelector('[data-ui="example-dialogue"]')!;
    await click(dialogue.querySelector('button[aria-label="Read dialogue"]'));
    assert.equal(spoken[2], example.dialogue[0].text);
    assert.ok(dialogue.querySelector('button[aria-label="Stop reading"]'));
    await act(async () => context.mock.timers.tick(499));
    assert.equal(spoken.length, 3);
    await act(async () => context.mock.timers.tick(1));
    assert.deepEqual(
      spoken.slice(2),
      example.dialogue.map(line => line.text),
    );
    assert.ok(dialogue.querySelector('button[aria-label="Read dialogue"]'));
    assert.equal(preparations, 3);
    assert.deepEqual(played, [], "system pronunciation does not trigger video playback");
    assert.equal(container.querySelectorAll('[data-ui="analysis-group"]').length, 2);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
