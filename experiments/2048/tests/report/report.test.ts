import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPORTS_DIR = path.resolve(import.meta.dirname, '../../reports');
const REPORT_FILE = path.join(REPORTS_DIR, 'self-bootstrap-report.md');

async function readReport(): Promise<string> {
  return fs.readFile(REPORT_FILE, 'utf8');
}

describe('FR-REPORT-001 报告内容', () => {
  it('A401: 报告包含 spec→trace 闭环通过率数据（H1）', async () => {
    const text = await readReport();
    expect(text).toMatch(/H1/);
    expect(text).toMatch(/trace/i);
    expect(text).toMatch(/通过率|pass rate|100%|闭环/);
  });

  it('A402: 报告包含 plan validate/review 捕获的问题数（H2）', async () => {
    const text = await readReport();
    expect(text).toMatch(/H2/);
    expect(text).toMatch(/validate|review/i);
    expect(text).toMatch(/问题|defect|finding|rework/i);
  });

  it('A403: 报告包含 eval 门禁拦截或未拦截的回归记录（H3）', async () => {
    const text = await readReport();
    expect(text).toMatch(/H3/);
    expect(text).toMatch(/eval/i);
    expect(text).toMatch(/拦截|回归|regression|intercept/i);
  });

  it('A404: 报告包含无人值守完成率与断点恢复记录（H4）', async () => {
    const text = await readReport();
    expect(text).toMatch(/H4/);
    expect(text).toMatch(/无人值守|daemon|headless|断点|recovery|恢复/);
  });
});

describe('FR-REPORT-002 平台发现', () => {
  it('A410: 报告列出平台缺陷/改进项清单（含 evolve verify 默认门禁现状）', async () => {
    const text = await readReport();
    expect(text).toMatch(/缺陷|改进项|findings|issue/i);
    expect(text).toMatch(/evolve/i);
    expect(text).toMatch(/门禁|gate/i);
  });

  it('A411: 报告落在 reports/ 目录且可被 spec trace 引用', async () => {
    const stat = await fs.stat(REPORT_FILE);
    expect(stat.isFile()).toBe(true);
    expect(path.dirname(REPORT_FILE)).toBe(REPORTS_DIR);
    const text = await readReport();
    expect(text).toMatch(/spec_ref|specs\/report\/spec\.md|spec trace|FR-REPORT/);
  });
});
