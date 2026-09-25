import { HostRequestSchema, type HostMessage, type LearningDocument } from "@immersive/core";
import { getAgentCatalog } from "./agents";
import { JobManager } from "./jobs/manager";
import { encodeMessage, NativeFramer } from "./protocol";
import { localStoragePorts } from "./storage/file";

const storage = localStoragePorts();
const manager = new JobManager({ storage }, (requestId, job) => {
  reply({ id: requestId, type: "job", job });
  reply({ id: requestId, type: "progress", jobId: job.id, completed: job.completed, total: job.total });
});

function reply(message: HostMessage): void {
  process.stdout.write(encodeMessage(message));
}

function deliverDocument(requestId: string, document: LearningDocument): void {
  const bytes = Buffer.from(JSON.stringify(document), "utf8");
  if (bytes.length < 500_000) {
    reply({ id: requestId, type: "result", document });
    return;
  }
  // Native Messaging has a 1 MB Host -> Chrome limit. Stream large JSON as bounded binary chunks.
  const chunkSize = 256 * 1024;
  const total = Math.ceil(bytes.length / chunkSize);
  for (let index = 0; index < total; index++) {
    const chunk = bytes.subarray(index * chunkSize, (index + 1) * chunkSize);
    reply({ id: requestId, type: "documentChunk", documentId: document.id, index, total,
      dataBase64: chunk.toString("base64") });
  }
}

async function handle(input: unknown): Promise<void> {
  const parsed = HostRequestSchema.safeParse(input);
  if (!parsed.success) {
    const maybeId = input && typeof input === "object" && "id" in input && typeof input.id === "string"
      ? input.id : "invalid-request";
    reply({ id: maybeId, type: "error", message: "Invalid request: " + parsed.error.issues[0]?.message });
    return;
  }
  const request = parsed.data;
  try {
    switch (request.type) {
      case "health": {
        const agents = await getAgentCatalog();
        reply({ id: request.id, type: "health", agents,
          installed: Object.fromEntries(agents.map(agent => [agent.id, agent.installed])) });
        break;
      }
      case "listJobs":
        reply({ id: request.id, type: "jobs", jobs: await manager.list() });
        break;
      case "getDocument": {
        const document = await storage.documents.get(request.documentId);
        if (!document) throw new Error("Saved document not found");
        deliverDocument(request.id, document);
        break;
      }
      case "cancel": {
        const cancelled = await manager.cancel(request.jobId);
        if (!cancelled) throw new Error("Job is not cancellable or does not exist");
        reply({ id: request.id, type: "cancelled" });
        break;
      }
      case "generate":
        deliverDocument(request.id, await manager.start(request.id, request.payload));
        break;
      case "resume":
        deliverDocument(request.id, await manager.resume(request.id, request.jobId));
        break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Host error";
    reply({ id: request.id, type: "error", message: message.slice(0, 1200) });
  }
}

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
process.stdin.on("end", () => manager.interruptAll());
