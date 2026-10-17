import "./platform/migrate-startup";
import { type HostMessage } from "@contextual/core";
import { CustomJobManager } from "./jobs/custom-manager";
import { FileCustomRepository } from "./storage/custom";
import { JobManager } from "./jobs/manager";
import { encodeMessage, NativeFramer } from "./protocol";
import { localStoragePorts } from "./storage/file";
import { interruptPiLogins } from "./host/agents";
import { createHostDispatcher } from "./host/dispatcher";

declare const __CONTEXTUAL_HOST_VERSION__: string;
const hostVersion =
  typeof __CONTEXTUAL_HOST_VERSION__ === "string" ? __CONTEXTUAL_HOST_VERSION__ : "dev";
const storage = localStoragePorts();
function reply(message: HostMessage): void {
  process.stdout.write(encodeMessage(message));
}
const manager = new JobManager({ storage }, (requestId, job) => {
  reply({ id: requestId, type: "job", job });
  reply({
    id: requestId,
    type: "progress",
    jobId: job.id,
    completed: job.completed,
    total: job.total,
  });
});
const customManager = new CustomJobManager(
  { repository: new FileCustomRepository() },
  (id, job) => reply({ id, type: "job", job }),
  () => manager.isRunning(),
);
const handle = createHostDispatcher({ storage, manager, customManager, reply, hostVersion });

const framer = new NativeFramer(message => {
  void handle(message).catch(error => {
    process.stderr.write("Host request failed: " + String(error) + "\n");
  });
});
process.stdin.on("data", (chunk: Buffer) => {
  try {
    framer.push(chunk);
  } catch (error) {
    process.stderr.write("Invalid native frame: " + String(error) + "\n");
    process.exitCode = 1;
    process.stdin.pause();
  }
});
process.stdin.on("end", () => {
  handle.interrupt();
  manager.interruptAll();
  customManager.interruptAll();
  interruptPiLogins();
});
