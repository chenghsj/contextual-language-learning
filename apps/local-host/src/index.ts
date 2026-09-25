import { HostRequestSchema, type HostMessage } from "@immersive/core";
import { generateDocument } from "./generation";
import { installedAgents } from "./agents";
import { encodeMessage, NativeFramer } from "./protocol";

const active = new Map<string, AbortController>();

function reply(message: HostMessage): void {
  process.stdout.write(encodeMessage(message));
}

async function handle(input: unknown): Promise<void> {
  const parsed = HostRequestSchema.safeParse(input);
  if (!parsed.success) {
    const possibleId = input && typeof input === "object" && "id" in input && typeof input.id === "string"
      ? input.id : "invalid-request";
    reply({ id: possibleId, type: "error", message: "Invalid request: " + parsed.error.issues[0]?.message });
    return;
  }
  const request = parsed.data;
  if (request.type === "health") {
    reply({ id: request.id, type: "health", installed: await installedAgents() });
    return;
  }
  if (request.type === "cancel") {
    active.get(request.jobId)?.abort();
    reply({ id: request.id, type: "cancelled" });
    return;
  }
  const controller = new AbortController();
  active.set(request.id, controller);
  try {
    const document = await generateDocument(request.payload, controller.signal, (completed, total) => {
      reply({ id: request.id, type: "progress", completed, total });
    });
    reply({ id: request.id, type: "result", document });
  } catch (error) {
    const message = controller.signal.aborted ? "Generation cancelled" :
      error instanceof Error ? error.message : "Unknown generation error";
    reply({ id: request.id, type: "error", message: message.slice(0, 1200) });
  } finally {
    active.delete(request.id);
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
process.stdin.on("end", () => {
  for (const controller of active.values()) controller.abort();
});
