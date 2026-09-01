export interface EvalTask {
  name: string;
  command: string;
  args: string[];
}

export interface EvalManifest {
  schema: 'cometflow.eval.v1';
  tasks: EvalTask[];
}

export interface EvalTaskResult {
  name: string;
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface EvalReport {
  schema: 'cometflow.eval-report.v1';
  passed: boolean;
  results: EvalTaskResult[];
}
