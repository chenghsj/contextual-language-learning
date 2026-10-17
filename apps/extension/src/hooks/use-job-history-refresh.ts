import { useCallback, useRef, useState } from "react";
import type { GenerationState } from "../native/generation-session";

type ConnectionStatus = NonNullable<GenerationState["connection"]>["status"];

/** Keep background listeners current and coalesce concurrent history requests. */
export function useJobHistoryRefresh(load: () => Promise<void>, onError: (error: unknown) => void) {
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const lastStatus = useRef<ConnectionStatus | undefined>(undefined);
  const latest = useRef({ load, onError });
  latest.current = { load, onError };

  const refresh = useCallback(async (): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      await latest.current.load();
    } catch (error) {
      latest.current.onError(error);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  const onConnectionStatus = useCallback(
    (status: ConnectionStatus | undefined): void => {
      const previous = lastStatus.current;
      // Update before requesting: a synchronous reply can broadcast another state.
      lastStatus.current = status;
      if (status === "ready" && previous !== "ready") void refresh();
    },
    [refresh],
  );

  return { loading, refresh, onConnectionStatus };
}
