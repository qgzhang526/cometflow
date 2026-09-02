import path from 'node:path';
import { createBundle, compileBundle, distributeBundle } from '../../domains/bundle/bundle-service.js';

function root(targetPath: string): string {
  return path.resolve(targetPath);
}

export async function bundleCreateCommand(name: string, targetPath: string): Promise<void> {
  const projectRoot = root(targetPath);
  const manifest = await createBundle(projectRoot, name);
  console.log('created bundle ' + manifest.name + ' v' + manifest.version);
}

export async function bundleCompileCommand(targetPath: string): Promise<void> {
  const projectRoot = root(targetPath);
  const compiled = await compileBundle(projectRoot);
  console.log(JSON.stringify(compiled, null, 2));
}

export async function bundleDistributeCommand(targetPath: string, options: { platform: string }): Promise<void> {
  const projectRoot = root(targetPath);
  const written = await distributeBundle(projectRoot, options.platform);
  for (const filePath of written) console.log('distributed ' + filePath);
}
