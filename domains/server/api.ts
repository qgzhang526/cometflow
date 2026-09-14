import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { collectProjectStatus } from '../dashboard/collector.js';
import { runDoctor } from '../dashboard/doctor.js';
import { syncProjectContext } from '../project/context.js';
import { syncGoals } from '../goal/goal-sync.js';
import type { GoalRecord } from '../goal/types.js';
import { initializeProject } from '../project/init.js';
import {
  detectKindNeeds,
  readInitManifest,
  scaffoldKinds,
  scaffoldProject,
  writeInitManifest,
} from '../project/scaffold.js';
import type { KindEntry, ScaffoldAnswers, StackHints } from '../project/scaffold.js';
import {
  mergeProjectConfigOverride,
  readProjectConfig,
  readProjectConfigOverride,
  validateProjectConfig,
  writeProjectConfig,
} from '../project/config.js';
import type { ProjectConfig } from '../project/config.js';
import { builtInAgentRunners, getBuiltInAgentRunner } from '../../platform/agents/registry.js';
import { readTextFile } from '../../platform/fs/read-file.js';
import { listSpecEntries } from '../spec/spec-index.js';
import { buildSpecIndex } from '../spec/spec-project.js';
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
import { atomicWriteText } from '../../platform/fs/atomic-write.js';
import { generateTaskPlan } from '../task-plan/task-plan-generate.js';
import { validateTaskPlan } from '../task-plan/task-plan-validate.js';
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
import { runLocalEval } from '../eval/eval-service.js';
import type { ApiContext } from './http.js';
import { readJsonBody, requestUrl, sendError, sendJson, sendOk } from './http.js';
import { getProject, listProjects, registerProject, removeProject, touchProject } from './workspace.js';

function stringField(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
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

async function describeProject(projectPath: string): Promise<Record<string, unknown>> {
  try {
    const status = await collectProjectStatus(projectPath);
    return { status };
  } catch (error) {
    return { status: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function handleApiRequest(ctx: ApiContext): Promise<boolean> {
  const { req, res, workspaceRoot, jobs } = ctx;
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
      sendOk(res, { jobs: jobs.list() });
      return true;
    }

    const jobMatch = /^\/api\/jobs\/([^/]+)$/u.exec(pathname);
    if (jobMatch && method === 'GET') {
      const job = jobs.get(jobMatch[1]);
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
    const segments = rest;

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
        sendOk(res, { config, projectOverride });
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

    // ---- init-manifest / spec scaffold ----
    if (segments[0] === 'init-manifest' && method === 'GET') {
      const manifest = await readInitManifest(root);
      sendOk(res, manifest ?? { schema: 'cometflow.init-manifest.v1', kinds: detectKindNeeds({}, {}) });
      return true;
    }
    if (segments[0] === 'spec' && segments[1] === 'scaffold' && method === 'POST') {
      const body = await readJsonBody(req);
      const answers = (body.answers ?? {}) as ScaffoldAnswers;
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
        result = await scaffoldProject(root, stack, answers);
      }
      jobs.stateChanged(projectId, '/api/specs');
      sendOk(res, result);
      return true;
    }

    // ---- specs ----

    // ---- spec kernel: 验收覆盖 / 一致性门禁 / 版本回放 / 影响分析 ----
    // 这些投影此前只有 CLI 能看到，是「spec 即产物」在前端缺失的部分。
    if (segments[0] === 'spec' && method === 'GET' && segments[1] === 'checks') {
      sendOk(res, await collectAcceptanceChecks(root));
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
      await refreshSpecBaseline(root, { note: 'pre-restore snapshot' });
      await atomicWriteText(path.join(root, resolved.path), content);
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
      // spec 是唯一事实源，半写的文件会让「按冻结版本重建」失效：走原子写。
      await atomicWriteText(absolute, content);
      // 通过 Web 编辑 spec 同样是一次 canonical spec 变更：立即登记版本并刷新 lock，
      // 否则 spec verify 会立刻报 stale-spec-lock，活跃 change 的 CAS 基线也会失真。
      await refreshSpecBaseline(root, { note: 'web edit' });
      jobs.stateChanged(projectId, '/api/specs');
      sendOk(res, { path: relativePath, created: absolute });
      return true;
    }
    if (segments[0] === 'specs' && segments[1] === 'content') {
      const relativePath = stringField(url.searchParams.get('path'));
      const absolute = resolveSpecPath(root, relativePath);
      if (method === 'GET') {
        sendOk(res, { path: relativePath, content: await readTextFile(absolute) });
        return true;
      }
      if (method === 'PUT') {
        const body = await readJsonBody(req);
        await atomicWriteText(absolute, stringField(body.content));
        await refreshSpecBaseline(root, { note: 'web edit' });
        jobs.stateChanged(projectId, '/api/specs');
        sendOk(res, { written: absolute });
        return true;
      }
    }

    // ---- plans ----
    if (segments[0] === 'plans' && segments.length === 1 && method === 'GET') {
      sendOk(res, { plans: await listPlanSummaries(root) });
      return true;
    }
    if (segments[0] === 'plans' && segments[1] === 'generate' && method === 'POST') {
      const body = await readJsonBody(req);
      const plan = await generateTaskPlan(root, stringField(body.goal));
      const filePath = await writeTaskPlan(root, plan);
      jobs.stateChanged(projectId, '/api/plans');
      sendOk(res, { plan, written: filePath });
      return true;
    }
    if (segments[0] === 'plans' && segments[1] === 'regenerate' && method === 'POST') {
      const body = await readJsonBody(req);
      const goal = stringField(body.goal);
      const previous = await readTaskPlan(root, goal);
      const plan = await regenerateTaskPlan(root, goal, previous, {
        preserveApproved: body.preserveApproved === true,
      });
      const filePath = await writeTaskPlan(root, plan);
      jobs.stateChanged(projectId, '/api/plans');
      sendOk(res, { plan, written: filePath });
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
        const frozen = await freezeTaskPlan(root, plan);
        const filePath = await writeTaskPlan(root, frozen);
        jobs.stateChanged(projectId, '/api/plans/' + goal);
        sendOk(res, { plan: frozen, written: filePath });
        return true;
      }
      sendError(res, 404, 'unknown-plan-action', action);
      return true;
    }

    // ---- changes ----
    // change 名字会参与 `changes/<name>/...` 的路径拼接，先挡住路径分隔符，
    // 避免 `..%2f` 之类的名字把读写引到项目外。
    if (segments[0] === 'changes' && segments.length >= 2) {
      // 先解码再判定：`..%2F..%2Fetc` 这类写法在编码状态下看不出是路径，解码后就一目了然。
      let candidate = segments[1];
      try {
        candidate = decodeURIComponent(candidate);
      } catch {
        // 非法的百分号编码不是合法 change 名，保持原样走后面的校验。
      }
      if (candidate === '' || candidate === '.' || candidate === '..' || /[\\/]/u.test(candidate)) {
        sendError(res, 400, 'invalid-change-name', 'change name must not contain path separators');
        return true;
      }
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

    sendError(res, 404, 'unknown-route', method + ' ' + pathname);
    return true;
  } catch (error) {
    sendError(res, 500, 'internal-error', error instanceof Error ? error.message : String(error));
    return true;
  }
}
