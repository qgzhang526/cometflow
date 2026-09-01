import { describe, expect, it } from 'vitest';
import { parseArgs, runCli } from '../../src/cli/main.js';

function collect() {
  const chunks: string[] = [];
  return {
    write(text: string): void {
      chunks.push(text);
    },
    get text(): string {
      return chunks.join('');
    },
  };
}

describe('parseArgs', () => {
  it('解析 --snapshot / --seed / --highscore-dir', () => {
    expect(parseArgs(['--snapshot'])).toEqual({ snapshot: true });
    expect(parseArgs(['--snapshot', '--seed', '42'])).toEqual({ snapshot: true, seed: 42 });
    expect(parseArgs(['--seed', '7'])).toEqual({ snapshot: false, seed: 7 });
  });
});

describe('runCli', () => {
  it('A102/A103: snapshot 模式输出可解析快照且无 ANSI 转义', async () => {
    const out = collect();
    await runCli(['--snapshot', '--seed', '1'], out);
    const text = out.text;
    expect(text).toContain('SCORE:');
    expect(text).toContain('BOARD:');
    expect(text).toContain('OVER:');
    expect(text).not.toContain('\u001b[');
  });

  it('A210: benchmark 模式输出合法 JSON', async () => {
    const out = collect();
    await runCli(['benchmark', '--n', '3', '--seed', '7', '--depth', '1'], out);
    const parsed = JSON.parse(out.text) as { games: number; seed: number };
    expect(parsed.games).toBe(3);
    expect(parsed.seed).toBe(7);
  });
});
