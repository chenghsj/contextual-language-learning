import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatTime, GenerationRequestSchema, LearningDocumentSchema, parsePlainText,
  parseSubtitles, youtubeTimeLink, netflixWatchId,
  type AgentSettings, type HostMessage, type LearningDocument,
  type LearningProfile, type SubtitleCue, type VideoSource,
} from "@immersive/core";
import { BookOpen, Settings2, WandSparkles } from "lucide-react";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Select } from "./components/ui/select";
import { Textarea } from "./components/ui/textarea";
import { Badge } from "./components/ui/badge";

const HOST_NAME = "dev.immersive.language_learning";
type Page = "create" | "reader" | "settings";
type Installed = Record<"claude" | "codex" | "agy", boolean>;
type RepeatOption = "2" | "3" | "5" | "infinite";

const DEFAULT_PROFILE: LearningProfile = {
  targetLanguage: "en", instructionLanguage: "zh-TW", level: "B1",
  mode: "adaptive", maxNewVocabulary: 8, exerciseCount: 3,
};
const DEFAULT_AGENT: AgentSettings = { provider: "claude", modelId: "" };

function platformFromUrl(value: string): VideoSource["platform"] {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(host)) return "youtube";
    if (host === "netflix.com" || host.endsWith(".netflix.com")) return "netflix";
  } catch { /* manual import */ }
  return "import";
}

function downloadDocument(doc: LearningDocument, format: "json" | "md"): void {
  const md = [
    "# " + doc.source.title, "",
    "Level: " + doc.profile.level + " · Teaching language: " + doc.profile.instructionLanguage, "",
    ...doc.sections.flatMap(section => [
      "## " + section.title, "", section.context, "",
      ...section.cueIds.map(id => {
        const cue = doc.cues.find(item => item.id === id);
        return cue ? "> " + formatTime(cue.startMs) + " " + cue.originalText : "";
      }),
      "", "### Vocabulary",
      ...section.vocabulary.map(word => "- " + word.expression + " — " + word.meaning + ": " + word.explanation),
      "", "### Insights", ...section.insights.map(text => "- " + text),
      "", "### Practice", ...section.exercises.map(ex => "- " + ex.question + "\n  - " + ex.answer), "",
    ]),
  ].join("\n");
  const content = format === "json" ? JSON.stringify(doc, null, 2) : md;
  const blob = new Blob([content], { type: format === "json" ? "application/json" : "text/markdown" });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url, saveAs: true, filename: "immersive-" + doc.id.slice(0, 8) + "." + format,
  }, () => {
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  });
}

