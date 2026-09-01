export interface BudgetOptions {
  budgetMs: number;
  startedAt?: number;
}

export class Budget {
  readonly budgetMs: number;
  readonly startedAt: number;

  constructor(options: BudgetOptions) {
    this.budgetMs = options.budgetMs;
    this.startedAt = options.startedAt ?? Date.now();
  }

  elapsedMs(now = Date.now()): number {
    return Math.max(0, now - this.startedAt);
  }

  isExhausted(now = Date.now()): boolean {
    return this.budgetMs > 0 && this.elapsedMs(now) >= this.budgetMs;
  }
}
