import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectSpecGraph } from '../../domains/spec/spec-graph.js';
import { validateSpecs } from '../../domains/spec/spec-validate.js';
import { extractRefSpans } from '../../domains/spec/spec-structure.js';

/**
 * 引用关系图（008 §8.6②）：kind → 文件 → anchor 三级 + 跨文件引用边。
 *
 * 关键约束是「与 `spec validate` 同源」：图上红色的边必须与门禁报的错是同一批引用，
 * 而不是两套各自维护的判断。
 */

let tmp: string;

async function write(relativePath: string, content: string): Promise<void> {
  const absolute = path.join(tmp, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content);
}

const MODELS = ['# 数据模型', '', '## 实体：Colony', '', '| 字段 | 类型 | 必填 | 唯一 | 说明 |', '|---|---|---|---|---|', '| id | string | 是 | 是 | 主键 |', '| name | string | 是 | 否 | 名称 |', ''].join('\n');
const ERRORS = ['# 错误码目录', '', '## 错误码', '', '| code | 语义 | 触发接口 |', '|---|---|---|', '| E_BOOM | 爆炸 | POST /x |', ''].join('\n');
const CONFIG = ['# 运行时配置', '', '## 配置项', '', '| 键 | 类型 | 默认值 | 必填 | 敏感 | 说明 |', '|---|---|---|---|---|---|', '| tick.intervalMs | integer | 1000 | 否 | 否 | tick 间隔 |', ''].join('\n');
const PROTOCOL = ['# 通信协议', '', '## 请求头', '', '| 头 | 类型 | 必填 | 说明 |', '|---|---|---|---|', '| Authorization | string | 否 | 认证 |', '', '## 状态码总表', '', '| 状态码 | 含义 | 说明 |', '|---|---|---|', '| 200 | OK | 成功 |', '| 404 | Not Found | 不存在 |', ''].join('\n');
const ENGINE = [
  '# engine capability',
  '',
  '## GET /state',
  '',
  '读取状态。',
  '',
  '- 模型：Colony',
  '- 状态码：404',
  '- 协议头：Authorization',
  '',
  '## 验收',
  '',
  '- A001：返回状态',
  '',
].join('\n');
const FLOW = [
  '# 建造流程',
  '',
  '## 前置条件',
  '',
  '- 模型：Colony',
  '',
  '## 步骤',
  '',
  '### 步骤1 查询',
  '',
  '- 调用 `GET /state`',
  '- 配置键：tick.intervalMs',
  '',
  '## 后置条件',
  '',
  '- 殖民地已更新',
  '',
].join('\n');
const RULES_OK = ['# 领域规则', '', '## 规则：能量前提', '', '- 语义：投产前必须校验能量', '- 模型：Colony', ''].join('\n');
const RULES_BROKEN = ['# 领域规则', '', '## 规则：能量前提', '', '- 语义：投产前必须校验能量', '- 模型：Colony', '- 模型：Ghost', ''].join('\n');
const FLOW_BROKEN = ['# 建造流程', '', '## 步骤', '', '### 步骤1 查询', '', '- 调用 `POST /nope`', ''].join('\n');

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cometflow-spec-graph-'));
  await write('specs/models.md', MODELS);
  await write('specs/errors.md', ERRORS);
  await write('specs/config.md', CONFIG);
  await write('specs/protocol.md', PROTOCOL);
  await write('specs/engine/spec.md', ENGINE);
  await write('specs/flows/build.md', FLOW);
  await write('specs/rules.md', RULES_OK);
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('spec graph projection', () => {
  it('collects ref spans with positions so highlight and graph share one syntax', () => {
    const spans = ['- 模型：Colony', '- 状态码：404', '- 调用 `GET /state`'].flatMap((line) => extractRefSpans(line));
    expect(spans.map((span) => span.kind + ':' + span.value)).toEqual(['model:Colony', 'status:404', 'api:GET /state']);
    const line = '- 调用 `GET /state`';
    const api = extractRefSpans(line).find((span) => span.kind === 'api')!;
    expect(line.slice(api.start, api.end)).toBe('GET /state');
    const model = extractRefSpans('- 模型：Colony')[0];
    expect('- 模型：Colony'.slice(model.start, model.end)).toBe('Colony');
  });

  it('builds kind/file/anchor nodes and resolves cross-file references', async () => {
    const graph = await collectSpecGraph(tmp);

    expect(graph.summary.kinds).toBe(12);
    expect(graph.nodes.find((node) => node.id === 'anchor:specs/engine/spec.md#GET /state')?.acceptance).toBe(1);
    expect(graph.nodes.find((node) => node.id === 'file:specs/engine/spec.md')?.kind).toBe('capability');
    expect(graph.nodes.find((node) => node.id === 'kind:flow')?.status).toBe('present');
    expect(graph.nodes.find((node) => node.id === 'kind:pages')?.status).toBe('absent');

    // 目标节点：实体、配置键、协议头、状态码、接口。
    const targetIds = graph.nodes.filter((node) => node.level === 'target').map((node) => node.id);
    expect(targetIds).toContain('target:model:Colony');
    expect(targetIds).toContain('target:config:tick.intervalMs');
    expect(targetIds).toContain('target:header:Authorization');
    expect(targetIds).toContain('target:status:404');
    expect(targetIds).toContain('target:api:GET /state');

    // 引用边带位置，且未解析数为 0。
    const apiEdge = graph.edges.find((edge) => edge.refKind === 'api' && edge.resolved);
    expect(apiEdge?.to).toBe('target:api:GET /state');
    expect(apiEdge?.site?.path).toBe('specs/flows/build.md');
    // 引用边带行号（用于悬停定位），但不把行号写死在测试里。
    const siteLine = apiEdge?.site?.line ?? 0;
    expect(siteLine).toBeGreaterThan(0);
    const flowLines = FLOW.split('\n');
    expect(flowLines[siteLine - 1]).toContain('GET /state');
    expect(graph.unresolved).toEqual([]);

    // kind 层聚合边：flow → capability / models / config，capability → models。
    const kindEdges = graph.edges.filter((edge) => edge.level === 'reference' && edge.from.startsWith('kind:'));
    const pairs = kindEdges.map((edge) => edge.from + '->' + edge.to);
    expect(pairs).toContain('kind:flow->kind:capability');
    expect(pairs).toContain('kind:flow->kind:config');
    expect(pairs).toContain('kind:capability->kind:models');
    expect(kindEdges.find((edge) => edge.from === 'kind:capability' && edge.to === 'kind:models')?.resolved).toBe(true);
  });

  it('marks broken references with the same code and severity as spec validate', async () => {
    await write('specs/rules.md', RULES_BROKEN);
    await write('specs/flows/build.md', FLOW_BROKEN);

    const graph = await collectSpecGraph(tmp);
    const graphSet = new Set(
      graph.unresolved
        .filter((entry) => entry.code.startsWith('unresolved-'))
        .map((entry) => entry.path + '|' + entry.code + '|' + entry.value),
    );
    expect(graphSet).toEqual(
      new Set([
        'specs/rules.md|unresolved-model-reference|Ghost',
        'specs/flows/build.md|unresolved-api-reference|POST /nope',
      ]),
    );

    // 同源断言：validate 的未解析引用集合与图完全一致。
    const validation = await validateSpecs(tmp);
    const validationSet = new Set(
      validation.findings
        .filter((finding) => finding.code.startsWith('unresolved-'))
        .map((finding) => finding.path + '|' + finding.code + '|' + finding.message.slice(finding.message.lastIndexOf(': ') + 2)),
    );
    expect(graphSet).toEqual(validationSet);
  });

  it('reports a missing target file as missing-reference-target (warning), not as an unresolved definition', async () => {
    await fs.rm(path.join(tmp, 'specs', 'models.md'));
    const graph = await collectSpecGraph(tmp);

    const modelRefs = graph.unresolved.filter((entry) => entry.refKind === 'model');
    expect(modelRefs.length).toBeGreaterThan(0);
    expect(modelRefs.every((entry) => entry.code === 'missing-reference-target' && entry.severity === 'warning')).toBe(true);

    const validation = await validateSpecs(tmp);
    const validateWarnings = validation.findings.filter((finding) => finding.code === 'missing-reference-target' && finding.message.includes('模型'));
    expect(validateWarnings.length).toBe(modelRefs.length);
  });
});
