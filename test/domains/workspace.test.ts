import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getProject, listProjects, registerProject, removeProject } from '../../domains/server/workspace.js';

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
});
