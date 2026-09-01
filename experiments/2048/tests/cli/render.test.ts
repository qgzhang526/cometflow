import { describe, expect, it } from 'vitest';
import { Game } from '../../src/core/index.js';
import { formatSnapshot, renderBoard, renderTitle } from '../../src/cli/render.js';

describe('FR-CLI-001 启动与渲染', () => {
  it('A101: renderBoard 渲染 4 行棋盘', () => {
    const game = Game.seeded(1);
    const text = renderBoard(game, { ansi: false });
    const lines = text.split('\n');
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(line.trim().length).toBeGreaterThan(0);
    }
  });

  it('A102: 快照输出可解析（分数/状态/4x4 棋盘）', () => {
    const game = Game.seeded(2);
    const snapshot = formatSnapshot(game);
    const lines = snapshot.split('\n');

    expect(lines[0]).toMatch(/^SCORE: \d+$/);
    expect(lines[1]).toMatch(/^OVER: (true|false)$/);
    expect(lines[2]).toMatch(/^WON: (true|false)$/);
    expect(lines[3]).toBe('BOARD:');

    const rows = lines.slice(4);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      const cells = row.split(' ').map(Number);
      expect(cells).toHaveLength(4);
      for (const value of cells) expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it('A103: 非 ANSI 输出不含转义序列，ANSI 输出包含转义序列', () => {
    const game = new Game({
      grid: [
        [2, 4, 8, 16],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    });
    const plain = renderBoard(game, { ansi: false });
    expect(plain).not.toContain('\u001b[');

    const colored = renderBoard(game, { ansi: true });
    expect(colored).toContain('\u001b[');
  });

  it('renderTitle 展示历史最高分', () => {
    expect(renderTitle(1234, false)).toContain('1234');
  });
});
