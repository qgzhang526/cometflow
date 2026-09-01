import { createSeededRandom, Game, WIN_TILE } from '../core/index.js';
import { DEFAULT_DEPTH, DEFAULT_TIMEOUT_MS, chooseMove } from './ai.js';

export interface BenchmarkGameResult {
  seed: number;
  max_tile: number;
  score: number;
  moves: number;
  won: boolean;
}

export interface BenchmarkResult {
  games: number;
  seed: number;
  depth: number;
  timeout_ms: number;
  wins: number;
  win_rate: number;
  max_tile: { min: number; max: number; avg: number };
  score: { min: number; max: number; avg: number };
  moves: { total: number; avg: number };
  games_detail: BenchmarkGameResult[];
}

export interface BenchmarkOptions {
  n?: number;
  seed?: number;
  depth?: number;
  timeoutMs?: number;
}

export const DEFAULT_GAMES = 100;

export function runBenchmark(options: BenchmarkOptions = {}): BenchmarkResult {
  const games = options.n ?? DEFAULT_GAMES;
  const seed = options.seed ?? 1;
  const depth = options.depth ?? DEFAULT_DEPTH;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const detail: BenchmarkGameResult[] = [];
  let wins = 0;
  let maxTileMax = 0;
  let maxTileMin = Infinity;
  let maxTileSum = 0;
  let scoreMax = 0;
  let scoreMin = Infinity;
  let scoreSum = 0;
  let movesTotal = 0;

  for (let i = 0; i < games; i++) {
    const gameSeed = (seed + i * 1000003) >>> 0;
    const game = new Game({ rng: createSeededRandom(gameSeed) });
    let moves = 0;
    while (!game.over) {
      const direction = chooseMove(game.grid, { depth, timeoutMs });
      const outcome = game.move(direction);
      if (!outcome.moved) break;
      moves++;
      if (moves > 10000) break;
    }
    const won = game.maxTile >= WIN_TILE;
    if (won) wins++;
    if (game.maxTile > maxTileMax) maxTileMax = game.maxTile;
    if (game.maxTile < maxTileMin) maxTileMin = game.maxTile;
    maxTileSum += game.maxTile;
    if (game.score > scoreMax) scoreMax = game.score;
    if (game.score < scoreMin) scoreMin = game.score;
    scoreSum += game.score;
    movesTotal += moves;
    detail.push({ seed: gameSeed, max_tile: game.maxTile, score: game.score, moves, won });
  }

  return {
    games,
    seed,
    depth,
    timeout_ms: timeoutMs,
    wins,
    win_rate: games > 0 ? wins / games : 0,
    max_tile: {
      min: maxTileMin === Infinity ? 0 : maxTileMin,
      max: maxTileMax,
      avg: games > 0 ? maxTileSum / games : 0,
    },
    score: {
      min: scoreMin === Infinity ? 0 : scoreMin,
      max: scoreMax,
      avg: games > 0 ? scoreSum / games : 0,
    },
    moves: { total: movesTotal, avg: games > 0 ? movesTotal / games : 0 },
    games_detail: detail,
  };
}
