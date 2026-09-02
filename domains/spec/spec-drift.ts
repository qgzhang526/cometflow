import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { readTextFile } from '../../platform/fs/read-file.js';
import type { TaskPlan, TaskRecord } from '../task-plan/types.js';

export interface SpecDriftEntry {
  goal: string;
  task: string;
  spec_ref: string;
  spec_anchor: string | null;
  frozen_hash: string;
  current_hash: string;
}

export interface SpecDriftReport {
  drift: SpecDriftEntry[];
  scannedTasks: number;
}

function sha256(text: string): string {
  // 归一化行尾：git autocrlf 会把 checkout 出的文件转成 CRLF，冻结哈希基于 LF 内容计算
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

async function listPlanFiles(projectRoot: string): Promise<string[]> {
  const dir = path.join(projectRoot, ".cometflow", "plans");
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((entry) => entry.endsWith(".task-plan.yaml")).sort();
  } catch {
    return [];
  }
}

export async function collectSpecDrift(projectRoot: string): Promise<SpecDriftReport> {
  const planFiles = await listPlanFiles(projectRoot);
  const drift: SpecDriftEntry[] = [];
  let scannedTasks = 0;

  for (const file of planFiles) {
    let plan: TaskPlan;
    try {
      const source = await fs.readFile(path.join(projectRoot, ".cometflow", "plans", file), "utf8");
      plan = parse(source) as TaskPlan;
    } catch {
      continue;
    }

    for (const task of plan.tasks) {
      if (task.status !== 'frozen' && task.status !== 'approved') continue;
      if (!task.spec_ref || !task.spec_hash) continue;
      scannedTasks += 1;
      let currentContent: string;
      try {
        currentContent = await readTextFile(path.join(projectRoot, task.spec_ref));
      } catch {
        continue;
      }
      const currentHash = sha256(currentContent);
      if (currentHash !== task.spec_hash) {
        drift.push({
          goal: plan.goal,
          task: task.id,
          spec_ref: task.spec_ref,
          spec_anchor: task.spec_anchor,
          frozen_hash: task.spec_hash,
          current_hash: currentHash,
        });
      }
    }
  }

  return { drift, scannedTasks };
}
