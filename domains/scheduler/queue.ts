import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import type { TaskPlan } from '../task-plan/types.js';

export type QueueTaskStatus = 'queued' | 'running' | 'done' | 'failed';

export interface QueueTask {
  id: string;
  goal: string;
  task: string;
  title: string;
  status: QueueTaskStatus;
  attempts: number;
  updated_at: string;
}

export interface SchedulerQueue {
  schema: 'cometflow.queue.v1';
  tasks: QueueTask[];
}

export function queuePath(projectRoot: string): string {
  return path.join(projectRoot, '.cometflow', 'runtime', 'queue.json');
}

export async function readQueue(projectRoot: string): Promise<SchedulerQueue | null> {
  try {
    const source = await fs.readFile(queuePath(projectRoot), "utf8");
    return JSON.parse(source) as SchedulerQueue;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeQueue(projectRoot: string, queue: SchedulerQueue): Promise<string> {
  const filePath = queuePath(projectRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(queue, null, 2));
  return filePath;
}

export async function buildQueueFromPlans(projectRoot: string): Promise<SchedulerQueue> {
  const plansDir = path.join(projectRoot, '.cometflow', 'plans');
  let entries: string[];
  try {
    entries = await fs.readdir(plansDir);
  } catch {
    entries = [];
  }

  const tasks: QueueTask[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.task-plan.yaml')) continue;
    try {
      const source = await fs.readFile(path.join(plansDir, entry), 'utf8');
      const plan = parse(source) as TaskPlan;
      tasks.push(...queueFromPlan(plan));
    } catch {
      // ignore unreadable generated plan files
    }
  }
  return { schema: 'cometflow.queue.v1', tasks };
}

export function queueFromPlan(plan: TaskPlan): QueueTask[] {
  const now = new Date().toISOString();
  return plan.tasks.filter((task) => task.status === 'frozen' || task.status === 'approved').map((task) => ({
    id: plan.goal + ":" + task.id,
    goal: plan.goal,
    task: task.id,
    title: task.title,
    status: 'queued' as const,
    attempts: 0,
    updated_at: now,
  }));
}

export function nextQueuedTask(queue: SchedulerQueue): QueueTask | null {
  return queue.tasks.find((task) => task.status === "queued") ?? null;
}

export function markQueueTask(queue: SchedulerQueue, taskId: string, status: QueueTaskStatus): SchedulerQueue {
  return {
    ...queue,
    tasks: queue.tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            status,
            attempts: status === "running" ? task.attempts + 1 : task.attempts,
            updated_at: new Date().toISOString(),
          }
        : task,
    ),
  };
}
