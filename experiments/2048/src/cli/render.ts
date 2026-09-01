import type { Game } from '../core/game.js';

export interface RenderOptions {
  ansi: boolean;
}

const ANSI_COLORS: Record<number, string> = {
  2: '37',
  4: '36',
  8: '34',
  16: '32',
  32: '33',
  64: '35',
  128: '31',
  256: '36;1',
  512: '32;1',
  1024: '33;1',
  2048: '35;1',
  4096: '31;1',
};

export function renderBoard(game: Game, options: RenderOptions): string {
  const lines: string[] = [];
  for (const row of game.grid) {
    const cells = row.map((value) => {
      if (value === 0) return '    .';
      const color = ANSI_COLORS[value] ?? '37';
      const text = String(value).padStart(5);
      return options.ansi ? `\u001b[${color}m${text}\u001b[0m` : text;
    });
    lines.push(cells.join(''));
  }
  return lines.join('\n');
}

export function formatSnapshot(game: Game): string {
  const lines: string[] = [];
  lines.push(`SCORE: ${game.score}`);
  lines.push(`OVER: ${game.over}`);
  lines.push(`WON: ${game.won}`);
  lines.push('BOARD:');
  for (const row of game.grid) {
    lines.push(row.join(' '));
  }
  return lines.join('\n');
}

export function renderTitle(highScore: number, ansi: boolean): string {
  const base = `CometFlow 2048 - high score: ${highScore}`;
  return ansi ? `\u001b[1m${base}\u001b[0m` : base;
}
