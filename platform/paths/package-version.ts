import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = '@zqg/cometflow';

/**
 * 读取本包自己的版本号。
 *
 * 这里不能硬编码，也不能写死相对路径：源码直跑（`tsx app/cli/index.ts`）时模块在
 * `<root>/app/cli/`，编译后跑（`node dist/app/cli/index.js`）时在 `<root>/dist/app/cli/`，
 * 两者到包根的层级不一样。所以从当前模块目录往上找本包的 package.json。
 */
export function readPackageVersion(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as {
          name?: string;
          version?: string;
        };
        if (parsed.name === PACKAGE_NAME && typeof parsed.version === 'string') {
          return parsed.version;
        }
      } catch {
        // 读不动或不是 JSON 就继续往上找
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}
