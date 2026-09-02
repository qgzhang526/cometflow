export interface UndoSnapshot {
  grid: number[][];
  score: number;
  won: boolean;
  over: boolean;
}

export const DEFAULT_UNDO_LIMIT = 10;

function cloneGrid(grid: number[][]): number[][] {
  return grid.map((row) => [...row]);
}

function cloneSnapshot(snapshot: UndoSnapshot): UndoSnapshot {
  return { grid: cloneGrid(snapshot.grid), score: snapshot.score, won: snapshot.won, over: snapshot.over };
}

export class UndoHistory {
  private readonly max: number;
  private readonly stack: UndoSnapshot[] = [];

  constructor(limit: number = DEFAULT_UNDO_LIMIT) {
    this.max = Math.max(0, Math.floor(limit));
  }

  get limit(): number {
    return this.max;
  }

  get remaining(): number {
    return this.stack.length;
  }

  get canUndo(): boolean {
    return this.stack.length > 0;
  }

  push(snapshot: UndoSnapshot): void {
    this.stack.push(cloneSnapshot(snapshot));
    while (this.stack.length > this.max) this.stack.shift();
  }

  pop(): UndoSnapshot | null {
    const top = this.stack.pop();
    return top ? cloneSnapshot(top) : null;
  }

  clear(): void {
    this.stack.length = 0;
  }
}
