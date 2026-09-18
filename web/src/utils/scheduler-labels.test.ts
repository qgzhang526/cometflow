import { describe, expect, it } from 'vitest';
import { decisionReasonLabel, stopReasonLabel, verdictLabel } from './scheduler-labels';

/**
 * 机器词 → 人话。
 *
 * 两条底线：**认得的词不能原样透出**（否则等于没翻），**认不得的词不能吞掉**
 * （后端新增状态词时，界面必须还能显示出来）。
 */
describe('调度状态词翻译', () => {
  it('认得的停止原因给中文 + 语义色', () => {
    expect(stopReasonLabel('no-queued-task')?.text).toBe('队列空了');
    expect(stopReasonLabel('waiting-on-active-change')?.tone).toBe('warn');
    expect(stopReasonLabel('stopped-by-control')?.text).toBe('收到停止指令');
    expect(stopReasonLabel('lease-held')?.text).toBe('已有调度器在跑');
    expect(stopReasonLabel('manual-single-pass')?.text).toContain('manual');
  });

  it('`needs-human:<verdict>` 把 verdict 一起翻出来', () => {
    const labeled = stopReasonLabel('needs-human:verify-failed');
    expect(labeled?.tone).toBe('err');
    expect(labeled?.text).toContain('需人工介入');
    expect(labeled?.text).toContain('验收未通过');
    // 认不得的 verdict 也不吞：原样接在后面。
    expect(stopReasonLabel('needs-human:weird-new-verdict')?.text).toContain('weird-new-verdict');
  });

  it('决策原因覆盖"跑了什么"，也能直接吃停止原因', () => {
    expect(decisionReasonLabel('task-delivered')?.tone).toBe('ok');
    expect(decisionReasonLabel('task-retry')?.text).toContain('重试');
    expect(decisionReasonLabel('started')?.text).toBe('刚启动');
    // 停止原因同时在决策词表里（停机那一轮的 last_decision 就是它）。
    expect(decisionReasonLabel('no-queued-task')?.text).toBe('队列空了');
    expect(decisionReasonLabel('needs-human:spec-conflict')?.text).toContain('spec 基线冲突');
    expect(decisionReasonLabel(null)).toBeNull();
  });

  it('交付结论有自己的措辞与颜色', () => {
    expect(verdictLabel('delivered')?.tone).toBe('ok');
    expect(verdictLabel('verify-failed')?.tone).toBe('warn');
    expect(verdictLabel('unverifiable')?.tone).toBe('err');
    expect(verdictLabel('in-flight')?.text).toContain('让开');
  });

  it('认不出来的词原样显示（不静默吞掉新状态）', () => {
    expect(stopReasonLabel('brand-new-reason')?.text).toBe('brand-new-reason');
    expect(verdictLabel('brand-new-verdict')?.text).toBe('brand-new-verdict');
    expect(stopReasonLabel('brand-new-reason')?.hint).toContain('未识别');
  });
});
