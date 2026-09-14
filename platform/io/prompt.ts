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

export interface PromptChoiceOptions<T extends string> {
  /** Extra accepted spellings, e.g. `{ '无': 'none' }`. Matched case-insensitively. */
  aliases?: Record<string, T>;
}

export async function promptChoice<T extends string>(
  question: string,
  choices: readonly T[],
  io?: PromptIO,
  options: PromptChoiceOptions<T> = {},
): Promise<T> {
  const streams = resolveIO(io);
  const aliases = options.aliases ?? {};
  const fallback = choices[0];
  const rl = createInterface({ input: streams.input, output: streams.output });

  try {
    for (;;) {
      let answer: string;
      try {
        answer = (await rl.question(question + ' [' + choices.join('/') + ']（回车=' + fallback + '） ')).trim();
      } catch (error) {
        // Piped stdin can close the interface between questions; keep the old fallback.
        if ((error as NodeJS.ErrnoException).code === 'ERR_USE_AFTER_CLOSE') return fallback;
        throw error;
      }

      if (answer === '') return fallback;

      const normalized = answer.toLowerCase();
      const matched = choices.find((choice) => choice.toLowerCase() === normalized) ?? aliases[answer] ?? aliases[normalized];
      if (matched !== undefined) return matched;

      // Only re-ask on a real terminal: with piped input the remaining lines are
      // already consumed, so re-asking would hang instead of helping.
      if ((streams.input as Readable & { isTTY?: boolean }).isTTY !== true) return fallback;
      streams.output.write('无效输入，请从 ' + choices.join(' / ') + ' 中选择（可直接回车取 ' + fallback + '）\n');
    }
  } finally {
    rl.close();
  }
}
