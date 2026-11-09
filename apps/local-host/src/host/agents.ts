import { randomUUID } from "node:crypto";
import { HOST_PROTOCOL_VERSION, type HostRequest, type HostMessage } from "@contextual/core";
import { getAgentCatalog } from "../agents";
import { loginPi, logoutPi, piModels, piProviders } from "../agents/pi";
import type { HostDispatcherDeps } from "./context";
import { estimateGenerationInput } from "../generation/input-estimate";

const logins = new Map<
  string,
  {
    controller: AbortController;
    promptId?: string;
    answer?: (value: string) => void;
    secret?: boolean;
  }
>();
export function interruptPiLogins(): void {
  for (const login of logins.values()) login.controller.abort();
}
export async function handleAgentRequest(
  request: HostRequest,
  { reply, hostVersion }: Pick<HostDispatcherDeps, "reply" | "hostVersion">,
  agentCatalog = getAgentCatalog,
): Promise<boolean> {
  switch (request.type) {
    case "estimateGeneration":
      reply({
        id: request.id,
        type: "generationEstimate",
        estimate: await estimateGenerationInput(request.payload),
      });
      return true;
    case "health": {
      const agents = request.includeAgents === false ? [] : await agentCatalog();
      reply({
        id: request.id,
        type: "health",
        agents,
        version: hostVersion,
        agentMode: "pi-sdk",
        protocolVersion: HOST_PROTOCOL_VERSION,
        installed: Object.fromEntries(agents.map(agent => [agent.id, agent.installed])),
      });
      return true;
    }
    case "piProviders":
      reply({ id: request.id, type: "piProviders", providers: await piProviders() });
      return true;
    case "piLogout":
      await logoutPi(request.provider);
      reply({ id: request.id, type: "piProviders", providers: await piProviders() });
      return true;
    case "agentModels":
      reply({ id: request.id, type: "agentModels", ...(await piModels(request.settings)) });
      return true;
    case "piAuthAnswer": {
      const login = logins.get(request.loginId);
      if (!login?.answer || login.promptId !== request.promptId)
        throw new Error("This login prompt has expired.");
      if (login.secret && request.value.trim().startsWith("!"))
        throw new Error("Enter a literal API key; credential commands are not supported.");
      const answer = login.answer;
      login.answer = undefined;
      answer(request.value);
      return true;
    }
    case "piAuthCancel":
      logins.get(request.loginId)?.controller.abort();
      return true;
    case "piLogin": {
      if (logins.size) throw new Error("Another login is already in progress.");
      const controller = new AbortController();
      const login: {
        controller: AbortController;
        promptId?: string;
        answer?: (value: string) => void;
        secret?: boolean;
      } = { controller };
      logins.set(request.id, login);
      const timeout = setTimeout(() => controller.abort(), 300_000);
      try {
        await loginPi(request.provider, request.method, {
          signal: controller.signal,
          notify(event) {
            const value =
              event.type === "auth_url"
                ? { message: event.instructions ?? "Open this link to sign in.", url: event.url }
                : event.type === "device_code"
                  ? { message: "Sign-in code: " + event.userCode, url: event.verificationUri }
                  : { message: event.message };
            reply({ id: request.id, type: "piAuthEvent", event: value });
          },
          prompt(prompt) {
            return new Promise<string>((resolve, reject) => {
              const promptId = randomUUID();
              const signal = prompt.signal
                ? AbortSignal.any([prompt.signal, controller.signal])
                : controller.signal;
              const cleanup = () => {
                signal.removeEventListener("abort", abort);
                login.answer = undefined;
                login.promptId = undefined;
              };
              const abort = () => {
                cleanup();
                reply({ id: request.id, type: "piAuthPromptClosed", promptId });
                reject(new Error("Login cancelled."));
              };
              login.promptId = promptId;
              login.secret = prompt.type === "secret";
              login.answer = value => {
                cleanup();
                resolve(value);
              };
              if (signal.aborted) {
                abort();
                return;
              }
              signal.addEventListener("abort", abort, { once: true });
              reply({
                id: request.id,
                type: "piAuthPrompt",
                prompt: {
                  promptId,
                  kind: prompt.type,
                  message: prompt.message,
                  ...(prompt.type === "select"
                    ? { options: prompt.options.map(({ id, label }) => ({ id, label })) }
                    : {}),
                },
              });
            });
          },
        });
        reply({ id: request.id, type: "piAuthDone" });
      } finally {
        clearTimeout(timeout);
        controller.abort();
        logins.delete(request.id);
      }
      return true;
    }
    default:
      return false;
  }
}
