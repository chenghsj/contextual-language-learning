import { type HostMessage } from "@immersive/core";
import { JobManager } from "./jobs/manager";
import { encodeMessage, NativeFramer } from "./protocol";
import { localStoragePorts } from "./storage/file";
import { interruptPiLogins } from "./host/agents";
import { createHostDispatcher } from "./host/dispatcher";

declare const __IMMERSIVE_HOST_VERSION__: string;
const hostVersion =
  typeof __IMMERSIVE_HOST_VERSION__ === "string" ? __IMMERSIVE_HOST_VERSION__ : "dev";
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
const handle = createHostDispatcher({ storage, manager, reply, hostVersion });

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
  manager.interruptAll();
  interruptPiLogins();
});
