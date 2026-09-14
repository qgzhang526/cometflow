import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getProject,
  listProjects,
  registerProject,
  removeProject,
  touchProject,
  workspaceFilePath,
} from '../../domains/server/workspace.js';

describe('workspace registry', () => {
  it('registers, upserts, lists, gets, and removes projects', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-ws-'));
    const projectPath = path.join(tmp, 'demo');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await registerProject(tmp, 'demo', projectPath);
    expect(project.id).toBeTruthy();
    expect(project.name).toBe('demo');

    expect((await listProjects(tmp)).length).toBe(1);
    expect((await getProject(tmp, project.id))?.name).toBe('demo');

    await registerProject(tmp, 'demo-renamed', projectPath);
    const list = await listProjects(tmp);
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('demo-renamed');

    expect(await removeProject(tmp, project.id)).toBe(true);
    expect((await listProjects(tmp)).length).toBe(0);

    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('survives concurrent read-modify-write from one client session', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-ws-'));
    const projects = await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map(async (name) => {
        const projectPath = path.join(tmp, name);
        await fs.mkdir(projectPath, { recursive: true });
        return registerProject(tmp, name, projectPath);
      }),
    );
    expect(new Set(projects.map((project) => project.id)).size).toBe(5);

    // 界面一个面板会并发发多个请求，每个请求都会 touchProject；
    // 没有串行化时这里会互相覆盖，甚至读到截断的 JSON。
    await Promise.all(Array.from({ length: 30 }, (_, index) => touchProject(tmp, projects[index % 5].id)));

    const listed = await listProjects(tmp);
    expect(listed.length).toBe(5);
    expect(listed.map((project) => project.name).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);

    // 文件必须是完整可解析的 JSON，而不是被截断的半份。
    const raw = await fs.readFile(workspaceFilePath(tmp), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw).projects.length).toBe(5);

    await fs.rm(tmp, { recursive: true, force: true });
  });
});
