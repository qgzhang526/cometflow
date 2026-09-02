import { describe, expect, it } from 'vitest';
import { DEFAULT_UNDO_LIMIT, UndoHistory, type UndoSnapshot } from '../../src/web/undo.js';

function makeSnapshot(score: number): UndoSnapshot {
  return { grid: [[score, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], score, won: false, over: false };
}

describe('web-undo undo history (FR-UNDO-001/003)', () => {
  it('A801: pop 返回上一步移动前的棋盘与分数快照', () => {
    const history = new UndoHistory();
    history.push(makeSnapshot(4));
    const restored = history.pop();
    expect(restored).not.toBeNull();
    expect(restored!.score).toBe(4);
    expect(restored!.grid[0][0]).toBe(4);
    expect(history.remaining).toBe(0);
  });

  it('A801: 快照按值复制，外部修改不污染历史', () => {
    const history = new UndoHistory();
    const snapshot = makeSnapshot(2);
    history.push(snapshot);
    snapshot.grid[0][0] = 512;
    snapshot.score = 999;
    const restored = history.pop();
    expect(restored!.grid[0][0]).toBe(2);
    expect(restored!.score).toBe(2);
    restored!.grid[0][1] = 8;
    expect(history.remaining).toBe(0);
  });

  it('A802: 连续撤销次数有上限且可配置（默认 10）', () => {
    expect(DEFAULT_UNDO_LIMIT).toBe(10);
    const history = new UndoHistory(3);
    for (let i = 1; i <= 5; i++) history.push(makeSnapshot(i));
    expect(history.remaining).toBe(3);
    expect(history.pop()!.score).toBe(5);
    expect(history.pop()!.score).toBe(4);
    expect(history.pop()!.score).toBe(3);
    expect(history.canUndo).toBe(false);
  });

  it('A803: clear 清空历史，pop 返回 null', () => {
    const history = new UndoHistory();
    history.push(makeSnapshot(2));
    history.clear();
    expect(history.remaining).toBe(0);
    expect(history.pop()).toBeNull();
    expect(history.canUndo).toBe(false);
  });
});
