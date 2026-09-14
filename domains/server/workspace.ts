import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteJson } from '../../platform/fs/atomic-write.js';

export interface WorkspaceProject {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string;
}

export interface Workspace {
  schema: 'cometflow.workspace.v1';
  projects: WorkspaceProject[];
}

export function defaultWorkspaceRoot(): string {
  return process.env.COMETFLOW_WORKSPACE ?? path.join(os.homedir(), '.cometflow', 'workspace');
}

export function workspaceFilePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'workspace.json');
}

export async function readWorkspace(workspaceRoot: string): Promise<Workspace> {
  const filePath = workspaceFilePath(workspaceRoot);
  try {
    const source = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(source) as Partial<Workspace>;
    return { schema: 'cometflow.workspace.v1', projects: parsed.projects ?? [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { schema: 'cometflow.workspace.v1', projects: [] };
    }
    throw error;
  }
}

export async function writeWorkspace(workspaceRoot: string, workspace: Workspace): Promise<string> {
  const filePath = workspaceFilePath(workspaceRoot);
  await fs.mkdir(workspaceRoot, { recursive: true });
  // 原子写：workspace.json 是每个请求都要 touch 的热文件，
  // 覆盖写被中断会留下截断的 JSON，之后所有请求都以 500 失败。
  await atomicWriteJson(filePath, workspace);
  return filePath;
}

/**
 * 工作区注册表的进程内串行化。
 *
 * 每个项目请求都会 `touchProject`（读 → 改 lastOpenedAt → 写），
 * 而界面一个面板会并发发起多个请求（Promise.all）。没有串行化时，
 * 两次读改写会互相覆盖、甚至读到对方写了一半的内容。
 * serve 是单进程，所以一把按文件路径排队的互斥锁就够了。
 */
const workspaceLocks = new Map<string, Promise<unknown>>();

function withWorkspaceLock<T>(workspaceRoot: string, task: () => Promise<T>): Promise<T> {
  const key = workspaceFilePath(workspaceRoot);
  const previous = workspaceLocks.get(key) ?? Promise.resolve();
  const next = previous.then(task, task);
  // 队列本身不承载业务语义，失败只影响调用方；这里吞掉拒绝避免 unhandled rejection。
  workspaceLocks.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

export async function listProjects(workspaceRoot: string): Promise<WorkspaceProject[]> {
  const workspace = await readWorkspace(workspaceRoot);
  return workspace.projects
    .slice()
    .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
}

export async function getProject(workspaceRoot: string, projectId: string): Promise<WorkspaceProject | null> {
  const workspace = await readWorkspace(workspaceRoot);
  return workspace.projects.find((project) => project.id === projectId) ?? null;
}

async function upsertProject(workspaceRoot: string, project: WorkspaceProject): Promise<WorkspaceProject> {
  const workspace = await readWorkspace(workspaceRoot);
  const index = workspace.projects.findIndex((entry) => entry.path === project.path);
  if (index >= 0) {
    workspace.projects[index] = { ...workspace.projects[index], lastOpenedAt: project.lastOpenedAt, name: project.name };
  } else {
    workspace.projects.push(project);
  }
  await writeWorkspace(workspaceRoot, workspace);
  return workspace.projects[index >= 0 ? index : workspace.projects.length - 1];
}

export async function registerProject(
  workspaceRoot: string,
  name: string,
  projectPath: string,
): Promise<WorkspaceProject> {
  const absolute = path.resolve(projectPath);
  const now = new Date().toISOString();
  return withWorkspaceLock(workspaceRoot, () =>
    upsertProject(workspaceRoot, {
      id: randomUUID(),
      name: name.trim() === '' ? path.basename(absolute) : name.trim(),
      path: absolute,
      createdAt: now,
      lastOpenedAt: now,
    }),
  );
}

export async function touchProject(workspaceRoot: string, projectId: string): Promise<WorkspaceProject | null> {
  return withWorkspaceLock(workspaceRoot, async () => {
    const workspace = await readWorkspace(workspaceRoot);
    const project = workspace.projects.find((entry) => entry.id === projectId);
    if (!project) return null;
    project.lastOpenedAt = new Date().toISOString();
    await writeWorkspace(workspaceRoot, workspace);
    return project;
  });
}

export async function removeProject(workspaceRoot: string, projectId: string): Promise<boolean> {
  return withWorkspaceLock(workspaceRoot, async () => {
    const workspace = await readWorkspace(workspaceRoot);
    const before = workspace.projects.length;
    workspace.projects = workspace.projects.filter((project) => project.id !== projectId);
    if (workspace.projects.length === before) return false;
    await writeWorkspace(workspaceRoot, workspace);
    return true;
  });
}
