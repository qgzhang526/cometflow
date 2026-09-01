import type { Output } from '../cli/output.js';
import { runBenchmark as runBenchmarkCore, type BenchmarkOptions } from './benchmark.js';

export function parseBenchmarkArgs(argv: string[]): BenchmarkOptions {
  const options: BenchmarkOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--n' || arg === '-n') options.n = Number(argv[++i]);
    else if (arg === '--seed') options.seed = Number(argv[++i]);
    else if (arg === '--depth') options.depth = Number(argv[++i]);
    else if (arg === '--timeout') options.timeoutMs = Number(argv[++i]);
  }
  return options;
}

export async function runBenchmark(argv: string[], out: Output): Promise<void> {
  const options = parseBenchmarkArgs(argv);
  const result = runBenchmarkCore(options);
  out.write(JSON.stringify(result, null, 2) + '\n');
}
