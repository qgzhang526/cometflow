import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSpecFile } from '../../domains/spec/spec-parse.js';
import { parseSpecContent } from '../../domains/spec/spec-parse.js';
import { validateSpecs } from '../../domains/spec/spec-validate.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spec-kernel-project');

describe('spec kernel', () => {
  it('parses anchors and acceptance items', async () => {
    const parsed = await parseSpecFile(fixture, 'specs/auth/spec.md');
    expect(parsed.anchors.length).toBe(2);
    expect(parsed.acceptance.length).toBe(2);
  });

  it('validates the fixture project', async () => {
    const result = await validateSpecs(fixture);
    expect(result.valid).toBe(true);
  });

  it('binds anchors to level-2 headings and treats repeated sub-headings as detail', () => {
    const content = [
      '# engine capability',
      '',
      '## GET /state',
      '',
      '### 请求',
      '',
      '无请求体。',
      '',
      '### 响应',
      '',
      '返回状态。',
      '',
      '## POST /tick',
      '',
      '### 请求',
      '',
      '无请求体。',
      '',
      '### 响应',
      '',
      '返回结算结果。',
      '',
    ].join('\n');
    const parsed = parseSpecContent(content, 'specs/engine/spec.md');

    expect(parsed.anchors.map((anchor) => anchor.heading)).toEqual(['GET /state', 'POST /tick']);
    expect(new Set(parsed.anchors.map((anchor) => anchor.id)).size).toBe(2);
    // `### 请求` 属于各自 endpoint 的正文，因此两个 anchor 的哈希必须不同。
    expect(parsed.anchors[0].hash).not.toBe(parsed.anchors[1].hash);
  });

  it('falls back to level-3 anchors when a spec has no level-2 heading', () => {
    const parsed = parseSpecContent('# flow\n\n### 步骤1 开始\n\n做点事。\n', 'specs/flows/x.md');
    expect(parsed.anchors.map((anchor) => anchor.heading)).toEqual(['步骤1 开始']);
  });

  it('attaches acceptance items to the nearest preceding anchor', () => {
    const content = [
      '## POST /a',
      '',
      '### Acceptance',
      '',
      '- A1：甲',
      '',
      '## POST /b',
      '',
      '### Acceptance',
      '',
      '- A2：乙',
      '',
    ].join('\n');
    const parsed = parseSpecContent(content, 'specs/x/spec.md');
    expect(parsed.anchors[0].acceptance.map((item) => item.id)).toEqual(['A1']);
    expect(parsed.anchors[1].acceptance.map((item) => item.id)).toEqual(['A2']);
  });
});
