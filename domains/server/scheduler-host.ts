import { getBuiltInAgentRunner } from '../../platform/agents/registry.js';
import { readProjectConfig, resolveModel, writeProjectConfig } from '../project/config.js';
import { runDaemonLoop } from '../scheduler/daemon.js';
import { readDaemonLease, isLeaseFresh } from '../scheduler/daemon-lease.js';
import type { JobManager } from './jobs.js';

/**
 * **serve 内嵌调度器**（ADR 0027）：把 daemon 循环托管在 serve 进程里，以 job 的形式跑。
 *
 * 与 CLI 的关系：两者调用同一个 `runDaemonLoop`，互斥由单实例租约保证（`daemon-lease.ts`）。
 * 差别只在"谁持有进程"与"日志去哪"：CLI 走 stdout，内嵌走任务中心（job 日志 + SSE）。
 *
 * 为什么是 job 而不是纯后台 promise：任务中心已经给了日志持久化、SSE 推送、刷新不丢，
 * 复用它是零成本的；而且 job 记录本身就是"这个调度器跑到什么时候、为什么停"的证据。
 */

export interface SchedulerStartOptions {
  projectId: string;
  projectRoot: string;
  /** 覆盖项目配置（缺省全部读 `scheduler.*`）。 */
  mode?: 'always' | 'idle' | 'schedule' | 'manual';
  agentId?: string;
  /** 页面上的「启动」= 常驻：把期望状态写进项目配置，serve 重启后会自动恢复。 */
  persistAutostart?: boolean;
  /** 并发槽位（ADR 0028：>1 目前会被拒绝并说明原因）。 */
  concurrency?: number;
  now?: Date;
}

export type SchedulerStartResult =
  | { ok: true; jobId: string }
  | { ok: false; code: 'already-running' | 'lease-held' | 'unknown-agent'; message: string };

export interface SchedulerHost {
  start: (options: SchedulerStartOptions) => Promise<SchedulerStartResult>;
  /** 正在本进程里跑的调度器（projectId）。 */
  running: () => string[];
  /** serve 启动时按项目配置恢复常驻调度器；返回被拉起的 projectId。 */
  autostartAll: (projects: Array<{ id: string; path: string }>) => Promise<string[]>;
  clearAutostart: (projectRoot: string) => Promise<void>;
}

export function createSchedulerHost(deps: { jobs: JobManager }): SchedulerHost {
  const inFlight = new Map<string, Promise<void>>();

  async function start(options: SchedulerStartOptions): Promise<SchedulerStartResult> {
    const config = await readProjectConfig(options.projectRoot);
    const mode = options.mode ?? config.scheduler?.mode ?? 'idle';
    const agentId = options.agentId ?? config.agent ?? 'opencode';
    // 先校验输入，再看"有没有在跑"：客户端参数写错时，返回"未知 agent"比"已经在跑"有用得多。
    try {
      getBuiltInAgentRunner(agentId);
    } catch {
      return { ok: false, code: 'unknown-agent', message: '未知 agent：' + agentId };
    }

    // 本进程内的重复启动：直接回绝（比让循环在租约上撞一次更快、更好解释）。
    if (inFlight.has(options.projectId)) {
      return { ok: false, code: 'already-running', message: '这个项目已经有一个内嵌调度器在跑（本进程）' };
    }

    // 别的调度器（CLI 或另一台机器）持有租约时，先给一个能解释清楚的回绝。
    const existing = await readDaemonLease(options.projectRoot);
    if (existing !== null && isLeaseFresh(existing, { now: options.now })) {
      return {
        ok: false,
        code: 'lease-held',
        message:
          '已有调度器在跑：' + existing.owner + '（mode=' + existing.mode + '，自 ' + existing.started_at + '）；' +
          '要换人就先让它 `daemon stop`，或等心跳过期',
      };
    }

    if (options.persistAutostart === true) {
      const next = { ...config, scheduler: { ...(config.scheduler ?? {}), autostart: true } };
      await writeProjectConfig(options.projectRoot, next);
    }

    const job = deps.jobs.create(options.projectId, 'daemon');
    const run = (async () => {
      deps.jobs.start(job.id);
      try {
        const result = await runDaemonLoop({
          projectRoot: options.projectRoot,
          agentId,
          mode,
          budgetMs: config.scheduler?.budgetMs,
          intervalMs: config.scheduler?.intervalMs,
          idleCpuThreshold: config.scheduler?.idleCpuThreshold,
          scheduleStartMinutes: config.scheduler?.scheduleStartMinutes,
          scheduleEndMinutes: config.scheduler?.scheduleEndMinutes,
          concurrency: options.concurrency ?? config.scheduler?.concurrency,
          model: await resolveModel(options.projectRoot, agentId),
          runner: getBuiltInAgentRunner(agentId),
          // 内嵌的日志出口就是任务中心：与 CLI 的 stdout 一一对应。
          log: (line) => deps.jobs.log(job.id, line),
        });
        deps.jobs.log(job.id, 'daemon 结束：reason=' + result.reason + ' iterations=' + result.iterations);
        deps.jobs.complete(job.id, result, result.reason === 'lease-held' ? 1 : 0);
      } catch (error) {
        deps.jobs.fail(job.id, error instanceof Error ? error.message : String(error));
      }
    })().finally(() => {
      inFlight.delete(options.projectId);
    });
    inFlight.set(options.projectId, run);

    return { ok: true, jobId: job.id };
  }

  return {
    start,
    running: () => [...inFlight.keys()],
    autostartAll: async (projects) => {
      const started: string[] = [];
      for (const project of projects) {
        try {
          const config = await readProjectConfig(project.path);
          if (config.scheduler?.autostart !== true) continue;
          const result = await start({ projectId: project.id, projectRoot: project.path });
          if (result.ok) started.push(project.id);
        } catch {
          // 单个项目恢复失败不该拖垮 serve 启动：它的状态投影与租约里都有痕迹。
        }
      }
      return started;
    },
    clearAutostart: async (projectRoot) => {
      const config = await readProjectConfig(projectRoot);
      if (config.scheduler?.autostart !== true) return;
      const next = { ...config, scheduler: { ...(config.scheduler ?? {}), autostart: false } };
      await writeProjectConfig(projectRoot, next);
    },
  };
}
