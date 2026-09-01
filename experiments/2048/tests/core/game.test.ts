import { describe, expect, it } from 'vitest';
import { Game, createSeededRandom, gridsEqual, moveGrid, WIN_TILE } from '../../src/core/index.js';
import type { Grid } from '../../src/core/index.js';

function countTiles(grid: Grid): number {
  let count = 0;
  for (const row of grid) for (const value of row) if (value !== 0) count++;
  return count;
}

describe('FR-2048-001 棋盘初始化', () => {
  it('A001: 初始化后棋盘存在 2 个 tile 且位置随机', () => {
    const game = Game.seeded(1);
    expect(countTiles(game.grid)).toBe(2);
    const other = Game.seeded(2);
    expect(JSON.stringify(other.grid)).not.toBe(JSON.stringify(game.grid));
  });

  it('A002: 初始化后棋盘存在至少一个空位', () => {
    const game = Game.seeded(3);
    expect(game.grid.some((row) => row.includes(0))).toBe(true);
  });

  it('A003: 注入固定种子时初始化结果可复现', () => {
    expect(Game.seeded(42).grid).toEqual(Game.seeded(42).grid);
    const customRng = createSeededRandom(7);
    const a = new Game({ rng: createSeededRandom(7) });
    const b = new Game({ rng: customRng });
    expect(a.grid).toEqual(b.grid);
  });

  it('初始 tile 数值只可能是 2 或 4', () => {
    const game = Game.seeded(5);
    for (const row of game.grid) for (const value of row) {
      if (value !== 0) expect([2, 4]).toContain(value);
    }
  });
});

describe('FR-2048-002 移动与合并', () => {
  it('A010: 四个方向移动后 tile 正确塌缩与合并', () => {
    const grid: Grid = [
      [2, 0, 2, 4],
      [4, 4, 0, 0],
      [0, 0, 0, 0],
      [2, 2, 2, 2],
    ];
    const left = moveGrid(grid, 'left').grid;
    expect(left[0]).toEqual([4, 4, 0, 0]);
    expect(left[1]).toEqual([8, 0, 0, 0]);
    expect(left[3]).toEqual([4, 4, 0, 0]);

    const right = moveGrid(grid, 'right').grid;
    expect(right[0]).toEqual([0, 0, 4, 4]);
    expect(right[1]).toEqual([0, 0, 0, 8]);

    const up = moveGrid(grid, 'up').grid;
    expect(up[0]).toEqual([2, 4, 4, 4]);
    expect(up[1]).toEqual([4, 2, 0, 2]);
    expect(up[2]).toEqual([2, 0, 0, 0]);

    const down = moveGrid(grid, 'down').grid;
    expect(down[2]).toEqual([4, 4, 0, 4]);
    expect(down[3]).toEqual([2, 2, 4, 2]);
  });

  it('A011: 一次移动内每个 tile 至多参与一次合并', () => {
    const grid: Grid = [[4, 4, 4, 4], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    const { grid: moved } = moveGrid(grid, 'left');
    expect(moved[0]).toEqual([8, 8, 0, 0]);
    const game = new Game({ grid });
    const outcome = game.move('left');
    expect(outcome.moved).toBe(true);
    expect(outcome.scoreGained).toBe(16);
  });

  it('A012: 合并分值正确累加到总分', () => {
    const game = new Game({ grid: [[2, 2, 4, 4], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] });
    const outcome = game.move('left');
    expect(outcome.scoreGained).toBe(4 + 8);
    expect(game.score).toBe(12);
  });

  it('A013: 无效移动不新增 tile、不加分', () => {
    const grid: Grid = [
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
    ];
    const game = new Game({ grid });
    const before = game.grid;
    const outcome = game.move('up');
    expect(outcome.moved).toBe(false);
    expect(outcome.scoreGained).toBe(0);
    expect(game.grid).toEqual(before);
  });
});

describe('FR-2048-003 胜负判定', () => {
  it('A020: 出现 2048 tile 时游戏标记为获胜且可继续', () => {
    const grid: Grid = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [1024, 1024, 0, 0],
    ];
    const game = new Game({ grid });
    game.move('left');
    expect(game.won).toBe(true);
    expect(game.over).toBe(false);
    const outcome = game.move('right');
    expect(outcome.moved).toBe(true);
  });

  it('A021: 无空位且无相邻可合并 tile 时游戏结束', () => {
    const grid: Grid = [
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
    ];
    const game = new Game({ grid });
    expect(game.over).toBe(true);
    expect(game.legalMoves()).toEqual([]);
  });

  it('A022: 游戏结束后任意移动不再改变棋盘', () => {
    const grid: Grid = [
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
    ];
    const game = new Game({ grid });
    const before = game.grid;
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      const outcome = game.move(dir);
      expect(outcome.moved).toBe(false);
      expect(gridsEqual(game.grid, before)).toBe(true);
    }
  });

  it('Winning tile recognized on construction', () => {
    const game = new Game({ grid: [[WIN_TILE, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] });
    expect(game.won).toBe(true);
  });
});
