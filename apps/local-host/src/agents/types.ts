import type { AgentSettings } from "@immersive/core";

export interface AgentExecution {
  readonly command: string;
  readonly prompt: string;
  readonly modelId: string;
  readonly env: NodeJS.ProcessEnv;
  readonly workDir: string;
  readonly signal: AbortSignal;
  run(args: string[]): Promise<string>;
}

export interface AgentAdapter {
  readonly id: string;
  readonly label: string;
  readonly executableName: string;
  readonly supportsAccountProfiles: boolean;
  configureEnvironment(settings: AgentSettings): Promise<NodeJS.ProcessEnv>;
  generate(execution: AgentExecution): Promise<unknown>;
}
