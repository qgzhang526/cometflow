import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { collectProjectStatus } from '../dashboard/collector.js';
import { runDoctor } from '../dashboard/doctor.js';
import { loadProjectContext, syncProjectContext } from '../project/context.js';
import { syncGoals } from '../goal/goal-sync.js';
import type { GoalRecord } from '../goal/types.js';
import { initializeProject } from '../project/init.js';
import {
  detectKindNeeds,
  readInitManifest,
  scaffoldCapabilities,
  scaffoldKinds,
  scaffoldProject,
  writeInitManifest,
} from '../project/scaffold.js';
import type { KindEntry, ScaffoldAnswers, StackHints } from '../project/scaffold.js';
import {
  mergeProjectConfigOverride,
  readProjectConfig,
  readProjectConfigOverride,
  resolveModel,
  validateProjectConfig,
  writeProjectConfig,
} from '../project/config.js';
import type { ProjectConfig } from '../project/config.js';
import { builtInAgentRunners, getBuiltInAgentRunner } from '../../platform/agents/registry.js';
import { resolveAgentId, runFlowRun } from '../scheduler/flow-run.js';
import { pathExists, readTextFile } from '../../platform/fs/read-file.js';
import { listSpecEntries } from '../spec/spec-index.js';
import { validateSpecs } from '../spec/spec-validate.js';
import {
  readSpecBlob,
  readSpecHistory,
  refreshSpecBaseline,
  resolveSpecVersionRef,
  specVersionsFor,
} from '../spec/spec-version.js';
import { diffSpecs } from '../spec/spec-lock.js';
import { collectSpecDrift } from '../spec/spec-drift.js';
import { analyzeSpecImpact } from '../spec/spec-impact.js';
import { verifySpecIntegrity } from '../spec/spec-verify.js';
import { collectAcceptanceChecks } from '../spec/spec-checks.js';
import { buildSpecReferenceIndex, collectSpecGraph, collectSpecReferenceTokens } from '../spec/spec-graph.js';
import { atomicWriteText } from '../../platform/fs/atomic-write.js';
import { CasConflictError, hashContent, readContentHash, writeWithCas } from '../../platform/fs/cas-write.js';
import { acquireLock, LockHeldError } from '../../platform/fs/file-lock.js';
import { readCasConflicts, recordCasConflict, resolveConcurrencyPolicy } from '../project/concurrency.js';
import { generateTaskPlan } from '../task-plan/task-plan-generate.js';
import { validateTaskPlan } from '../task-plan/task-plan-validate.js';
import { applyPlanReviewPolicy } from '../task-plan/plan-review-policy.js';
import { freezeTaskPlan } from '../task-plan/task-plan-freeze.js';
import { regenerateTaskPlan } from '../task-plan/task-plan-regenerate.js';
import {
  markTaskPlanApproved,
  markTaskPlanReviewed,
  readTaskPlan,
  writeTaskPlan,
} from '../task-plan/task-plan-store.js';
import { listChangeStates } from '../workflow/change-list.js';
import { createChangeFromTask } from '../workflow/change-create.js';
import {
  archiveChange,
  listIncompleteSpecTransactions,
  readProposedSpecs,
  rebaseChange,
  runChange,
  SpecConflictError,
  unblockChange,
  verifyChange,
} from '../workflow/change-execution.js';
import { applyChangeTransition } from '../workflow/change-transitions.js';
import { commitTransition, readChangeState } from '../workflow/change-store.js';
import { resumeChange } from '../workflow/change-resume.js';
import { readChangeJournal } from '../workflow/change-journal.js';
import { collectImplementationScope, resolveScopeAllow } from '../workflow/implementation-scope.js';
import type { ChangeEvent } from '../workflow/change-types.js';
import {
  approveEvolution,
  listEvolutionProposals,
  proposeEvolution,
  rejectEvolution,
  submitEvolution,
  verifyEvolution,
} from '../evolution/evolution-service.js';
import { listClassicStates } from '../classic/classic-store.js';
import { listInstalledSkills } from '../skill/skill-list.js';
import {
  compileBundle,
  distributeBundle,
  platformSkillsRoot,
  readBundleManifest,
  supportedBundlePlatforms,
} from '../bundle/bundle-service.js';
import { evaluateHook, type HookEvent } from '../guard/hook-guard.js';
import { nextQueuedTask } from '../scheduler/queue.js';
import type { SchedulerQueue } from '../scheduler/queue.js';
import { readBudgetUsage } from '../scheduler/budget.js';
import { readDaemonState } from '../scheduler/daemon-state.js';
import { readDaemonControl, writeDaemonControl } from '../scheduler/daemon-control.js';
import { mergeTodoView, rebuildQueue, resetQueue, retryQueueTask } from '../scheduler/daemon-todo.js';
import { runLocalEval } from '../eval/eval-service.js';
import { collectFindings } from '../gates/findings.js';
import { readMetricsGate } from '../gates/metrics-gate.js';
import { gitHookStatus } from '../gates/git-hook.js';
import { runSpecGates } from '../gates/spec-gates.js';
import { describeMetricsGate } from '../metrics/metric-gates.js';
import { collectMetrics } from '../metrics/metrics-service.js';
import { collectSpecAnchors } from '../spec/spec-anchors.js';
import { approveSpec } from '../spec/spec-approval.js';
import { importSpecsFromContent, previewSpecImport } from '../spec/spec-import.js';
import { buildSpecIndex } from '../spec/spec-project.js';
import { traceTaskPlan } from '../task-plan/task-plan-trace.js';
import {
  applyEvidenceCleanup,
  applyForceUnlock,
  applyJobCleanup,
  applyTempCleanup,
  collectMaintenancePlan,
  StaleMaintenancePreviewError,
} from '../dashboard/maintenance.js';
import { HOOK_PLATFORMS, hookStatus } from '../guard/hook-install.js';
import { rollbackEvolution } from '../evolution/evolution-service.js';
import {
  clearCurrentChange,
  readCurrentChange,
  selectCurrentChange,
} from '../workflow/current-change.js';
import type { ApiContext } from './http.js';
import { readJsonBody, requestUrl, sendError, sendJson, sendOk } from './http.js';
import { getProject, listProjects, registerProject, removeProject, touchProject } from './workspace.js';

function stringField(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** 预告值回传校验用：只接受有限数字，`null` 表示「调用方没给」。 */
function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 解析客户端带来的「我基于哪一版改的」。
 *
 * - 字符串：必须与磁盘一致，否则冲突；
 * - null：期望目标不存在（新建）；
 * - undefined：不做并发检查（旧调用方 / 内部写入）。
 */
function parseIfHash(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * 处理一次 CAS 冲突。
 *
 * 返回 true 表示「已经给出响应」（fail 模式下 409 中止）；返回 false 表示 warn 模式，
 * 调用方应继续写入（冲突已记录到 .cometflow/runtime/cas-conflicts.jsonl，doctor 会报出来）。
 */
async function handleCasConflict(
  res: import('node:http').ServerResponse,
  root: string,
  error: CasConflictError,
): Promise<boolean> {
  const policy = await resolveConcurrencyPolicy(root);
  await recordCasConflict(root, {
    path: error.conflict.path,
    expected: error.conflict.expected,
    actual: error.conflict.actual,
    mode: policy.mode,
  });
  if (policy.mode === 'fail') {
    // fail：中止，把冲突的期望/实际哈希交给界面，由人决定重读还是显式覆盖。
    sendError(res, 409, 'concurrent-modification', error.message, { conflict: error.conflict, policy });
    return true;
  }
  return false;
}

interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

async function listDirectory(targetPath: string): Promise<{ path: string; parent: string | null; entries: FsEntry[] }> {
  const isWindows = process.platform === 'win32';
  if (targetPath.trim() === '') {
    if (isWindows) {
      const candidates = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index) + ':\\');
      const checked = await Promise.all(
        candidates.map(async (drive) => {
          try {
            await fs.access(drive);
            return { name: drive, path: drive, isDirectory: true } as FsEntry;
          } catch {
            return null;
          }
        }),
      );
      return { path: '', parent: null, entries: checked.filter((entry): entry is FsEntry => entry !== null) };
    }
    return { path: '', parent: null, entries: [{ name: '/', path: '/', isDirectory: true }] };
  }

  const absolute = path.resolve(targetPath);
  const dirents = await fs.readdir(absolute, { withFileTypes: true });
  const entries = dirents
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, path: path.join(absolute, entry.name), isDirectory: true }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const parent = path.dirname(absolute);
  return { path: absolute, parent: parent === absolute ? null : parent, entries };
}

