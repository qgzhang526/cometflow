import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface HighScoreStats {
  highScore: number;
  bestTile: number;
  gamesPlayed: number;
  updatedAt: string | null;
}

export const DEFAULT_DIR = path.join(os.homedir(), '.cometflow-2048');
export const STORE_FILE = 'highscore.json';

const EMPTY_STATS: HighScoreStats = {
  highScore: 0,
  bestTile: 0,
  gamesPlayed: 0,
  updatedAt: null,
};

export class HighScoreStore {
  private readonly filePath: string;

  constructor(dir?: string) {
    this.filePath = path.join(dir ?? DEFAULT_DIR, STORE_FILE);
  }

  private async load(): Promise<HighScoreStats> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY_STATS };
      return { ...EMPTY_STATS };
    }
    try {
      const parsed = JSON.parse(raw) as Partial<HighScoreStats>;
      return {
        highScore: typeof parsed.highScore === 'number' ? parsed.highScore : 0,
        bestTile: typeof parsed.bestTile === 'number' ? parsed.bestTile : 0,
        gamesPlayed: typeof parsed.gamesPlayed === 'number' ? parsed.gamesPlayed : 0,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      };
    } catch {
      return { ...EMPTY_STATS };
    }
  }

  private async save(stats: HighScoreStats): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = this.filePath + '.tmp';
    await fs.writeFile(tempPath, JSON.stringify(stats, null, 2), 'utf8');
    await fs.rename(tempPath, this.filePath);
  }

  async read(): Promise<number> {
    const stats = await this.load();
    return stats.highScore;
  }

  async readStats(): Promise<HighScoreStats> {
    return this.load();
  }

  async record(score: number, maxTile: number): Promise<number> {
    const stats = await this.load();
    const next: HighScoreStats = {
      highScore: Math.max(stats.highScore, score),
      bestTile: Math.max(stats.bestTile, maxTile),
      gamesPlayed: stats.gamesPlayed + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.save(next);
    return next.highScore;
  }

  get storePath(): string {
    return this.filePath;
  }
}
