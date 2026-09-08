import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';

export interface PromptIO {
  input: Readable;
  output: Writable;
}

function resolveIO(io?: PromptIO): PromptIO {
  return io ?? { input: process.stdin, output: process.stdout };
}

export async function promptLine(question: string, fallback = '', io?: PromptIO): Promise<string> {
  const streams = resolveIO(io);
  const rl = createInterface({ input: streams.input, output: streams.output });
  try {
    const suffix = fallback === '' ? '' : ' [' + fallback + ']';
    const answer = (await rl.question(question + suffix + ' ')).trim();
    return answer === '' ? fallback : answer;
  } finally {
    rl.close();
  }
}

export async function promptBoolean(question: string, io?: PromptIO): Promise<boolean> {
  const streams = resolveIO(io);
  const rl = createInterface({ input: streams.input, output: streams.output });
  try {
    const answer = (await rl.question(question + ' [y/N] ')).trim().toLowerCase();
    return answer === 'y' || answer === 'yes' || answer === 'true' || answer === '1';
  } finally {
    rl.close();
  }
}

export async function promptChoice<T extends string>(question: string, choices: readonly T[], io?: PromptIO): Promise<T> {
  const streams = resolveIO(io);
  const rl = createInterface({ input: streams.input, output: streams.output });
  try {
    const answer = (await rl.question(question + ' [' + choices.join('/') + '] ')).trim() as T;
    return choices.includes(answer) ? answer : choices[0];
  } finally {
    rl.close();
  }
}