async function readGoalFiles(projectRoot: string): Promise<GoalRecord[]> {
  const dir = path.join(projectRoot, '.cometflow', 'goals');
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const goals: GoalRecord[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) continue;
    try {
      goals.push(parse(await fs.readFile(path.join(dir, entry), 'utf8')) as GoalRecord);
    } catch {
      // ignore unreadable goal files
    }
  }
  return goals;
}

async function listPlanSummaries(projectRoot: string): Promise<Array<{ goal: string; status: string; tasks: number }>> {
  const dir = path.join(projectRoot, '.cometflow', 'plans');
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const summaries: Array<{ goal: string; status: string; tasks: number }> = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.task-plan.yaml')) continue;
    try {
      const plan = parse(await fs.readFile(path.join(dir, entry), 'utf8')) as { goal: string; status: string; tasks: unknown[] };
      summaries.push({ goal: plan.goal, status: plan.status, tasks: (plan.tasks ?? []).length });
    } catch {
      // ignore unreadable plan files
    }
  }
  return summaries;
}

function resolveSpecPath(projectRoot: string, relativePath: string): string {
  const specsDir = path.join(projectRoot, 'specs');
  const absolute = path.resolve(projectRoot, relativePath);
  const within = absolute === specsDir || absolute.startsWith(specsDir + path.sep);
  if (!within) throw new Error('invalid spec path: ' + relativePath);
  return absolute;
}

/**
 * 解码并校验一个「会参与文件路径拼接」的 URL 片段。
 *
 * 客户端用 encodeURIComponent 传名字，所以服务端必须解码后再用（否则含空格的名字会去找
 * 一个带 %20 的目录）；解码后含分隔符或 `.` / `..` 一律拒绝，避免把读写带出项目目录。
 */
function safePathSegment(segment: string): string | null {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // 非法的百分号编码：保持原样交给下面的校验（它同样不会通过）。
  }
  if (decoded === '' || decoded === '.' || decoded === '..' || /[\\/]/u.test(decoded)) return null;
  return decoded;
}

