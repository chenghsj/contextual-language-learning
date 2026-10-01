import { createGenerationHandler } from "./generation";
import { handleLessonRequest } from "./lessons";
import { handleDriveRequest } from "./drive";
import { createPublicationFlow } from "./publication";
import { handleAgentRequest } from "./agents";
import { HostRequestSchema } from "@immersive/core";
import type { HostDispatcherDeps } from "./context";

/** Dispatch validated requests with caller-owned storage, job lifecycle and transport. */
export function createHostDispatcher({ storage, manager, reply, hostVersion }: HostDispatcherDeps) {
  const {
    deliverDocument,
    finishDocument,
    handle: handlePublication,
  } = createPublicationFlow(storage, reply);
  const handleGeneration = createGenerationHandler({ storage, manager, reply }, finishDocument);

  async function handle(input: unknown): Promise<void> {
    const parsed = HostRequestSchema.safeParse(input);
    if (!parsed.success) {
      const maybeId =
        input && typeof input === "object" && "id" in input && typeof input.id === "string"
          ? input.id
          : "invalid-request";
      reply({
        id: maybeId,
        type: "error",
        message: "Invalid request: " + parsed.error.issues[0]?.message,
      });
      return;
    }
    const request = parsed.data;
    try {
      if (await handleAgentRequest(request, { storage, manager, reply, hostVersion })) return;
      if (await handleDriveRequest(request, { storage, reply })) return;
      if (await handleLessonRequest(request, { storage, manager, reply }, deliverDocument)) return;
      if (await handleGeneration(request)) return;
      if (await handlePublication(request)) return;
      reply({ id: request.id, type: "error", message: "Unsupported Native Host request." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Host error";
      reply({ id: request.id, type: "error", message: message.slice(0, 1200) });
    }
  }

  return handle;
}
