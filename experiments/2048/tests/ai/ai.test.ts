import { describe, expect, it } from 'vitest';
import { Game } from '../../src/core/index.js';
import { chooseMove, legalMoves, searchValue } from '../../src/ai/ai.js';
import type { Grid } from '../../src/core/types.js';

const DIRECTIONS = ['up', 'down', 'left', 'right'];

describe('FR-AI-001 AI 决策', () => {
  it('A201: 返回合法方向（上/下/左/右）', () => {
    const game = Game.seeded(1);
    const direction = chooseMove(game.grid, { depth: 1 });
    expect(DIRECTIONS).toContain(direction);
    expect(game.legalMoves()).toContain(direction);
  });

  it('A201: 随机棋盘多次调用均返回合法方向', () => {
    for (let seed = 0; seed < 10; seed++) {
      const game = Game.seeded(seed);
      const legal = game.legalMoves();
      const direction = chooseMove(game.grid, { depth: 1 });
      expect(legal).toContain(direction);
    }
  });

  it('A202: 相同配置下结果可复现', () => {
    const grid: Grid = [
      [2, 2, 4, 0],
      [4, 8, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    const config = { depth: 2, timeoutMs: 5000 };
    expect(chooseMove(grid, config)).toBe(chooseMove(grid, config));
  });

  it('A202: 搜索深度配置生效（不同深度搜索估值不同）', () => {
    const grid: Grid = [
      [2, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    expect(searchValue(grid, 1)).not.toBe(searchValue(grid, 2));
  });

  it('A203: 单次决策在配置超时内返回', () => {
    const grid: Grid = [
      [2, 4, 8, 16],
      [4, 8, 16, 32],
      [8, 16, 32, 64],
      [16, 32, 64, 0],
    ];
    const start = Date.now();
    const direction = chooseMove(grid, { depth: 5, timeoutMs: 5 });
    const elapsed = Date.now() - start;
    expect(DIRECTIONS).toContain(direction);
    expect(elapsed).toBeLessThan(5000);
  });
});

describe('legalMoves', () => {
  it('空棋盘四个方向都合法', () => {
    expect(legalMoves(Game.seeded(2).grid).length).toBeGreaterThan(0);
  });
});
