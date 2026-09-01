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
