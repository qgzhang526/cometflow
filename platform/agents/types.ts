export interface AgentRunInput {
  prompt: string;
  cwd: string;
  model?: string;
  timeoutMs?: number;
}

export interface AgentRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface AgentCommand {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
}

export interface AgentRunner {
  id: string;
  name: string;
  buildCommand(input: AgentRunInput): AgentCommand;
  run(input: AgentRunInput): Promise<AgentRunResult>;
  check(): Promise<boolean>;
  subagentTool(): string;
  configTemplate(): string;
}
