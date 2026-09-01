import { describe, expect, it, vi } from 'vitest';
import { createSeededRandom, Game } from '../../src/core/index.js';
import type { Grid } from '../../src/core/index.js';
import { play, type PlayEvent } from '../../src/cli/session.js';

function countTiles(grid: Grid): number {
  let count = 0;
  for (const row of grid) for (const value of row) if (value !== 0) count++;
  return count;
}

function lastSnapshot(events: PlayEvent[]) {
  const snapshots = events.filter((event): event is Extract<PlayEvent, { type: 'snapshot' }> => event.type === 'snapshot');
  return snapshots[snapshots.length - 1].game;
}

describe('FR-CLI-002 输入与控制', () => {
  it('A110: WASD 按键驱动移动', async () => {
    const result = await play(['w', 'a', 's', 'd'], { createGame: () => Game.seeded(7) });
    expect(result.moves).toBeGreaterThan(0);
    const snapshots = result.events.filter((event) => event.type === 'snapshot');
    expect(snapshots.length).toBeGreaterThan(1);
  });

  it('A110: 快照反映各自时点的棋盘状态（引用冻结）', async () => {
    const result = await play(['w', 'a', 's', 'd'], { createGame: () => Game.seeded(7) });
    const snapshots = result.events.filter((event): event is Extract<PlayEvent, { type: 'snapshot' }> => event.type === 'snapshot');
    const boards = snapshots.map((snapshot) => JSON.stringify(snapshot.game.grid));
    const unique = new Set(boards);
    expect(unique.size).toBeGreaterThan(1);
    const first = snapshots[0].game;
    expect(first.score).toBe(0);
  });

  it('A110: 方向键驱动移动', async () => {
    const result = await play(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'], {
      createGame: () => Game.seeded(7),
    });
    expect(result.moves).toBeGreaterThan(0);
  });

  it('A111: q 退出对局，后续输入不再处理', async () => {
    const result = await play(['a', 'q', 'a', 's'], { createGame: () => Game.seeded(3) });
    expect(result.quit).toBe(true);
    const snapshots = result.events.filter((event) => event.type === 'snapshot');
    expect(snapshots.length).toBeLessThan(3);
  });

  it('A111: r 立即重开并重新初始化棋盘', async () => {
    const result = await play(['a', 'r'], { createGame: () => Game.seeded(5) });
    expect(result.restarts).toBe(1);
    expect(result.events.some((event) => event.type === 'message' && event.text.includes('board restarted'))).toBe(true);
    expect(countTiles(lastSnapshot(result.events).grid)).toBe(2);
  });

  it('A112: 非法输入被忽略且不崩溃', async () => {
    const result = await play(['!', '@', '#', 'zzz', '\u0000'], { createGame: () => Game.seeded(1) });
    expect(result.moves).toBe(0);
    expect(result.quit).toBe(false);
    expect(result.events.some((event) => event.type === 'message' && event.text.includes('ignored invalid input'))).toBe(true);
  });

  it('A113: 无效移动给出提示且棋盘不变', async () => {
    const grid: Grid = [
      [2, 4, 2, 4],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    const game = new Game({ grid, rng: createSeededRandom(1) });
    const before = game.grid;
    const result = await play(['w'], { createGame: () => game });
    expect(result.moves).toBe(0);
    expect(result.events.some((event) => event.type === 'message' && event.text.includes('invalid move, board unchanged'))).toBe(true);
    expect(game.grid).toEqual(before);
  });
});

describe('FR-CLI-003 对局流程', () => {
  it('A120: 游戏结束时展示最终分数并回调', async () => {
    const grid: Grid = [
      [8, 0, 16, 8],
      [16, 8, 16, 8],
      [8, 16, 8, 16],
      [16, 8, 16, 8],
    ];
    const onGameOver = vi.fn();
    const result = await play(['left'], {
      createGame: () => new Game({ grid, rng: createSeededRandom(4) }),
      onGameOver,
    });
    expect(onGameOver).toHaveBeenCalledTimes(1);
    const message = result.events.find((event) => event.type === 'message' && event.text.includes('game over'));
    expect(message).toBeDefined();
    if (message && message.type === 'message') {
      expect(message.text).toContain('final score');
      expect(message.text).toContain('r to restart, q to quit');
    }
  });

  it('A121: 重开后棋盘重新初始化', async () => {
    const result = await play(['r'], { createGame: () => Game.seeded(11) });
    expect(countTiles(lastSnapshot(result.events).grid)).toBe(2);
    const fresh = Game.seeded(11).grid;
    expect(lastSnapshot(result.events).grid).toEqual(fresh);
  });
});
