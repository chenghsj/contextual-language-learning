import type { HostMessage } from "@immersive/core";
import type { JobManager } from "../jobs/manager";
import type { StoragePorts } from "../storage/ports";

/** Process-owned dependencies passed to each request handler. */
export interface HostDispatcherDeps {
  storage: StoragePorts;
  manager: JobManager;
  reply: (message: HostMessage) => void;
  hostVersion: string;
}
