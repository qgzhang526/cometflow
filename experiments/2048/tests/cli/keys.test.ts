import { describe, expect, it } from 'vitest';
import { normalizeKey } from '../../src/cli/keys.js';

describe('FR-CLI-002 输入与控制 - keys', () => {
  it('A110: WASD 按键映射到移动方向', () => {
    expect(normalizeKey('w')).toBe('up');
    expect(normalizeKey('a')).toBe('left');
    expect(normalizeKey('s')).toBe('down');
    expect(normalizeKey('d')).toBe('right');
    expect(normalizeKey('W')).toBe('up');
    expect(normalizeKey('A')).toBe('left');
    expect(normalizeKey('S')).toBe('down');
    expect(normalizeKey('D')).toBe('right');
  });

  it('A110: 方向键映射到移动方向', () => {
    expect(normalizeKey('ArrowUp')).toBe('up');
    expect(normalizeKey('ArrowDown')).toBe('down');
    expect(normalizeKey('ArrowLeft')).toBe('left');
    expect(normalizeKey('ArrowRight')).toBe('right');
  });

  it('A111: q 退出，r 重开', () => {
    expect(normalizeKey('q')).toBe('quit');
    expect(normalizeKey('Q')).toBe('quit');
    expect(normalizeKey('r')).toBe('restart');
    expect(normalizeKey('R')).toBe('restart');
  });

  it('A112: 非法输入映射为 invalid 且不抛错', () => {
    expect(normalizeKey('!')).toBe('invalid');
    expect(normalizeKey('zzz')).toBe('invalid');
    expect(normalizeKey('')).toBe('invalid');
    expect(normalizeKey('\u0000')).toBe('invalid');
  });
});
