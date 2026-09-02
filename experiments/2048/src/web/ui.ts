import { Game, WIN_TILE } from '../core/game.js';
import { chooseMove } from '../ai/ai.js';
import type { Direction, Grid } from '../core/types.js';

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
  private demoOn = false;
  private demoInterval: number | null = null;
  private readonly demoButton = byId<HTMLButtonElement>('ai-demo');

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
    this.demoButton.addEventListener('click', () => this.toggleDemo());

    window.addEventListener('keydown', (event) => {
      if (event.key === 'r' || event.key === 'R') {
        this.restart();
        return;
      }
      const direction = directionFromKey(event);
      if (direction) {
        this.stopDemo();
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
      this.stopDemo();
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
    const prevGrid = this.game.grid;
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
      if (this.demoOn) this.stopDemo();
    }
    this.render();
    this.animateMove(prevGrid, this.game.grid);
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
    this.stopDemo();
    this.game = new Game();
    this.winShown = false;
    this.overRecorded = false;
    this.overlayEl.classList.add('hidden');
    this.setStatus('新的一局，祝好运！');
    this.render();
  }

  private showHint(): void {
    this.stopDemo();
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

  private toggleDemo(): void {
    if (this.demoOn) this.stopDemo();
    else this.startDemo();
  }

  private startDemo(): void {
    if (this.game.over) return;
    this.stopDemo();
    this.demoOn = true;
    this.demoButton.textContent = '停止演示';
    this.demoInterval = window.setInterval(() => this.demoStep(), 150);
    this.demoStep();
  }

  private stopDemo(): void {
    this.demoOn = false;
    if (this.demoInterval !== null) {
      window.clearInterval(this.demoInterval);
      this.demoInterval = null;
    }
    this.demoButton.textContent = 'AI 演示';
  }

  private demoStep(): void {
    if (this.game.over) {
      this.stopDemo();
      this.setStatus('AI 演示结束');
      return;
    }
    const direction = chooseMove(this.game.grid, { depth: 1, timeoutMs: 200 });
    this.move(direction);
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

  private cellPitch(): number {
    const width = this.cells[0].offsetWidth || 0;
    return width + 10; // 与 CSS gap 一致
  }

  private findSlideSource(prev: Grid, used: Set<number>, value: number): { r: number; c: number } | null {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const idx = r * 4 + c;
        if (used.has(idx)) continue;
        if (prev[r][c] === value) return { r, c };
      }
    }
    return null;
  }

  private findMergeSource(prev: Grid, used: Set<number>, value: number): Array<{ r: number; c: number; idx: number }> | null {
    // 同行或同列、未被使用的两格旧值之和等于新值 → 视为合并
    for (let line = 0; line < 4; line++) {
      for (const isRow of [true, false]) {
        const candidates: Array<{ r: number; c: number; idx: number; v: number }> = [];
        for (let k = 0; k < 4; k++) {
          const r = isRow ? line : k;
          const c = isRow ? k : line;
          const idx = r * 4 + c;
          if (used.has(idx)) continue;
          const v = prev[r][c];
          if (v !== 0 && v < value) candidates.push({ r, c, idx, v });
        }
        for (let i = 0; i < candidates.length; i++) {
          for (let j = i + 1; j < candidates.length; j++) {
            if (candidates[i].v + candidates[j].v === value) {
              return [candidates[i], candidates[j]];
            }
          }
        }
      }
    }
    return null;
  }

  /** 视觉动画：滑动（transform 过渡）、合并（pop）、生成（spawn）。只动样式，不改游戏状态。 */
  private animateMove(prev: Grid, next: Grid): void {
    const pitch = this.cellPitch();
    const used = new Set<number>();
    const slide = new Map<number, { dr: number; dc: number }>();
    const merge = new Set<number>();
    const spawn = new Set<number>();

    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const value = next[r][c];
        const idx = r * 4 + c;
        if (value === 0) continue;
        const pair = this.findMergeSource(prev, used, value);
        if (pair) {
          merge.add(idx);
          for (const p of pair) used.add(p.idx);
          continue;
        }
        const source = this.findSlideSource(prev, used, value);
        if (source) {
          used.add(source.r * 4 + source.c);
          slide.set(idx, { dr: source.r - r, dc: source.c - c });
        } else {
          spawn.add(idx);
        }
      }
    }

    for (const [idx, delta] of slide) {
      this.cells[idx].style.transform = `translate(${delta.dc * pitch}px, ${delta.dr * pitch}px)`;
    }

    const settle = (): void => {
      for (const idx of slide.keys()) {
        this.cells[idx].style.transform = '';
      }
      for (const idx of merge) {
        const el = this.cells[idx];
        el.classList.add('cell-pop');
        window.setTimeout(() => el.classList.remove('cell-pop'), 180);
      }
      for (const idx of spawn) {
        this.cells[idx].classList.add('cell-spawn');
      }
    };
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => window.requestAnimationFrame(settle));
    } else {
      settle();
    }
  }
}

new Web2048();
