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
});