async function describeProject(projectPath: string): Promise<Record<string, unknown>> {
  try {
    const status = await collectProjectStatus(projectPath);
    return { status };
  } catch (error) {
    return { status: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function handleApiRequest(ctx: ApiContext): Promise<boolean> {
  const { req, res, workspaceRoot, jobs, tickets } = ctx;
  const url = requestUrl(req);
  const method = req.method ?? 'GET';
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) return false;

  try {
    // Workspace endpoints
    if (pathname === '/api/workspace' && method === 'GET') {
      const projects = await listProjects(workspaceRoot);
      const enriched = await Promise.all(
        projects.map(async (project) => ({ ...project, ...(await describeProject(project.path)) })),
      );
      sendOk(res, { projects: enriched });
      return true;
    }

    if (pathname === '/api/projects' && method === 'POST') {
      const body = await readJsonBody(req);
      const name = stringField(body.name);
      const projectPath = stringField(body.path);
      if (projectPath === '') {
        sendError(res, 400, 'missing-path', 'path is required');
        return true;
      }
      await initializeProject(projectPath);
      const stack: StackHints = {
        frontend: stringField(body.frontend),
        backend: stringField(body.backend),
        database: stringField(body.database),
      };
      const answers = (body.answers ?? {}) as ScaffoldAnswers;
      const scaffold = await scaffoldProject(projectPath, stack, answers);
      const project = await registerProject(workspaceRoot, name, projectPath);
      sendOk(res, { project, scaffold });
      return true;
    }

    if (pathname === '/api/projects/import' && method === 'POST') {
      const body = await readJsonBody(req);
      const projectPath = stringField(body.path);
      if (projectPath === '') {
        sendError(res, 400, 'missing-path', 'path is required');
        return true;
      }
      const mission = path.join(projectPath, 'COMETFLOW.md');
      try {
        await fs.access(mission);
      } catch {
        sendError(res, 400, 'not-a-project', 'COMETFLOW.md not found at path');
        return true;
      }
      const project = await registerProject(workspaceRoot, path.basename(projectPath), projectPath);
      sendOk(res, { project });
      return true;
    }

    if (pathname === '/api/jobs' && method === 'GET') {
      // 首次访问时把各项目落盘的任务读回内存：进程重启后任务中心仍能看到历史。
      for (const project of await listProjects(workspaceRoot)) await jobs.hydrate(project.id, project.path);
      sendOk(res, { jobs: jobs.list() });
      return true;
    }
    if (pathname === '/api/session/ticket' && method === 'POST') {
      // 已经通过 Authorization 校验：这里签发一次性的 SSE 票据。
      sendOk(res, { ticket: tickets.issue(), expiresInMs: 30_000 });
      return true;
    }
    if (pathname === '/api/jobs' && method === 'DELETE') {
      for (const project of await listProjects(workspaceRoot)) await jobs.hydrate(project.id, project.path);
      sendOk(res, { removed: await jobs.clearFinished() });
      return true;
    }

    const jobMatch = /^\/api\/jobs\/([^/]+)$/u.exec(pathname);
    if (jobMatch && method === 'GET') {
      let job = jobs.get(jobMatch[1]);
      if (!job) {
        for (const project of await listProjects(workspaceRoot)) await jobs.hydrate(project.id, project.path);
        job = jobs.get(jobMatch[1]);
      }
      if (!job) {
        sendError(res, 404, 'unknown-job', 'job not found');
      } else {
        sendOk(res, { job });
      }
      return true;
    }

    if (pathname === '/api/fs/list' && method === 'GET') {
      sendOk(res, await listDirectory(url.searchParams.get('path') ?? ''));
      return true;
    }

    // Project endpoints
    const projectMatch = /^\/api\/projects\/([^/]+)(?:\/(.*))?$/u.exec(pathname);
    if (!projectMatch) {
      sendError(res, 404, 'unknown-route', pathname);
      return true;
    }

    const projectId = projectMatch[1];
    const project = await getProject(workspaceRoot, projectId);
    if (!project) {
      sendError(res, 404, 'unknown-project', 'project not found');
      return true;
    }
    await touchProject(workspaceRoot, projectId);
    const root = project.path;

    const rest = (projectMatch[2] ?? '').split('/').filter((segment) => segment !== '');
    let segments = rest;

    // ---- project detail ----
    if (segments.length === 0 && method === 'GET') {
      sendOk(res, { project, ...(await describeProject(root)) });
      return true;
    }
    if (segments.length === 0 && method === 'DELETE') {
      await removeProject(workspaceRoot, projectId);
      sendOk(res, { removed: true });
      return true;
    }

    // ---- project/status, project/doctor ----
    if (segments[0] === 'project' && segments[1] === 'status' && method === 'GET') {
      sendOk(res, await collectProjectStatus(root));
      return true;
    }
    if (segments[0] === 'project' && segments[1] === 'doctor' && method === 'GET') {
      sendOk(res, await runDoctor(root));
      return true;
    }

    // ---- 维护动作（V1-4）：预告 → 确认 → 执行，回传值不匹配就拒绝且不删任何东西 ----
    if (segments[0] === 'project' && segments[1] === 'doctor' && segments[2] === 'clean-temp' && method === 'POST') {
      const body = await readJsonBody(req);
      const expectedFiles = numberField(body.expectedFiles);
      if (expectedFiles === null) {
        sendError(res, 400, 'missing-expected', 'expectedFiles 必填：先读 GET /maintenance 的预告值再回传');
        return true;
      }
      try {
        const cleaned = await applyTempCleanup(root, expectedFiles);
        jobs.stateChanged(projectId, '/api/project/doctor');
        sendOk(res, { cleaned, report: await runDoctor(root) });
      } catch (error) {
        if (error instanceof StaleMaintenancePreviewError) {
          sendError(res, 409, 'stale-maintenance-preview', error.message, {
            expected: error.expected,
            actual: error.actual,
          });
          return true;
        }
        throw error;
      }
      return true;
    }
    if (segments[0] === 'project' && segments[1] === 'doctor' && segments[2] === 'clean-jobs' && method === 'POST') {
      const body = await readJsonBody(req);
      const expectedCandidates = numberField(body.expectedCandidates);
      if (expectedCandidates === null) {
        sendError(res, 400, 'missing-expected', 'expectedCandidates 必填：先读 GET /maintenance 的预告值再回传');
        return true;
      }
      try {
        const cleaned = await applyJobCleanup(root, expectedCandidates);
        jobs.stateChanged(projectId, '/api/project/doctor');
        jobs.stateChanged(projectId, '/api/jobs');
        sendOk(res, { cleaned, report: await runDoctor(root) });
      } catch (error) {
        if (error instanceof StaleMaintenancePreviewError) {
          sendError(res, 409, 'stale-maintenance-preview', error.message, {
            expected: error.expected,
            actual: error.actual,
          });
          return true;
        }
        throw error;
      }
      return true;
    }
    if (segments[0] === 'project' && segments[1] === 'doctor' && segments[2] === 'force-unlock' && method === 'POST') {
      const body = await readJsonBody(req);
      const expectedHolder = stringField(body.expectedHolder).trim();
      if (expectedHolder === '') {
        sendError(res, 400, 'missing-expected', 'expectedHolder 必填：先读 GET /maintenance 的 lock.holder 再回传');
        return true;
      }
      try {
        const cleaned = await applyForceUnlock(root, expectedHolder);
        jobs.stateChanged(projectId, '/api/project/doctor');
        sendOk(res, { cleaned, report: await runDoctor(root) });
      } catch (error) {
        if (error instanceof StaleMaintenancePreviewError) {
          sendError(res, 409, 'stale-maintenance-preview', error.message, {
            expected: error.expected,
            actual: error.actual,
          });
          return true;
        }
        throw error;
      }
      return true;
    }
    // `change gc --apply` 的界面入口：与 doctor 三个动作同一套「预告 → 确认 → 执行」护栏。
    if (segments[0] === 'project' && segments[1] === 'evidence' && segments[2] === 'clean' && method === 'POST') {
      const body = await readJsonBody(req);
      const expectedReclaimableBytes = numberField(body.expectedReclaimableBytes);
      if (expectedReclaimableBytes === null) {
        sendError(
          res,
          400,
          'missing-expected',
          'expectedReclaimableBytes 必填：先读 GET /maintenance 的 evidence.reclaimableBytes 再回传',
        );
        return true;
      }
      try {
        const cleaned = await applyEvidenceCleanup(root, expectedReclaimableBytes);
        jobs.stateChanged(projectId, '/api/project/doctor');
        // 回带执行后的新预告：卡片据此刷新，不用再打一次 GET。
        sendOk(res, { cleaned, plan: await collectMaintenancePlan(root) });
      } catch (error) {
        if (error instanceof StaleMaintenancePreviewError) {
          sendError(res, 409, 'stale-maintenance-preview', error.message, {
            expected: error.expected,
            actual: error.actual,
          });
          return true;
        }
        throw error;
      }
      return true;
    }

    // ---- mission.md ----
    if (segments[0] === 'mission.md') {
      const missionPath = path.join(root, 'COMETFLOW.md');
      if (method === 'GET') {
        sendOk(res, { content: await readTextFile(missionPath) });
        return true;
      }
      if (method === 'PUT') {
        const body = await readJsonBody(req);
        await fs.writeFile(missionPath, stringField(body.content));
        jobs.stateChanged(projectId, '/api/mission.md');
        sendOk(res, { written: missionPath });
        return true;
      }
    }

    // ---- context/goals ----
    if (segments[0] === 'context' && segments[1] === 'sync' && method === 'POST') {
      const result = await syncProjectContext(root);
      jobs.stateChanged(projectId, '/api/context');
      sendOk(res, result);
      return true;
    }
    if (segments[0] === 'goals' && segments[1] === 'sync' && method === 'POST') {
      const result = await syncGoals(root);
      jobs.stateChanged(projectId, '/api/goals');
      sendOk(res, result);
      return true;
    }
    if (segments[0] === 'goals' && segments.length === 1 && method === 'GET') {
      sendOk(res, { goals: await readGoalFiles(root) });
      return true;
    }

    // ---- config / agents ----
    // 保留：项目层覆盖集合（CLI 与脚本用）。界面不需要它——`GET /config` 已经同时返回
    // 合并视图与 `projectOverride`，设置页用的是后者（见审计 §6 与 V4-5 的决策记录）。
    if (segments[0] === 'config' && segments[1] === 'project' && method === 'GET') {
      sendOk(res, { override: await readProjectConfigOverride(root) });
      return true;
    }
    if (segments[0] === 'config') {
      if (method === 'GET') {
        // 合并视图（项目覆盖全局）用于渲染；同时给出项目文件本身的覆盖集合，
        // 界面据此区分「这个值是项目写的」还是「继承全局默认」。
        const config = await readProjectConfig(root);
        const projectOverride = await readProjectConfigOverride(root);
        // 并发策略一并给出：设置页要显示「当前模式 / 距到期天数 / 累计冲突」，而不只是配置原文。
        const concurrencyPolicy = await resolveConcurrencyPolicy(root);
        const concurrencyConflicts = await readCasConflicts(root);
        sendOk(res, {
          config,
          projectOverride,
          concurrencyPolicy,
          concurrencyConflicts: concurrencyConflicts.length,
        });
        return true;
      }
      if (method === 'PUT') {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        // 增量合并写：整个 body 覆盖项目文件会让只渲染部分字段的界面顺手删掉其余配置
        // （verification / scope / agents 等），也会把全局默认值固化成项目值。
        const existing = await readProjectConfigOverride(root);
        const config = mergeProjectConfigOverride(existing, body as Partial<ProjectConfig>);
        const errors = validateProjectConfig(config);
        if (errors.length > 0) {
          sendError(res, 400, 'invalid-config', errors.join('; '));
          return true;
        }
        const filePath = await writeProjectConfig(root, config);
        jobs.stateChanged(projectId, '/api/config');
        sendOk(res, { written: filePath, config, writtenKeys: Object.keys(body).sort() });
        return true;
      }
    }
    if (segments[0] === 'agents' && method === 'GET') {
      const agents = await Promise.all(
        builtInAgentRunners().map(async (runner) => ({
          id: runner.id,
          name: runner.name,
          available: await runner.check(),
        })),
      );
      sendOk(res, { agents });
      return true;
    }

    // ---- 只读投影：把「已经算出来、但只能敲命令」的结论搬到界面（V1-1 / V1-2）----
    if (segments[0] === 'findings' && segments.length === 1 && method === 'GET') {
      // 与 `cometflow gate check . --findings` 同源：verify + doctor 两源、已去重、已排序。
      sendOk(res, { findings: await collectFindings(root) });
      return true;
    }
    if (segments[0] === 'metrics' && segments.length === 1 && method === 'GET') {
      const report = await collectMetrics(root);
      const gate = await readMetricsGate(root);
      // 阈值只影响门禁结论、不参与指标本身。lines 始终给出（未配置时是内置方向表），
      // 否则界面上就会出现一条看不见的约束。与 `metrics --json` 的 gates 字段同形。
      sendOk(res, {
        report,
        gates: {
          thresholds: gate.thresholds,
          errors: gate.errors,
          lines: describeMetricsGate(gate.thresholds),
        },
      });
      return true;
    }
    if (segments[0] === 'maintenance' && segments.length === 1 && method === 'GET') {
      // 只读预告：三个维护动作各自「将要删什么」。界面据此渲染确认弹窗。
      sendOk(res, await collectMaintenancePlan(root));
      return true;
    }
    if (segments[0] === 'gate' && segments.length === 1 && method === 'GET') {
      // 「现在能不能提交」= 判定结果（与 `gate check` 同源，只读）；「装没装」= git hook 状态。
      // 两者放同一个响应里，是因为界面上它们是同一个问题的两半：结论 + 这个结论会不会被自动执行。
      const [check, install] = await Promise.all([runSpecGates(root), gitHookStatus(root)]);
      sendOk(res, { check, install });
      return true;
    }
    if (segments[0] === 'spec' && segments[1] === 'anchors' && method === 'GET') {
      // 锚点平铺：全部锚点（不只带验收的那些）+ kind + 绑定任务 + 可执行验收数。
      sendOk(res, await collectSpecAnchors(root));
      return true;
    }

    // ---- init-manifest / spec scaffold ----
    if (segments[0] === 'init-manifest' && method === 'GET') {
      const manifest = await readInitManifest(root);
      sendOk(res, manifest ?? { schema: 'cometflow.init-manifest.v1', kinds: detectKindNeeds({}, {}) });
      return true;
    }
    if (segments[0] === 'spec' && segments[1] === 'scaffold' && method === 'POST') {
      const body = await readJsonBody(req);
      const answers = (body.answers ?? {}) as ScaffoldAnswers;
      // capability 骨架：root kind 由项目类型推导，capability 只能由调用方点名
      // （goal 的 scope 或外部标准），所以这里必须显式传入，不能自动推断。
      const capabilities = Array.isArray(body.capabilities)
        ? body.capabilities.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
        : [];
      let result: { kinds: Record<string, KindEntry>; created: string[]; skipped: string[]; manifestPath?: string };
      if (body.kinds) {
        const kinds = body.kinds as Record<string, KindEntry>;
        const { created, skipped } = await scaffoldKinds(root, kinds, answers);
        const manifestPath = await writeInitManifest(root, kinds);
        result = { kinds, created, skipped, manifestPath };
      } else {
        const stack: StackHints = {
          frontend: stringField(body.frontend),
          backend: stringField(body.backend),
          database: stringField(body.database),
        };
        // 调用方没给技术栈时退回项目上下文里的投影（与 CLI `spec scaffold` 同源）。
        // 不兜底的话空串会被 detectKindNeeds 判成 absent，点一次按钮就把
        // models / pages / constraints 写成「本项目不需要」——那是比脚手架没生效更坏的结果。
        if (stack.frontend === '' && stack.backend === '' && stack.database === '') {
          const context = await loadProjectContext(root);
          if (context !== null) {
            stack.frontend = context.tech_stack.frontend;
            stack.backend = context.tech_stack.backend;
            stack.database = context.tech_stack.database;
          }
        }
        result = await scaffoldProject(root, stack, answers);
      }
      const capabilityResult = capabilities.length > 0 ? await scaffoldCapabilities(root, capabilities) : null;
      jobs.stateChanged(projectId, '/api/specs');
      sendOk(res, { ...result, capabilities: capabilityResult });
      return true;
    }

    // ---- specs ----

    // ---- spec kernel: 验收覆盖 / 一致性门禁 / 版本回放 / 影响分析 ----
    // 这些投影此前只有 CLI 能看到，是「spec 即产物」在前端缺失的部分。
    if (segments[0] === 'spec' && method === 'GET' && segments[1] === 'checks') {
      sendOk(res, await collectAcceptanceChecks(root));
      return true;
    }
    if (segments[0] === 'spec' && method === 'GET' && segments[1] === 'graph') {
      sendOk(res, await collectSpecGraph(root));
      return true;
    }
    if (segments[0] === 'spec' && method === 'POST' && segments[1] === 'references') {
      // 编辑器高亮：对**草稿正文**求 token，因此不落盘、不产生版本。
      const body = await readJsonBody(req);
      const index = await buildSpecReferenceIndex(root);
      sendOk(res, { tokens: collectSpecReferenceTokens(index, stringField(body.content)) });
      return true;
    }
    if (segments[0] === 'spec' && method === 'GET' && segments[1] === 'proposals') {
      // 「先把改动存成提案」：提案只有一种形态——change 目录下的 specs/ 副本（ADR 0020）。
      const target = stringField(url.searchParams.get('path'));
      const proposals: Array<{ change: string; path: string; content?: string }> = [];
      for (const change of await listChangeStates(root)) {
        if (change.archived) continue;
        const proposed = await readProposedSpecs(root, change.name);
        for (const specPath of Object.keys(proposed)) {
          if (target !== '' && specPath !== target) continue;
          // 指定 path 时顺带回正文（编辑器要拿它跟当前草稿对比）；不指定时只回索引。
          proposals.push(
            target === ''
              ? { change: change.name, path: specPath }
              : { change: change.name, path: specPath, content: proposed[specPath] },
          );
        }
      }
      sendOk(res, { proposals });
      return true;
    }
    if (segments[0] === 'spec' && method === 'POST' && segments[1] === 'proposal') {
      const body = await readJsonBody(req);
      const changeName = stringField(body.change);
      const safeChange = safePathSegment(changeName);
      if (safeChange === null) {
        sendError(res, 400, 'invalid-change-name', 'change name must not contain path separators');
        return true;
      }
      const relativePath = stringField(body.path);
      if (relativePath === '' || !relativePath.startsWith('specs/') || !relativePath.endsWith('.md')) {
        sendError(res, 400, 'invalid-spec-path', 'proposal path must be a .md path under specs/');
        return true;
      }
      try {
        // 只做「必须落在 specs/ 内」的校验；提案写入的是 change 目录下的副本。
        resolveSpecPath(root, relativePath);
      } catch {
        sendError(res, 400, 'invalid-spec-path', 'proposal path must stay under specs/');
        return true;
      }
      const state = await readChangeState(root, safeChange).catch(() => null);
      if (state === null) {
        sendError(res, 404, 'unknown-change', 'change not found: ' + safeChange);
        return true;
      }
      if (state.archived || state.phase !== 'shape') {
        sendError(
          res,
          409,
          'change-not-in-shape',
          'change ' + safeChange + ' 处于 ' + state.phase + ' 阶段；提案 spec 只能在 shape 阶段提出',
        );
        return true;
      }
      const proposedPath = path.join(root, 'changes', safeChange, 'specs', relativePath.replace(/^specs\//u, ''));
      await atomicWriteText(proposedPath, stringField(body.content));
      jobs.stateChanged(projectId, '/api/changes/' + safeChange);
      sendOk(res, { change: safeChange, path: relativePath, written: proposedPath });
      return true;
    }
    if (segments[0] === 'spec' && method === 'GET' && segments[1] === 'verify') {
      sendOk(res, await verifySpecIntegrity(root));
      return true;
    }
    if (segments[0] === 'spec' && method === 'GET' && segments[1] === 'diff') {
      sendOk(res, await diffSpecs(root));
      return true;
    }
    if (segments[0] === 'spec' && method === 'GET' && segments[1] === 'drift') {
      sendOk(res, await collectSpecDrift(root));
      return true;
    }
    if (segments[0] === 'spec' && method === 'GET' && segments[1] === 'impact') {
      // 带 change 时算的是「归档这个 change 之后谁会漂移」，不修改工作区。
      const changeName = stringField(url.searchParams.get('change'));
      const overlay = changeName === '' ? undefined : await readProposedSpecs(root, changeName);
      sendOk(res, await analyzeSpecImpact(root, { overlay }));
      return true;
    }
    if (segments[0] === 'spec' && method === 'GET' && segments[1] === 'versions') {
      const history = await readSpecHistory(root);
      const specPath = stringField(url.searchParams.get('path'));
      sendOk(res, {
        schema: history.schema,
        specs: specPath === '' ? history.specs : { [specPath]: specVersionsFor(history, specPath) },
      });
      return true;
    }
    if (segments[0] === 'spec' && method === 'GET' && segments[1] === 'version') {
      const ref = stringField(url.searchParams.get('ref'));
      try {
        const resolved = await resolveSpecVersionRef(root, ref);
        const content = await readSpecBlob(root, resolved.record.hash);
        if (content === null) {
          sendError(res, 404, 'missing-version-blob', 'version blob is missing: ' + resolved.record.hash);
          return true;
        }
        sendOk(res, { path: resolved.path, record: resolved.record, content });
      } catch (error) {
        sendError(res, 404, 'unknown-spec-version', error instanceof Error ? error.message : String(error));
      }
      return true;
    }
    if (segments[0] === 'spec' && method === 'POST' && segments[1] === 'lock') {
      const result = await refreshSpecBaseline(root, { note: 'web lock' });
      jobs.stateChanged(projectId, '/api/specs');
      sendOk(res, result);
      return true;
    }
    if (segments[0] === 'spec' && method === 'POST' && segments[1] === 'restore') {
      const body = await readJsonBody(req);
      const ref = stringField(body.ref);
      let resolved: Awaited<ReturnType<typeof resolveSpecVersionRef>>;
      try {
        resolved = await resolveSpecVersionRef(root, ref);
      } catch (error) {
        sendError(res, 404, 'unknown-spec-version', error instanceof Error ? error.message : String(error));
        return true;
      }
      const content = await readSpecBlob(root, resolved.record.hash);
      if (content === null) {
        sendError(res, 404, 'missing-version-blob', 'version blob is missing: ' + resolved.record.hash);
        return true;
      }
      // 覆盖 specs/ 之前先给当前内容记账：未登记的手工改动不能因为一次 restore 就消失。
      // 恢复是多文件事务（正文 + 版本仓 + lock）：整段持锁，避免与归档/freeze 交错。
      const restoreLock = await acquireLock(root, 'spec restore ' + resolved.path);
      try {
        await refreshSpecBaseline(root, { note: 'pre-restore snapshot' });
      // 恢复也做并发检查：读到写之间若 canonical spec 又变了，fail 模式下必须先让人决定。
      const restoreTarget = path.join(root, resolved.path);
      try {
        await writeWithCas(restoreTarget, content, { expectedHash: await readContentHash(restoreTarget) });
      } catch (error) {
        if (!(error instanceof CasConflictError)) throw error;
        if (await handleCasConflict(res, root, error)) return true;
        await atomicWriteText(restoreTarget, content);
      }
      } finally {
        await restoreLock.release();
      }
      const after = await refreshSpecBaseline(root, { note: 'restore v' + resolved.record.spec_version });
      const restored = after.recorded.find((entry) => entry.path === resolved.path) ?? null;
      jobs.stateChanged(projectId, '/api/specs');
      sendOk(res, {
        path: resolved.path,
        restoredFrom: resolved.record.spec_version,
        spec_version: restored?.spec_version ?? null,
        hash: restored?.hash ?? null,
      });
      return true;
    }

    if (segments[0] === 'spec' && segments[1] === 'validate' && method === 'POST') {
      sendOk(res, await validateSpecs(root));
      return true;
    }
    // 表格导入：`dryRun !== false` 时只回预览（解析 + 会写哪些能力 + 哪些会被跳过），不落盘。
    if (segments[0] === 'spec' && segments[1] === 'import' && method === 'POST') {
      const body = await readJsonBody(req);
      const content = stringField(body.content);
      if (content.trim() === '') {
        sendError(res, 400, 'empty-content', 'content 必填：粘贴 CSV / TSV / Markdown 表格内容');
        return true;
      }
      const source = stringField(body.source, 'web-paste') || 'web-paste';
      if (body.dryRun !== false) {
        sendOk(res, { preview: await previewSpecImport(root, source, content) });
        return true;
      }
      const result = await importSpecsFromContent(root, source, content, {
        force: body.force === true,
        module: stringField(body.module) || undefined,
      });
      jobs.stateChanged(projectId, '/api/specs');
      sendOk(res, { result });
      return true;
    }
    // 定稿（G1）：草案 → approved。与 CLI `spec approve` 共用同一份领域实现，
    // 改完立刻刷新版本与 lock（否则 spec verify 会以 stale-spec-lock 报警）。
    if (segments[0] === 'spec' && segments[1] === 'approve' && method === 'POST') {
      const body = await readJsonBody(req);
      const specPath = stringField(body.path);
      if (specPath === '') {
        sendError(res, 400, 'missing-path', 'path 必填：specs/<capability>/spec.md');
        return true;
      }
      try {
        const result = await approveSpec(root, specPath);
        jobs.stateChanged(projectId, '/api/specs');
        sendOk(res, result);
      } catch (error) {
        sendError(res, 400, 'invalid-spec-path', error instanceof Error ? error.message : String(error));
      }
      return true;
    }
    // 保留：spec 投影（等价 `cometflow spec index` 的产物视图），CLI 与脚本用。
    // 界面走 `/spec/graph`（带解析状态与边）与 `/spec/anchors`，不再消费这一份。
    if (segments[0] === 'spec-index' && method === 'GET') {
      sendOk(res, await buildSpecIndex(root));
      return true;
    }
    if (segments[0] === 'specs' && segments.length === 1 && method === 'GET') {
      const entries = await listSpecEntries(root);
      const manifest = await readInitManifest(root);
      sendOk(res, { entries, manifest });
      return true;
    }
    if (segments[0] === 'specs' && segments.length === 1 && method === 'POST') {
      const body = await readJsonBody(req);
      const relativePath = stringField(body.path);
      const content = stringField(body.content);
      if (relativePath === '' || !relativePath.endsWith('.md')) {
        sendError(res, 400, 'invalid-spec-path', 'spec path must be a non-empty .md path under specs/');
        return true;
      }
      let absolute: string;
      try {
        absolute = resolveSpecPath(root, relativePath);
      } catch {
        sendError(res, 400, 'invalid-spec-path', 'spec path must stay under specs/');
        return true;
      }
      // 新建也支持并发检查：客户端带 ifHash=null 表示「这个文件应当还不存在」。
      try {
        await writeWithCas(absolute, content, { expectedHash: parseIfHash(body.ifHash) });
      } catch (error) {
        if (!(error instanceof CasConflictError)) throw error;
        if (await handleCasConflict(res, root, error)) return true;
        await atomicWriteText(absolute, content);
      }
      // 通过 Web 编辑 spec 同样是一次 canonical spec 变更：立即登记版本并刷新 lock，
      // 否则 spec verify 会立刻报 stale-spec-lock，活跃 change 的 CAS 基线也会失真。
      await refreshSpecBaseline(root, { note: 'web edit' });
      jobs.stateChanged(projectId, '/api/specs');
      sendOk(res, { path: relativePath, created: absolute, hash: hashContent(content) });
      return true;
    }
    if (segments[0] === 'specs' && segments[1] === 'content') {
      const relativePath = stringField(url.searchParams.get('path'));
      const absolute = resolveSpecPath(root, relativePath);
      if (method === 'GET') {
        const content = await readTextFile(absolute);
        // 连哈希一起回：客户端保存时把它作为 ifHash，服务端据此判断「我改的这版还是不是最新」。
        sendOk(res, { path: relativePath, content, hash: hashContent(content) });
        return true;
      }
      if (method === 'PUT') {
        const body = await readJsonBody(req);
        const content = stringField(body.content);
        const ifHash = parseIfHash(body.ifHash);
        try {
          await writeWithCas(absolute, content, { expectedHash: ifHash });
          await refreshSpecBaseline(root, { note: 'web edit' });
          jobs.stateChanged(projectId, '/api/specs');
          sendOk(res, { written: absolute, hash: hashContent(content) });
          return true;
        } catch (error) {
          if (error instanceof CasConflictError) {
            // fail：409 中止（冲突细节交给界面）；warn：记录后照旧写入。
            if (await handleCasConflict(res, root, error)) return true;
            await atomicWriteText(absolute, content);
            await refreshSpecBaseline(root, { note: 'web edit (concurrent-warn)' });
            jobs.stateChanged(projectId, '/api/specs');
            sendOk(res, {
              written: absolute,
              hash: hashContent(content),
              warning: {
                code: 'concurrent-modification',
                conflict: error.conflict,
                policy: await resolveConcurrencyPolicy(root),
              },
            });
            return true;
          }
          throw error;
        }
      }
    }

    // ---- plans ----
    if (segments[0] === 'plans' && segments.length === 1 && method === 'GET') {
      sendOk(res, { plans: await listPlanSummaries(root) });
      return true;
    }
    if (segments[0] === 'plans' && segments[1] === 'generate' && method === 'POST') {
      const body = await readJsonBody(req);
      // 拆解审核策略（ADR 0003）与 CLI `plan generate` 共用同一份实现。
      const review = await applyPlanReviewPolicy(root, await generateTaskPlan(root, stringField(body.goal)));
      const filePath = await writeTaskPlan(root, review.plan);
      jobs.stateChanged(projectId, '/api/plans');
      jobs.stateChanged(projectId, '/api/plans/' + stringField(body.goal));
      sendOk(res, { plan: review.plan, written: filePath, review });
      return true;
    }
    if (segments[0] === 'plans' && segments[1] === 'regenerate' && method === 'POST') {
      const body = await readJsonBody(req);
      const goal = stringField(body.goal);
      const previous = await readTaskPlan(root, goal);
      const regenerated = await regenerateTaskPlan(root, goal, previous, {
        preserveApproved: body.preserveApproved === true,
      });
      const review = await applyPlanReviewPolicy(root, regenerated);
      const filePath = await writeTaskPlan(root, review.plan);
      jobs.stateChanged(projectId, '/api/plans');
      sendOk(res, { plan: review.plan, written: filePath, review });
      return true;
    }
    if (segments[0] === 'plans' && segments.length === 2 && method === 'GET') {
      const goal = segments[1];
      try {
        sendOk(res, await readTaskPlan(root, goal));
      } catch {
        sendError(res, 404, 'unknown-plan', 'plan not found for ' + goal);
      }
      return true;
    }
    // 任务 → spec 追溯：与 `plan trace` 同源的文本投影 + 同一份数据的结构化视图（界面用后者）。
    if (segments[0] === 'plans' && segments.length === 3 && segments[2] === 'trace' && method === 'GET') {
      const goal = segments[1];
      try {
        const plan = await readTaskPlan(root, goal);
        sendOk(res, {
          goal: plan.goal,
          status: plan.status,
          lines: traceTaskPlan(plan),
          tasks: plan.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            capability: task.capability,
            spec_ref: task.spec_ref ?? null,
            spec_anchor: task.spec_anchor ?? null,
            spec_version: task.spec_version ?? null,
            acceptance_ids: task.acceptance_ids,
            status: task.status,
          })),
        });
      } catch {
        sendError(res, 404, 'unknown-plan', 'plan not found for ' + goal);
      }
      return true;
    }
    if (segments[0] === 'plans' && segments.length === 3 && method === 'POST') {
      const goal = segments[1];
      const action = segments[2];
      const plan = await readTaskPlan(root, goal);
      if (action === 'validate') {
        sendOk(res, await validateTaskPlan(root, plan));
        return true;
      }
      if (action === 'review') {
        const next = markTaskPlanReviewed(plan);
        const filePath = await writeTaskPlan(root, next);
        jobs.stateChanged(projectId, '/api/plans/' + goal);
        sendOk(res, { plan: next, written: filePath });
        return true;
      }
      if (action === 'approve') {
        const next = markTaskPlanApproved(plan);
        const filePath = await writeTaskPlan(root, next);
        jobs.stateChanged(projectId, '/api/plans/' + goal);
        sendOk(res, { plan: next, written: filePath });
        return true;
      }
      if (action === 'freeze') {
        try {
          const frozen = await freezeTaskPlan(root, plan);
          const filePath = await writeTaskPlan(root, frozen);
          jobs.stateChanged(projectId, '/api/plans/' + goal);
          sendOk(res, { plan: frozen, written: filePath });
          return true;
        } catch (error) {
          if (error instanceof LockHeldError) {
            sendError(res, 409, 'lock-held', error.message, { lock: error.record });
            return true;
          }
          throw error;
        }
      }
      sendError(res, 404, 'unknown-plan-action', action);
      return true;
    }

    // ---- changes ----
    // change 名字会参与 `changes/<name>/...` 的路径拼接，先挡住路径分隔符，
    // 避免 `..%2f` 之类的名字把读写引到项目外。
    if (segments[0] === 'changes' && segments.length >= 2) {
      const decoded = safePathSegment(segments[1]);
      if (decoded === null) {
        sendError(res, 400, 'invalid-change-name', 'change name must not contain path separators');
        return true;
      }
      // 用解码后的名字参与后续的路径拼接与状态读取（客户端用 encodeURIComponent 传名字）。
      segments = [segments[0], decoded, ...segments.slice(2)];
    }

    // ---- current-change 指针（ADR 0018 / V1-3）----
    // 路径刻意**不**取 `/changes/current`：那会把一个真叫 `current` 的 change 永久遮蔽掉
    // （change 名本可以是任意不含分隔符的字符串）。所以用项目级路径 `/current-change`。
    if (segments[0] === 'current-change' && method === 'GET') {
      const pointer = await readCurrentChange(root);
      // 指针存在 ≠ 指针可用：指向已归档/已删除的 change 时，hook 会以 stale-current-change fail closed。
      const change = pointer === null ? null : await readChangeState(root, pointer.change).catch(() => null);
      sendOk(res, {
        pointer,
        change,
        resolved: pointer !== null && change !== null && !change.archived,
      });
      return true;
    }
    if (segments[0] === 'current-change' && method === 'POST') {
      const body = await readJsonBody(req);
      // `{ name: null }` 表示清除指针；缺字段与 null 等价，避免前端还要区分两种「没有」。
      if (body.name === null || body.name === undefined) {
        const pointer = await readCurrentChange(root);
        if (pointer === null) {
          sendOk(res, { cleared: false, removed: null, pointer: null });
          return true;
        }
        // force：清除动作本身就是「我要清掉现在这个」，不需要再比对名字。
        const cleared = await clearCurrentChange(root, pointer.change, { force: true });
        jobs.stateChanged(projectId, '/api/current-change');
        sendOk(res, { cleared, removed: pointer, pointer: null });
        return true;
      }
      const name = stringField(body.name).trim();
      const safeName = safePathSegment(name);
      if (name === '' || safeName === null) {
        sendError(res, 400, 'invalid-change-name', 'change name must not contain path separators');
        return true;
      }
      const state = await readChangeState(root, safeName).catch(() => null);
      if (state === null) {
        sendError(res, 404, 'unknown-change', 'change not found: ' + safeName);
        return true;
      }
      // 与 CLI `change select` 同源：归档的 change 不能被选为当前（它已经不会再被写入）。
      if (state.archived) {
        sendError(res, 409, 'change-not-selectable', 'change ' + safeName + ' 已归档，不能设为当前 change');
        return true;
      }
      const pointer = await selectCurrentChange(root, safeName, { source: 'manual' });
      jobs.stateChanged(projectId, '/api/current-change');
      sendOk(res, { pointer, change: state });
      return true;
    }

    if (segments[0] === 'changes' && segments.length === 1 && method === 'GET') {
      sendOk(res, { changes: await listChangeStates(root) });
      return true;
    }
    if (segments[0] === 'changes' && segments.length === 1 && method === 'POST') {
      const body = await readJsonBody(req);
      const state = await createChangeFromTask({
        projectRoot: root,
        goalId: stringField(body.goal),
        taskId: stringField(body.task),
        changeName: stringField(body.name),
      });
      jobs.stateChanged(projectId, '/api/changes');
      sendOk(res, { change: state });
      return true;
    }
    if (segments[0] === 'changes' && segments.length === 2 && method === 'GET') {
      sendOk(res, await readChangeState(root, segments[1]));
      return true;
    }
    if (segments[0] === 'changes' && segments.length === 3 && segments[2] === 'resume' && method === 'POST') {
      sendOk(res, resumeChange(await readChangeState(root, segments[1])));
      return true;
    }
    if (segments[0] === 'changes' && segments.length === 3 && segments[2] === 'transition' && method === 'POST') {
      const body = await readJsonBody(req);
      const state = await readChangeState(root, segments[1]);
      const next = applyChangeTransition(state, stringField(body.event) as ChangeEvent);
      const filePath = await commitTransition(root, stringField(body.event) as ChangeEvent, state, next);
      jobs.stateChanged(projectId, '/api/changes/' + segments[1]);
      sendOk(res, { change: next, written: filePath });
      return true;
    }
    if (segments[0] === 'changes' && segments.length === 3 && segments[2] === 'run' && method === 'POST') {
      const body = await readJsonBody(req);
      const name = segments[1];
      const agentId = stringField(body.agent, 'opencode');
      const runner = getBuiltInAgentRunner(agentId);
      const job = jobs.create(projectId, 'change-run', { change: name });
      setImmediate(async () => {
        jobs.start(job.id);
        try {
          jobs.log(job.id, 'change run: agent=' + agentId);
          const outcome = await runChange(root, name, runner);
          jobs.log(job.id, 'change run finished: phase=' + outcome.state.phase + ' exit=' + outcome.agentExitCode);
          jobs.complete(job.id, { state: outcome.state }, outcome.agentExitCode);
          jobs.stateChanged(projectId, '/api/changes/' + name);
        } catch (error) {
          jobs.fail(job.id, error instanceof Error ? error.message : String(error));
        }
      });
      sendJson(res, 202, { ok: true, data: { jobId: job.id }, requestId: String(Date.now()) });
      return true;
    }
    if (segments[0] === 'changes' && segments.length === 3 && segments[2] === 'verify' && method === 'POST') {
      const outcome = await verifyChange(root, segments[1]);
      jobs.stateChanged(projectId, '/api/changes/' + segments[1]);
      sendOk(res, outcome);
      return true;
    }
    if (segments[0] === 'changes' && segments.length === 3 && segments[2] === 'archive' && method === 'POST') {
      try {
        const { state, appliedSpecs, specVersions } = await archiveChange(root, segments[1]);
        jobs.stateChanged(projectId, '/api/changes/' + segments[1]);
        sendOk(res, { change: state, appliedSpecs, specVersions });
      } catch (error) {
        // spec 基线冲突是「可预期的人工决策点」，不是 500：把它和两份冲突证据一起交给界面，
        // 让用户明确选择 rebase（接受新基线）还是建 reconciliation change（ADR 0004）。
        if (error instanceof SpecConflictError) {
          sendError(res, 409, 'spec-base-conflict', error.message, { conflicts: error.conflicts });
          return true;
        }
        // 另一个进程正在做多文件事务：立即失败并说明持有者，而不是排队等（ADR 0021）。
        if (error instanceof LockHeldError) {
          sendError(res, 409, 'lock-held', error.message, { lock: error.record });
          return true;
        }
        throw error;
      }
      return true;
    }

    // ---- change 审计：实现范围 / 流水 / 证据 / 恢复路径 ----
    if (segments[0] === 'changes' && segments.length === 3 && segments[2] === 'scope' && method === 'GET') {
      const name = segments[1];
      const state = await readChangeState(root, name);
      sendOk(
        res,
        await collectImplementationScope(root, name, {
          module: state.module ?? null,
          allow: await resolveScopeAllow(root),
        }),
      );
      return true;
    }
    if (segments[0] === 'changes' && segments.length === 3 && segments[2] === 'journal' && method === 'GET') {
      const rawLimit = stringField(url.searchParams.get('limit'));
      const limit = rawLimit === '' ? undefined : Number.parseInt(rawLimit, 10);
      sendOk(res, {
        events: await readChangeJournal(root, segments[1], {
          limit: limit === undefined || Number.isNaN(limit) ? undefined : limit,
        }),
      });
      return true;
    }
    if (segments[0] === 'changes' && segments.length === 3 && segments[2] === 'evidence' && method === 'GET') {
      const name = segments[1];
      const dir = path.join(root, 'changes', name);
      const artifacts: Array<{ name: string; bytes: number; content: string }> = [];
      // 只读白名单内的固定文件名，不接受来自请求的路径片段。
      for (const fileName of ['brief.md', 'verification.md', 'verification.yaml']) {
        try {
          const content = await fs.readFile(path.join(dir, fileName), 'utf8');
          artifacts.push({ name: fileName, bytes: Buffer.byteLength(content, 'utf8'), content });
        } catch {
          // 没写过就跳过
        }
      }
      let staleVerification: string[] = [];
      try {
        staleVerification = (await fs.readdir(dir))
          .filter((entry) => /^verification\.stale-\d+\.yaml$/u.test(entry))
          .sort();
      } catch {
        staleVerification = [];
      }
      const proposed = await readProposedSpecs(root, name);
      const incompleteTransactions = (await listIncompleteSpecTransactions(root)).filter(
        (transaction) => transaction.change === name,
      );
      sendOk(res, {
        artifacts,
        staleVerification,
        proposedSpecs: Object.keys(proposed).sort(),
        incompleteTransactions: incompleteTransactions.map((transaction) => ({
          txId: transaction.txId,
          status: transaction.status,
          dir: transaction.dir,
        })),
      });
      return true;
    }
    if (segments[0] === 'changes' && segments.length === 3 && segments[2] === 'rebase' && method === 'POST') {
      try {
        const outcome = await rebaseChange(root, segments[1]);
        jobs.stateChanged(projectId, '/api/changes/' + segments[1]);
        sendOk(res, outcome);
      } catch (error) {
        // 「已归档 / 没有绑定锚点 / 锚点已删」都是可预期的人工决策点，不是服务端故障。
        sendError(res, 409, 'change-not-rebasable', error instanceof Error ? error.message : String(error));
      }
      return true;
    }
    if (segments[0] === 'changes' && segments.length === 3 && segments[2] === 'unblock' && method === 'POST') {
      const body = await readJsonBody(req);
      try {
        const outcome = await unblockChange(root, segments[1], { note: stringField(body.note) || undefined });
        jobs.stateChanged(projectId, '/api/changes/' + segments[1]);
        sendOk(res, outcome);
      } catch (error) {
        sendError(res, 409, 'change-not-blocked', error instanceof Error ? error.message : String(error));
      }
      return true;
    }

    // ---- evolutions ----
    if (segments[0] === 'evolutions' && segments.length === 1 && method === 'GET') {
      sendOk(res, { evolutions: await listEvolutionProposals(root) });
      return true;
    }
    if (segments[0] === 'evolutions' && segments.length === 1 && method === 'POST') {
      const body = await readJsonBody(req);
      const proposal = await proposeEvolution({
        projectRoot: root,
        name: stringField(body.name),
        summary: stringField(body.summary),
        riskPlan: typeof body.risk === 'string' ? body.risk : undefined,
      });
      jobs.stateChanged(projectId, '/api/evolutions');
      sendOk(res, { proposal });
      return true;
    }
    if (segments[0] === 'evolutions' && segments.length === 3 && method === 'POST') {
      const name = segments[1];
      const action = segments[2];
      if (action === 'verify') {
        const body = await readJsonBody(req);
        const job = jobs.create(projectId, 'evolve-verify');
        setImmediate(async () => {
          jobs.start(job.id);
          try {
            jobs.log(job.id, 'evolution verify: ' + name);
            const proposal = await verifyEvolution(root, name, { includeEval: body.eval === true });
            jobs.log(job.id, 'evolution verify finished: status=' + proposal.status);
            jobs.complete(job.id, { proposal });
            jobs.stateChanged(projectId, '/api/evolutions');
          } catch (error) {
            jobs.fail(job.id, error instanceof Error ? error.message : String(error));
          }
        });
        sendJson(res, 202, { ok: true, data: { jobId: job.id }, requestId: String(Date.now()) });
        return true;
      }
      if (action === 'submit') {
        sendOk(res, await submitEvolution(root, name));
        return true;
      }
      if (action === 'approve') {
        const body = await readJsonBody(req);
        const commits = typeof body.commits === 'string' ? body.commits.split(',').map((item) => item.trim()).filter(Boolean) : [];
        sendOk(res, await approveEvolution(root, name, {
          note: typeof body.note === 'string' ? body.note : undefined,
          commits,
        }));
        return true;
      }
      if (action === 'reject') {
        const body = await readJsonBody(req);
        sendOk(res, await rejectEvolution(root, name, stringField(body.reason, 'rejected')));
        return true;
      }
      sendError(res, 404, 'unknown-evolution-action', action);
      return true;
    }
    // 回滚指引：纯投影（`evolve rollback` 的输出），不改任何状态。
    if (segments[0] === 'evolutions' && segments.length === 3 && segments[2] === 'rollback' && method === 'GET') {
      const name = safePathSegment(segments[1]);
      if (name === null) {
        sendError(res, 400, 'invalid-evolution-name', 'evolution name must not contain path separators');
        return true;
      }
      try {
        const lines = await rollbackEvolution(root, name);
        sendOk(res, { name, lines });
      } catch (error) {
        sendError(res, 404, 'unknown-evolution', error instanceof Error ? error.message : String(error));
      }
      return true;
    }

    // ---- eval ----
    if (segments[0] === 'eval' && segments[1] === 'run' && method === 'POST') {
      const job = jobs.create(projectId, 'eval-run');
      setImmediate(async () => {
        jobs.start(job.id);
        try {
          jobs.log(job.id, 'eval run start');
          const report = await runLocalEval(root);
          jobs.log(job.id, 'eval: ' + (report.passed ? 'PASS' : 'FAIL') + ' pass@k=' + report.passAtKRate.toFixed(2));
          jobs.complete(job.id, { report }, report.passed ? 0 : 1);
        } catch (error) {
          jobs.fail(job.id, error instanceof Error ? error.message : String(error));
        }
      });
      sendJson(res, 202, { ok: true, data: { jobId: job.id }, requestId: String(Date.now()) });
      return true;
    }

    // ---- 一次性 agent 试跑（C13）：等价 `cometflow run` ----
    // 与 change run 的区别是「没有契约」：不绑 change / task / acceptance，所以它只是试跑，
    // 结论不进验收账本——界面那侧必须把这句话写出来，否则会被当成交付。
    if (segments[0] === 'run' && segments.length === 1 && method === 'POST') {
      const body = await readJsonBody(req);
      const requested = stringField(body.agent);
      const agentId = requested !== '' ? requested : await resolveAgentId(root);
      const knownAgent = builtInAgentRunners().some((runner) => runner.id === agentId);
      if (!knownAgent) {
        sendError(res, 400, 'unknown-agent', 'agent must be one of: ' + builtInAgentRunners().map((r) => r.id).join(', '));
        return true;
      }
      const timeoutMs = numberField(body.timeoutMs);
      const job = jobs.create(projectId, 'flow-run');
      setImmediate(async () => {
        jobs.start(job.id);
        try {
          jobs.log(job.id, 'flow run: agent=' + agentId + '（试跑：不绑 change / task / acceptance）');
          const runner = getBuiltInAgentRunner(agentId);
          const outcome = await runFlowRun(runner, {
            projectRoot: root,
            agentId,
            model: stringField(body.model) !== '' ? stringField(body.model) : await resolveModel(root, agentId),
            timeoutMs: timeoutMs === null ? undefined : timeoutMs,
          });
          for (const line of outcome.result.stdout.split(/\r?\n/u)) if (line !== '') jobs.log(job.id, line);
          for (const line of outcome.result.stderr.split(/\r?\n/u)) if (line !== '') jobs.log(job.id, '[stderr] ' + line);
          jobs.log(
            job.id,
            'flow run finished: exit=' + outcome.result.exitCode + (outcome.result.timedOut ? ' (timed out)' : ''),
          );
          jobs.complete(job.id, { agent: agentId, exitCode: outcome.result.exitCode }, outcome.result.exitCode);
        } catch (error) {
          jobs.fail(job.id, error instanceof Error ? error.message : String(error));
        }
      });
      sendJson(res, 202, { ok: true, data: { jobId: job.id, agent: agentId }, requestId: String(Date.now()) });
      return true;
    }

    // ---- 调度 / 资产 / 写入门禁（W5：把 8 面板之外的资产纳入界面）----
    if (segments[0] === 'scheduler' && segments[1] === 'queue' && method === 'GET') {
      // S3：待办由事实推导（plans 的 frozen/approved 减去已归档 change），再叠加运行时覆盖。
      // `tasks` 是给界面的合并视图；`queue`（覆盖）与 `derived`（推导）保留给对账与脚本。
      const view = await mergeTodoView(root);
      const queue = view.overlay;
      const derived: SchedulerQueue = { schema: 'cometflow.queue.v1', tasks: view.derived };
      const config = await readProjectConfig(root);
      // 预算用量是跨重启累计的：只读展示它，「改/重置」仍走 CLI `daemon budget --reset`。
      const budget = await readBudgetUsage(root);
      // 调度器的状态投影（C5）：没有它，界面答不出「无人值守到底有没有在工作」。
      // 读不到就是从未跑过 daemon，界面据此显式说明，而不是拿空队列糊弄。
      const daemon = await readDaemonState(root);
      const control = await readDaemonControl(root);
      // 每行任务补上「工作流视角」（S4）：队列状态回答「跑没跑」，change 回答「交付没交付」。
      // 两列并排，才看得出「跑过但没交付」和「已交付」的区别。
      const tasks = await Promise.all(
        view.tasks.map(async (task) => {
          if (!task.change) return task;
          const state = await readChangeState(root, task.change).catch(() => null);
          return {
            ...task,
            workflow:
              state === null
                ? null
                : { name: state.name, phase: state.phase, status: state.status, archived: state.archived },
          };
        }),
      );
      sendOk(res, {
        tasks,
        queue,
        derived,
        next: nextQueuedTask({ schema: 'cometflow.queue.v1', tasks: view.tasks }),
        scheduler: config.scheduler ?? null,
        budget,
        daemon,
        control,
      });
      return true;
    }
    // daemon 控制（S4）：只写控制文件，不启停进程——进程归启动它的终端（ADR 0026）。
    if (segments[0] === 'scheduler' && segments[1] === 'daemon' && segments[2] === 'control' && method === 'POST') {
      const body = await readJsonBody(req);
      const action = stringField(body.action);
      if (action !== 'pause' && action !== 'resume' && action !== 'stop') {
        sendError(res, 400, 'invalid-control-action', 'action must be pause, resume or stop');
        return true;
      }
      const record = await writeDaemonControl(root, action, { by: 'web' });
      jobs.stateChanged(projectId, '/api/scheduler/queue');
      sendOk(res, { control: record });
      return true;
    }
    // 队列维护（S3）：把「手工删 queue.json」升级成有语义的动作，与 CLI `daemon queue` 同源。
    if (segments[0] === 'scheduler' && segments[1] === 'queue' && segments[2] === 'rebuild' && method === 'POST') {
      const view = await rebuildQueue(root);
      jobs.stateChanged(projectId, '/api/scheduler/queue');
      sendOk(res, { tasks: view.tasks, queued: view.tasks.filter((task) => task.status === 'queued').length });
      return true;
    }
    if (segments[0] === 'scheduler' && segments[1] === 'queue' && segments[2] === 'reset' && method === 'POST') {
      const view = await resetQueue(root);
      jobs.stateChanged(projectId, '/api/scheduler/queue');
      sendOk(res, { tasks: view.tasks, queued: view.tasks.filter((task) => task.status === 'queued').length });
      return true;
    }
    // 单条任务重新排队（细粒度恢复）：不用为了修一条任务而 reset 整个队列。
    if (segments[0] === 'scheduler' && segments[1] === 'queue' && segments[2] === 'retry' && method === 'POST') {
      const body = await readJsonBody(req);
      const taskRef = stringField(body.task);
      if (taskRef === '') {
        sendError(res, 400, 'missing-task', 'task 必填：goal:task（如 G1:T1）');
        return true;
      }
      const result = await retryQueueTask(root, taskRef);
      if (!result.retried) {
        // 已交付 / 不存在都是「什么都别做」，但要让人知道原因，而不是静默成功。
        sendError(res, 409, 'not-retryable', result.reason);
        return true;
      }
      jobs.stateChanged(projectId, '/api/scheduler/queue');
      sendOk(res, { tasks: result.view.tasks, reason: result.reason });
      return true;
    }
    if (segments[0] === 'skills' && segments.length === 1 && method === 'GET') {
      const skills = await listInstalledSkills(root);
      sendOk(res, {
        skills: skills.map((pkg) => ({
          name: pkg.definition.name,
          description: pkg.definition.description,
          version: pkg.definition.version,
          author: pkg.definition.author ?? null,
          files: pkg.files,
        })),
      });
      return true;
    }
    if (segments[0] === 'skills' && segments.length === 2 && method === 'GET') {
      const name = safePathSegment(segments[1]);
      if (name === null) {
        sendError(res, 400, 'invalid-skill-name', 'skill name must not contain path separators');
        return true;
      }
      const skills = await listInstalledSkills(root);
      const found = skills.find((pkg) => pkg.definition.name === name);
      if (!found) {
        sendError(res, 404, 'unknown-skill', 'skill is not installed: ' + name);
        return true;
      }
      let content: string | null = null;
      try {
        content = await readTextFile(path.join(found.root, 'SKILL.md'));
      } catch {
        content = null;
      }
      sendOk(res, { definition: found.definition, files: found.files, content });
      return true;
    }
    if (segments[0] === 'bundles' && method === 'GET') {
      const platforms = supportedBundlePlatforms();
      let manifest = null;
      let compiled = null;
      let error: string | null = null;
      try {
        manifest = await readBundleManifest(root);
      } catch {
        manifest = null;
      }
      if (manifest !== null) {
        try {
          compiled = await compileBundle(root);
        } catch (caught) {
          error = caught instanceof Error ? caught.message : String(caught);
        }
      }
      sendOk(res, { manifest, compiled, platforms, error });
      return true;
    }
    // bundle 分发（C12）：先预告（会写哪些路径、哪些会被覆盖），确认后再执行。
    // 覆盖语义是 `rm -rf 目标目录 + cp`，所以预告不是装饰——它是这个动作的安全带。
    if (segments[0] === 'bundles' && segments[1] === 'distribute' && method === 'POST') {
      const body = await readJsonBody(req);
      const platform = stringField(body.platform);
      let skillsRoot: string;
      try {
        skillsRoot = platformSkillsRoot(platform);
      } catch {
        sendError(res, 400, 'unknown-platform', 'platform must be one of: ' + supportedBundlePlatforms().join(', '));
        return true;
      }
      // 分发前先编译一遍：清单里引用的 skill 读不出来时，宁可在这里失败，
      // 也不要在「一半 skill 拷进去了」的状态下退出。
      try {
        await compileBundle(root);
      } catch (caught) {
        sendError(res, 400, 'bundle-not-compilable', caught instanceof Error ? caught.message : String(caught));
        return true;
      }
      const manifest = await readBundleManifest(root);
      // `platformSkillsRoot` 返回的是**项目相对**路径（如 `.opencode/skills`），
      // 落盘判断必须拼上项目根，否则 pathExists 会去 cwd 上找（那是另一个目录）。
      const absoluteSkillsRoot = path.join(root, skillsRoot);
      const items = await Promise.all(
        manifest.skills.map(async (skill) => {
          const target = path.join(absoluteSkillsRoot, skill.name);
          return {
            name: skill.name,
            source: skill.path,
            target,
            // 覆盖是常态（重复分发是幂等的），但执行前必须让人看见哪几个会被替换。
            overwritten: await pathExists(target),
          };
        }),
      );
      if (body.dryRun !== false) {
        sendOk(res, { platform, skillsRoot, items, written: [] });
        return true;
      }
      const written = await distributeBundle(root, platform);
      jobs.stateChanged(projectId, '/api/bundles');
      sendOk(res, { platform, skillsRoot, items, written });
      return true;
    }
    if (segments[0] === 'hook' && segments[1] === 'check' && method === 'POST') {
      const body = await readJsonBody(req);
      const target = stringField(body.target);
      if (target.trim() === '') {
        sendError(res, 400, 'missing-target', 'target path is required');
        return true;
      }
      const event: HookEvent = stringField(body.event, 'write') === 'edit' ? 'edit' : 'write';
      // 相对路径按项目根解析：serve 的 cwd 不一定是项目目录。
      const decision = await evaluateHook(root, event, path.resolve(root, target));
      sendOk(res, { target, event, decision });
      return true;
    }
    // 写保护（ADR 0023）的安装状态：装没装、条目与脚本是否漂移、守卫调用的 CLI 能否解析。
    if (segments[0] === 'hook' && segments[1] === 'status' && method === 'GET') {
      // 只支持 claude-code；另外两个平台会返回 supported: false，界面据此显示「暂不支持」而不是「未安装」。
      const platforms = await Promise.all(HOOK_PLATFORMS.map((platform) => hookStatus(root, platform)));
      sendOk(res, { platforms });
      return true;
    }
    if (segments[0] === 'classic' && method === 'GET') {
      sendOk(res, { changes: await listClassicStates(root) });
      return true;
    }

    sendError(res, 404, 'unknown-route', method + ' ' + pathname);
    return true;
  } catch (error) {
    sendError(res, 500, 'internal-error', error instanceof Error ? error.message : String(error));
    return true;
  }
}
