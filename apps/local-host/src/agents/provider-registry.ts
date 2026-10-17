import { PI_PROVIDER_REGISTRY, type PiProviderAdapter } from "@contextual/core";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { registerAntigravity } from "./antigravity";

type ConfigureProvider = (runtime: ModelRuntime, root: string) => void;
const adapters: Record<PiProviderAdapter, ConfigureProvider> = {
  builtin: () => {}, // SDK built-ins are already registered by ModelRuntime.create().
  antigravity: registerAntigravity,
};
export function configurePiProviders(runtime: ModelRuntime, root: string): void {
  for (const definition of PI_PROVIDER_REGISTRY) {
    adapters[definition.adapter](runtime, root);
    if (!runtime.getProvider(definition.id)) {
      throw new Error(
        `Bundled SDK does not provide ${definition.id}. Check the provider registry and pinned SDK version.`,
      );
    }
  }
}
