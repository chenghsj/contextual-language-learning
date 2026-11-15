import type { VideoAdapter, LoopSettings } from "../../extension/src/video/types";
import { youtubeVideo } from "./youtube";
type Player = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(rate: number): void;
  destroy(): void;
};
type YouTubeAPI = {
  Player: new (
    frame: HTMLIFrameElement,
    options: { events: { onReady(): void; onError(event: { data: number }): void } },
  ) => Player;
};
declare global {
  interface Window {
    YT?: YouTubeAPI;
    onYouTubeIframeAPIReady?: () => void;
  }
}
let api: Promise<YouTubeAPI> | undefined;
function loadApi(): Promise<YouTubeAPI> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return (api ??= new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube 播放器未就緒。"));
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => {
      api = undefined;
      script.remove();
      reject(new Error("無法載入 YouTube 播放器，請檢查網路。"));
    };
    document.head.append(script);
  }));
}
export class YouTubeController {
  private player?: Player;
  private playable = false;
  private ready: Promise<Player>;
  private resolve!: (player: Player) => void;
  private reject!: (error: Error) => void;
  private generation = 0;
  private timer?: ReturnType<typeof setInterval>;
  private delay?: ReturnType<typeof setTimeout>;
  readonly adapter: VideoAdapter;
  constructor(
    url: string | undefined,
    private onError: (message: string) => void,
  ) {
    this.ready = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    void this.ready.catch(() => {});
    this.adapter = youtubeVideo(url)
      ? {
          id: "web-youtube",
          label: "YouTube",
          getVideoId: input => youtubeVideo(input)?.id ?? null,
          timestampLink: (input, ms) => {
            const video = youtubeVideo(input, ms);
            return video ? `https://www.youtube.com/watch?v=${video.id}&t=${video.start}s` : null;
          },
          status: async () => {
            const p = await this.get();
            return {
              currentMs: p.getCurrentTime() * 1000,
              durationMs: p.getDuration() * 1000,
              playing: p.getPlayerState() === 1,
            };
          },
          diagnose: async () => {
            const p = await this.get();
            return { currentMs: p.getCurrentTime() * 1000, message: "YouTube 播放器已連結" };
          },
          seek: async (_url, ms) => {
            (await this.get()).seekTo(ms / 1000, true);
          },
          play: async () => {
            (await this.get()).playVideo();
          },
          pause: async () => {
            (await this.get()).pauseVideo();
          },
          setPlaybackRate: async (_url, rate) => {
            (await this.get()).setPlaybackRate(rate);
          },
          loop: async (_url, options) => this.loop(options),
          stopLoop: async () => {
            this.clearLoop();
            if (this.playable) this.player?.pauseVideo();
          },
        }
      : { id: "import", label: "無影片", getVideoId: () => null };
  }
  attach(frame: HTMLIFrameElement): () => void {
    const generation = ++this.generation;
    void loadApi()
      .then(YT => {
        if (generation !== this.generation) return;
        const p = new YT.Player(frame, {
          events: {
            onReady: () => {
              if (generation === this.generation) {
                this.player = p;
                this.playable = true;
                this.resolve(p);
              }
            },
            onError: ({ data }) => {
              if (generation !== this.generation) return;
              this.playable = false;
              const message =
                data === 101 || data === 150
                  ? "影片禁止在網站嵌入，請使用「在 YouTube 開啟」。"
                  : data === 100
                    ? "YouTube 影片已移除或設為私人。"
                    : "YouTube 播放器無法使用，請重新載入或在 YouTube 開啟。";
              this.reject(new Error(message));
              this.onError(message);
            },
          },
        });
        this.player = p;
      })
      .catch(error => {
        if (generation === this.generation) {
          this.reject(error);
          this.onError(error.message);
        }
      });
    return () => {
      this.generation++;
      this.clearLoop();
      this.player?.destroy();
      this.player = undefined;
      this.playable = false;
      this.ready = new Promise((resolve, reject) => {
        this.resolve = resolve;
        this.reject = reject;
      });
      void this.ready.catch(() => {});
    };
  }
  private async get(): Promise<Player> {
    if (navigator.onLine === false) throw new Error("影片播放需要網路連線。");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.ready,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("YouTube 播放器尚未就緒，請稍後重試。")),
            10000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  private clearLoop() {
    clearInterval(this.timer);
    clearTimeout(this.delay);
    this.timer = undefined;
    this.delay = undefined;
  }
  private async loop(options: LoopSettings) {
    const p = await this.get();
    this.clearLoop();
    let remaining = options.repeats;
    const start = () => {
      p.seekTo(options.startMs / 1000, true);
      p.playVideo();
    };
    p.seekTo((options.resumeMs ?? options.startMs) / 1000, true);
    p.playVideo();
    this.timer = setInterval(() => {
      if (this.delay || p.getCurrentTime() * 1000 < options.endMs) return;
      p.pauseVideo();
      if (remaining !== "infinite" && --remaining <= 0) {
        this.clearLoop();
        return;
      }
      this.delay = setTimeout(() => {
        this.delay = undefined;
        start();
      }, options.delaySeconds * 1000);
    }, 80);
  }
}
