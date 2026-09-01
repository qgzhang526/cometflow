import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HighScoreStore, STORE_FILE } from '../../src/persistence/highscore.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-2048-'));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('FR-PERSIST-001 高分存取', () => {
  it('A301: 对局结束写入最高分文件', async () => {
    const store = new HighScoreStore(tempDir);
    const recorded = await store.record(1200, 128);
    expect(recorded).toBe(1200);
    const raw = await fs.readFile(path.join(tempDir, STORE_FILE), 'utf8');
    expect(JSON.parse(raw).highScore).toBe(1200);
  });

  it('A302: 重开后读取历史最高分并展示', async () => {
    const first = new HighScoreStore(tempDir);
    await first.record(2400, 256);
    const second = new HighScoreStore(tempDir);
    expect(await second.read()).toBe(2400);
  });

  it('A303: 多次对局只保留最高分', async () => {
    const store = new HighScoreStore(tempDir);
    await store.record(500, 64);
    await store.record(3200, 512);
    await store.record(100, 32);
    expect(await store.read()).toBe(3200);
    const stats = await store.readStats();
    expect(stats.bestTile).toBe(512);
    expect(stats.gamesPlayed).toBe(3);
  });
});

describe('FR-PERSIST-002 健壮性', () => {
  it('A310: 缺失文件首次运行时自动初始化', async () => {
    const store = new HighScoreStore(tempDir);
    expect(await store.read()).toBe(0);
    expect(await store.readStats()).toMatchObject({ highScore: 0, gamesPlayed: 0 });
  });

  it('A311: 损坏文件被安全忽略并重建', async () => {
    await fs.writeFile(path.join(tempDir, STORE_FILE), '{ not valid json !!', 'utf8');
    const store = new HighScoreStore(tempDir);
    expect(await store.read()).toBe(0);
    await store.record(800, 64);
    expect(await store.read()).toBe(800);
  });

  it('A312: 存储路径遵循跨平台约定（不使用硬编码绝对路径）', () => {
    const store = new HighScoreStore();
    expect(store.storePath.startsWith(os.homedir())).toBe(true);
    expect(store.storePath.endsWith(STORE_FILE)).toBe(true);
  });
});
