import { BOARD_SIZE, cloneGrid, gridsEqual, moveGrid } from '../core/board.js';
import { DIRECTIONS, type Direction, type Grid } from '../core/types.js';

export const DEFAULT_DEPTH = 1;
export const DEFAULT_TIMEOUT_MS = 200;

export interface AIConfig {
  depth: number;
  timeoutMs: number;
}

const SPAWN_PROBS: ReadonlyArray<readonly [number, number]> = [
  [2, 0.9],
  [4, 0.1],
];

const EMPTY_WEIGHT = 270.0;
const SMOOTH_WEIGHT = 0.1;
const MONO_WEIGHT = 100.0;
const CORNER_WEIGHT = 500.0;

export function legalMoves(grid: Grid): Direction[] {
  const legal: Direction[] = [];
  for (const direction of DIRECTIONS) {
    if (!gridsEqual(grid, moveGrid(grid, direction).grid)) legal.push(direction);
  }
  return legal;
}

function listEmptyCells(grid: Grid): Array<{ row: number; col: number }> {
  const empties: Array<{ row: number; col: number }> = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (grid[r][c] === 0) empties.push({ row: r, col: c });
    }
  }
  return empties;
}

export function evaluate(grid: Grid): number {
  let empty = 0;
  let maxTile = 0;
  for (const row of grid) {
    for (const value of row) {
      if (value === 0) empty++;
      else if (value > maxTile) maxTile = value;
    }
  }

  let smooth = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const value = grid[r][c];
      if (value === 0) continue;
      const logValue = Math.log2(value);
      if (c + 1 < BOARD_SIZE && grid[r][c + 1] !== 0) {
        smooth -= Math.abs(logValue - Math.log2(grid[r][c + 1]));
      }
      if (r + 1 < BOARD_SIZE && grid[r + 1][c] !== 0) {
        smooth -= Math.abs(logValue - Math.log2(grid[r + 1][c]));
      }
    }
  }

  let mono = 0;
  for (let c = 0; c < BOARD_SIZE; c++) {
    for (let r = 0; r < BOARD_SIZE - 1; r++) {
      const top = grid[r][c];
      const bottom = grid[r + 1][c];
      if (top !== 0 && bottom !== 0) {
        if (bottom >= top) mono += Math.log2(bottom) - Math.log2(top);
        else mono -= Math.log2(top) - Math.log2(bottom);
      }
    }
  }
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE - 1; c++) {
      const left = grid[r][c];
      const right = grid[r][c + 1];
      if (left !== 0 && right !== 0) {
        if (right >= left) mono += Math.log2(right) - Math.log2(left);
        else mono -= Math.log2(left) - Math.log2(right);
      }
    }
  }

  let cornerBonus = 0;
  for (const [r, c] of [
    [0, 0],
    [0, BOARD_SIZE - 1],
    [BOARD_SIZE - 1, 0],
    [BOARD_SIZE - 1, BOARD_SIZE - 1],
  ]) {
    if (grid[r][c] === maxTile) cornerBonus += CORNER_WEIGHT;
  }

  return empty * EMPTY_WEIGHT + smooth * SMOOTH_WEIGHT + mono * MONO_WEIGHT + cornerBonus;
}

function maxMoves(grid: Grid, depth: number, start: number, timeoutMs: number): number {
  if (depth <= 0 || Date.now() - start > timeoutMs) return evaluate(grid);
  const moves = legalMoves(grid);
  if (moves.length === 0) return evaluate(grid);
  let best = -Infinity;
  for (const direction of moves) {
    const next = moveGrid(grid, direction).grid;
    const value = search(next, depth - 1, start, timeoutMs);
    if (value > best) best = value;
  }
  return best;
}

function search(grid: Grid, depth: number, start: number, timeoutMs: number): number {
  if (depth <= 0 || Date.now() - start > timeoutMs) return evaluate(grid);
  const empties = listEmptyCells(grid);
  if (empties.length === 0) return evaluate(grid);
  let expected = 0;
  for (const { row, col } of empties) {
    for (const [value, probability] of SPAWN_PROBS) {
      const next = cloneGrid(grid);
      next[row][col] = value;
      expected += probability * maxMoves(next, depth, start, timeoutMs);
    }
  }
  return expected;
}

export function searchValue(grid: Grid, depth: number, timeoutMs: number = DEFAULT_TIMEOUT_MS): number {
  return search(grid, depth, Date.now(), timeoutMs);
}

export function chooseMove(grid: Grid, config: Partial<AIConfig> = {}): Direction {
  const cfg: AIConfig = {
    depth: config.depth ?? DEFAULT_DEPTH,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  const moves = legalMoves(grid);
  if (moves.length === 0) return 'left';
  const start = Date.now();
  let bestDirection = moves[0];
  let bestValue = -Infinity;
  for (const direction of moves) {
    const next = moveGrid(grid, direction).grid;
    const value = search(next, cfg.depth, start, cfg.timeoutMs);
    if (value > bestValue) {
      bestValue = value;
      bestDirection = direction;
    }
    if (Date.now() - start > cfg.timeoutMs) break;
  }
  return bestDirection;
}
