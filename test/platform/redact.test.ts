import { describe, expect, it } from 'vitest';
import { REDACTED, redactDeep, redactSecrets } from '../../platform/io/redact.js';

describe('redactSecrets', () => {
  it('masks high-confidence credential shapes', () => {
    const cases: [string, string][] = [
      ['key=sk-abcdefghijklmnopqrstuvwx', 'sk-'],
      ['token ghp_abcdefghijklmnopqrstuvwxyz01', 'ghp_abcdefghijklmnopqrstuvwxyz01'],
      ['AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE'],
      ['Authorization: Bearer abcdefghijklmnopqrstuvwxyz', 'abcdefghijklmnopqrstuvwxyz'],
      ['xoxb-1234567890-abcdefghijkl', 'xoxb-'],
      ['postgres://user:s3cr3tP4ss@db.internal:5432/app', 's3cr3tP4ss'],
      [
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
        'eyJhbGciOiJIUzI1NiJ9',
      ],
    ];
    for (const [input, secret] of cases) {
      const output = redactSecrets(input, { aggressive: true });
      expect(output).not.toContain(secret);
      expect(output).toContain(REDACTED);
    }
  });

  it('keeps the surrounding structure so the evidence is still readable', () => {
    const output = redactSecrets('postgres://user:s3cr3tP4ss@db.internal/app', { aggressive: true });
    expect(output).toContain('postgres://user:');
    expect(output).toContain('@db.internal/app');
  });

  it('only applies the generic key-value rule in aggressive mode', () => {
    const input = 'password: hunter2hunter2';
    expect(redactSecrets(input)).toBe(input);
    expect(redactSecrets(input, { aggressive: true })).toContain(REDACTED);
  });

  it('does not mangle spec contract examples in the non-aggressive mode', () => {
    const spec = [
      '| 键 | 类型 | 说明 |',
      '|----|------|------|',
      '| password | string | 口令 |',
      'api_key: string',
      'token: required',
    ].join('\n');
    expect(redactSecrets(spec)).toBe(spec);
  });

  it('is idempotent', () => {
    const once = redactSecrets('key sk-abcdefghijklmnopqrstuvwx', { aggressive: true });
    expect(redactSecrets(once, { aggressive: true })).toBe(once);
  });
});

describe('redactDeep', () => {
  it('redacts strings and sensitive keys in nested structures', () => {
    const output = redactDeep(
      {
        note: 'using sk-abcdefghijklmnopqrstuvwx',
        nested: { token: 'plainvalue', keep: 'visible' },
        list: [{ password: 'p@ssw0rd-long' }],
      },
      { aggressive: true },
    ) as Record<string, unknown>;

    expect(JSON.stringify(output)).not.toContain('sk-abcdefghijklmnopqrstuvwx');
    expect(JSON.stringify(output)).not.toContain('plainvalue');
    expect(JSON.stringify(output)).not.toContain('p@ssw0rd-long');
    expect(JSON.stringify(output)).toContain('visible');
  });

  it('leaves non-string leaves untouched', () => {
    const output = redactDeep({ count: 3, flag: true, nothing: null });
    expect(output).toEqual({ count: 3, flag: true, nothing: null });
  });
});
