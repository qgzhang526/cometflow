import { Game, WIN_TILE } from '../core/game.js';
import { chooseMove } from '../ai/ai.js';
import type { Direction } from '../core/types.js';

const BEST_SCORE_KEY = 'cometflow2048.best';

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error('missing element #' + id);
  return node as T;
}

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_SCORE_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function writeBest(value: number): void {
  try {
    localStorage.setItem(BEST_SCORE_KEY, String(value));
  } catch {
    // storage unavailable (e.g. private mode): ignore
  }
}

function directionFromKey(event: KeyboardEvent): Direction | null {
  const key = event.key;
  if (key === 'ArrowUp' || key === 'w' || key === 'W' || key === 'k' || key === 'K') return 'up';
  if (key === 'ArrowDown' || key === 's' || key === 'S' || key === 'j' || key === 'J') return 'down';
  if (key === 'ArrowLeft' || key === 'a' || key === 'A' || key === 'h' || key === 'H') return 'left';
  if (key === 'ArrowRight' || key === 'd' || key === 'D' || key === 'l' || key === 'L') return 'right';
  return null;
}

const DIRECTION_ARROW: Record<Direction, string> = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
};

export class Web2048 {
  private game = new Game();
  private best = readBest();
  private winShown = false;
  private overRecorded = false;
  private hintText = '';
  private hintTimer: number | null = null;
  private touchStart: { x: number; y: number } | null = null;

  private readonly scoreEl = byId<HTMLElement>('score');
  private readonly bestEl = byId<HTMLElement>('best');
  private readonly statusEl = byId<HTMLElement>('status');
  private readonly boardEl = byId<HTMLElement>('board');
  private readonly overlayEl = byId<HTMLElement>('overlay');
  private readonly overlayTitleEl = byId<HTMLElement>('overlay-title');
  private readonly overlayTextEl = byId<HTMLElement>('overlay-text');
  private readonly cells: HTMLElement[] = [];

  constructor() {
    for (let i = 0; i < 16; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      this.boardEl.appendChild(cell);
      this.cells.push(cell);
    }
    byId('restart').addEventListener('click', () => this.restart());
    byId('overlay-restart').addEventListener('click', () => this.restart());
    byId('hint').addEventListener('click', () => this.showHint());

    window.addEventListener('keydown', (event) => {
      if (event.key === 'r' || event.key === 'R') {
        this.restart();
        return;
      }
      const direction = directionFromKey(event);
      if (direction) {
        event.preventDefault();
        this.move(direction);
      }
    });

    this.boardEl.addEventListener('touchstart', (event) => {
      const touch = event.changedTouches[0];
      this.touchStart = { x: touch.clientX, y: touch.clientY };
    }, { passive: true });

    this.boardEl.addEventListener('touchend', (event) => {
      const start = this.touchStart;
      this.touchStart = null;
      if (!start) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      const threshold = 24;
      if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
      if (Math.abs(dx) > Math.abs(dy)) this.move(dx > 0 ? 'right' : 'left');
      else this.move(dy > 0 ? 'down' : 'up');
    }, { passive: true });

    this.render();
    this.setStatus('WASD / 方向键 / 滑动移动 · R 重开');
  }

  private move(direction: Direction): void {
    if (this.game.over) {
      this.setStatus('游戏结束，点击「重新开始」再玩一局');
      return;
    }
    const outcome = this.game.move(direction);
    if (!outcome.moved) {
      this.setStatus('无效移动，棋盘不变');
      this.render();
      return;
    }
    if (this.game.won && !this.winShown) {
      this.winShown = true;
      this.setStatus(`达成 ${WIN_TILE}！继续挑战更高分 🎉`);
    }
    if (this.game.over) {
      this.recordOver();
    }
    this.render();
  }

  private recordOver(): void {
    if (this.overRecorded) return;
    this.overRecorded = true;
    if (this.game.score > this.best) {
      this.best = this.game.score;
      writeBest(this.best);
    }
    this.overlayTitleEl.textContent = 'Game Over';
    this.overlayTextEl.textContent = `最终得分 ${this.game.score} · 最大 tile ${this.game.maxTile}`;
    this.overlayEl.classList.remove('hidden');
  }

  private restart(): void {
    this.game = new Game();
    this.winShown = false;
    this.overRecorded = false;
    this.overlayEl.classList.add('hidden');
    this.setStatus('新的一局，祝好运！');
    this.render();
  }

  private showHint(): void {
    if (this.game.over) return;
    const direction = chooseMove(this.game.grid, { depth: 1, timeoutMs: 200 });
    this.hintText = `AI 建议：${DIRECTION_ARROW[direction]}`;
    this.render();
    if (this.hintTimer !== null) window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => {
      this.hintText = '';
      this.render();
    }, 2500);
  }

  private setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  private render(): void {
    this.scoreEl.textContent = String(this.game.score);
    this.bestEl.textContent = String(Math.max(this.best, this.game.score));
    const grid = this.game.grid;
    for (let i = 0; i < 16; i++) {
      const value = grid[Math.floor(i / 4)][i % 4];
      const cell = this.cells[i];
      cell.textContent = value === 0 ? '' : String(value);
      cell.className = 'cell' + (value === 0 ? '' : ' cell-' + value);
    }
    if (this.hintText) this.statusEl.textContent = this.hintText;
  }
}

new Web2048();
