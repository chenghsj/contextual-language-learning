import React, {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import { translate, type UiLocale } from "../i18n/messages";
import { Button } from "./ui/button";

const copy = {
  en: { error: "Unable to open this view. Reload to try again.", reload: "Reload" },
  "zh-TW": { error: "無法開啟這個畫面，請重新載入後再試。", reload: "重新載入" },
  "zh-CN": { error: "无法打开这个页面，请重新加载后再试。", reload: "重新加载" },
  ja: { error: "この画面を開けませんでした。再読み込みしてお試しください。", reload: "再読み込み" },
  ko: { error: "화면을 열 수 없습니다. 새로고침 후 다시 시도하세요.", reload: "새로고침" },
};

type Props = {
  locale: UiLocale;
  children: ReactNode;
  onBack?: () => void;
  backLabel?: string;
};
const LoadingContext = createContext<Omit<Props, "children"> | null>(null);

/** Cache a view's module across visits; resolve immediately rather than delaying the first reveal. */
export function deferView<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  type P = React.ComponentProps<T>;
  type Snapshot =
    { status: "pending" } | { status: "ready"; View: T } | { status: "failed"; error: unknown };
  let snapshot: Snapshot = { status: "pending" };
  let started = false;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const read = () => snapshot;
  return function Deferred(props: P) {
    const fallback = useContext(LoadingContext);
    const state = useSyncExternalStore(subscribe, read, read);
    useEffect(() => {
      if (started) return;
      started = true;
      void Promise.resolve()
        .then(load)
        .then(
          module => {
            snapshot = { status: "ready", View: module.default };
          },
          error => {
            snapshot = { status: "failed", error };
          },
        )
        .then(() => {
          for (const listener of listeners) listener();
        });
    }, []);
    if (state.status === "failed") throw state.error;
    if (state.status === "ready") return React.createElement(state.View, props);
    return fallback ? <LoadMessage {...fallback} /> : null;
  };
}

function LoadMessage({
  locale,
  onBack,
  backLabel,
  failed = false,
}: Omit<Props, "children"> & { failed?: boolean }) {
  const ui = copy[locale];
  return (
    <div role={failed ? "alert" : "status"} className="grid min-w-0 gap-3 py-4 text-ui-body">
      <p className={failed ? "text-foreground" : "text-muted-foreground"}>
        {failed ? ui.error : translate(locale, "loading")}
      </p>
      <div className="flex flex-wrap gap-2">
        {onBack && (
          <Button variant="outline" onClick={onBack}>
            {backLabel ?? translate(locale, "lessonLibrary")}
          </Button>
        )}
        {failed && (
          <Button variant="outline" onClick={() => window.location.reload()}>
            {ui.reload}
          </Button>
        )}
      </div>
    </div>
  );
}

class ViewError extends React.Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <LoadMessage {...this.props} failed />;
  }
}

/** Keep navigation, draft state and the generation session outside loading or failed views. */
export function DeferredView({ children, ...props }: Props) {
  return (
    <LoadingContext.Provider value={props}>
      <ViewError {...props}>{children}</ViewError>
    </LoadingContext.Provider>
  );
}
