import { useEffect, useState } from "react";
import { isPiProviderId, type DiscoveredModel } from "@contextual/core";
import { nativeOnce } from "../native/host-client";

type Directory = {
  provider: string;
  models: DiscoveredModel[];
  source: "account" | "directory" | "sdk";
  state: "loading" | "ready" | "error";
};
export function useModelDirectory(
  provider: string,
  available: boolean,
  refresh: number,
  method?: "api_key" | "oauth",
) {
  const route = `${provider}:${method ?? ""}`;
  const [directory, setDirectory] = useState<Directory>({
    provider: "",
    models: [],
    source: "sdk",
    state: "ready",
  });
  useEffect(() => {
    let live = true;
    if (!available || provider === "local" || !isPiProviderId(provider)) {
      setDirectory({ provider: "", models: [], source: "sdk", state: "ready" });
      return;
    }
    setDirectory(previous => ({
      provider: route,
      models: previous.provider === route ? previous.models : [],
      source: previous.provider === route ? previous.source : "sdk",
      state: "loading",
    }));
    void nativeOnce({
      id: crypto.randomUUID(),
      type: "discoverModels",
      provider,
      force: refresh > 0,
    })
      .then(reply => {
        if (live)
          setDirectory({
            provider: route,
            models: reply.models,
            source: reply.source,
            state: "ready",
          });
      })
      .catch(() => {
        if (live) setDirectory(previous => ({ ...previous, state: "error" }));
      });
    return () => {
      live = false;
    };
  }, [provider, available, refresh, route]);
  if (!available || provider === "local" || directory.provider !== route)
    return { models: [], source: "sdk" as const, state: "ready" as const };
  return directory;
}
