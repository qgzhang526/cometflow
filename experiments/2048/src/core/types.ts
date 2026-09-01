export type Direction = 'up' | 'down' | 'left' | 'right';

export const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];

export type Grid = number[][];

export interface TileSpawn {
  value: number;
  probability: number;
}

export interface SpawnConfig {
  tiles: TileSpawn[];
}

export interface MoveOutcome {
  moved: boolean;
  scoreGained: number;
}
