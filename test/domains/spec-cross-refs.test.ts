import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateSpecs } from '../../domains/spec/spec-validate.js';

const COMETFLOW = [
  '# 项目使命',
  '',
  'demo',
  '',
  '## 技术栈',
  '',
  '| 维度 | 值 |',
  '|------|-----|',
  '| 前端 | 无 |',
  '| 后端 | TypeScript |',
  '| 数据库 | 无 |',
  '| 缓存 | 无 |',
  '| 测试框架 | vitest |',
  '| 构建工具 | tsc |',
  '',
  '## 运行环境',
  '',
  '| 维度 | 值 |',
  '|------|-----|',
  '| 操作系统 | Linux |',
  '| 部署方式 | 本地 |',
  '| 语言版本 | Node 22+ |',
].join('\n');

const MODELS = '# 数据模型\n\n## 实体：User\n';
const ERRORS = '# 错误码目录\n\n## 错误码\n\n| code | 语义 | 触发接口 |\n|------|------|----------|\n| INVALID_CODE | 无效 | POST /login |\n';
const CONFIG = '# 运行时配置\n\n## 配置项\n\n| 键 | 类型 | 默认值 |\n|----|------|--------|\n| platform.url | string | |\n';

async function writeProject(root: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content);
  }
}

describe('spec cross-file references', () => {
  it('resolves capability model and error-code references', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-xref-'));
    await writeProject(tmp, {
      'COMETFLOW.md': COMETFLOW,
      'specs/models.md': MODELS,
      'specs/errors.md': ERRORS,
      'specs/auth/spec.md': '# auth\n\n## POST /login\n\n模型：User\n错误码：INVALID_CODE\n\n## Acceptance\n\n- A1：ok\n',
    });
    const result = await validateSpecs(tmp);
    expect(result.findings.filter((finding) => finding.severity === 'error')).toHaveLength(0);
    expect(result.valid).toBe(true);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('flags unresolved capability model reference', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-xref-'));
    await writeProject(tmp, {
      'COMETFLOW.md': COMETFLOW,
      'specs/models.md': MODELS,
      'specs/auth/spec.md': '# auth\n\n## POST /login\n\n模型：Ghost\n\n## Acceptance\n\n- A1：ok\n',
    });
    const result = await validateSpecs(tmp);
    expect(result.findings.some((finding) => finding.code === 'unresolved-model-reference')).toBe(true);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('flags unresolved capability error-code reference', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-xref-'));
    await writeProject(tmp, {
      'COMETFLOW.md': COMETFLOW,
      'specs/errors.md': ERRORS,
      'specs/auth/spec.md': '# auth\n\n## POST /login\n\n错误码：NOPE\n\n## Acceptance\n\n- A1：ok\n',
    });
    const result = await validateSpecs(tmp);
    expect(result.findings.some((finding) => finding.code === 'unresolved-error-reference')).toBe(true);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('resolves error codes kept in the protocol 错误码 table', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-xref-'));
    await writeProject(tmp, {
      'COMETFLOW.md': COMETFLOW,
      'specs/protocol.md': '# 通信协议\n\n## 状态码总表\n\n| 状态码 | 含义 |\n|--------|------|\n| 200 | OK |\n\n## 错误码\n\n| code | 语义 | 触发接口 |\n|------|------|----------|\n| INVALID_CODE | 无效 | POST /login |\n',
      'specs/auth/spec.md': '# auth\n\n## POST /login\n\n错误码：INVALID_CODE\n\n## Acceptance\n\n- A1：ok\n',
    });
    const result = await validateSpecs(tmp);
    expect(result.findings.filter((finding) => finding.severity === 'error')).toHaveLength(0);
    expect(result.valid).toBe(true);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('flags a code missing from both errors.md and the protocol table', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-xref-'));
    await writeProject(tmp, {
      'COMETFLOW.md': COMETFLOW,
      'specs/protocol.md': '# 通信协议\n\n## 错误码\n\n| code | 语义 |\n|------|------|\n| OTHER_CODE | 其他 |\n',
      'specs/auth/spec.md': '# auth\n\n## POST /login\n\n错误码：MISSING_CODE\n\n## Acceptance\n\n- A1：ok\n',
    });
    const result = await validateSpecs(tmp);
    expect(result.findings.some((finding) => finding.code === 'unresolved-error-reference')).toBe(true);
    expect(result.findings.some((finding) => finding.code === 'missing-reference-target')).toBe(false);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('flags unresolved process config-key reference', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-xref-'));
    await writeProject(tmp, {
      'COMETFLOW.md': COMETFLOW,
      'specs/config.md': CONFIG,
      'specs/processes.md': '# 后台进程\n\n## 进程：心跳\n\n- 配置：missing.key\n',
    });
    const result = await validateSpecs(tmp);
    expect(result.findings.some((finding) => finding.code === 'unresolved-config-reference')).toBe(true);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('flags unresolved rules model reference', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-xref-'));
    await writeProject(tmp, {
      'COMETFLOW.md': COMETFLOW,
      'specs/models.md': MODELS,
      'specs/rules.md': '# 领域规则\n\n## 规则：X\n\n- 模型：Ghost\n',
    });
    const result = await validateSpecs(tmp);
    expect(result.findings.some((finding) => finding.code === 'unresolved-model-reference')).toBe(true);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  /**
   * 反向引用完整性（ADR 0030）：正向检查保证"引用到的东西存在"，
   * 反向检查保证"声明了的东西有人用"——否则 models 的实体、rules 的规则就是悬空的事实来源。
   */
  describe('反向引用：声明了却没人用', () => {
    it('实体没有被任何行为层引用 → warning（不是 error：预留是合法需求）', async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-xref-'));
      await writeProject(tmp, {
        'COMETFLOW.md': COMETFLOW,
        'specs/models.md': '# 数据模型\n\n## 实体：Orphan\n',
        'specs/auth/spec.md': '# auth\n\n## POST /login\n\n## Acceptance\n\n- A1：ok\n',
      });
      const result = await validateSpecs(tmp);
      const finding = result.findings.find((entry) => entry.code === 'unreferenced-model');
      expect(finding?.severity).toBe('warning');
      expect(finding?.message).toContain('Orphan');
      // 只是 warning：validate 仍然算通过（不挡 CI）。
      expect(result.valid).toBe(true);
      await fs.rm(tmp, { recursive: true, force: true });
    });

    it('规则没有被任何行为层引用 → warning；补一条 `- 规则：X` 就消失', async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-xref-'));
      const rules = '# 领域规则\n\n## 规则：会话有效期\n\n- 语义：过期即拒绝\n';
      await writeProject(tmp, {
        'COMETFLOW.md': COMETFLOW,
        'specs/rules.md': rules,
        'specs/auth/spec.md': '# auth\n\n## POST /login\n\n## Acceptance\n\n- A1：ok\n',
      });
      const before = await validateSpecs(tmp);
      expect(before.findings.some((entry) => entry.code === 'unreferenced-rule')).toBe(true);

      await fs.writeFile(
        path.join(tmp, 'specs/auth/spec.md'),
        '# auth\n\n## POST /login\n\n- 规则：会话有效期\n\n## Acceptance\n\n- A1：ok\n',
      );
      const after = await validateSpecs(tmp);
      expect(after.findings.some((entry) => entry.code === 'unreferenced-rule')).toBe(false);
      await fs.rm(tmp, { recursive: true, force: true });
    });

    it('引用了不存在的规则 → error（正向）', async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-xref-'));
      await writeProject(tmp, {
        'COMETFLOW.md': COMETFLOW,
        'specs/rules.md': '# 领域规则\n\n## 规则：会话有效期\n',
        'specs/auth/spec.md': '# auth\n\n## POST /login\n\n- 规则：不存在\n\n## Acceptance\n\n- A1：ok\n',
      });
      const result = await validateSpecs(tmp);
      expect(result.findings.some((entry) => entry.code === 'unresolved-rule-reference')).toBe(true);
      expect(result.valid).toBe(false);
      await fs.rm(tmp, { recursive: true, force: true });
    });

    it('传递一次：被引用的规则所引用的实体算已使用；没人引用的规则不算', async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-xref-'));
      await writeProject(tmp, {
        'COMETFLOW.md': COMETFLOW,
        'specs/models.md': '# 数据模型\n\n## 实体：ViaRule\n\n## 实体：ViaOrphanRule\n',
        'specs/rules.md':
          '# 领域规则\n\n## 规则：被遵守\n\n- 模型：ViaRule\n\n## 规则：没人遵守\n\n- 模型：ViaOrphanRule\n',
        'specs/auth/spec.md': '# auth\n\n## POST /login\n\n- 规则：被遵守\n\n## Acceptance\n\n- A1：ok\n',
      });
      const result = await validateSpecs(tmp);
      const unreferenced = result.findings
        .filter((entry) => entry.code === 'unreferenced-model')
        .map((entry) => entry.message)
        .join(' | ');
      // 被"被遵守"这条规则引用的实体 → 传递算已使用。
      expect(unreferenced).not.toContain('ViaRule ');
      expect(unreferenced).not.toContain('实体 ViaRule ');
      // 只被"没人遵守"的规则引用的实体 → 仍然悬空。
      expect(unreferenced).toContain('ViaOrphanRule');
      await fs.rm(tmp, { recursive: true, force: true });
    });
  });

  it('flags permissions matrix api references as warnings', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-xref-'));
    await writeProject(tmp, {
      'COMETFLOW.md': COMETFLOW,
      'specs/auth/spec.md': '# auth\n\n## POST /login\n\n## Acceptance\n\n- A1：ok\n',
      'specs/permissions.md': '# 认证与鉴权\n\n## 角色定义\n\n| 角色 | 说明 |\n|------|------|\n| admin | 全部 |\n\n## 接口级权限\n\n| API | admin |\n|-----|-------|\n| GET /missing | ✓ |\n',
    });
    const result = await validateSpecs(tmp);
    expect(result.findings.some((finding) => finding.code === 'unresolved-api-reference')).toBe(true);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('flags unresolved capability protocol references', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-xref-'));
    const protocol = '# 通信协议\n\n## 请求头\n\n| 头 | 类型 |\n|----|------|\n| User-Agent | string |\n\n## 状态码总表\n\n| 状态码 | 含义 |\n|--------|------|\n| 200 | OK |\n';
    await writeProject(tmp, {
      'COMETFLOW.md': COMETFLOW,
      'specs/protocol.md': protocol,
      'specs/auth/spec.md': '# auth\n\n## POST /login\n\n协议头：X-Missing\n状态码：499\n\n## Acceptance\n\n- A1：ok\n',
    });
    const result = await validateSpecs(tmp);
    expect(result.findings.filter((finding) => finding.code === 'unresolved-protocol-reference')).toHaveLength(2);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('resolves capability protocol references when defined', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-xref-'));
    const protocol = '# 通信协议\n\n## 请求头\n\n| 头 | 类型 |\n|----|------|\n| User-Agent | string |\n\n## 状态码总表\n\n| 状态码 | 含义 |\n|--------|------|\n| 200 | OK |\n';
    await writeProject(tmp, {
      'COMETFLOW.md': COMETFLOW,
      'specs/protocol.md': protocol,
      'specs/auth/spec.md': '# auth\n\n## POST /login\n\n协议头：User-Agent\n状态码：200\n\n## Acceptance\n\n- A1：ok\n',
    });
    const result = await validateSpecs(tmp);
    expect(result.findings.filter((finding) => finding.severity === 'error')).toHaveLength(0);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('validates flow model and config references', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-xref-'));
    await writeProject(tmp, {
      'COMETFLOW.md': COMETFLOW,
      'specs/models.md': '# 数据模型\n\n## 实体：User\n',
      'specs/config.md': '# 运行时配置\n\n## 配置项\n\n| 键 | 类型 |\n|----|------|\n| platform.url | string |\n',
      'specs/auth/spec.md': '# auth\n\n## POST /login\n\n## Acceptance\n\n- A1：ok\n',
      'specs/flows/login.md': '# 场景：登录\n\n## 前置条件\n- 无\n\n## 步骤\n\n### 步骤1：调用登录\n调用 POST /login\n\n模型：Ghost\n配置：missing.key\n\n## 后置条件\n- 成功\n',
    });
    const result = await validateSpecs(tmp);
    expect(result.findings.some((finding) => finding.code === 'unresolved-model-reference')).toBe(true);
    expect(result.findings.some((finding) => finding.code === 'unresolved-config-reference')).toBe(true);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('validates capability request/response fields against models', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-xref-'));
    await writeProject(tmp, {
      'COMETFLOW.md': COMETFLOW,
      'specs/models.md': '# 数据模型\n\n## 实体：User\n\n| 字段 | 类型 |\n|------|------|\n| username | string |\n| token | string |\n',
      'specs/auth/spec.md': [
        '# auth',
        '',
        '## POST /login',
        '',
        '模型：User',
        '',
        '### 请求体',
        '',
        '| 字段 | 类型 |',
        '|------|------|',
        '| username | string |',
        '',
        '### 响应',
        '',
        '| 字段 | 类型 |',
        '|------|------|',
        '| token | string |',
        '',
        '## Acceptance',
        '',
        '- A1：ok',
      ].join('\n'),
    });
    const result = await validateSpecs(tmp);
    expect(result.findings.filter((finding) => finding.severity === 'error')).toHaveLength(0);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('flags unresolved capability field references', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-xref-'));
    await writeProject(tmp, {
      'COMETFLOW.md': COMETFLOW,
      'specs/models.md': '# 数据模型\n\n## 实体：User\n\n| 字段 | 类型 |\n|------|------|\n| username | string |\n',
      'specs/auth/spec.md': [
        '# auth',
        '',
        '## POST /login',
        '',
        '模型：User',
        '',
        '### 请求体',
        '',
        '| 字段 | 类型 |',
        '|------|------|',
        '| password | string |',
        '',
        '## Acceptance',
        '',
        '- A1：ok',
      ].join('\n'),
    });
    const result = await validateSpecs(tmp);
    expect(result.findings.some((finding) => finding.code === 'unresolved-field-reference')).toBe(true);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('warns when capability declares fields without a model binding', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-xref-'));
    await writeProject(tmp, {
      'COMETFLOW.md': COMETFLOW,
      'specs/auth/spec.md': [
        '# auth',
        '',
        '## POST /login',
        '',
        '### 请求体',
        '',
        '| 字段 | 类型 |',
        '|------|------|',
        '| username | string |',
        '',
        '## Acceptance',
        '',
        '- A1：ok',
      ].join('\n'),
    });
    const result = await validateSpecs(tmp);
    expect(result.findings.some((finding) => finding.code === 'missing-model-binding')).toBe(true);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('flags unresolved process api references as warnings', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-xref-'));
    await writeProject(tmp, {
      'COMETFLOW.md': COMETFLOW,
      'specs/auth/spec.md': '# auth\n\n## POST /login\n\n## Acceptance\n\n- A1：ok\n',
      'specs/processes.md': '# 后台进程\n\n## 进程：心跳\n\n调用 POST /missing\n',
    });
    const result = await validateSpecs(tmp);
    expect(result.findings.some((finding) => finding.code === 'unresolved-api-reference')).toBe(true);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('warns when a referenced target kind is missing', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-xref-'));
    await writeProject(tmp, {
      'COMETFLOW.md': COMETFLOW,
      'specs/auth/spec.md': '# auth\n\n## POST /login\n\n模型：User\n\n## Acceptance\n\n- A1：ok\n',
    });
    const result = await validateSpecs(tmp);
    expect(result.findings.some((finding) => finding.code === 'missing-reference-target')).toBe(true);
    expect(result.valid).toBe(true);
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
