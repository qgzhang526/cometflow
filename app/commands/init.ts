import path from 'node:path';
import { initializeProject } from '../../domains/project/init.js';
import { detectKindNeeds, scaffoldProject, writeInitManifest } from '../../domains/project/scaffold.js';
import { askScaffoldPrompts } from './scaffold-prompts.js';

export async function initCommand(
  targetPath: string,
  options: { interactive?: boolean } = {},
): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const { missionPath } = await initializeProject(projectRoot);
  console.log('initialized ' + missionPath);

  if (options.interactive) {
    const { stack, answers } = await askScaffoldPrompts(true);
    const result = await scaffoldProject(projectRoot, stack, answers);
    for (const filePath of result.created) console.log('scaffolded ' + filePath);
    for (const filePath of result.skipped) console.log('skipped ' + filePath);
    console.log('wrote ' + result.manifestPath);
    if (result.created.length > 0) {
      console.log('（骨架是草案：确认内容后 cometflow spec approve <spec-file> 定稿；草案不能参与 plan freeze）');
    }
  } else {
    const kinds = detectKindNeeds({}, {});
    const manifestPath = await writeInitManifest(projectRoot, kinds);
    console.log('wrote ' + manifestPath);
  }
}
