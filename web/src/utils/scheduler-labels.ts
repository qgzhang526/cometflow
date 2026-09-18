/**
 * 调度器的机器词 → 人话（含语义色与解释）。
 *
 * 面板上原本直接渲染 `waiting-on-active-change` / `needs-human:verify-failed` 这类字符串：
 * 它们**准确但不可读**，而且"停机了"与"队列空了"看起来一样。这里只做翻译，不改判据——
 * 认不出来的词一律原样显示（后端新增状态词时，界面不能装作没看见）。
 */
export type BadgeTone = 'ok' | 'warn' | 'err' | 'gray' | 'brand';

export interface Labeled {
  text: string;
  tone: BadgeTone;
  /** 悬停解释：为什么停 / 该做什么。 */
  hint?: string;
}

const STOP_REASONS: Record<string, Labeled> = {
  'no-queued-task': {
    text: '队列空了',
    tone: 'gray',
    hint: '没有可领取的待办：要么全交付了，要么剩下的都在等依赖交付',
  },
  'waiting-on-active-change': {
    text: '在等在飞 change 让出 module',
    tone: 'warn',
    hint: '候选的 module 被在飞的 change 占着（相等 / 嵌套 / 未声明），等它交付或归档后自然继续',
  },
  'budget-exhausted': {
    text: '预算耗尽',
    tone: 'warn',
    hint: 'cometflow daemon budget . --reset 后重新启动',
  },
  'stopped-by-control': {
    text: '收到停止指令',
    tone: 'gray',
    hint: '页面或 CLI 按下停止：只停止领取新任务，已在跑的槽跑完',
  },
  'needs-human': {
    text: '需人工介入',
    tone: 'err',
    hint: '后面的 verdict 指出卡在哪一步（spec 冲突 / 验收反复不过 / 前置检查判不出来）',
  },
  'lease-held': {
    text: '已有调度器在跑',
    tone: 'warn',
    hint: '单实例租约：等它结束，或等心跳过期后接管',
  },
  'manual-single-pass': {
    text: 'manual：单轮结束',
    tone: 'gray',
    hint: 'manual 模式只做一次回收 / 快照 / 状态投影，不进循环',
  },
};

const DECISION_REASONS: Record<string, Labeled> = {
  started: { text: '刚启动', tone: 'gray' },
  'task-delivered': { text: '交付了一条任务', tone: 'ok' },
  'task-retry': { text: '这条没成，按尝试上限重试', tone: 'warn' },
  'task-needs-human': { text: '这条需要人工介入', tone: 'err' },
  'paused-by-control': { text: '按指令暂停', tone: 'gray' },
  ...STOP_REASONS,
};

const VERDICTS: Record<string, Labeled> = {
  delivered: { text: '已交付', tone: 'ok', hint: 'change 已归档，验收通过' },
  'agent-failed': {
    text: 'builder 失败',
    tone: 'warn',
    hint: 'agent 退出码非 0：可重试，达到尝试上限后标记 failed',
  },
  'verify-failed': {
    text: '验收未通过',
    tone: 'warn',
    hint: '独立验收有项没过：细节见 changes/<name>/verification.md',
  },
  unverifiable: {
    text: '验收判不出来',
    tone: 'err',
    hint: '验收没有可执行的 check / eval / verifier：补契约，或调低前置检查档位',
  },
  'spec-conflict': {
    text: 'spec 基线冲突',
    tone: 'err',
    hint: '选 rebase 或建 reconciliation change，不静默覆盖',
  },
  error: { text: '出错', tone: 'err' },
  'in-flight': {
    text: '别人在做（调度器让开）',
    tone: 'gray',
    hint: '同名任务上已有非调度器命名的 change',
  },
};

function unknown(tone: BadgeTone, raw: string): Labeled {
  return { text: raw, tone, hint: '未识别的状态词：界面原样显示，避免把新状态吞掉' };
}

/** 停止原因。`needs-human:<verdict>` 会把 verdict 一起翻出来。 */
export function stopReasonLabel(reason: string | null | undefined): Labeled | null {
  if (!reason) return null;
  const separator = reason.indexOf(':');
  const head = separator < 0 ? reason : reason.slice(0, separator);
  const tail = separator < 0 ? '' : reason.slice(separator + 1);
  const base = STOP_REASONS[head];
  if (head === 'needs-human' && tail !== '') {
    return { ...(base ?? unknown('err', head)), text: '需人工介入：' + (verdictLabel(tail)?.text ?? tail) };
  }
  return base ?? unknown('gray', reason);
}

/** 最近一次决策的原因（含"跑了什么"的那几种）。 */
export function decisionReasonLabel(reason: string | null | undefined): Labeled | null {
  if (!reason) return null;
  if (reason.startsWith('needs-human')) return stopReasonLabel(reason);
  return DECISION_REASONS[reason] ?? unknown('gray', reason);
}

/** 任务的交付结论（delivered / agent-failed / verify-failed / …）。 */
export function verdictLabel(verdict: string | null | undefined): Labeled | null {
  if (!verdict) return null;
  return VERDICTS[verdict] ?? unknown('gray', verdict);
}
