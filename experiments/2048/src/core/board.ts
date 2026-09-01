import type { Direction, Grid } from './types.js';

export const BOARD_SIZE = 4;

export function emptyGrid(): Grid {
  return Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => 0));
}

export function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => [...row]);
}

export function gridsEqual(a: Grid, b: Grid): boolean {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (a[r][c] !== b[r][c]) return false;
    }
  }
  return true;
}

function slideRow(row: number[]): { row: number[]; score: number } {
  const compacted = row.filter((value) => value !== 0);
  const result: number[] = [];
  let score = 0;
  for (let i = 0; i < compacted.length; i++) {
    if (i + 1 < compacted.length && compacted[i] === compacted[i + 1]) {
      const merged = compacted[i] * 2;
      result.push(merged);
      score += merged;
      i++;
    } else {
      result.push(compacted[i]);
    }
  }
  while (result.length < BOARD_SIZE) result.push(0);
  return { row: result, score };
}

function transpose(grid: Grid): Grid {
  return grid.map((_, c) => grid.map((row) => row[c]));
}

function reverseRows(grid: Grid): Grid {
  return grid.map((row) => [...row].reverse());
}

export function moveGrid(grid: Grid, direction: Direction): { grid: Grid; score: number } {
  let working = cloneGrid(grid);
  if (direction === 'up' || direction === 'down') working = transpose(working);
  if (direction === 'right' || direction === 'down') working = reverseRows(working);

  let score = 0;
  const movedRows = working.map((row) => {
    const slid = slideRow(row);
    score += slid.score;
    return slid.row;
  });

  let result = movedRows;
  if (direction === 'right' || direction === 'down') result = reverseRows(result);
  if (direction === 'up' || direction === 'down') result = transpose(result);

  return { grid: result, score };
}
