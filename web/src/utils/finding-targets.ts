import type { Finding } from '../api/types';
import { PANELS, type PanelId } from '../panels';

/**
 * 问题清单 → **能把它处理掉的那一页**。
 *
 * 只给面板是不够的：spec verify 的结论都归「规格」，但"spec 与 spec-lock 不一致"要在
 * 「影响与门禁」里点「建立基线」，锚点漂移要在「Spec 文件」里看正文，版本缺失要去「版本」——
 * 落到默认页签（12-kind 状态）等于让人自己找，正是这条 finding 被投诉的地方。
 *
 * 所以映射到 `(panel, tab, subject)`：`subject` 是出问题的那份 spec / 那个 change，
 * 落地面板据此聚焦并把"为什么来这里"写在页面上。写错的 tab 由面板忽略（面板自己校验页签 id）。
 */
export interface PanelTarget {
  panel: PanelId;
  tab?: string;
  subject?: string;
  /** 落地页显示的一句话：这里能做什么。 */
  reason?: string;
}

/** 把 spec 路径这类 subject 收敛成面板要的形式（空串 = 没有具体对象）。 */
function subjectOf(finding: Finding): string | undefined {
  const subject = finding.subject.trim();
  return subject === '' ? undefined : subject;
}

export function targetForFinding(finding: Finding): PanelTarget | null {
  // doctor 会把 spec verify 的结论镜像成 `spec-verify:<code>`（合并时已丢弃镜像，这里再兜一层）。
  const code = finding.code.startsWith('spec-verify:') ? finding.code.slice('spec-verify:'.length) : finding.code;
  const subject = subjectOf(finding);

  switch (code) {
    // 基线过期 / 缺失：处理点在「影响与门禁」——那里同时有「建立基线（spec lock）」与影响分析。
    case 'missing-spec-lock':
    case 'stale-spec-lock':
      return {
        panel: 'specs',
        tab: 'integrity',
        subject,
        reason: '在这里建立基线（spec lock），或先看影响分析再决定',
      };
    // 版本缺失：基线登记过但版本仓里查不到那份内容。
    case 'missing-spec-version':
    case 'missing-version-blob':
      return { panel: 'specs', tab: 'versions', subject, reason: '版本仓里缺这一份，看「版本」页签' };
    // 正文本身的问题（锚点重复 / 漂移 / 验收漂移 / 还是草稿）：去「Spec 文件」看正文。
    case 'duplicate-anchor':
    case 'anchor-drift':
    case 'acceptance-drift':
    case 'frozen-anchor-missing':
    case 'spec-is-draft':
      return { panel: 'specs', tab: 'files', subject, reason: '看这份 spec 的正文（漂移 / 草稿状态在下面对应行）' };
    case 'plan-integrity':
      return { panel: 'plans', subject, reason: '计划与 spec 对不上，在「计划」里重生成或重新冻结' };
    case 'no-plans':
      return { panel: 'plans', reason: '还没有计划：先拆解（plan generate）再冻结' };
    // change 侧的问题：基线冲突、状态不一致、多活跃 change、事务残留。
    case 'change-base-conflict':
    case 'change-state-integrity':
    case 'pending-change-transition':
    case 'incomplete-spec-transaction':
      return { panel: 'changes', subject, reason: '在「变更」里 rebase / 选当前 change / 收尾那条 change' };
    /**
     * 多活跃 change 的解法只有一条：**指定当前 change**（写保护守卫靠它判断写入属于谁）。
     * 落地页把活跃 change 列成可点的「设为当前」，并说明"不跑 agent 可以先放着"。
     */
    case 'multiple-active-changes':
      return {
        panel: 'changes',
        reason: '在「当前 change」卡里选一个设为当前（你正在做的那个）；遗留的收尾，不跑 agent 可以先放着',
      };
    case 'hook-guard-missing':
    case 'hook-entry-missing':
    case 'hook-guard-outdated':
    case 'hook-cli-missing':
    case 'hook-not-installed':
      return { panel: 'assets', tab: 'hook', subject, reason: '写保护装没装、装对没对，在「Hook 预览」页签' };
    // spec validate 的汇总结论：逐条 finding 在「影响与门禁」的「跨文件引用校验」里。
    case 'invalid-specs':
      return { panel: 'specs', tab: 'integrity', reason: '在「跨文件引用校验」里点一次校验，看逐条结论' };
    case 'concurrency-warn-expired':
    case 'concurrency-policy-unset':
    case 'concurrent-modification-warned':
      return { panel: 'settings', reason: '并发写保护策略在设置页' };
    default:
      // 兜底：spec 路径形态的 subject 一律可以进「Spec 文件」看正文。
      if (subject !== undefined && subject.startsWith('specs/')) {
        return { panel: 'specs', tab: 'files', subject };
      }
      // 说不出去处的（临时文件 / 证据占用 / 锁这类总览自己就能处理的）不给按钮。
      return null;
  }
}

/**
 * 目标的人话描述，如「规格 · 影响与门禁」。
 *
 * 两个用处：按钮的悬停提示（点下去之前就知道会去哪），以及落地页的横幅
 * （"我确实到了该来的地方"）。页签标签由映射表维护——写错的话这里会露出来。
 */
const TAB_LABELS: Record<string, string> = {
  'specs:integrity': '影响与门禁',
  'specs:versions': '版本',
  'specs:files': 'Spec 文件',
  'assets:hook': 'Hook 预览',
};

export function describeTarget(target: PanelTarget): string {
  const panel = PANELS.find((entry) => entry.id === target.panel);
  const label = panel?.label ?? target.panel;
  if (target.tab === undefined) return label;
  return label + ' · ' + (TAB_LABELS[target.panel + ':' + target.tab] ?? target.tab);
}
