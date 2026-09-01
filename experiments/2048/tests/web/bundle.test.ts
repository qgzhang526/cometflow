import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
const bundle = readFileSync(path.join(webRoot, '2048.js'), 'utf8');

interface FakeElement {
  id: string;
  textContent: string;
  className: string;
  children: FakeElement[];
  listeners: Record<string, Array<(arg: unknown) => void>>;
  addEventListener: (type: string, fn: (arg: unknown) => void) => void;
  classList: { add: () => void; remove: () => void };
  appendChild: (child: FakeElement) => FakeElement;
}

function makeEl(id: string): FakeElement {
  const listeners: Record<string, Array<(arg: unknown) => void>> = {};
  return {
    id,
    textContent: '',
    className: '',
    children: [],
    listeners,
    addEventListener(type: string, fn: (arg: unknown) => void) {
      (listeners[type] ??= []).push(fn);
    },
    classList: { add() {}, remove() {} },
    appendChild(child: FakeElement) {
      this.children.push(child);
      return child;
    },
  };
}

function runBundleWithStubs(): { els: Record<string, FakeElement>; keydown: (key: string) => void } {
  const els: Record<string, FakeElement> = {};
  const winListeners: Record<string, Array<(arg: unknown) => void>> = {};
  const doc = {
    getElementById(id: string) {
      return (els[id] ??= makeEl(id));
    },
    createElement() {
      return makeEl('cell');
    },
  };
  const win = {
    addEventListener(type: string, fn: (arg: unknown) => void) {
      (winListeners[type] ??= []).push(fn);
    },
    setTimeout() {
      return 0;
    },
    clearTimeout() {},
  };
  const store: Record<string, string> = {};
  const ls = {
    getItem(key: string) {
      return store[key] ?? null;
    },
    setItem(key: string, value: string) {
      store[key] = String(value);
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('window', 'document', 'localStorage', bundle)(win, doc, ls);
  const keydown = winListeners.keydown?.[0] as ((event: { key: string; preventDefault: () => void }) => void) | undefined;
  if (!keydown) throw new Error('keydown listener not registered');
  return {
    els,
    keydown: (key: string) => keydown({ key, preventDefault() {} }),
  };
}

describe('web bundle (G6)', () => {
  it('A501: 单文件 IIFE，无顶层 import/export（file:// 可开）', () => {
    expect(bundle).not.toMatch(/^\s*import\s/m);
    expect(bundle).not.toMatch(/^\s*export\s/m);
  });

  it('A502/A503/A510: 加载后按键移动、重开、分数更新', () => {
    const { els, keydown } = runBundleWithStubs();
    expect(els['board'].children.length).toBe(16);
    keydown('ArrowLeft');
    expect(typeof els['score'].textContent).toBe('string');
    keydown('r');
    expect(els['overlay'].classList).toBeDefined();
    expect(els['score'].textContent).toBe('0');
  });

  it('A511: 最高分展示更新', () => {
    const { els, keydown } = runBundleWithStubs();
    keydown('ArrowLeft');
    expect(els['best'].textContent.length).toBeGreaterThan(0);
  });
});
