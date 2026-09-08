import { describe, expect, it } from 'vitest';
import { parseFlow, parseModels } from '../../domains/spec/spec-model.js';

describe('spec model parsers', () => {
  it('parses models entities, enums, and state machines', () => {
    const content = [
      '# 数据模型',
      '',
      '## 实体：User',
      '',
      '| 字段 | 类型 | 必填 | 唯一 | 说明 |',
      '|------|------|------|------|------|',
      '| id | string (UUID) | 是 | 是 | 主键 |',
      '| name | string | 否 | 否 | 名称 |',
      '',
      '## 枚举',
      '',
      '- 0=文档',
      '- 1=图片',
      '',
      '## 状态机：User',
      '',
      '| 当前状态 | 事件 | 目标状态 |',
      '|----------|------|----------|',
      '| pending | approve | active |',
    ].join('\n');
    const models = parseModels(content);
    expect(models.entities).toHaveLength(1);
    expect(models.entities[0].name).toBe('User');
    expect(models.entities[0].fields).toHaveLength(2);
    expect(models.entities[0].fields[0]).toEqual({ name: 'id', type: 'string (UUID)', required: true, unique: true, description: '主键' });
    expect(models.enums).toEqual([['0=文档', '1=图片']]);
    expect(models.stateMachines).toHaveLength(1);
    expect(models.stateMachines[0].transitions).toEqual([{ from: 'pending', event: 'approve', to: 'active' }]);
  });

  it('parses flow steps, branches, polling, and references', () => {
    const content = [
      '# 场景：登录',
      '',
      '## 前置条件',
      '- 系统中无该用户',
      '',
      '## 步骤',
      '',
      '### 步骤1：调用登录',
      '调用 \`POST /login\`（参考 specs/auth/spec.md）',
      '',
      '#### 路径A：type = 0',
      '→ 跳转到 步骤2',
      '',
      '### 步骤2-R [轮询]',
      '调用 \`GET /status\`',
      '',
      '## 后置条件',
      '- 数据库新增记录',
    ].join('\n');
    const flow = parseFlow(content, 'specs/flows/login.md');
    expect(flow.name).toBe('场景：登录');
    expect(flow.preconditions).toEqual(['系统中无该用户']);
    expect(flow.postconditions).toEqual(['数据库新增记录']);
    expect(flow.steps).toHaveLength(2);
    expect(flow.steps[0].apiRefs[0].path).toBe('/login');
    expect(flow.steps[0].branches).toContain('路径A = type = 0');
    expect(flow.steps[1].polling).toBe(true);
  });
});
