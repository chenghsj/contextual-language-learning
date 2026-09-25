import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatTime, GenerationRequestSchema, LearningDocumentSchema, parsePlainText,
  parseSubtitles, type AgentInfo, type GenerationRequest, type JobSummary,
  type AgentSettings, type HostMessage, type LearningDocument,
  type LearningProfile, type SubtitleCue,
} from "@immersive/core";
import { getVideoAdapter } from "./video";
import { DocumentChunkAssembler } from "./native/document-chunks";
import { BookOpen, Settings2, WandSparkles } from "lucide-react";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Select } from "./components/ui/select";
import { Textarea } from "./components/ui/textarea";
import { Badge } from "./components/ui/badge";

const HOST_NAME = "dev.immersive.language_learning";
type Page = "create" | "reader" | "settings";
type Installed = Record<string, boolean>;
type RepeatOption = "2" | "3" | "5" | "infinite";
type StorageLocation = { id: string; kind: "local" | "google-drive-desktop"; label: string; path: string; account?: string };

const DEFAULT_PROFILE: LearningProfile = {
  targetLanguage: "en", instructionLanguage: "zh-TW", level: "B1",
  mode: "adaptive", maxNewVocabulary: 8, exerciseCount: 3,
};
const DEFAULT_AGENT: AgentSettings = { provider: "claude", modelId: "" };

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
  const [agentProfiles, setAgentProfiles] = useState<Record<string, Pick<AgentSettings, "modelId" | "accountConfigDir">>>({});
  const [installed, setInstalled] = useState<Installed | null>(null);
  const [agentCatalog, setAgentCatalog] = useState<AgentInfo[]>([
    { id: "claude", label: "Claude Code", installed: false, supportsAccountProfiles: true },
    { id: "codex", label: "Codex", installed: false, supportsAccountProfiles: true },
    { id: "agy", label: "AGY", installed: false, supportsAccountProfiles: false },
  ]);
  const [document, setDocument] = useState<LearningDocument | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [storageLocations, setStorageLocations] = useState<StorageLocation[]>([]);
  const [outputPath, setOutputPath] = useState("");
  const [customOutputPath, setCustomOutputPath] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState<{ payload: GenerationRequest; count: number } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [repeat, setRepeat] = useState<RepeatOption>("3");
  const [delay, setDelay] = useState(1);
  const [loopActive, setLoopActive] = useState(false);
  const [playbackStatus, setPlaybackStatus] = useState("");
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const requestRef = useRef<string | null>(null);

  const cues = useMemo(() => raw.includes("-->") ? parseSubtitles(raw) : parsePlainText(raw), [raw]);
  const platform = getVideoAdapter(sourceUrl).id;
  const readerAdapter = getVideoAdapter(document?.source.url);

  useEffect(() => {
    void chrome.storage.local.get(["profile", "agent", "agentProfiles", "repeat", "delay"]).then(saved => {
      if (saved.profile) setProfile(saved.profile as LearningProfile);
      if (saved.agent) setAgent(saved.agent as AgentSettings);
      if (saved.agentProfiles && typeof saved.agentProfiles === "object") {
        setAgentProfiles(saved.agentProfiles as Record<string, Pick<AgentSettings, "modelId" | "accountConfigDir">>);
      } else if (saved.agent) {
        const previous = saved.agent as AgentSettings;
        setAgentProfiles({ [previous.provider]: { modelId: previous.modelId, accountConfigDir: previous.accountConfigDir } });
      }
      if (saved.repeat) setRepeat(saved.repeat as RepeatOption);
      if (typeof saved.delay === "number") setDelay(saved.delay);
      setHydrated(true);
    }).catch(() => setHydrated(true));
    const storageId = crypto.randomUUID();
    const storagePort = chrome.runtime.connectNative(HOST_NAME);
    storagePort.onMessage.addListener((message: HostMessage) => {
      if (message.id === storageId && message.type === "storageLocations") {
        setStorageLocations(message.locations);
        setOutputPath(current => current || message.locations[0]?.path || "");
        storagePort.disconnect();
      }
    });
    storagePort.postMessage({ id: storageId, type: "storageLocations" });
    void chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      const tab = tabs[0];
      if (tab?.url && getVideoAdapter(tab.url).id !== "import") {
        setSourceUrl(tab.url);
        setTitle((tab.title ?? "Video").slice(0, 200));
      }
    });
    return () => { portRef.current?.disconnect(); };
  }, []);

  useEffect(() => {
    if (hydrated) void chrome.storage.local.set({ profile, agent, agentProfiles, repeat, delay });
  }, [hydrated, profile, agent, agentProfiles, repeat, delay]);

  function updateAgent(next: AgentSettings): void {
    setAgent(next);
    setAgentProfiles(previous => ({
      ...previous,
      [next.provider]: { modelId: next.modelId, accountConfigDir: next.accountConfigDir },
    }));
  }

  function selectAgent(provider: string): void {
    const previous = agentProfiles[provider];
    updateAgent({
      provider,
      modelId: previous?.modelId ?? "",
      accountConfigDir: previous?.accountConfigDir,
    });
  }

  function checkHost(): void {
    setError("");
    const id = crypto.randomUUID();
    let replied = false;
    const port = chrome.runtime.connectNative(HOST_NAME);
    port.onMessage.addListener((message: HostMessage) => {
      if (message.id === id && message.type === "health") {
        replied = true;
        setInstalled(message.installed);
        if (Array.isArray(message.agents)) setAgentCatalog(message.agents);
        port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => {
      if (!replied) setError(chrome.runtime.lastError?.message ?? "Native Host connection failed.");
    });
    port.postMessage({ id, type: "health" });
  }

  function showDocument(raw: unknown): void {
    const parsed = LearningDocumentSchema.safeParse(raw);
    if (!parsed.success) throw new Error("Host returned an invalid learning document.");
    setDocument(parsed.data);
    setPage("reader");
    setProgress("教材已建立並存入本地 Documents/Immersive Learning");
  }

  function updateJob(summary: JobSummary): void {
    setJobs(previous => [summary, ...previous.filter(job => job.id !== summary.id)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }

  function runGeneration(input: { type: "generate"; payload: GenerationRequest } | { type: "resume"; jobId: string }): void {
    if (generating) return;
    setError("");
    const id = input.type === "generate" ? input.payload.id : crypto.randomUUID();
    const jobId = input.type === "generate" ? input.payload.id : input.jobId;
    const port = chrome.runtime.connectNative(HOST_NAME);
    portRef.current = port;
    requestRef.current = jobId;
    setGenerating(true);
    setProgress(input.type === "resume" ? "正在載入上次的生成進度…" : "連線至本地 CLI…");
    const chunks = new DocumentChunkAssembler();
    let finished = false;
    function complete(raw: unknown): void {
      try {
        showDocument(raw);
      } catch (error) {
        setError(error instanceof Error ? error.message : "文件無法開啟。");
      }
      finished = true;
      setGenerating(false);
      port.disconnect();
    }
    port.onMessage.addListener((message: HostMessage) => {
      if (message.id !== id) return;
      if (message.type === "job") {
        updateJob(message.job);
      } else if (message.type === "progress") {
        setProgress("已完成 " + message.completed + " / " + message.total + " 個章節");
      } else if (message.type === "result") {
        complete(message.document);
      } else if (message.type === "documentChunk") {
        try {
          const document = chunks.push(message);
          if (document) complete(document);
        } catch (error) {
          setError(error instanceof Error ? error.message : "文件分段資料無法讀取。");
          finished = true;
          setGenerating(false);
          port.disconnect();
        }
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
        setError(chrome.runtime.lastError?.message ?? "Native Host 中斷，可從任務紀錄恢復已完成的章節。");
      }
    });
    port.postMessage({ id, ...input });
  }

  function startGeneration(allowRegenerate = false): void {
    setError("");
    setDuplicateWarning(null);
    try {
      const id = crypto.randomUUID();
      const payload = GenerationRequestSchema.parse({
        id,
        source: { platform, title: title.trim(), ...(sourceUrl.trim() ? { url: sourceUrl.trim() } : {}) },
        profile, agent, cues, outputPath: customOutputPath.trim() || outputPath || undefined, allowRegenerate,
      });
      if (allowRegenerate) { runGeneration({ type: "generate", payload }); return; }
      const port = chrome.runtime.connectNative(HOST_NAME);
      port.onMessage.addListener((message: HostMessage) => {
        if (message.id !== id) return;
        if (message.type === "preflight") {
          port.disconnect();
          if (message.existing.length) setDuplicateWarning({ payload, count: message.existing.length });
          else runGeneration({ type: "generate", payload });
        } else if (message.type === "error") {
          port.disconnect();
          setError(message.message);
        }
      });
      port.postMessage({ id, type: "preflight", payload });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid generation settings.");
    }
  }

  function loadJobs(): void {
    if (loadingJobs) return;
    setError("");
    setLoadingJobs(true);
    const id = crypto.randomUUID();
    const port = chrome.runtime.connectNative(HOST_NAME);
    let received = false;
    port.onMessage.addListener((message: HostMessage) => {
      if (message.id !== id) return;
      if (message.type === "jobs") {
        received = true;
        setJobs(message.jobs);
        setLoadingJobs(false);
        port.disconnect();
      } else if (message.type === "error") {
        received = true;
        setError(message.message);
        setLoadingJobs(false);
        port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => {
      if (!received) {
        setLoadingJobs(false);
        setError(chrome.runtime.lastError?.message ?? "無法讀取本地任務紀錄。");
      }
    });
    port.postMessage({ type: "listJobs", id });
  }

  function openSavedDocument(documentId: string): void {
    if (generating) return;
    setError("");
    setGenerating(true);
    const id = crypto.randomUUID();
    const port = chrome.runtime.connectNative(HOST_NAME);
    const chunks = new DocumentChunkAssembler();
    let finished = false;
    function complete(raw: unknown): void {
      try { showDocument(raw); }
      catch (error) { setError(error instanceof Error ? error.message : "無法開啟教材。"); }
      finished = true;
      setGenerating(false);
      port.disconnect();
    }
    port.onMessage.addListener((message: HostMessage) => {
      if (message.id !== id) return;
      if (message.type === "result") complete(message.document);
      else if (message.type === "documentChunk") {
        try {
          const doc = chunks.push(message);
          if (doc) complete(doc);
        } catch (error) {
          finished = true;
          setGenerating(false);
          setError(error instanceof Error ? error.message : "文件分段資料損壞。");
          port.disconnect();
        }
      } else if (message.type === "error") {
        finished = true;
        setGenerating(false);
        setError(message.message);
        port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => {
      if (!finished) {
        setGenerating(false);
        setError(chrome.runtime.lastError?.message ?? "Native Host 已中斷。");
      }
    });
    port.postMessage({ type: "getDocument", id, documentId });
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

  async function diagnoseVideo(): Promise<void> {
    setError("");
    try {
      if (!readerAdapter.diagnose || !document?.source.url) throw new Error("這個影片來源不支援播放器診斷。");
      const status = await readerAdapter.diagnose(document.source.url);
      setPlaybackStatus(status.message + (status.currentMs !== undefined ? " · 目前時間 " + formatTime(status.currentMs) : ""));
    } catch (cause) {
      setPlaybackStatus("");
      setError(cause instanceof Error ? cause.message : "播放器診斷失敗。");
    }
  }

  async function seekCue(cue: SubtitleCue): Promise<void> {
    if (cue.startMs === null) return;
    setError("");
    try {
      if (!readerAdapter.seek || !document?.source.url) throw new Error("此來源不支援直接時間跳轉。");
      await readerAdapter.seek(document.source.url, cue.startMs);
      setLoopActive(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "無法跳轉，請使用顯示的時間手動定位。");
    }
  }

  async function loopCue(cue: SubtitleCue): Promise<void> {
    if (cue.startMs === null || cue.endMs === null) return;
    setError("");
    try {
      if (!readerAdapter.loop || !document?.source.url) throw new Error("此來源不支援片段循環。");
      await readerAdapter.loop(document.source.url, {
        startMs: cue.startMs, endMs: cue.endMs,
        repeats: repeat === "infinite" ? "infinite" : Number(repeat),
        delaySeconds: delay,
      });
      setLoopActive(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "無法設定循環播放。");
    }
  }

  async function stopLoop(): Promise<void> {
    try {
      if (readerAdapter.stopLoop && document?.source.url) {
        await readerAdapter.stopLoop(document.source.url);
      }
    } catch {
      // Closing or reloading a video tab already cancels its loop.
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
          <Badge className="chip">來源：{getVideoAdapter(sourceUrl).label}</Badge>
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
          <label>儲存位置
            <Select value={customOutputPath ? "custom" : outputPath} onChange={event => {
              if (event.target.value === "custom") { setCustomOutputPath(customOutputPath || ""); return; }
              setCustomOutputPath(""); setOutputPath(event.target.value);
            }}>
              {storageLocations.map(location => <option key={location.id} value={location.path}>{location.label}</option>)}
              <option value="custom">其他本機資料夾…</option>
            </Select>
          </label>
          {customOutputPath !== "" || (!storageLocations.some(location => location.path === outputPath) && outputPath === "") ? <label>自訂資料夾路徑
            <Input value={customOutputPath} onChange={event => setCustomOutputPath(event.target.value)}
              placeholder="/Users/you/Documents/My Lessons" />
          </label> : null}
          <p className="hint">若已安裝 Google Drive for desktop，這裡會自動列出每個已掛載帳號，可直接切換。資料仍先保留本地 checkpoint。</p>
          {duplicateWarning && <div className="callout">
            這個影片／教材在目前儲存位置已生成過 {duplicateWarning.count} 次。重新生成會建立新版本，不覆蓋舊文件。
            <div className="actions">
              <Button variant="destructive" size="sm" onClick={() => runGeneration({ type: "generate", payload: { ...duplicateWarning.payload, allowRegenerate: true } })}>確認重新生成</Button>
              <Button variant="outline" size="sm" onClick={() => setDuplicateWarning(null)}>取消</Button>
            </div>
          </div>}
          <Button className="primary" onClick={startGeneration} disabled={generating || !cues.length || !title.trim()}>
            {generating ? "生成中…" : "使用本地 Agent 生成教材"}
          </Button>
          {generating && <Button variant="outline" className="secondary" onClick={cancelGeneration}>取消生成</Button>}
          {progress && <p className="status" role="status">{progress}</p>}
        </Card>
        <Card className="panel">
          <h2>任務紀錄與恢復</h2>
          <p className="hint">已完成的章節會儲存在本地；Host 中斷後，可從未完成處繼續。取消的任務不會自動恢復。</p>
          <Button variant="outline" className="secondary" disabled={loadingJobs}
            onClick={loadJobs}>{loadingJobs ? "讀取中…" : "重新整理任務"}</Button>
          {jobs.map(job => <div className="learningCard" key={job.id}>
            <strong>{job.sourceTitle}</strong>
            <p>{job.provider} · {job.status} · {job.completed} / {job.total} 章節</p>
            {job.error && <p>{job.error}</p>}
            <div className="actions">
              {["queued", "waiting", "failed"].includes(job.status) &&
                <Button variant="outline" size="sm" disabled={generating}
                  onClick={() => runGeneration({ type: "resume", jobId: job.id })}>繼續生成</Button>}
              {job.documentId &&
                <Button variant="outline" size="sm" disabled={generating}
                  onClick={() => openSavedDocument(job.documentId!)}>開啟教材</Button>}
            </div>
          </div>)}
        </Card>
      </main>}

      {page === "settings" && <main>
        <Card className="panel">
          <h2>本地 CLI Agent</h2>
          <p className="hint">只使用你的本地 CLI 登入狀態；字幕會依所選 CLI 的服務條款傳送給相應模型供應商。</p>
          <Button variant="outline" className="secondary" onClick={checkHost}>檢查 Native Host / CLI</Button>
          {installed && <div className="status">
            {agentCatalog.map(entry => entry.label + "：" + (entry.installed ? "已安裝" : "未找到")).join(" · ")}
          </div>}
          <label>預設 Agent
            <Select value={agent.provider} onChange={event => selectAgent(event.target.value)}>
              {agentCatalog.map(entry =>
                <option key={entry.id} value={entry.id}>{entry.label}{installed && !entry.installed ? "（未安裝）" : ""}</option>
              )}
            </Select>
          </label>
          <label>預設模型 ID
            <Input value={agent.modelId} onChange={event => updateAgent({ ...agent, modelId: event.target.value })} placeholder="留空使用 CLI 預設模型" />
          </label>
          <label>獨立帳號設定目錄（選填）
            <Input disabled={!agentCatalog.find(entry => entry.id === agent.provider)?.supportsAccountProfiles} value={agent.accountConfigDir ?? ""} onChange={event => updateAgent({ ...agent, accountConfigDir: event.target.value || undefined })} placeholder="例如：/Users/you/.codex-work" />
          </label>
          <p className="hint">帳號設定目錄僅供宣告支援獨立 Profile 的 Agent 使用；目錄必須已存在於家目錄內。不支援獨立 Profile 的 Agent 使用目前的 CLI 登入環境。</p>
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
            {readerAdapter.diagnose
              ? <div className="callout">
                  {readerAdapter.label} 的播放器控制由該平台 Adapter 提供；非公開介面可能更新失效。所有控制皆由你主動操作，不取得字幕。
                  <div className="actions"><Button variant="outline" className="secondary" onClick={() => void diagnoseVideo()}>檢查 {readerAdapter.label} 播放器</Button></div>
                  {playbackStatus && <p className="hint" role="status">{playbackStatus}</p>}
                </div>
              : readerAdapter.loop
                ? <p className="hint">目前來源：{readerAdapter.label}。循環會控制已開啟的影片分頁，不會重新載入。</p>
                : <p className="hint">目前來源沒有自動播放器控制；仍可閱讀字幕、查看時間及匯出文件。</p>}
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
              const link = cue.startMs !== null && document.source.url
                ? readerAdapter.timestampLink?.(document.source.url, cue.startMs) ?? null : null;
              const canSeek = cue.startMs !== null && !!readerAdapter.seek;
              const canLoop = cue.startMs !== null && cue.endMs !== null && !!readerAdapter.loop;
              return <div className="cue" key={id}>
                <span className="time">{formatTime(cue.startMs)}</span>
                <p>{cue.originalText}</p>
                <div className="actions">
                  {link && <Button variant="link" className="textButton" onClick={() => void chrome.tabs.create({ url: link })}>開啟時間連結</Button>}
                  {canSeek && <Button variant="link" className="textButton" onClick={() => void seekCue(cue)}>跳到影片指定時間</Button>}
                  {canLoop && <Button variant="link" className="textButton" onClick={() => void loopCue(cue)}>循環此句</Button>}
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
