import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { promptBoolean, promptChoice, promptLine } from '../../platform/io/prompt.js';

function inputFrom(text: string): Readable {
  const stream = new Readable({ read() {} });
  stream.push(text);
  stream.push(null);
  return stream;
}

function sink(): Writable {
  return new Writable({ write(_chunk, _encoding, callback) { callback(); } });
}

describe('prompt helpers (injectable io)', () => {
  it('promptLine returns fallback on empty input', async () => {
    expect(await promptLine('前端框架', '无', { input: inputFrom('\n'), output: sink() })).toBe('无');
    expect(await promptLine('后端', '', { input: inputFrom('Golang\n'), output: sink() })).toBe('Golang');
  });

  it('promptBoolean reads y/n', async () => {
    expect(await promptBoolean('网络？', { input: inputFrom('y\n'), output: sink() })).toBe(true);
    expect(await promptBoolean('网络？', { input: inputFrom('n\n'), output: sink() })).toBe(false);
  });

  it('promptChoice returns the matched token', async () => {
    expect(await promptChoice('鉴权方式', ['none', 'machine', 'roles'] as const, { input: inputFrom('roles\n'), output: sink() })).toBe('roles');
    expect(await promptChoice('鉴权方式', ['none', 'machine', 'roles'] as const, { input: inputFrom('bogus\n'), output: sink() })).toBe('none');
  });

  it('promptChoice accepts an empty answer as the first choice', async () => {
    expect(await promptChoice('鉴权方式', ['none', 'machine', 'roles'] as const, { input: inputFrom('\n'), output: sink() })).toBe('none');
  });

  it('promptChoice resolves aliases such as 无 / 机机 / 角色', async () => {
    const io = (text: string) => ({ input: inputFrom(text), output: sink() });
    const options = { aliases: { '无': 'none', '机机': 'machine', '角色': 'roles' } } as const;
    expect(await promptChoice('鉴权方式', ['none', 'machine', 'roles'] as const, io('无\n'), options)).toBe('none');
    expect(await promptChoice('鉴权方式', ['none', 'machine', 'roles'] as const, io('机机\n'), options)).toBe('machine');
    expect(await promptChoice('鉴权方式', ['none', 'machine', 'roles'] as const, io('角色\n'), options)).toBe('roles');
  });

  it('promptChoice re-asks on a terminal after invalid input instead of silently defaulting', async () => {
    const input = new Readable({ read() {} });
    (input as Readable & { isTTY?: boolean }).isTTY = true;
    input.push('bogus\n');
    setTimeout(() => input.push('机机\n'), 20);

    const result = await promptChoice('鉴权方式', ['none', 'machine', 'roles'] as const, { input, output: sink() }, { aliases: { '机机': 'machine' } });
    expect(result).toBe('machine');
  });

  it('promptChoice falls back instead of hanging on exhausted piped input', async () => {
    const result = await promptChoice('鉴权方式', ['none', 'machine', 'roles'] as const, {
      input: inputFrom('bogus\n'),
      output: sink(),
    }, { aliases: { '机机': 'machine' } });
    expect(result).toBe('none');
  });
});
