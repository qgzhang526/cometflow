import { Game } from '../core/game.js';
import { normalizeKey, type Command } from './keys.js';

export type PlayEvent =
  | { type: 'snapshot'; game: Game }
  | { type: 'message'; text: string };

export interface PlayOptions {
  createGame: () => Game;
  onGameOver?: (game: Game) => void | Promise<void>;
}

export interface PlayResult {
  events: PlayEvent[];
  moves: number;
  restarts: number;
  quit: boolean;
  finalScore: number;
}

function snapshotOf(game: Game): Game {
  return new Game({ grid: game.grid, score: game.score, won: game.won, over: game.over });
}

export async function play(keys: string[], options: PlayOptions): Promise<PlayResult> {
  let game = options.createGame();
  let moves = 0;
  let restarts = 0;
  let quit = false;
  let winMessageEmitted = false;
  const events: PlayEvent[] = [];

  const emit = (event: PlayEvent): void => {
    events.push(event);
  };

  emit({ type: 'snapshot', game: snapshotOf(game) });
  emit({ type: 'message', text: 'use WASD/arrows to move, r to restart, q to quit' });

  for (const key of keys) {
    const command: Command = normalizeKey(key);
    if (command === 'quit') {
      quit = true;
      break;
    }
    if (command === 'restart') {
      game = options.createGame();
      restarts++;
      emit({ type: 'snapshot', game: snapshotOf(game) });
      emit({ type: 'message', text: 'board restarted' });
      continue;
    }
    if (command === 'invalid') {
      emit({ type: 'message', text: `ignored invalid input: ${JSON.stringify(key)}` });
      continue;
    }
    if (game.over) {
      emit({ type: 'message', text: 'game over, board unchanged - press r to restart or q to quit' });
      continue;
    }
    const outcome = game.move(command);
    if (!outcome.moved) {
      emit({ type: 'message', text: 'invalid move, board unchanged' });
      continue;
    }
    moves++;
    emit({ type: 'snapshot', game: snapshotOf(game) });
    if (game.won && !winMessageEmitted) {
      winMessageEmitted = true;
      emit({ type: 'message', text: 'you reached 2048 - keep going or restart' });
    }
    if (game.over) {
      await options.onGameOver?.(game);
      emit({ type: 'message', text: `game over - final score: ${game.score} (r to restart, q to quit)` });
    }
  }

  return { events, moves, restarts, quit, finalScore: game.score };
}
