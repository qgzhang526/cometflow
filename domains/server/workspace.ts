import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

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
  await fs.writeFile(filePath, JSON.stringify(workspace, null, 2));
  return filePath;
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
  return upsertProject(workspaceRoot, {
    id: randomUUID(),
    name: name.trim() === '' ? path.basename(absolute) : name.trim(),
    path: absolute,
    createdAt: now,
    lastOpenedAt: now,
  });
}

export async function touchProject(workspaceRoot: string, projectId: string): Promise<WorkspaceProject | null> {
  const workspace = await readWorkspace(workspaceRoot);
  const project = workspace.projects.find((entry) => entry.id === projectId);
  if (!project) return null;
  project.lastOpenedAt = new Date().toISOString();
  await writeWorkspace(workspaceRoot, workspace);
  return project;
}

export async function removeProject(workspaceRoot: string, projectId: string): Promise<boolean> {
  const workspace = await readWorkspace(workspaceRoot);
  const before = workspace.projects.length;
  workspace.projects = workspace.projects.filter((project) => project.id !== projectId);
  if (workspace.projects.length === before) return false;
  await writeWorkspace(workspaceRoot, workspace);
  return true;
}
