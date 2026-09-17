import { randomUUID } from 'node:crypto';
import { appendJobLog, listJobRecords, removeJob, writeJobRecord } from './job-store.js';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type JobKind =
  | 'plan-generate'
  | 'plan-regenerate'
  | 'change-run'
  | 'change-verify'
  | 'evolve-verify'
  | 'eval-run'
  /** 一次性 agent 试跑（`cometflow run` 的界面入口，C13）。 */
  | 'flow-run'
  /** serve 内嵌的调度器循环（ADR 0027）：一个 daemon job 就是一次 `daemon start`。 */
  | 'daemon';

export interface JobRecord {
  id: string;
  projectId: string;
  kind: JobKind;
  goal?: string;
  change?: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  error?: string;
  logTail: string[];
  /**
   * 任务产出的结构化结果（如 eval 报告、change 状态）。
   *
   * 只在事件里带结果的话，刷新页面就再也拿不到了；job 中心要能回答「刚才那次跑出了什么」，
   * 所以结果留存在记录上，由 GET /api/jobs/{id} 一并返回。
   */
  result?: unknown;
}

export type JobEventType =
  | 'job.queued'
  | 'job.started'
  | 'job.log'
  | 'job.completed'
  | 'job.failed'
  | 'state.changed';

export interface JobEvent {
  type: JobEventType;
  jobId?: string;
  projectId?: string;
  line?: string;
  result?: unknown;
  error?: string;
  path?: string;
  at: string;
}

/**
 * 内存里保留的任务上限。
 *
 * serve 是长驻进程，任务只增不减会让「任务中心」越用越慢；超限时从**已结束**的任务里
 * 淘汰最旧的，正在排队/运行的任务永远不动（淘汰它们等于丢证据）。
 */
export const MAX_RETAINED_JOBS = 200;

export class JobManager {
  private jobs = new Map<string, JobRecord>();
  private listeners = new Set<(event: JobEvent) => void>();
  /** 已经落盘/加载过的项目（避免每次列表都重复读盘）。 */
  private hydrated = new Set<string>();
  private projectRoots = new Map<string, string>();
  /** 落盘是异步的：跟踪在途写入，便于测试与优雅停机等待落盘完成。 */
  private pending = new Set<Promise<void>>();

  constructor(
    private options: {
      resolveProjectRoot?: (projectId: string) => Promise<string | null>;
    } = {},
  ) {}

  /** 首次访问某项目时，把落盘的任务读回内存（进程重启后仍能看到历史）。 */
  async hydrate(projectId: string, projectRoot: string): Promise<void> {
    this.projectRoots.set(projectId, projectRoot);
    if (this.hydrated.has(projectId)) return;
    this.hydrated.add(projectId);
    for (const record of await listJobRecords(projectRoot)) {
      if (!this.jobs.has(record.id)) this.jobs.set(record.id, record);
    }
  }

  private async persist(job: JobRecord, options: { log?: string } = {}): Promise<void> {
    const root = this.projectRoots.get(job.projectId) ?? (await this.options.resolveProjectRoot?.(job.projectId)) ?? null;
    if (root === null) return;
    this.projectRoots.set(job.projectId, root);
    await writeJobRecord(root, job);
    if (options.log !== undefined) await appendJobLog(root, job.id, options.log);
  }

  create(projectId: string, kind: JobKind, meta: { goal?: string; change?: string } = {}): JobRecord {
    const job: JobRecord = {
      id: 'job_' + randomUUID().slice(0, 8),
      projectId,
      kind,
      goal: meta.goal,
      change: meta.change,
      status: 'queued',
      createdAt: new Date().toISOString(),
      logTail: [],
    };
    this.jobs.set(job.id, job);
    this.emit({ type: 'job.queued', jobId: job.id, projectId, at: new Date().toISOString() });
    this.track(this.persist(job));
    this.evictFinished();
    return job;
  }

  private evictFinished(): void {
    const finished = [...this.jobs.values()]
      .filter((job) => job.status === 'succeeded' || job.status === 'failed')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const overflow = this.jobs.size - MAX_RETAINED_JOBS;
    for (let index = 0; index < overflow && index < finished.length; index += 1) {
      this.jobs.delete(finished[index].id);
    }
  }

  /** 清理已结束的任务，返回清理条数；排队/运行中的任务不受影响。 */
  async clearFinished(): Promise<number> {
    let removed = 0;
    for (const job of [...this.jobs.values()]) {
      if (job.status !== 'succeeded' && job.status !== 'failed') continue;
      this.jobs.delete(job.id);
      removed += 1;
      const root = this.projectRoots.get(job.projectId) ?? (await this.options.resolveProjectRoot?.(job.projectId)) ?? null;
      if (root !== null) await removeJob(root, job.id).catch(() => undefined);
    }
    return removed;
  }

  get(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  list(): JobRecord[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  log(id: string, line: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.logTail.push(line);
    if (job.logTail.length > 500) job.logTail.shift();
    this.emit({ type: 'job.log', jobId: id, projectId: job.projectId, line, at: new Date().toISOString() });
    // 日志逐行落盘（脱敏在存储层做）；记录本身只在状态变化时写，避免写放大。
    this.track(this.appendLog(job, line));
  }

  private async appendLog(job: JobRecord, line: string): Promise<void> {
    const root = this.projectRoots.get(job.projectId) ?? (await this.options.resolveProjectRoot?.(job.projectId)) ?? null;
    if (root === null) return;
    this.projectRoots.set(job.projectId, root);
    await appendJobLog(root, job.id, line);
  }

  private track(task: Promise<void>): void {
    this.pending.add(task);
    void task.catch(() => undefined).finally(() => this.pending.delete(task));
  }

  /** 等待所有在途落盘完成（测试与优雅停机用）。 */
  async flush(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  start(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    this.emit({ type: 'job.started', jobId: id, projectId: job.projectId, at: new Date().toISOString() });
    this.track(this.persist(job));
  }

  complete(id: string, result?: unknown, exitCode?: number): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = 'succeeded';
    job.finishedAt = new Date().toISOString();
    job.exitCode = exitCode;
    job.result = result ?? job.result;
    this.emit({ type: 'job.completed', jobId: id, projectId: job.projectId, result, at: new Date().toISOString() });
    this.track(this.persist(job));
  }

  fail(id: string, error: string, exitCode?: number): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    job.error = error;
    job.exitCode = exitCode;
    this.emit({ type: 'job.failed', jobId: id, projectId: job.projectId, error, at: new Date().toISOString() });
    this.track(this.persist(job));
  }

  stateChanged(projectId: string, pathValue: string): void {
    this.emit({ type: 'state.changed', projectId, path: pathValue, at: new Date().toISOString() });
  }

  subscribe(listener: (event: JobEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: JobEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // ignore listener errors
      }
    }
  }
}