export default function App() {
  const [page, setPage] = useState<Page>("create");
  const [raw, setRaw] = useState("");
  const [fileName, setFileName] = useState("");
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [profile, setProfile] = useState<LearningProfile>(DEFAULT_PROFILE);
  const [agent, setAgent] = useState<AgentSettings>(DEFAULT_AGENT);
  const [installed, setInstalled] = useState<Installed | null>(null);
  const [document, setDocument] = useState<LearningDocument | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [repeat, setRepeat] = useState<RepeatOption>("3");
  const [delay, setDelay] = useState(1);
  const [loopActive, setLoopActive] = useState(false);
  const [playbackStatus, setPlaybackStatus] = useState("");
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const requestRef = useRef<string | null>(null);

  const cues = useMemo(() => raw.includes("-->") ? parseSubtitles(raw) : parsePlainText(raw), [raw]);
  const platform = platformFromUrl(sourceUrl);

  useEffect(() => {
    void chrome.storage.local.get(["profile", "agent", "repeat", "delay"]).then(saved => {
      if (saved.profile) setProfile(saved.profile as LearningProfile);
      if (saved.agent) setAgent(saved.agent as AgentSettings);
      if (saved.repeat) setRepeat(saved.repeat as RepeatOption);
      if (typeof saved.delay === "number") setDelay(saved.delay);
      setHydrated(true);
    }).catch(() => setHydrated(true));
    void chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      const tab = tabs[0];
      if (tab?.url && platformFromUrl(tab.url) !== "import") {
        setSourceUrl(tab.url);
        setTitle((tab.title ?? "Video").slice(0, 200));
      }
    });
    return () => { portRef.current?.disconnect(); };
  }, []);

  useEffect(() => {
    if (hydrated) void chrome.storage.local.set({ profile, agent, repeat, delay });
  }, [hydrated, profile, agent, repeat, delay]);

  function checkHost(): void {
    setError("");
    const id = crypto.randomUUID();
    let replied = false;
    const port = chrome.runtime.connectNative(HOST_NAME);
    port.onMessage.addListener((message: HostMessage) => {
      if (message.id === id && message.type === "health") {
        replied = true;
        setInstalled(message.installed);
        port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => {
      if (!replied) setError(chrome.runtime.lastError?.message ?? "Native Host connection failed.");
    });
    port.postMessage({ id, type: "health" });
  }

  function startGeneration(): void {
    setError("");
    try {
      const id = crypto.randomUUID();
      const payload = GenerationRequestSchema.parse({
        id,
        source: { platform, title: title.trim(), ...(sourceUrl.trim() ? { url: sourceUrl.trim() } : {}) },
        profile, agent, cues,
      });
      const port = chrome.runtime.connectNative(HOST_NAME);
      portRef.current = port;
      requestRef.current = id;
      setGenerating(true);
      setProgress("連線至本地 CLI…");
      let finished = false;
      port.onMessage.addListener((message: HostMessage) => {
        if (message.id !== id) return;
        if (message.type === "progress") {
          setProgress("已完成 " + message.completed + " / " + message.total + " 個章節");
        } else if (message.type === "result") {
          finished = true;
          const parsed = LearningDocumentSchema.safeParse(message.document);
          if (!parsed.success) setError("Host returned an invalid document.");
          else { setDocument(parsed.data); setPage("reader"); setProgress("教材已建立並存入本地 Documents/Immersive Learning"); }
          setGenerating(false);
          port.disconnect();
        } else if (message.type === "error") {
          finished = true;
          setError(message.message);
          setGenerating(false);
          port.disconnect();
        }
      });
      port.onDisconnect.addListener(() => {
        if (portRef.current === port) portRef.current = null;
        if (!finished) {
          setGenerating(false);
          setError(chrome.runtime.lastError?.message ?? "Native Host disconnected during generation.");
        }
      });
      port.postMessage({ id, type: "generate", payload });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid generation settings.");
    }
  }

  function cancelGeneration(): void {
    if (!portRef.current || !requestRef.current) return;
    portRef.current.postMessage({ id: crypto.randomUUID(), type: "cancel", jobId: requestRef.current });
    setProgress("正在取消…");
  }

  async function onFile(file: File | undefined): Promise<void> {
    if (!file) return;
    if (file.size > 2_000_000) { setError("檔案上限為 2 MB。請選擇較短的字幕。"); return; }
    setRaw(await file.text());
    setFileName(file.name);
    if (!title) setTitle(file.name.replace(/\.(srt|vtt|txt)$/i, ""));
    setError("");
  }

  async function youtubeTab(): Promise<chrome.tabs.Tab | undefined> {
    const url = document?.source.url ?? sourceUrl;
    if (platformFromUrl(url) !== "youtube") return undefined;
    const sourceId = youtubeTimeLink(url, 0)?.match(/[?&]v=([^&]+)/)?.[1];
    const tabs = await chrome.tabs.query({});
    return tabs.find(tab => tab.id && tab.url && youtubeTimeLink(tab.url, 0)?.includes("v=" + sourceId + "&"));
  }

  async function netflixTab(): Promise<chrome.tabs.Tab | undefined> {
    const id = netflixWatchId(document?.source.url ?? sourceUrl);
    if (!id) return undefined;
    const tabs = await chrome.tabs.query({});
    return tabs.find(tab => tab.id && netflixWatchId(tab.url) === id);
  }

  async function diagnoseNetflix(): Promise<void> {
    setError("");
    try {
      const tab = await netflixTab();
      if (!tab?.id) throw new Error("請先開啟教材對應的 Netflix 影片分頁。");
      const response = await chrome.tabs.sendMessage(tab.id, { type: "NETFLIX_DIAGNOSE" }) as {
        ok: boolean; error?: string; currentMs?: number;
      };
      if (!response?.ok) throw new Error(response?.error ?? "Netflix 播放器尚未就緒。");
      setPlaybackStatus("播放器已就緒 · 目前時間 " + formatTime(response.currentMs ?? null));
    } catch (cause) {
      setPlaybackStatus("");
      setError(cause instanceof Error ? cause.message : "Netflix 診斷失敗。");
    }
  }

  async function seekNetflix(cue: SubtitleCue): Promise<void> {
    if (cue.startMs === null) return;
    setError("");
    try {
      const tab = await netflixTab();
      if (!tab?.id) throw new Error("請先在 Chrome 開啟這部 Netflix 影片。");
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "NETFLIX_SEEK", timeMs: cue.startMs,
      }) as { ok: boolean; error?: string };
      if (!response?.ok) throw new Error(response?.error ?? "Netflix 不支援這次跳轉。");
      setLoopActive(false);
      await chrome.tabs.update(tab.id, { active: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Netflix 無法跳轉，請使用顯示的時間手動定位。");
    }
  }

  async function loopCue(cue: SubtitleCue): Promise<void> {
    if (cue.startMs === null || cue.endMs === null) return;
    const netflix = !!netflixWatchId(document?.source.url ?? sourceUrl);
    try {
      const tab = netflix ? await netflixTab() : await youtubeTab();
      if (!tab?.id) throw new Error("請先在 Chrome 開啟對應的影片分頁。");
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: netflix ? "NETFLIX_LOOP_SET" : "LOOP_SET",
        startMs: cue.startMs, endMs: cue.endMs,
        repeats: repeat === "infinite" ? "infinite" : Number(repeat),
        delaySeconds: delay,
      }) as { ok: boolean; error?: string };
      if (!response?.ok) throw new Error(response?.error ?? "播放器無法進行片段循環。");
      setLoopActive(true);
      setError("");
      await chrome.tabs.update(tab.id, { active: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "無法設定循環播放。");
    }
  }

  async function stopLoop(): Promise<void> {
    const netflix = !!netflixWatchId(document?.source.url ?? sourceUrl);
    try {
      const tab = netflix ? await netflixTab() : await youtubeTab();
      if (tab?.id) await chrome.tabs.sendMessage(tab.id, {
        type: netflix ? "NETFLIX_LOOP_CLEAR" : "LOOP_CLEAR",
      });
    } catch {
      // A removed or reloaded video tab already ends its loop.
    }
    setLoopActive(false);
  }

  const levelOptions = profile.targetLanguage === "en"
    ? ["A1", "A2", "B1", "B2", "C1", "C2"]
    : profile.targetLanguage === "ja"
      ? ["N5", "N4", "N3", "N2", "N1"] : ["1", "2", "3", "4", "5", "6"];

  return (
    <div className="app">
      <header className="topbar">
        <div><span className="brandMark">IL</span><strong>Immersive Learning</strong></div>
        <span className="version">MVP · v0.1</span>
      </header>
      <nav className="tabs" aria-label="主要選單">
        <Button className={page === "create" ? "selected" : ""} onClick={() => setPage("create")}><WandSparkles aria-hidden="true" />建立教材</Button>
        <Button className={page === "reader" ? "selected" : ""} onClick={() => setPage("reader")}><BookOpen aria-hidden="true" />閱讀文件</Button>
        <Button className={page === "settings" ? "selected" : ""} onClick={() => setPage("settings")}><Settings2 aria-hidden="true" />Agent 設定</Button>
      </nav>

      {error && <div className="alert" role="alert">{error}<Button variant="ghost" size="icon" aria-label="關閉錯誤" onClick={() => setError("")}>×</Button></div>}

      {page === "create" && <main>
        <Card className="panel">
          <h2>1. 字幕與影片</h2>
          <p className="hint">匯入你有權使用的 SRT、VTT 或文字。Netflix 不會被自動擷取或修改。</p>
          <label>字幕檔案 <Input type="file" accept=".srt,.vtt,.txt,text/plain" onChange={event => void onFile(event.target.files?.[0])} /></label>
          {fileName && <p className="hint">已匯入：{fileName}</p>}
          <label>或貼上字幕 <Textarea rows={5} value={raw} onChange={event => setRaw(event.target.value)} placeholder="WEBVTT、SRT 或純文字…" /></label>
          <p className="hint">已解析 {cues.length} 段字幕。</p>
          <label>影片／教材標題 <Input value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：Making a decision" /></label>
          <label>原始影片網址（選填） <Input type="url" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" /></label>
          <Badge className="chip">來源：{platform === "youtube" ? "YouTube" : platform === "netflix" ? "Netflix（可選播放器控制）" : "字幕匯入"}</Badge>
        </Card>

        <Card className="panel">
          <h2>2. 教材設定</h2>
          <div className="twoColumns">
            <label>學習語言
              <Select value={profile.targetLanguage} onChange={event => {
                const targetLanguage = event.target.value as LearningProfile["targetLanguage"];
                setProfile(current => ({ ...current, targetLanguage, level: targetLanguage === "en" ? "B1" : targetLanguage === "ja" ? "N4" : "2" }));
              }}><option value="en">英文</option><option value="ja">日文</option><option value="ko">韓文</option></Select>
            </label>
            <label>程度
              <Select value={profile.level} onChange={event => setProfile(current => ({ ...current, level: event.target.value }))}>
                {levelOptions.map(level => <option key={level} value={level}>{level}</option>)}
              </Select>
            </label>
          </div>
          <label>文件教學語言
            <Select value={profile.instructionLanguage} onChange={event => setProfile(current => ({ ...current, instructionLanguage: event.target.value as LearningProfile["instructionLanguage"] }))}>
              <option value="zh-TW">繁體中文</option><option value="zh-CN">简体中文</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option>
            </Select>
          </label>
          <label>解說模式
            <Select value={profile.mode} onChange={event => setProfile(current => ({ ...current, mode: event.target.value as LearningProfile["mode"] }))}>
              <option value="adaptive">依程度調整</option><option value="guided">較多教學語言輔助</option><option value="immersive">較多目標語言練習</option>
            </Select>
          </label>
          <div className="twoColumns">
            <label>每章新詞彙上限
              <Input type="number" min={1} max={30} value={profile.maxNewVocabulary} onChange={event => setProfile(current => ({ ...current, maxNewVocabulary: Number(event.target.value) }))} />
            </label>
            <label>每章練習題
              <Input type="number" min={0} max={12} value={profile.exerciseCount} onChange={event => setProfile(current => ({ ...current, exerciseCount: Number(event.target.value) }))} />
            </label>
          </div>
        </Card>

        <Card className="panel">
          <h2>3. Agent 與生成</h2>
          <p className="hint">目前使用：{agent.provider} · {agent.modelId || "CLI 預設模型"}。切換請至 Agent 設定。</p>
          <p className="hint">教材會存到 ~/Documents/Immersive Learning；完成後也能以「另存新檔」選擇本地位置。</p>
          <Button className="primary" onClick={startGeneration} disabled={generating || !cues.length || !title.trim()}>
            {generating ? "生成中…" : "使用本地 Agent 生成教材"}
          </Button>
          {generating && <Button variant="outline" className="secondary" onClick={cancelGeneration}>取消生成</Button>}
          {progress && <p className="status" role="status">{progress}</p>}
        </Card>
      </main>}

      {page === "settings" && <main>
        <Card className="panel">
          <h2>本地 CLI Agent</h2>
          <p className="hint">只使用你的本地 CLI 登入狀態；字幕會依所選 CLI 的服務條款傳送給相應模型供應商。</p>
          <Button variant="outline" className="secondary" onClick={checkHost}>檢查 Native Host / CLI</Button>
          {installed && <div className="status">
            Claude：{installed.claude ? "已安裝" : "未找到"} · Codex：{installed.codex ? "已安裝" : "未找到"} · AGY：{installed.agy ? "已安裝" : "未找到"}
          </div>}
          <label>預設 Agent
            <Select value={agent.provider} onChange={event => setAgent(current => ({ ...current, provider: event.target.value as AgentSettings["provider"], accountConfigDir: undefined }))}>
              <option value="claude">Claude Code</option><option value="codex">Codex</option><option value="agy">AGY</option>
            </Select>
          </label>
          <label>預設模型 ID
            <Input value={agent.modelId} onChange={event => setAgent(current => ({ ...current, modelId: event.target.value }))} placeholder="留空使用 CLI 預設模型" />
          </label>
          <label>獨立帳號設定目錄（選填）
            <Input disabled={agent.provider === "agy"} value={agent.accountConfigDir ?? ""} onChange={event => setAgent(current => ({ ...current, accountConfigDir: event.target.value || undefined }))} placeholder="例如：/Users/you/.codex-work" />
          </label>
          <p className="hint">Claude 使用 CLAUDE_CONFIG_DIR，Codex 使用 CODEX_HOME；目錄必須已存在且位於使用者家目錄內。AGY 暫時使用目前登入帳號。</p>
          <div className="callout">Google Drive OAuth、多個帳號的圖形化管理及背景 Daemon 尚未納入這個 MVP，不會假裝已連線。</div>
        </Card>
      </main>}

      {page === "reader" && <main>
        {!document ? <Card className="panel empty">
          <h2>尚無教材</h2><p className="hint">先匯入字幕並生成，文件會顯示在這裡。</p>
          <Button variant="outline" className="secondary" onClick={() => setPage("create")}>建立教材</Button>
        </Card> : <>
          <Card className="panel">
            <Badge className="chip">{document.profile.targetLanguage.toUpperCase()} · {document.profile.level}</Badge>
            <h1>{document.source.title}</h1>
            <p className="hint">{document.sections.length} 個學習章節 · 教學語言 {document.profile.instructionLanguage}</p>
            <div className="actions">
              <Button variant="outline" className="secondary" onClick={() => downloadDocument(document, "json")}>JSON 另存新檔</Button>
              <Button variant="outline" className="secondary" onClick={() => downloadDocument(document, "md")}>Markdown 另存新檔</Button>
            </div>
          </Card>
          <Card className="panel">
            <h2>影片伴讀</h2>
            <div className="twoColumns">
              <label>循環次數
                <Select value={repeat} onChange={event => setRepeat(event.target.value as RepeatOption)}>
                  <option value="2">2 次</option><option value="3">3 次</option><option value="5">5 次</option><option value="infinite">持續循環</option>
                </Select>
              </label>
              <label>間隔
                <Select value={delay} onChange={event => setDelay(Number(event.target.value))}>
                  {[0, 1, 2, 3].map(seconds => <option key={seconds} value={seconds}>{seconds} 秒</option>)}
                </Select>
              </label>
            </div>
            {platformFromUrl(document.source.url ?? "") === "youtube"
              ? <p className="hint">循環控制使用已開啟的 YouTube 分頁，不會重新載入影片。</p>
              : netflixWatchId(document.source.url)
                ? <div className="callout">
                    Netflix 時間跳轉及循環使用非公開播放器 API，可能隨 Netflix 更新而失效；只在你點擊後執行，不取得字幕或改寫播放器。
                    <div className="actions"><Button variant="outline" className="secondary" onClick={() => void diagnoseNetflix()}>檢查 Netflix 播放器</Button></div>
                    {playbackStatus && <p className="hint" role="status">{playbackStatus}</p>}
                  </div>
                : <p className="hint">沒有播放器連結；仍可查看字幕時間戳及下載文件。</p>}
            {loopActive && <Button variant="outline" className="secondary" onClick={() => void stopLoop()}>停止循環</Button>}
          </Card>
          {document.sections.map(section => <Card className="panel lesson" key={section.id}>
            <Badge className="chip">{formatTime(section.startMs)}–{formatTime(section.endMs)}</Badge>
            <h2>{section.title}</h2>
            <p>{section.context}</p>
            <h3>原始字幕</h3>
            {section.cueIds.map(id => {
              const cue = document.cues.find(item => item.id === id);
              if (!cue) return null;
              const link = youtubeTimeLink(document.source.url, cue.startMs);
              const netflix = netflixWatchId(document.source.url) !== null;
              return <div className="cue" key={id}>
                <span className="time">{formatTime(cue.startMs)}</span>
                <p>{cue.originalText}</p>
                <div className="actions">
                  {link && <Button variant="link" className="textButton" onClick={() => void chrome.tabs.create({ url: link })}>開啟時間連結</Button>}
                  {netflix && cue.startMs !== null && <Button variant="link" className="textButton" onClick={() => void seekNetflix(cue)}>跳到 Netflix 指定時間</Button>}
                  {(link || netflix) && cue.startMs !== null && cue.endMs !== null && <Button variant="link" className="textButton" onClick={() => void loopCue(cue)}>循環此句</Button>}
                  {!link && cue.startMs !== null && <Button variant="link" className="textButton" onClick={() => void navigator.clipboard.writeText(formatTime(cue.startMs))}>複製時間</Button>}
                </div>
              </div>;
            })}
            {section.vocabulary.length > 0 && <><h3>單字與片語</h3>
              {section.vocabulary.map((word, index) => <div className="learningCard" key={word.expression + index}>
                <strong>{word.expression}</strong><span>{word.meaning}</span>
                <p>{word.explanation}</p>{word.example && <p className="example">{word.example}</p>}
              </div>)}</>}
            {section.insights.length > 0 && <><h3>語言重點</h3><ul>{section.insights.map((insight, index) => <li key={index}>{insight}</li>)}</ul></>}
            {section.exercises.length > 0 && <><h3>練習</h3>
              {section.exercises.map((exercise, index) => <details key={index}><summary>{exercise.question}</summary><p>{exercise.answer}</p></details>)}</>}
          </Card>)}
        </>}
      </main>}
    </div>
  );
}
