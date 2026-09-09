import { randomUUID } from 'node:crypto';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type JobKind =
  | 'plan-generate'
  | 'plan-regenerate'
  | 'change-run'
  | 'change-verify'
  | 'evolve-verify'
  | 'eval-run';

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

export class JobManager {
  private jobs = new Map<string, JobRecord>();
  private listeners = new Set<(event: JobEvent) => void>();

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
    return job;
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
  }

  start(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    this.emit({ type: 'job.started', jobId: id, projectId: job.projectId, at: new Date().toISOString() });
  }

  complete(id: string, result?: unknown, exitCode?: number): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = 'succeeded';
    job.finishedAt = new Date().toISOString();
    job.exitCode = exitCode;
    this.emit({ type: 'job.completed', jobId: id, projectId: job.projectId, result, at: new Date().toISOString() });
  }

  fail(id: string, error: string, exitCode?: number): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    job.error = error;
    job.exitCode = exitCode;
    this.emit({ type: 'job.failed', jobId: id, projectId: job.projectId, error, at: new Date().toISOString() });
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
