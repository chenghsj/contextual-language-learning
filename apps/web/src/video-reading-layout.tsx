import React, { useEffect, useState, useRef, useId } from "react";
import { ExternalLink, PanelTopClose, PanelTopOpen } from "lucide-react";
import type { YouTubeController } from "./youtube-controller";
import { youtubeVideo } from "./youtube";
import { Button } from "./components/ui/button";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
  type PanelImperativeHandle,
} from "./components/ui/resizable";

const WIDTH_KEY = "cll-reader-pane-width";
function savedWidth() {
  try {
    const width = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(width) && width >= 320 && width <= 600 ? width : 400;
  } catch {
    return 400;
  }
}
export function VideoReadingLayout({
  url,
  title,
  startMs,
  children,
  controller,
}: {
  url?: string;
  title: string;
  startMs?: number | null;
  children: React.ReactNode;
  controller?: YouTubeController;
}) {
  const video = youtubeVideo(url, startMs);
  const frame = useRef<HTMLIFrameElement>(null);
  const materialPanel = useRef<PanelImperativeHandle>(null);
  const frameId = useId();
  const [collapsed, setCollapsed] = useState(
    () =>
      window.matchMedia("(max-width: 1023px) and (max-height: 560px)").matches ||
      history.state?.cllVideoCollapsed === true,
  );
  const [initialWidth] = useState(savedWidth);
  const width = useRef(initialWidth);
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const stacked = viewport.width < 1024 || collapsed;
  const shortLandscape = viewport.width < 1024 && viewport.height <= 560;
  const videoHeight = collapsed
    ? 36
    : shortLandscape
      ? "100%"
      : Math.max(200, Math.min(((viewport.width - 24) * 9) / 16, viewport.height * 0.32)) + 46;
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const changed = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", changed);
    return () => window.removeEventListener("resize", changed);
  }, []);
  useEffect(() => {
    if (!stacked) materialPanel.current?.resize(width.current);
  }, [stacked]);
  useEffect(() => {
    const compact = window.matchMedia("(max-width: 1023px) and (max-height: 560px)");
    const changed = () => {
      if (compact.matches) setCollapsed(true);
    };
    compact.addEventListener("change", changed);
    return () => compact.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener("online", changed);
    window.addEventListener("offline", changed);
    return () => {
      window.removeEventListener("online", changed);
      window.removeEventListener("offline", changed);
    };
  }, []);
  useEffect(() => {
    if (frame.current && controller && online) return controller.attach(frame.current);
  }, [controller, online]);
  function toggleVideo() {
    const next = !collapsed;
    history.replaceState({ ...history.state, cllVideoCollapsed: next }, "");
    setCollapsed(next);
  }
  function rememberWidth(next: number) {
    width.current = Math.round(next);
    try {
      localStorage.setItem(WIDTH_KEY, String(width.current));
    } catch {
      /* Keep the current page usable. */
    }
  }
  const material = (
    <div className="video-reading-content" data-reading-scroll="material">
      {children}
    </div>
  );
  return (
    <div className="video-reading-layout" data-video-collapsed={collapsed} data-has-video={!!video}>
      {video && (
        <ResizablePanelGroup
          orientation={stacked ? "vertical" : "horizontal"}
          disabled={stacked}
          onLayoutChanged={(_, { isUserInteraction }) => {
            if (stacked || !isUserInteraction || !materialPanel.current) return;
            rememberWidth(materialPanel.current.getSize().inPixels);
          }}
        >
          <ResizablePanel
            id="reader-video"
            style={{ overflow: "hidden" }}
            defaultSize={stacked ? videoHeight : undefined}
            minSize={stacked ? videoHeight : 360}
            maxSize={stacked ? videoHeight : undefined}
          >
            <aside className="video-sidebar" aria-label="教材影片">
              <div id={frameId} className="video-sidebar-body" hidden={collapsed}>
                {online ? (
                  <div className="video-stage">
                    <div className="video-frame">
                      <iframe
                        ref={frame}
                        key={`${video.id}:${video.start}`}
                        src={`https://www.youtube-nocookie.com/embed/${video.id}?playsinline=1&rel=0&start=${video.start}${controller ? "&enablejsapi=1&origin=" + encodeURIComponent(location.origin) : ""}`}
                        title={`YouTube 影片：${title}`}
                        referrerPolicy="strict-origin-when-cross-origin"
                        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  </div>
                ) : (
                  <div className="video-offline" role="status">
                    影片需要網路連線；已下載教材仍可閱讀。
                  </div>
                )}
              </div>
              <div className="video-sidebar-toolbar">
                {!collapsed && (
                  <a
                    href={`https://www.youtube.com/watch?v=${video.id}&t=${video.start}s`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    在 YouTube 開啟 <ExternalLink size={14} />
                  </a>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleVideo}
                  aria-expanded={!collapsed}
                  aria-controls={frameId}
                >
                  {collapsed ? <PanelTopOpen size={15} /> : <PanelTopClose size={15} />}
                  {collapsed ? "顯示影片" : "收合影片"}
                </Button>
              </div>
            </aside>
          </ResizablePanel>
          <ResizableHandle
            withHandle
            hidden={stacked}
            aria-label="調整教材欄寬度"
            onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
            onDoubleClick={() => rememberWidth(initialWidth)}
          />
          <ResizablePanel
            id="reader-material"
            style={{ overflow: "hidden" }}
            panelRef={materialPanel}
            defaultSize={stacked ? undefined : initialWidth}
            minSize={stacked ? 0 : 320}
            maxSize={stacked ? undefined : 600}
            groupResizeBehavior="preserve-pixel-size"
          >
            {material}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
      {!video && material}
    </div>
  );
}
