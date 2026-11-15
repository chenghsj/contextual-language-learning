import type { HostMessage } from "@contextual/core";
import type { JobManager } from "../jobs/manager";
import type { StoragePorts } from "../storage/ports";

/** Process-owned dependencies passed to each request handler. */
export interface HostDispatcherDeps {
  favorites?: import("@contextual/core").FavoritesService;
  customManager?: import("../jobs/custom-manager").CustomJobManager;
  storage: StoragePorts;
  manager: JobManager;
  reply: (message: HostMessage) => void;
  hostVersion: string;
}
