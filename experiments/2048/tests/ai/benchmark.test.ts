import { describe, expect, it } from 'vitest';
import { runBenchmark, DEFAULT_GAMES } from '../../src/ai/benchmark.js';

describe('FR-AI-002 benchmark', () => {
  it('A210: benchmark 输出可序列化为合法 JSON', () => {
    const result = runBenchmark({ n: 4, seed: 1, depth: 1 });
    const parsed = JSON.parse(JSON.stringify(result)) as typeof result;
    expect(parsed).toBeDefined();
    expect(parsed.games).toBe(4);
  });

  it('A211: 指标包含 max_tile、score、moves、win_rate', () => {
    const result = runBenchmark({ n: 4, seed: 1, depth: 1 });
    expect(result).toHaveProperty('max_tile');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('moves');
    expect(result).toHaveProperty('win_rate');
    expect(typeof result.win_rate).toBe('number');
    expect(result.max_tile).toHaveProperty('max');
    expect(result.max_tile).toHaveProperty('avg');
    expect(result.score).toHaveProperty('max');
    expect(result.moves).toHaveProperty('total');
    expect(result.wins).toBeGreaterThanOrEqual(0);
    expect(result.wins).toBeLessThanOrEqual(result.games);
  });

  it('A211: 每局明细包含 max_tile、score、moves、won', () => {
    const result = runBenchmark({ n: 3, seed: 1, depth: 1 });
    expect(result.games_detail).toHaveLength(3);
    for (const game of result.games_detail) {
      expect(game).toHaveProperty('max_tile');
      expect(game).toHaveProperty('score');
      expect(game).toHaveProperty('moves');
      expect(game).toHaveProperty('won');
      expect(typeof game.won).toBe('boolean');
    }
  });

  it('A212: 相同种子运行两次结果一致', () => {
    const a = runBenchmark({ n: 3, seed: 42, depth: 1 });
    const b = runBenchmark({ n: 3, seed: 42, depth: 1 });
    expect(a).toEqual(b);
  });

  it('A213: 默认 N=100 且 N 可配置', () => {
    expect(DEFAULT_GAMES).toBe(100);
    expect(runBenchmark({ seed: 1, depth: 0 }).games).toBe(100);
    expect(runBenchmark({ n: 25, seed: 1, depth: 0 }).games).toBe(25);
  }, 120000);
});
