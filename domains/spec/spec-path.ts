import path from 'node:path';

/**
 * 把调用方给的 spec 路径解析成绝对路径，并把范围钉死在 `specs/` 之内。
 *
 * 服务端（`POST /specs`、`POST /spec/approve`）与 CLI（`spec approve`）都要这一道：
 * 路径来自请求体或命令行参数，不校验就能把读写带出项目目录。
 */
export function resolveSpecPath(projectRoot: string, relativePath: string): string {
  const specsDir = path.join(projectRoot, 'specs');
  const absolute = path.resolve(projectRoot, relativePath);
  const within = absolute === specsDir || absolute.startsWith(specsDir + path.sep);
  if (!within) throw new Error('invalid spec path: ' + relativePath);
  return absolute;
}

/** 项目相对路径（正斜杠），用于回显与登记版本。 */
export function toProjectRelative(projectRoot: string, absolute: string): string {
  return path.relative(projectRoot, absolute).split(path.sep).join('/');
}
