import { createInterface } from 'node:readline';
import { Game } from '../core/game.js';
import { runBenchmark } from '../ai/benchmark-cli.js';
import { HighScoreStore } from '../persistence/highscore.js';
import { formatSnapshot, renderBoard, renderTitle } from './render.js';
import type { Output } from './output.js';
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

async function runInteractive(args: CliArgs, out: Output): Promise<void> {
  const ansi = Boolean(process.stdout.isTTY);
  const store = new HighScoreStore(args.highScoreDir);
  const highScore = await store.read();
  out.write(renderTitle(highScore, ansi) + '\n\n');

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
