import { BOARD_SIZE, cloneGrid, emptyGrid, gridsEqual, moveGrid } from './board.js';
import { createSeededRandom, type RandomSource } from './rng.js';
import type { Direction, Grid, MoveOutcome, SpawnConfig } from './types.js';

export const WIN_TILE = 2048;

export const DEFAULT_SPAWN: SpawnConfig = {
  tiles: [
    { value: 2, probability: 0.9 },
    { value: 4, probability: 0.1 },
  ],
};

export interface GameOptions {
  rng?: RandomSource;
  spawn?: SpawnConfig;
  grid?: Grid;
  score?: number;
  won?: boolean;
  over?: boolean;
}

export class Game {
  private currentGrid: Grid;
  private currentScore: number;
  private currentWon: boolean;
  private currentOver: boolean;
  private readonly rng: RandomSource;
  private readonly spawn: SpawnConfig;

  constructor(options: GameOptions = {}) {
    this.rng = options.rng ?? createSeededRandom(Date.now() >>> 0);
    this.spawn = options.spawn ?? DEFAULT_SPAWN;
    this.currentGrid = options.grid ? cloneGrid(options.grid) : this.initGrid();
    this.currentScore = options.score ?? 0;
    this.currentWon = options.won ?? this.currentGrid.some((row) => row.includes(WIN_TILE));
    this.currentOver = options.over ?? this.computeOver();
  }

  static seeded(seed: number): Game {
    return new Game({ rng: createSeededRandom(seed) });
  }

  get grid(): Grid {
    return cloneGrid(this.currentGrid);
  }

  get score(): number {
    return this.currentScore;
  }

  get won(): boolean {
    return this.currentWon;
  }

  get over(): boolean {
    return this.currentOver;
  }

  get maxTile(): number {
    let max = 0;
    for (const row of this.currentGrid) {
      for (const value of row) {
        if (value > max) max = value;
      }
    }
    return max;
  }

  private initGrid(): Grid {
    const grid = emptyGrid();
    if (this.spawnTileAtRandomEmpty(grid) === null) {
      throw new Error('board has no room for initial tiles');
    }
    if (this.spawnTileAtRandomEmpty(grid) === null) {
      throw new Error('board has no room for initial tiles');
    }
    return grid;
  }

  private spawnTileAtRandomEmpty(grid: Grid): { row: number; col: number } | null {
    const empties: Array<{ row: number; col: number }> = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (grid[r][c] === 0) empties.push({ row: r, col: c });
      }
    }
    if (empties.length === 0) return null;
    const pick = empties[Math.floor(this.rng() * empties.length)];
    grid[pick.row][pick.col] = this.pickValue();
    return pick;
  }

  private pickValue(): number {
    const roll = this.rng();
    let cumulative = 0;
    for (const tile of this.spawn.tiles) {
      cumulative += tile.probability;
      if (roll < cumulative) return tile.value;
    }
    return this.spawn.tiles[this.spawn.tiles.length - 1].value;
  }

  move(direction: Direction): MoveOutcome {
    if (this.currentOver) {
      return { moved: false, scoreGained: 0 };
    }
    const before = this.currentGrid;
    const { grid, score } = moveGrid(before, direction);
    if (gridsEqual(before, grid)) {
      return { moved: false, scoreGained: 0 };
    }
    this.currentGrid = grid;
    this.currentScore += score;
    if (this.currentGrid.some((row) => row.includes(WIN_TILE))) {
      this.currentWon = true;
    }
    this.spawnTileAtRandomEmpty(this.currentGrid);
    this.currentOver = this.computeOver();
    return { moved: true, scoreGained: score };
  }

  private computeOver(): boolean {
    return !this.hasEmpty() && !this.canMergeAnywhere();
  }

  private hasEmpty(): boolean {
    return this.currentGrid.some((row) => row.includes(0));
  }

  private canMergeAnywhere(): boolean {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const value = this.currentGrid[r][c];
        if (value === 0) return true;
        if (c + 1 < BOARD_SIZE && this.currentGrid[r][c + 1] === value) return true;
        if (r + 1 < BOARD_SIZE && this.currentGrid[r + 1][c] === value) return true;
      }
    }
    return false;
  }

  legalMoves(): Direction[] {
    if (this.currentOver) return [];
    const legal: Direction[] = [];
    for (const direction of ['up', 'down', 'left', 'right'] as const) {
      if (!gridsEqual(this.currentGrid, moveGrid(this.currentGrid, direction).grid)) legal.push(direction);
    }
    return legal;
  }
}
