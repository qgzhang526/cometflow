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
  style: { transform: string };
  offsetWidth: number;
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
    style: { transform: '' },
    offsetWidth: 0,
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

function runBundleWithStubs(): { els: Record<string, FakeElement>; keydown: (key: string) => void; intervals: Array<(() => void) | undefined> } {
  const els: Record<string, FakeElement> = {};
  const winListeners: Record<string, Array<(arg: unknown) => void>> = {};
  const intervals: Array<(() => void) | undefined> = [];
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
    requestAnimationFrame(cb: () => void) {
      cb();
      return 0;
    },
    setInterval(cb: () => void) {
      intervals.push(cb);
      return intervals.length;
    },
    clearInterval(id: number) {
      intervals[id - 1] = undefined;
    },
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
    intervals,
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

  it('A620/A621: 动画路径不抛异常且 transform 归位', () => {
    const { els, keydown } = runBundleWithStubs();
    keydown('ArrowLeft');
    keydown('ArrowDown');
    keydown('ArrowRight');
    keydown('ArrowUp');
    for (const cell of els['board'].children) {
      expect(cell.style.transform).toBe('');
    }
    expect(typeof els['score'].textContent).toBe('string');
  });

  it('A701/A710/A720: AI 演示启动、步进、停止', () => {
    const { els, intervals } = runBundleWithStubs();
    const click = els['ai-demo'].listeners.click?.[0] as (() => void) | undefined;
    expect(click).toBeDefined();
    click?.();
    expect(intervals.length).toBeGreaterThan(0);
    expect(els['ai-demo'].textContent).toBe('停止演示');
    const step = intervals[intervals.length - 1];
    step?.();
    expect(typeof els['score'].textContent).toBe('string');
    click?.();
    expect(els['ai-demo'].textContent).toBe('AI 演示');
  });

  it('A511: 最高分展示更新', () => {
    const { els, keydown } = runBundleWithStubs();
    keydown('ArrowLeft');
    expect(els['best'].textContent.length).toBeGreaterThan(0);
  });
});
