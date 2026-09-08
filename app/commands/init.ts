import { promises as fs } from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import { detectKindNeeds, scaffoldProject, writeInitManifest } from '../../domains/project/scaffold.js';
import { askScaffoldPrompts } from './scaffold-prompts.js';

const COMETFLOW_TEMPLATE = [
  '# 项目使命',
  '',
  '[用一句话描述这个项目要做什么]',
  '',
  '## 技术栈',
  '',
  '| 维度 | 值 |',
  '|------|-----|',
  '| 前端 | [无/框架] |',
  '| 后端 | [语言/框架] |',
  '| 数据库 | [数据库或“无”] |',
  '| 缓存 | [缓存或“无”] |',
  '| 测试框架 | [测试框架] |',
  '| 构建工具 | [构建命令] |',
  '',
  '## 运行环境',
  '',
  '| 维度 | 值 |',
  '|------|-----|',
  '| 操作系统 | [OS] |',
  '| 部署方式 | [部署环境] |',
  '| 语言版本 | [版本] |',
  '',
  '## 任务目标',
  '',
  '### G1：第一个任务目标',
  '- 目标：[用一句话描述这个任务目标]',
  '- 范围：[capability]',
  '- 成功标准：',
  '  - [可验证的成功标准]',
  '- 非目标：',
  '  - [明确不做的事]',
].join('\n');

const CONFIG_TEMPLATE = {
  schema: 'cometflow.project.v1',
  default_workflow: 'native',
  plan_review: 'high-risk',
};

async function ensureGitignore(projectRoot: string): Promise<void> {
  const gitignore = path.join(projectRoot, '.gitignore');
  let content = '';
  try {
    content = await fs.readFile(gitignore, 'utf8');
  } catch {
    content = '';
  }
  const marker = '.cometflow/';
  if (!content.split(/\r?\n/u).includes(marker)) {
    const prefix = content === '' || content.endsWith('\n') ? '' : '\n';
    await fs.appendFile(gitignore, prefix + marker + '\n');
  }
}

export async function initCommand(
  targetPath: string,
  options: { interactive?: boolean } = {},
): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const missionPath = path.join(projectRoot, 'COMETFLOW.md');
  try {
    await fs.access(missionPath);
    throw new Error('COMETFLOW.md already exists');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(path.join(projectRoot, 'specs'), { recursive: true });
  await fs.mkdir(path.join(projectRoot, '.cometflow', 'goals'), { recursive: true });
  await fs.mkdir(path.join(projectRoot, '.cometflow', 'plans'), { recursive: true });
  await fs.writeFile(missionPath, COMETFLOW_TEMPLATE);
  await fs.writeFile(
    path.join(projectRoot, '.cometflow', 'config.yaml'),
    stringify(CONFIG_TEMPLATE),
  );
  await ensureGitignore(projectRoot);
  console.log('initialized ' + projectRoot);

  if (options.interactive) {
    const { stack, answers } = await askScaffoldPrompts(true);
    const result = await scaffoldProject(projectRoot, stack, answers);
    for (const filePath of result.created) console.log('scaffolded ' + filePath);
    for (const filePath of result.skipped) console.log('skipped ' + filePath);
    console.log('wrote ' + result.manifestPath);
  } else {
    const kinds = detectKindNeeds({}, {});
    const manifestPath = await writeInitManifest(projectRoot, kinds);
    console.log('wrote ' + manifestPath);
  }
}
