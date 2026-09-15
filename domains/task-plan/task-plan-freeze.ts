import path from 'node:path';
import { parseSpecFile } from '../spec/spec-parse.js';
import { hashSpecText } from '../spec/spec-hash.js';
import { normalizeModulePath, parseSpecMeta } from '../spec/spec-meta.js';
import { recordSpecVersion, refreshSpecBaseline } from '../spec/spec-version.js';
import { readTextFile } from '../../platform/fs/read-file.js';
import { acquireLock } from '../../platform/fs/file-lock.js';
import type { TaskPlan, TaskRecord } from './types.js';

/**
 * 冻结 = 把「任务 ↔ spec」的对应关系固化成可校验的版本引用。
 *
 * 冻结时会做两件事：
 * 1. 把当前 spec 内容登记为一个版本（内容没变则复用已有版本号），task.spec_version 取该版本号；
 * 2. 记录整份文件的 hash 与该 anchor 的段落 hash，分别用于文件级与锚点级漂移检测。
 */
export async function freezeTaskPlan(projectRoot: string, plan: TaskPlan): Promise<TaskPlan> {
  // 冻结会写计划 + 登记 spec 版本 + 刷新 lock（多个文件）：整段持锁。
  const lock = await acquireLock(projectRoot, 'plan freeze ' + plan.goal);
  try {
    return await freezeTaskPlanLocked(projectRoot, plan);
  } finally {
    await lock.release();
  }
}

async function freezeTaskPlanLocked(projectRoot: string, plan: TaskPlan): Promise<TaskPlan> {
  const frozenTasks: TaskRecord[] = [];

  for (const task of plan.tasks) {
    if (task.kind === 'spec-authoring' || !task.spec_ref || !task.spec_anchor) {
      frozenTasks.push({ ...task, status: 'frozen' as const });
      continue;
    }

    const parsed = await parseSpecFile(projectRoot, task.spec_ref);
    const anchor = parsed.anchors.find((entry) => entry.heading === task.spec_anchor);
    if (!anchor) throw new Error('Missing anchor for task ' + task.id);
    const acceptance = anchor.acceptance.length > 0 ? anchor.acceptance : parsed.acceptance;
    if (acceptance.length === 0) throw new Error('No acceptance for task ' + task.id);

    const content = await readTextFile(path.join(projectRoot, task.spec_ref));
    // 冻结同时绑定模块边界：老计划（在 module 机制之前生成）不会带着 module 字段，
    // 如果只刷新 hash，change 就会拿到一个「无边界」的任务，越界检查随之失效。
    const module = normalizeModulePath(parseSpecMeta(content).module);
    const version = await recordSpecVersion(projectRoot, {
      specPath: task.spec_ref,
      content,
      note: 'plan freeze',
    });
    frozenTasks.push({
      ...task,
      acceptance_ids: acceptance.map((item) => item.id),
      spec_version: version.spec_version,
      spec_hash: hashSpecText(content),
      anchor_hash: anchor.hash,
      module,
      test_scope: module ?? task.test_scope,
      status: 'frozen' as const,
    });
  }

  // 冻结同时确立基线：登记版本 + 刷新 spec-lock，
  // 使 spec diff / impact 的比对起点与「冻结时看到的 spec」一致。
  await refreshSpecBaseline(projectRoot, { note: 'plan freeze' });
  return { ...plan, status: 'frozen' as const, tasks: frozenTasks };
}
