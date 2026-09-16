import { createHash } from 'node:crypto';
import path from 'node:path';
import { stringify } from 'yaml';
import { readTextFile, pathExists } from '../../platform/fs/read-file.js';
import type { GoalRecord, GoalSyncResult } from './types.js';

const GOAL_HEADING = /^###\s+(G\d+)[：:]?\s*(.*)$/u;
const BULLET = /^\s*-\s+/u;
const NESTED_BULLET = /^\s{2,}-\s+/u;

interface RawGoal {
  id: string;
  title: string;
  body: string;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function splitList(value: string): string[] {
  return value
    .split(/[，,、]/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseGoalBlock(raw: RawGoal): GoalRecord {
  const lines = raw.body.split(/\r?\n/u);
  let summary = '';
  const scope: string[] = [];
  const success: string[] = [];
  const nonGoals: string[] = [];
  let currentList: 'success' | 'non_goals' | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (NESTED_BULLET.test(line)) {
      const value = line.replace(NESTED_BULLET, '').trim();
      if (currentList === 'success') success.push(value);
      else if (currentList === 'non_goals') nonGoals.push(value);
      continue;
    }

    if (!BULLET.test(line)) continue;
    const value = line.replace(BULLET, '').trim();

    if (value.startsWith('目标：') || value.startsWith('目标:')) {
      summary = value.replace(/^目标[：:]\s*/u, '').trim();
      currentList = null;
      continue;
    }

    if (value.startsWith('范围：') || value.startsWith('范围:')) {
      scope.push(...splitList(value.replace(/^范围[：:]\s*/u, '')));
      currentList = null;
      continue;
    }

    if (value.startsWith('成功标准：') || value.startsWith('成功标准:')) {
      currentList = 'success';
      continue;
    }

    if (value.startsWith('非目标：') || value.startsWith('非目标:')) {
      currentList = 'non_goals';
      continue;
    }
  }

  return {
    schema: 'cometflow.goal.v1',
    id: raw.id,
    title: raw.title || raw.id,
    summary,
    scope,
    success_criteria: success,
    non_goals: nonGoals,
    source: 'COMETFLOW.md',
    source_hash: '',
    status: 'active',
  };
}

export function parseGoals(markdown: string): GoalRecord[] {
  const lines = markdown.split(/\r?\n/u);
  const goalsSectionStart = lines.findIndex((line) => /^##\s+任务目标\s*$/u.test(line.trim()));
  if (goalsSectionStart < 0) return [];

  const rawGoals: RawGoal[] = [];
  let current: RawGoal | null = null;

  for (let index = goalsSectionStart + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^##\s+/u.test(line)) break;
    const match = GOAL_HEADING.exec(line.trim());
    if (match) {
      if (current) rawGoals.push(current);
      current = { id: match[1], title: match[2].trim(), body: '' };
      continue;
    }
    if (current) current.body += line + '\n';
  }
  if (current) rawGoals.push(current);

  const hash = sha256(markdown);
  return rawGoals.map((raw) => ({ ...parseGoalBlock(raw), source_hash: hash }));
}

export async function syncGoals(projectRoot: string): Promise<GoalSyncResult> {
  const missionPath = path.join(projectRoot, 'COMETFLOW.md');
  if (!(await pathExists(missionPath))) {
    return { goals: [], written: [] };
  }
  const markdown = await readTextFile(missionPath);
  const goals = parseGoals(markdown);
  const goalsDir = path.join(projectRoot, '.cometflow', 'goals');
  const written: string[] = [];
  const { promises: fs } = await import('node:fs');

  for (const goal of goals) {
    const filePath = path.join(goalsDir, goal.id + '.yaml');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, stringify(goal));
    written.push(filePath);
  }

  return { goals, written };
}

export function goalProjectionDir(projectRoot: string): string {
  return path.join(projectRoot, '.cometflow', 'goals');
}

/**
 * 读目标投影（`.cometflow/goals/*.yaml`）。
 *
 * 投影是 `goal sync` 的产物，读不到文件就不返回记录——调用方负责决定
 * 「没有投影」意味着什么（例如 Builder 提示词里退化成只给 goal id）。
 */
export async function listGoalRecords(projectRoot: string): Promise<GoalRecord[]> {
  const { promises: fs } = await import('node:fs');
  const dir = goalProjectionDir(projectRoot);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const { parse } = await import('yaml');
  const goals: GoalRecord[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) continue;
    try {
      goals.push(parse(await fs.readFile(path.join(dir, entry), 'utf8')) as GoalRecord);
    } catch {
      // 投影损坏不该让调用方失败：坏文件跳过，其余照常返回。
    }
  }
  return goals;
}

export async function readGoalRecord(projectRoot: string, goalId: string): Promise<GoalRecord | null> {
  const goals = await listGoalRecords(projectRoot);
  return goals.find((goal) => goal.id === goalId) ?? null;
}
