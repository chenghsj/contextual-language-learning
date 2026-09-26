import type { AgentSettings } from "@immersive/core";

export interface AgentExecution {
  readonly command: string;
  readonly prompt: string;
  readonly modelId: string;
  readonly env: NodeJS.ProcessEnv;
  readonly workDir: string;
  readonly signal: AbortSignal;
  run(args: string[], input?: string, timeoutMs?: number): Promise<string>;
}

export interface AgentAdapter {
  readonly id: string;
  readonly label: string;
  readonly executableName: string;
  readonly supportsAccountProfiles: boolean;
  readonly custom?: boolean;
  resolveExecutable?(): Promise<string | null>;
  configureEnvironment(settings: AgentSettings): Promise<NodeJS.ProcessEnv>;
  generate(execution: AgentExecution): Promise<unknown>;
}
