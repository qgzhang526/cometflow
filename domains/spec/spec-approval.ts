import path from 'node:path';
import { readTextFile } from '../../platform/fs/read-file.js';
import { atomicWriteText } from '../../platform/fs/atomic-write.js';
import { parseSpecMeta, setSpecStatus } from './spec-meta.js';
import { refreshSpecBaseline } from './spec-version.js';
import { resolveSpecPath, toProjectRelative } from './spec-path.js';
import type { SpecStatus } from './spec-meta.js';

export interface SpecApprovalResult {
  path: string;
  previous: SpecStatus;
  status: SpecStatus;
  /** 内容是否真的变了（已经是 approved 时不重写文件，也不记新版本）。 */
  changed: boolean;
  spec_version: number | null;
}

/**
 * 把一份 spec 标成定稿（G1）。
 *
 * 这是「机器可以起草、但必须有人点头」里那个「点头」的动作：脚手架骨架、
 * 表格导入、Agent 起草的 spec 都是 `status: draft`，只有过了这一步才能被 `plan freeze` 绑定。
 *
 * 定稿只改 front-matter 的一个键，随后立刻 `refreshSpecBaseline`——
 * 与 Web 编辑器保存走同一条路（登记版本 + 刷新 lock），否则 `spec verify` 会立刻报 stale-spec-lock。
 */
export async function approveSpec(projectRoot: string, specRef: string): Promise<SpecApprovalResult> {
  const absolute = resolveSpecPath(projectRoot, specRef);
  const relative = toProjectRelative(projectRoot, absolute);
  const content = await readTextFile(absolute);
  const previous = parseSpecMeta(content).status;
  if (previous === 'approved') {
    return { path: relative, previous, status: 'approved', changed: false, spec_version: null };
  }

  await atomicWriteText(absolute, setSpecStatus(content, 'approved'));
  const refreshed = await refreshSpecBaseline(projectRoot, { note: 'spec approve' });
  const record = refreshed.recorded.find((entry) => entry.path === relative);
  return { path: relative, previous, status: 'approved', changed: true, spec_version: record?.spec_version ?? null };
}
