import React, { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "./components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@contextual/ui/popover";
type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
function standalone() {
  return (
    matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && navigator.standalone === true)
  );
}
export function PwaInstall() {
  const [installed, setInstalled] = useState(standalone);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const available = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const installed = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", available);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", available);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  if (installed) return null;
  const button = (
    <Button
      variant="ghost"
      size="sm"
      aria-label="安裝 App"
      title="安裝 App"
      disabled={busy}
      onClick={
        prompt
          ? async () => {
              setBusy(true);
              try {
                await prompt.prompt();
                await prompt.userChoice;
                setPrompt(null);
              } catch {
                setOpen(true);
                setPrompt(null);
              } finally {
                setBusy(false);
              }
            }
          : undefined
      }
    >
      <Download />
      <span className="install-label">安裝 App</span>
    </Button>
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {prompt ? button : <PopoverTrigger asChild>{button}</PopoverTrigger>}
      <PopoverContent align="end" collisionPadding={12} className="install-help">
        <strong>加入主畫面</strong>
        <p>Chrome／Edge：開啟瀏覽器選單，選擇「安裝應用程式」。</p>
        <p>iPhone／iPad：用 Safari 開啟，點「分享」→「加入主畫面」。</p>
        <p className="muted">安裝後可離線閱讀已下載教材，影片播放需要網路。</p>
      </PopoverContent>
    </Popover>
  );
}
