import { createInterface } from 'node:readline/promises';

export async function promptLine(question: string, fallback = ''): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = fallback === '' ? '' : ' [' + fallback + ']';
    const answer = (await rl.question(question + suffix + ' ')).trim();
    return answer === '' ? fallback : answer;
  } finally {
    rl.close();
  }
}

export async function promptBoolean(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question + ' [y/N] ')).trim().toLowerCase();
    return answer === 'y' || answer === 'yes' || answer === 'true' || answer === '1';
  } finally {
    rl.close();
  }
}

export async function promptChoice<T extends string>(question: string, choices: readonly T[]): Promise<T> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question + ' [' + choices.join('/') + '] ')).trim() as T;
    return choices.includes(answer) ? answer : choices[0];
  } finally {
    rl.close();
  }
}
