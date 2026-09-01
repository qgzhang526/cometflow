import path from 'node:path';

export function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

export function relativePosix(from: string, to: string): string {
  return toPosix(path.relative(from, to));
}
