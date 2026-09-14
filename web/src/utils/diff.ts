export type DiffKind = 'same' | 'add' | 'del';

export interface DiffLine {
  kind: DiffKind;
  text: string;
}

const MAX_LINES = 1500;

/**
 * 行级 diff（LCS）。
 *
 * 只用于「保存前看一眼改了什么」，因此保持无依赖、可预测：行数超过上限时退化为
 * 「整块替换」的粗粒度结果，而不是卡住界面。
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return [
      ...a.map((text) => ({ kind: 'del' as const, text })),
      ...b.map((text) => ({ kind: 'add' as const, text })),
    ];
  }

  const lengths: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] });
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      out.push({ kind: 'del', text: a[i] });
      i += 1;
    } else {
      out.push({ kind: 'add', text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) {
    out.push({ kind: 'del', text: a[i] });
    i += 1;
  }
  while (j < b.length) {
    out.push({ kind: 'add', text: b[j] });
    j += 1;
  }
  return out;
}

export function summarizeDiff(lines: DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((line) => line.kind === 'add').length,
    removed: lines.filter((line) => line.kind === 'del').length,
  };
}
