import { createInterface, emitKeypressEvents } from 'node:readline';
import { Game } from '../core/game.js';
import { runBenchmark } from '../ai/benchmark-cli.js';
import { HighScoreStore } from '../persistence/highscore.js';
import { formatSnapshot, renderBoard, renderTitle } from './render.js';
import type { Output } from './output.js';
import { normalizeKey } from './keys.js';
import { play } from './session.js';

export interface CliArgs {
  snapshot: boolean;
  seed?: number;
  highScoreDir?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { snapshot: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--snapshot') args.snapshot = true;
    else if (arg === '--seed') args.seed = Number(argv[++i]);
    else if (arg === '--highscore-dir') args.highScoreDir = argv[++i];
  }
  return args;
}

async function readKeys(): Promise<string[]> {
  const keys: string[] = [];
  const lines = createInterface({ input: process.stdin, terminal: false });
  for await (const line of lines) {
    for (const chunk of line.split(/\s+/u)) {
      if (chunk) keys.push(chunk);
    }
  }
  return keys;
}

/**
 * 实时交互模式（TTY）：按一个键立即移动并重绘。
 * 非 TTY / 管道输入仍走 readKeys + 整局回放（保证可测试性与脚本化玩法）。
 */
async function runLiveTTY(args: CliArgs, out: Output): Promise<void> {
  const store = new HighScoreStore(args.highScoreDir);
  const highScore = await store.read();
  let game = args.seed === undefined ? new Game() : Game.seeded(args.seed);
  let moves = 0;
  let winMessageEmitted = false;
  let gameOverRecorded = false;
  let message = '';

  const draw = (): void => {
    out.write('\x1b[2J\x1b[H');
    out.write(renderTitle(highScore, true) + '\n\n');
    out.write(renderBoard(game, { ansi: true }) + '\n\n');
    out.write(`score: ${game.score}   max tile: ${game.maxTile}   moves: ${moves}\n`);
    if (message) out.write('> ' + message + '\n');
    out.write('WASD/arrows move · r restart · q quit\n');
  };

  const exit = (code: number): never => {
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
    process.exit(code);
  };

  draw();
  emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();

  process.stdin.on('keypress', (_str, key) => {
    if (key && key.ctrl && key.name === 'c') exit(0);
    const candidate = key && key.name ? String(key.name) : _str ?? '';
    const command = normalizeKey(candidate);

    if (command === 'quit') exit(0);
    if (command === 'restart') {
      game = args.seed === undefined ? new Game() : Game.seeded(args.seed);
      moves = 0;
      winMessageEmitted = false;
      gameOverRecorded = false;
      message = 'board restarted';
      draw();
      return;
    }
    if (command === 'invalid') {
      message = 'ignored invalid input';
      draw();
      return;
    }
    if (game.over) {
      message = 'game over - press r to restart or q to quit';
      draw();
      return;
    }

    if (command !== 'up' && command !== 'down' && command !== 'left' && command !== 'right') {
      return;
    }
    const outcome = game.move(command);
    if (!outcome.moved) {
      message = 'invalid move, board unchanged';
      draw();
      return;
    }
    moves++;
    message = '';
    if (game.won && !winMessageEmitted) {
      winMessageEmitted = true;
      message = 'you reached 2048 - keep going or restart';
    }
    if (game.over) {
      message = `game over - final score: ${game.score} (r to restart, q to quit)`;
      if (!gameOverRecorded) {
        gameOverRecorded = true;
        void store.record(game.score, game.maxTile);
      }
    }
    draw();
  });
}

async function runInteractive(args: CliArgs, out: Output): Promise<void> {
  const ansi = Boolean(process.stdout.isTTY);
  const store = new HighScoreStore(args.highScoreDir);
  const highScore = await store.read();
  out.write(renderTitle(highScore, ansi) + '\n\n');

  // TTY 下实时逐键；管道/脚本输入走整局回放
  if (process.stdin.isTTY && process.stdout.isTTY) {
    await runLiveTTY(args, out);
    return;
  }

  const keys = await readKeys();

  const result = await play(keys, {
    createGame: () => (args.seed === undefined ? new Game() : Game.seeded(args.seed)),
    onGameOver: (game) => {
      void store.record(game.score, game.maxTile);
    },
  });

  for (const event of result.events) {
    if (event.type === 'snapshot') {
      if (ansi) {
        out.write(renderBoard(event.game, { ansi: true }) + '\n');
        out.write(`score: ${event.game.score}\n`);
      } else {
        out.write(formatSnapshot(event.game) + '\n');
      }
    } else {
      out.write('> ' + event.text + '\n');
    }
  }
}

async function runSnapshot(args: CliArgs, out: Output): Promise<void> {
  const store = new HighScoreStore(args.highScoreDir);
  const highScore = await store.read();
  const game = args.seed === undefined ? new Game() : Game.seeded(args.seed);
  out.write(renderTitle(highScore, false) + '\n');
  out.write(formatSnapshot(game) + '\n');
}

export async function runCli(argv: string[], out?: Output): Promise<void> {
  const sink: Output = out ?? process.stdout;
  if (argv[0] === 'benchmark') {
    await runBenchmark(argv.slice(1), sink);
    return;
  }
  const args = parseArgs(argv);
  if (args.snapshot) {
    await runSnapshot(args, sink);
    return;
  }
  await runInteractive(args, sink);
}
